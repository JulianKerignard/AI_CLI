import React from "react";
import { render } from "ink";
import { CWD } from "./utils/paths.js";
import { log } from "./utils/logger.js";
import { InputHistory } from "./utils/history.js";
import { App } from "./ui/App.js";
import { inputController } from "./ui/input-controller.js";
import { newSessionId, openSession, appendEvent, } from "./sessions/store.js";
import { BetterModelWatcher } from "./lib/better-model-watcher.js";
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
import { loadCredentials, saveCredentials, checkCredentialsPerms, } from "./auth/store.js";
import { loadPermissions, savePermissions, } from "./permissions/store.js";
import { initStatusBar, teardownStatusBar, updateStatus, } from "./utils/status-bar.js";
function buildSystemPrompt(cwd) {
    // Détection cross-plateforme du shell dispo (sh/bash/pwsh/cmd).
    // Sur Windows, si l'user a Git Bash ou WSL → syntaxe POSIX identique
    // à Unix. Sinon (pwsh/cmd) on prévient l'agent dans le prompt.
    const shell = detectShell();
    const platformLine = `Plateforme : ${process.platform} (${process.arch}). ${shellSyntaxHint(shell)}`;
    return `Tu es AI_CLI, un agent de code qui tourne dans un terminal, inspiré de Claude Code.

# Contexte d'exécution
Tu tournes DANS le répertoire de l'utilisateur : ${cwd}
${platformLine}
C'est ton répertoire de travail courant. Tu n'as pas besoin de demander où est le projet — tu y es déjà.

# Ton rôle
Assistant de développement logiciel. Tu aides l'utilisateur à écrire, lire, modifier, debugger, exécuter du code. Tu as accès à des outils (Read, Write, Bash, Skill, Agent, mcp__*) que tu appelles directement via tool_use. JAMAIS de pseudo-code markdown qui simule un appel d'outil (\`<function>Bash</function>\`, \`\`\`bash etc.) — soit tu appelles l'outil réellement, soit tu réponds en texte.

# Comportement
- Action d'abord : pas de "je vais analyser", "je commence par...". Appelle directement les outils qu'il faut.
- Pas de questions inutiles : si l'utilisateur dit "analyse le projet", tu lances \`ls -la\` + \`cat package.json\` (ou équivalent) sans demander.
- Concis : réponds court et direct. Pas de préambule, pas de résumé final, pas d'emojis sauf demande explicite.
- Français par défaut, termes techniques en anglais.
- Si une commande échoue, investigue (lis l'erreur, lis le fichier concerné) avant de proposer un fix.
- Pour tout changement non-trivial sur du code existant, lis d'abord le fichier avant d'éditer.

# Outils disponibles
Utilise-les via des vrais tool_use blocks (pas du texte). Liste :
- **Read** : lit un fichier (numéroté, utile pour localiser les lignes à éditer ensuite)
- **Write** : crée ou écrase un fichier (privilégie Edit pour modifier l'existant)
- **Edit** : remplace une chaîne exacte dans un fichier (plus sûr que Write sur de l'existant)
- **Glob** : trouve des fichiers par pattern ('**/*.ts', 'src/**/*.{ts,tsx}'), triés par date
- **Grep** : cherche un regex dans les fichiers (utilise ripgrep si dispo)
- **Ls** : liste un répertoire (taille + type)
- **Bash** : exécute une commande shell (\`npm test\`, \`git status\`, build, etc.)
- **Skill/Agent** : délègue à un skill ou sub-agent configuré

Workflow typique sur une tâche :
1. Ls ou Glob pour localiser les fichiers
2. Read pour lire le fichier concerné
3. Edit (ou Write pour un nouveau) pour la modification
4. Bash pour tester (\`npm run build\`, \`npm test\`, etc.)

# Parallélisation des tools (IMPORTANT)
Quand plusieurs actions sont indépendantes, émets TOUS les tool_use dans la MÊME
réponse au lieu de les faire un par un. Exemples :
- Explorer un projet : 1 seul turn avec Ls("src") + Ls("tests") + Read("package.json") + Read("README.md") en parallèle
- Lire plusieurs fichiers liés : tous les Read en même temps
- Cherche dans plusieurs dossiers : Glob x3 dans le même turn
Ne fais séquentiel QUE si l'action N dépend du résultat de l'action N-1 (ex: Ls
d'abord pour découvrir les fichiers, puis Read ensuite). Chaque turn sans
parallélisation = 1 requête Mistral de plus vers un rate limit bas.

# Style de code
Conventions standard : code propre, noms explicites, pas de commentaires triviaux. Respecte le style existant du projet (lis quelques fichiers avant d'écrire pour capter les conventions).`;
}
function makeProvider(creds) {
    if (creds) {
        return new HttpProvider({
            token: creds.token,
            baseUrl: creds.baseUrl,
            model: creds.model,
        });
    }
    return new DemoProvider();
}
export async function startRepl() {
    const tools = createBaseRegistry();
    let currentCreds = loadCredentials();
    const permCheck = checkCredentialsPerms();
    if (!permCheck.ok && permCheck.warning)
        log.warn(permCheck.warning);
    let provider = makeProvider(currentCreds);
    // Permissions : config persistante + état session mutable.
    let permConfig = loadPermissions();
    const sessionAllowed = new Set();
    const getPolicyState = () => ({
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
    const inkInstance = render(React.createElement(App, {
        history,
    }), {
        exitOnCtrlC: false,
        patchConsole: false,
    });
    // Banner poussé dans l'historique après mount.
    log.banner("AI_CLI v0.1.0");
    log.info(`${log.kicker("provider")}  ${log.ink(provider.name)}   ${log.kicker("cwd")}  ${log.inkMuted(CWD)}`);
    log.info(`${log.kicker("loaded")}  ${log.inkMuted(`${tools.list().length} tools · ${skills.length} skills · ${subAgents.length} agents · ${mcpServers.length} MCP`)}`);
    const modeDisplay = permConfig.mode === "bypass"
        ? log.danger("⚠ " + permConfig.mode)
        : permConfig.mode === "plan"
            ? log.accentSoft(permConfig.mode)
            : log.ink(permConfig.mode);
    log.info(`${log.kicker("mode")}      ${modeDisplay}`);
    // Affiche le shell détecté — utile pour que l'user sache si il est
    // sur Git Bash, WSL, pwsh ou cmd sur Windows.
    const detectedShell = detectShell();
    log.info(`${log.kicker("shell")}     ${log.inkMuted(detectedShell.label)}`);
    if (!currentCreds) {
        log.info(`${log.accentSoft("→")} tape ${log.accent.bold("/login")} ${log.inkMuted("pour te connecter à chat.juliankerignard.fr")}`);
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
                log.info(`${log.accentSoft("↻")} mise à jour dispo : ${log.inkMuted(local)} → ${log.accent.bold(latest)} · tape ${log.accent.bold("/update")}`);
            }
        }
        catch {
            /* silencieux — check échoué n'est pas bloquant */
        }
    })();
    updateStatus({
        provider: provider.name,
        phase: currentCreds ? "idle" : "offline",
    });
    // Watcher background : déclaré tôt pour que cleanup() puisse le stop
    // sans TDZ. Start ci-dessous une fois auth setup.
    const watcher = new BetterModelWatcher(() => currentCreds, "balanced");
    const cleanup = () => {
        teardownStatusBar();
        for (const s of mcpServers)
            s.close();
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
        onLogin: (creds) => {
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
        setMode: (mode, persist = true) => {
            permConfig = { ...permConfig, mode };
            if (persist)
                savePermissions(permConfig);
        },
        getAlwaysAllow: () => [...permConfig.alwaysAllow],
        addAlwaysAllow: (toolName) => {
            if (!permConfig.alwaysAllow.includes(toolName)) {
                permConfig = {
                    ...permConfig,
                    alwaysAllow: [...permConfig.alwaysAllow, toolName],
                };
                savePermissions(permConfig);
            }
        },
        removeAlwaysAllow: (toolName) => {
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
    let ctrlCResetTimer = null;
    while (!shouldExit) {
        let input;
        try {
            input = (await inputController.waitForLine()).trim();
        }
        catch (err) {
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
            if (ctrlCResetTimer)
                clearTimeout(ctrlCResetTimer);
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
        if (!input)
            continue;
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
            }
            else {
                await agent.send(input);
            }
        }
        catch (err) {
            log.error(err.message);
        }
        finally {
            // Ré-enable l'input pour le prochain tour — qu'il y ait eu erreur
            // ou non, qu'on ait été /exit ou non.
            inputController.setDisabled(false);
        }
        if (shouldExit)
            return;
    }
    // Unmount Ink proprement.
    inkInstance.unmount();
}
