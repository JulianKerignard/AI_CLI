import React from "react";
import { render } from "ink";
import { CWD } from "./utils/paths.js";
import { log } from "./utils/logger.js";
import { InputHistory } from "./utils/history.js";
import { App } from "./ui/App.js";
import { inputController } from "./ui/input-controller.js";
import {
  newSessionId,
  openSession,
  appendEvent,
} from "./sessions/store.js";
import { BetterModelWatcher } from "./lib/better-model-watcher.js";
import { cleanProvider } from "./lib/context-window.js";
import { detectShell, shellSyntaxHint } from "./tools/shell-detect.js";
import { createBaseRegistry } from "./tools/registry.js";
import { DemoProvider } from "./agent/demo-provider.js";
import { HttpProvider } from "./agent/http-provider.js";
import { AgentLoop } from "./agent/loop.js";
import { CommandRegistry } from "./commands/registry.js";
import { loadSkills } from "./skills/loader.js";
import { makeSkillTool } from "./skills/tool.js";
import { loadSubAgents } from "./agents/loader.js";
import { makeAgentTool } from "./agents/tool.js";
import { loadMcpServers } from "./mcp/config.js";
import {
  loadCredentials,
  saveCredentials,
  checkCredentialsPerms,
  type Credentials,
} from "./auth/store.js";
import type { Provider } from "./agent/provider.js";
import {
  loadPermissions,
  savePermissions,
  type PermissionsConfig,
} from "./permissions/store.js";
import type {
  PermissionMode,
  PolicyState,
} from "./permissions/policy.js";
import {
  initStatusBar,
  teardownStatusBar,
  updateStatus,
} from "./utils/status-bar.js";

function buildSystemPrompt(cwd: string, mode: PermissionMode = "default"): string {
  const shell = detectShell();
  const platformLine = `${process.platform} (${process.arch}). ${shellSyntaxHint(shell)}`;

  // Bloc mode permission : injecté dynamiquement selon le mode courant.
  // Seul le bloc du mode actif est dans le prompt — les autres modes n'existent
  // pas pour l'agent à un instant t. Économise ~600 tokens vs envoyer les 4.
  const MODE_BLOCK: Record<PermissionMode, string> = {
    default: `Mode DEFAULT : confirmations Edit/Write/Bash gérées par l'UI, ignore-les.`,
    "accept-edits": `Mode ACCEPT-EDITS : Edit/Write/Bash auto-acceptés. Travaille vite.`,
    bypass: `Mode BYPASS : tous les tools auto, y compris destructifs. Aucune restriction.`,
    plan: `Mode PLAN : **lecture seule**. INTERDIT : Edit, Write, Bash qui modifie (install, rm, git push, etc.). AUTORISÉ : Read, Glob, Grep, Ls, Bash read-only.
Job : explore (parallélise) → propose un PLAN markdown (objectif, étapes avec fichiers, risques). Attends Shift+Tab pour exécuter. Si on te demande de modifier : réponds "Plan mode, sors-en pour exécuter → [plan]".`,
  };

  return `Tu es AI_CLI, agent de code terminal. Tu lis/écris/modifies/debug/exécutes du code.

${MODE_BLOCK[mode]}

# Contexte
- cwd: \`${cwd}\`
- ${platformLine}
- Tu es déjà dans le projet, pas besoin de te "localiser".

# Deux modes de réponse

**CONVERSATION** (zéro tool) : salutations, réactions ("merci", "ok"), questions sur toi, small talk, questions générales sans rapport au code local. Réponds en texte court. JAMAIS de Ls/Read/Bash sur un "coucou".

**ACTION** (tools + texte) : demandes concrètes sur le projet, lecture/écriture/exécution, questions sur le code local. Attaque direct sans préambule. Parallélise les tools indépendants (plusieurs tool_use par turn). Lis avant d'écrire. En cas d'erreur tool, investigue avant de re-tenter.

Si doute : CONVERSATION.

# Style
- **Concis par défaut** (comme Claude) : réponse courte, droit au but. Pas de préambule ("Bien sûr", "Voici"), pas de résumé final ("J'ai fini de...", "En résumé..."), pas d'emojis sauf si l'user en met.
- **Développe uniquement si l'user le demande explicitement** : "explique", "détaille", "pourquoi", "comment ça marche", "pas à pas". Sinon tais-toi après avoir fait.
- **Questions simples = réponses courtes** : 1-3 phrases suffisent pour la majorité des questions. Un diff ou un chemin file:line suffit souvent.
- Direct : dis ce qui a changé, pas ce que tu vas faire.
- Français, termes techniques en anglais.
- Markdown léger (code inline, blocs triple-backtick, listes si utile).
- Code : respecte le style du projet, noms explicites, pas de \`any\` TS, commentaires uniquement pour le "pourquoi" non-obvious.

# Anti-patterns
- \`echo\`/\`cat\`/\`ls\` en Bash pour afficher/lire/lister → texte direct ou Read/Ls.
- Pas de \`rm -rf\`, \`git reset --hard\`, force push sans demander.
- Pas de secrets hardcodés.

# Fin
1 phrase sur ce qui a changé. Ex: \`Ajouté lib/foo.ts, modifié bar.ts:42.\`.`;
}

function makeProvider(creds: Credentials | null): Provider {
  if (creds) {
    return new HttpProvider({
      token: creds.token,
      baseUrl: creds.baseUrl,
      model: creds.model,
    });
  }
  return new DemoProvider();
}

export async function startRepl(): Promise<void> {
  const tools = createBaseRegistry();

  let currentCreds = loadCredentials();
  const permCheck = checkCredentialsPerms();
  if (!permCheck.ok && permCheck.warning) log.warn(permCheck.warning);

  let provider = makeProvider(currentCreds);

  // Permissions : config persistante + état session mutable.
  let permConfig: PermissionsConfig = loadPermissions();
  const sessionAllowed = new Set<string>();

  const getPolicyState = (): PolicyState => ({
    mode: permConfig.mode,
    sessionAllowed,
    alwaysAllow: new Set(permConfig.alwaysAllow),
  });

  // Ouverture d'une session AI_CLI — écrit un JSONL dans
  // ~/.aicli/sessions/<cwd-hash>/<sessionId>.jsonl. Permet /resume de
  // retrouver les conversations lancées depuis ce même dossier.
  const sessionId = newSessionId();
  const sessionPath = openSession(sessionId, CWD, provider.name);

  const agent = new AgentLoop({
    system: buildSystemPrompt(CWD, permConfig.mode),
    provider,
    tools,
    cwd: CWD,
    getPolicyState,
    onRecord: (type, content) => {
      appendEvent(sessionPath, type, content);
    },
    onAllowSession: (toolName) => {
      sessionAllowed.add(toolName);
    },
    onAllowPersist: (toolName) => {
      if (!permConfig.alwaysAllow.includes(toolName)) {
        permConfig = {
          ...permConfig,
          alwaysAllow: [...permConfig.alwaysAllow, toolName],
        };
        savePermissions(permConfig);
      }
    },
  });

  // Shift+Tab cycle les permission modes. Ordre : default → accept-edits
  // → plan → bypass → default. Persisté dans ~/.aicli/permissions.json.
  // Rebuild aussi le system prompt pour que l'agent sache dans quel mode
  // il est (ex: plan mode = pas de write/edit).
  const MODE_CYCLE: PermissionMode[] = [
    "default",
    "accept-edits",
    "plan",
    "bypass",
  ];
  inputController.on("cycle-permission-mode", () => {
    const currentIdx = MODE_CYCLE.indexOf(permConfig.mode);
    const nextMode = MODE_CYCLE[(currentIdx + 1) % MODE_CYCLE.length];
    permConfig = { ...permConfig, mode: nextMode };
    savePermissions(permConfig);
    updateStatus({ permissionMode: nextMode });
    // Reinjecte le system prompt avec le nouveau mode. L'agent saura
    // qu'il est en plan mode (ou autre) dès le prochain turn.
    agent.setSystem(buildSystemPrompt(CWD, nextMode));
    const label =
      nextMode === "bypass"
        ? log.danger("⚠ bypass")
        : nextMode === "plan"
          ? log.accentSoft("plan")
          : log.ink(nextMode);
    log.info(`${log.kicker("mode")} → ${label}`);
  });

  const skills = loadSkills();
  const subAgents = loadSubAgents();

  tools.register(makeSkillTool(skills, agent));
  // makeAgentTool reçoit la référence du provider courant ; on le recrée
  // lors du switch /login /logout pour qu'il voie le bon provider.
  // On propage aussi getPolicyState + allow handlers pour que les sub-agents
  // respectent le mode parent (sinon bypass trivial du plan mode).
  const registerAgentTool = () => {
    tools.register(
      makeAgentTool({
        subAgents,
        provider,
        parentTools: tools,
        getPolicyState,
        onAllowSession: (toolName) => sessionAllowed.add(toolName),
        onAllowPersist: (toolName) => {
          if (!permConfig.alwaysAllow.includes(toolName)) {
            permConfig = {
              ...permConfig,
              alwaysAllow: [...permConfig.alwaysAllow, toolName],
            };
            savePermissions(permConfig);
          }
        },
      }),
    );
  };
  registerAgentTool();

  const mcpServers = await loadMcpServers(tools);

  const commands = new CommandRegistry();
  // Expose à l'InputBox pour l'autocomplete slash.
  const { setSlashCommands } = await import("./ui/slash-store.js");
  setSlashCommands(
    commands.list().map((c) => ({ name: c.name, description: c.description })),
  );

  // initStatusBar enregistre les handlers SIGINT/SIGTERM — OK d'appeler
  // avant le banner. Mais on DIFFÈRE updateStatus (qui déclenche le premier
  // render) jusqu'APRÈS le banner, sinon le status s'imprime en haut puis
  // le banner passe par-dessus et on voit le status deux fois.
  initStatusBar();

  // Mount l'App Ink : layout output + input box + status line.
  // Les log.* poussent maintenant dans le history store (via logger.ts
  // refactorisé). L'input attend inputController.submit() depuis InputBox.
  // Redirige aussi les console.log des commandes builtin (qui utilisent
  // console.log direct) vers le store — sinon Ink capte mais masque.
  const { installConsolePatch } = await import("./ui/history-store.js");
  installConsolePatch();
  // InputHistory est instantiée tôt pour pouvoir être passée à l'App.
  const history = new InputHistory();
  const inkInstance = render(
    React.createElement(App as React.ComponentType<{ history: InputHistory }>, {
      history,
    }),
    {
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  // Banner poussé dans l'historique après mount.
  log.banner("AI_CLI v0.1.0");
  log.info(
    `${log.kicker("provider")}  ${log.ink(cleanProvider(provider.name))}   ${log.kicker("cwd")}  ${log.inkMuted(CWD)}`,
  );
  log.info(
    `${log.kicker("loaded")}  ${log.inkMuted(
      `${tools.list().length} tools · ${skills.length} skills · ${subAgents.length} agents · ${mcpServers.length} MCP`,
    )}`,
  );
  const modeDisplay =
    permConfig.mode === "bypass"
      ? log.danger("⚠ " + permConfig.mode)
      : permConfig.mode === "plan"
        ? log.accentSoft(permConfig.mode)
        : log.ink(permConfig.mode);
  log.info(`${log.kicker("mode")}      ${modeDisplay}`);
  // Affiche le shell détecté — utile pour que l'user sache si il est
  // sur Git Bash, WSL, pwsh ou cmd sur Windows.
  const detectedShell = detectShell();
  log.info(
    `${log.kicker("shell")}     ${log.inkMuted(detectedShell.label)}`,
  );
  if (!currentCreds) {
    log.info(
      `${log.accentSoft("→")} tape ${log.accent.bold("/login")} ${log.inkMuted(
        "pour te connecter à chat.juliankerignard.fr",
      )}`,
    );
  }

  // Update check non-bloquant : fire-and-forget, résultat push dans
  // l'historique si une nouvelle version est dispo. Cache 6h → n'affiche
  // pas plus d'1 fois par session typique.
  void (async () => {
    try {
      const { checkForUpdate } = await import("./lib/update-check.js");
      const status = await checkForUpdate();
      if (status?.updateAvailable && status.latest) {
        log.info(
          `${log.accentSoft("↻")} mise à jour dispo (${status.channel}) : ${log.inkMuted(status.current)} → ${log.accent.bold(status.latest)} · tape ${log.accent.bold("/update")}`,
        );
      }
    } catch {
      /* silencieux — check échoué n'est pas bloquant */
    }
  })();

  updateStatus({
    provider: provider.name,
    phase: currentCreds ? "idle" : "offline",
    permissionMode: permConfig.mode,
  });

  // Watcher background : déclaré tôt pour que cleanup() puisse le stop
  // sans TDZ. Start ci-dessous une fois auth setup.
  const watcher = new BetterModelWatcher(
    () => currentCreds,
    "balanced",
  );

  const cleanup = () => {
    teardownStatusBar();
    for (const s of mcpServers) s.close();
    watcher.stop();
  };

  let shouldExit = false;
  const exit = () => {
    shouldExit = true;
    cleanup();
    log.info("Au revoir.");
    process.exit(0);
  };

  // Restart in-place après /update : unmount Ink, restaure stdin en mode
  // normal, spawn un nouveau aicli avec stdio hérité. Le parent se bloque
  // sur spawnSync pendant que le child occupe le terminal ; quand l'user
  // quitte le nouveau REPL, le parent exit avec le même code.
  // Permet d'éviter d'avoir à faire /exit + aicli après /update.
  const restartApp = () => {
    cleanup();
    try {
      inkInstance.unmount();
    } catch {
      /* peut être déjà démonté */
    }
    // Laisse Ink finir son cleanup stdin avant spawnSync (raw mode off).
    // Sans ça, le child hérite d'un stdin encore en raw mode incohérent.
    setTimeout(async () => {
      const { spawnSync } = await import("node:child_process");
      const nodeBin = process.execPath;
      // argv[1] = path vers dist/index.js (ou src/index.ts en dev).
      // Relance le MÊME script, avec les mêmes args (--mode=..., etc.).
      const scriptPath = process.argv[1];
      const args = process.argv.slice(2);
      log.info("Relance aicli…");
      const result = spawnSync(nodeBin, [scriptPath, ...args], {
        stdio: "inherit",
        env: process.env,
      });
      process.exit(result.status ?? 0);
    }, 50);
  };

  const auth = {
    getCredentials: () => currentCreds,
    onLogin: (creds: Credentials) => {
      currentCreds = creds;
      saveCredentials(creds);
      provider = makeProvider(creds);
      agent.setProvider(provider);
      registerAgentTool();
      // Invalide le cache catalog — nouveau serveur/modèle possible.
      void import("./lib/model-catalog.js").then((m) => m.invalidateCatalog());
      updateStatus({
        provider: provider.name,
        contextWindow: undefined,
        phase: "idle",
      });
      // Reset la suggestion : l'user vient de switcher, on redémarre
      // l'évaluation à partir du nouveau modèle. Force un refresh immédiat
      // pour recalculer Q/V du nouveau modèle sans attendre le poll.
      watcher.clearSuggestion();
      watcher.forceRefresh();
    },
    onLogout: () => {
      currentCreds = null;
      provider = makeProvider(null);
      agent.setProvider(provider);
      registerAgentTool();
      updateStatus({
        provider: provider.name,
        contextWindow: undefined,
        phase: "offline",
      });
      watcher.clearSuggestion();
    },
  };

  // Démarre le watcher après setup de auth (il a besoin de getCredentials).
  watcher.start();

  const permissions = {
    getMode: () => permConfig.mode,
    setMode: (mode: PermissionMode, persist = true) => {
      permConfig = { ...permConfig, mode };
      if (persist) savePermissions(permConfig);
    },
    getAlwaysAllow: () => [...permConfig.alwaysAllow],
    addAlwaysAllow: (toolName: string) => {
      if (!permConfig.alwaysAllow.includes(toolName)) {
        permConfig = {
          ...permConfig,
          alwaysAllow: [...permConfig.alwaysAllow, toolName],
        };
        savePermissions(permConfig);
      }
    },
    removeAlwaysAllow: (toolName: string) => {
      permConfig = {
        ...permConfig,
        alwaysAllow: permConfig.alwaysAllow.filter((t) => t !== toolName),
      };
      savePermissions(permConfig);
    },
    getSessionAllowed: () => [...sessionAllowed],
    clearSessionAllowed: () => {
      sessionAllowed.clear();
    },
  };

  // Boucle REPL : attend des lignes depuis l'InputBox Ink via
  // inputController. Un seul owner stdin (Ink), donc pas de collision.
  let ctrlCCount = 0;
  let ctrlCResetTimer: NodeJS.Timeout | null = null;

  while (!shouldExit) {
    let input: string;
    try {
      input = (await inputController.waitForLine()).trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "INTERRUPT") {
        log.error(msg);
        continue;
      }
      ctrlCCount += 1;
      if (ctrlCCount >= 2) {
        exit();
        return;
      }
      log.dim("(Ctrl-C encore pour quitter, ou /exit)");
      if (ctrlCResetTimer) clearTimeout(ctrlCResetTimer);
      ctrlCResetTimer = setTimeout(() => {
        ctrlCCount = 0;
      }, 1500);
      continue;
    }
    ctrlCCount = 0;
    if (ctrlCResetTimer) {
      clearTimeout(ctrlCResetTimer);
      ctrlCResetTimer = null;
    }

    if (!input) continue;
    history.add(input);
    const { historyStore } = await import("./ui/history-store.js");
    historyStore.push({ type: "user", text: input });

    // Désactive l'InputBox pendant l'exécution pour éviter les saisies
    // parallèles. L'user ne peut pas envoyer un nouveau message tant
    // que l'agent n'a pas terminé. Ré-enable dans finally.
    inputController.setDisabled(true);
    try {
      if (input.startsWith("/")) {
        await commands.run(input, {
          agent,
          tools,
          skills,
          subAgents,
          mcpServers,
          auth,
          permissions,
          exit,
          refreshCatalog: () => watcher.forceRefresh(),
          restartApp,
        });
      } else {
        await agent.send(input);
      }
    } catch (err) {
      log.error((err as Error).message);
    } finally {
      // Ré-enable l'input pour le prochain tour — qu'il y ait eu erreur
      // ou non, qu'on ait été /exit ou non.
      inputController.setDisabled(false);
      // Windows / PowerShell : sur certains terminaux le raw mode stdin
      // se perd après l'exec d'une slash command (re-render Ink, console.log,
      // subprocess inherited stdio). Sans ça, useInput d'Ink ne capte plus
      // aucune touche au tour suivant. On force le re-engage ici — no-op
      // sur macOS/Linux si le raw mode était déjà actif.
      if (
        process.stdin.isTTY &&
        typeof process.stdin.setRawMode === "function"
      ) {
        try {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        } catch {
          /* ignore — certains terminaux non-TTY */
        }
      }
    }

    if (shouldExit) return;
  }
  // Unmount Ink proprement.
  inkInstance.unmount();
}
