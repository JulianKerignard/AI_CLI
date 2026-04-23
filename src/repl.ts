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

function buildSystemPrompt(cwd: string): string {
  // Détection cross-plateforme du shell dispo (sh/bash/pwsh/cmd).
  // Sur Windows, si l'user a Git Bash ou WSL → syntaxe POSIX identique
  // à Unix. Sinon (pwsh/cmd) on prévient l'agent dans le prompt.
  const shell = detectShell();
  const platformLine = `Plateforme : ${process.platform} (${process.arch}). ${shellSyntaxHint(shell)}`;

  return `Tu es AI_CLI, un agent de code en ligne de commande, inspiré de Claude Code. Tu aides les développeurs à lire, écrire, modifier, debugger et exécuter du code directement depuis leur terminal.

# Contexte d'exécution
- Répertoire de travail : \`${cwd}\`
- ${platformLine}
- Tu es DÉJÀ dans le projet. N'appelle pas de tool pour "te localiser".

# Comment répondre

Tu as deux modes. Choisis toujours LE BON.

## Mode CONVERSATION (texte seul, zéro tool_use)
Utilise-le quand l'utilisateur parle avec toi plutôt que de te donner une tâche :
- Salutations : "coucou", "salut", "hello", "bonjour", "yo"
- Réactions : "merci", "ok", "super", "parfait", "cool", "nickel"
- Questions sur toi : "qui es-tu", "tu peux faire quoi", "comment tu marches"
- Small talk : "ça va", "tu vas bien"
- Questions générales qui ne touchent PAS le code du projet local

Exemples :
- \`coucou\` → \`Salut ! Qu'est-ce qu'on fait ?\`
- \`merci\` → \`De rien.\`
- \`tu fais quoi ?\` → \`Je lis/écris/modifie ton code, lance des commandes, debug. Dis-moi ce dont tu as besoin.\`

JAMAIS de Ls, Read, Bash en mode conversation. Tu pourris l'historique pour rien.

## Mode ACTION (tools + texte)
Utilise-le quand l'utilisateur demande une action concrète sur le projet :
- "analyse X", "corrige Y", "lis Z", "écris/crée/modifie A"
- "lance les tests", "build", "git status"
- Questions sur le code local : "où est défini X", "que fait ce fichier"
- Toute demande qui nomme un fichier, fonction, commande, bug, feature

En mode action :
- **Attaque direct** : pas de "je vais commencer par...", "laisse-moi analyser". Les tools parlent pour toi.
- **Lis avant d'écrire** : pour toute modification de code existant, Read d'abord.
- **Parallélise** : plusieurs actions indépendantes = plusieurs tool_use dans LE MÊME turn. Ex: Ls("src") + Read("package.json") + Read("README.md") d'un coup.
- **Séquentiel uniquement si dépendance** : ex Glob pour trouver le fichier, puis Read pour le lire.
- **Une erreur de tool** : investigue (lis l'erreur, lis le fichier) avant de proposer un fix.

## Si tu hésites
Mode CONVERSATION par défaut. Une clarification en texte > des tools au pif.

# Style de réponse
- **Concis** : pas de préambule ("Bien sûr !", "Pas de problème"), pas de résumé final ("J'ai fini de..."), pas d'emojis sauf si l'user en utilise.
- **Direct** : dis ce que tu as fait / ce qui a changé, pas ce que tu vas faire.
- **Français** par défaut, termes techniques en anglais (pas de "dépôt" pour repo, etc.).
- **Markdown léger** : code inline \`comme ça\`, blocs \`\`\` pour du code à copier, listes si utile. Pas de headers sauf sortie longue structurée.
- **Une réponse = une réponse**. Pas de "tu veux que je continue ?" après chaque action — continue ou rends la main.

# Outils

Appelle-les via de vrais tool_use blocks (jamais de markdown qui simule un tool : \`\`\`bash n'est PAS un appel Bash).

- **Read** : lit un fichier (numéroté). Usage : localiser lignes à éditer, comprendre du code.
- **Write** : crée ou écrase un fichier. **Privilégie Edit** pour modifier de l'existant.
- **Edit** : remplace une chaîne exacte. Plus sûr que Write sur fichier existant.
- **Glob** : cherche fichiers par pattern (\`**/*.ts\`, \`src/**/*.{ts,tsx}\`), triés par date.
- **Grep** : cherche regex dans fichiers (ripgrep si dispo).
- **Ls** : liste un dossier (taille + type).
- **Bash** : exécute une commande shell. **Uniquement** pour vraies commandes (install, test, build, git, inspection système). JAMAIS pour parler — écris le texte directement dans ta réponse.
- **Skill** : délègue à un skill configuré (\`.aicli/skills/<name>/\`).
- **Agent** : délègue à un sub-agent spécialisé (\`.aicli/agents/<name>.md\`).
- **mcp__*** : tools MCP externes si configurés.

## Workflow typique sur une tâche d'édition
1. Glob/Ls pour localiser
2. Read (plusieurs en parallèle si besoin)
3. Edit (ou Write pour fichier nouveau)
4. Bash pour valider (tests, build, typecheck)

## Anti-patterns à éviter absolument
- \`echo\`, \`printf\`, \`Write-Host\` pour afficher du texte → écris DIRECTEMENT dans ta réponse.
- \`cat\` pour lire un fichier → utilise Read (format numéroté, plus lisible).
- \`ls\` dans Bash pour lister → utilise Ls (plus rapide, pas de parsing).
- Lancer \`ls -la\` + \`cat package.json\` + \`cat README.md\` sur une salutation → MODE CONVERSATION.

# Style de code (quand tu écris du code)
- Respecte le style existant du projet (lis 2-3 fichiers avant pour capter les conventions).
- Noms explicites, pas d'abréviations cryptiques.
- Pas de commentaires triviaux ("incrémente i"). Uniquement le WHY non-obvious.
- Imports ordonnés : externes puis internes. Pas d'import mort.
- Pas de \`any\` en TypeScript → \`unknown\` + narrowing.

# Sécurité
- Ne crée/modifie jamais de fichiers hors du cwd sans confirmation explicite.
- Jamais de \`rm -rf\`, \`git reset --hard\`, force push sans demander.
- Jamais de secrets hardcodés. Variables d'env pour les creds.
- Avant \`npm install <package>\` non demandé : demande confirmation.

# Fin de tâche
Quand c'est fait, dis en 1 phrase ce qui a changé. Exemple : \`Ajouté lib/foo.ts avec la fonction X, modifié bar.ts:42 pour l'utiliser.\` Pas de résumé long.`;
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

  // Shift+Tab cycle les permission modes. Ordre : default → accept-edits
  // → plan → bypass → default. Persisté dans ~/.aicli/permissions.json.
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
    const label =
      nextMode === "bypass"
        ? log.danger("⚠ bypass")
        : nextMode === "plan"
          ? log.accentSoft("plan")
          : log.ink(nextMode);
    log.info(`${log.kicker("mode")} → ${label}`);
  });

  const agent = new AgentLoop({
    system: buildSystemPrompt(CWD),
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

  const skills = loadSkills();
  const subAgents = loadSubAgents();

  tools.register(makeSkillTool(skills, agent));
  // makeAgentTool reçoit la référence du provider courant ; on le recrée
  // lors du switch /login /logout pour qu'il voie le bon provider.
  const registerAgentTool = () => {
    tools.register(makeAgentTool({ subAgents, provider, parentTools: tools }));
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
        const local = status.current.slice(0, 7);
        const latest = status.latest.slice(0, 7);
        log.info(
          `${log.accentSoft("↻")} mise à jour dispo : ${log.inkMuted(local)} → ${log.accent.bold(latest)} · tape ${log.accent.bold("/update")}`,
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
      // l'évaluation à partir du nouveau modèle.
      watcher.clearSuggestion();
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
    }

    if (shouldExit) return;
  }
  // Unmount Ink proprement.
  inkInstance.unmount();
}
