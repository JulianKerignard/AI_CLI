import { extractText } from "./provider.js";
import { log, formatQuotaStatus } from "../utils/logger.js";
import { decide } from "../permissions/policy.js";
import { askPermission, logDenied } from "../permissions/prompt.js";
import { compactMessages, estimateTokens } from "./compactor.js";
import { contextWindowFor } from "../lib/context-window.js";
import { historyStore } from "../ui/history-store.js";
import { updateStatus, setSessionTotals, } from "../utils/status-bar.js";
export class AgentLoop {
    messages = [];
    opts;
    stats = {
        inputTokens: 0,
        outputTokens: 0,
        turns: 0,
        toolCalls: 0,
    };
    constructor(opts) {
        // Default 25 (aligné Claude Code) pour laisser les tâches multi-étapes aboutir.
        // Overridable via AICLI_MAX_ITERATIONS pour les power users.
        const envLimit = Number(process.env.AICLI_MAX_ITERATIONS);
        const defaultLimit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 25;
        this.opts = { ...opts, maxIterations: opts.maxIterations ?? defaultLimit };
    }
    getStats() {
        return { ...this.stats };
    }
    resetStats() {
        this.stats = {
            inputTokens: 0,
            outputTokens: 0,
            turns: 0,
            toolCalls: 0,
        };
    }
    get provider() {
        return this.opts.provider;
    }
    setProvider(provider) {
        this.opts.provider = provider;
    }
    setSystem(system) {
        this.opts.system = system;
    }
    reset() {
        this.messages.length = 0;
    }
    appendSystemNote(note) {
        // On l'injecte comme un message user système léger (le vrai Claude utilise system)
        this.messages.push({
            role: "user",
            content: [{ type: "text", text: `[système] ${note}` }],
        });
    }
    async send(userInput) {
        // Récupère les images attachées via /image. Si le modèle ne supporte
        // pas la vision, warn et drop les images (ne pas casser le send).
        const { takeAllAndClear } = await import("../ui/pending-images.js");
        const pending = takeAllAndClear();
        const content = [];
        if (pending.length > 0) {
            const { modelSupportsVision } = await import("./provider.js");
            const modelId = this.opts.provider.name.replace(/^http\(|\)$/g, "");
            if (!modelSupportsVision(modelId)) {
                log.warn(`${modelId} ne supporte pas la vision — ${pending.length} image(s) ignorée(s). Switch sur mistral-* ou gemini-* via /model.`);
            }
            else {
                // Anthropic format : images AVANT le texte pour que le modèle les
                // "voie" avec le contexte de la question qui suit.
                for (const img of pending)
                    content.push(img.block);
            }
        }
        content.push({ type: "text", text: userInput });
        this.messages.push({ role: "user", content });
        this.opts.onRecord?.("user", userInput);
        return await this.runUntilEnd();
    }
    async runUntilEnd() {
        const ctx = { cwd: this.opts.cwd };
        let finalText = "";
        // Agrège les tokens de cette commande utilisateur (tous les sous-tours
        // tool_use inclus). Affichés en une seule ligne à la fin.
        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let lastQuota;
        for (let i = 0; i < this.opts.maxIterations; i++) {
            // Compaction auto avant chaque tour : seuils absolus (30 msgs / 60k
            // tokens) OU seuil relatif 70% du context window du modèle courant.
            // Le relatif permet de gérer correctement les petits ctx (phi-4 16k).
            //
            // INVARIANT : appel synchrone avant provider.chat(). Pas de watcher
            // async → évite race condition avec messages[] pendant streaming.
            //
            // Si compact fail ET que le tokens est vraiment > ctx window, on
            // stop la boucle plutôt que de crash côté provider 400.
            const ctxWin = contextWindowFor(this.opts.provider.name);
            try {
                updateStatus({ phase: "compacting" });
                await compactMessages(this.messages, this.opts.provider, this.opts.system, ctxWin);
            }
            catch (err) {
                log.warn(`[compact] erreur : ${err instanceof Error ? err.message : err}`);
                // Vérifie si on est vraiment en danger de crash provider.
                const estimated = estimateTokens(this.messages) * 1.2;
                if (estimated > ctxWin) {
                    log.error(`[compact] historique trop gros (${Math.round(estimated)} tokens > ${ctxWin} ctx window) et compaction a échoué. Tape /compact pour retenter, ou /exit et recommence.`);
                    return finalText;
                }
            }
            // Status : 'loading' pendant la phase pre-premier-token (cold start
            // NVIDIA peut être long). Passe à 'streaming' dès le 1er delta.
            updateStatus({
                provider: this.opts.provider.name,
                phase: "loading",
                tokensIn: 0,
                tokensOut: 0,
            });
            // Streaming : on imprime le prefix assistant "●" + les text deltas en
            // live. Pendant le stream, le status est suspendu (évite le flicker
            // du hide/show à chaque token). Il est réactivé à la fin.
            let streamStarted = false;
            let streamedChars = 0;
            const startStream = () => {
                if (streamStarted)
                    return;
                streamStarted = true;
                updateStatus({ phase: "streaming" });
            };
            // Wrapper retry-on-upstream-error : si le provider throw un 429
            // déguisé (stream coupé mid-way, "terminated"), on pause avec
            // "waiting quota" + retry automatique au lieu de montrer l'erreur.
            const callProviderWithRetry = async () => {
                const MAX_RETRIES = 3;
                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    try {
                        return await this.opts.provider.chat({
                            system: this.opts.system,
                            messages: this.messages,
                            tools: this.opts.tools.list(),
                            onTextDelta: (delta) => {
                                startStream();
                                historyStore.appendAssistantDelta(delta);
                                streamedChars += delta.length;
                                updateStatus({ tokensOut: Math.ceil(streamedChars / 4) });
                            },
                        });
                    }
                    catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        const isRetryable = /rate limit|quota|interrompu|terminated|upstream|500|502|503|504/i.test(msg) && attempt < MAX_RETRIES - 1;
                        if (!isRetryable)
                            throw err;
                        // Pause progressive 15s → 30s → 60s avec countdown.
                        const waitMs = 15_000 * (attempt + 1);
                        updateStatus({
                            phase: "waiting-quota",
                            waitingMsRemaining: waitMs,
                            toolName: `retry ${attempt + 1}/${MAX_RETRIES}`,
                        });
                        const end = Date.now() + waitMs;
                        while (Date.now() < end) {
                            updateStatus({
                                waitingMsRemaining: Math.max(0, end - Date.now()),
                            });
                            await new Promise((r) => setTimeout(r, 500));
                        }
                        updateStatus({
                            phase: "loading",
                            waitingMsRemaining: undefined,
                            toolName: undefined,
                        });
                    }
                }
                throw new Error("Max retries atteint");
            };
            const response = await callProviderWithRetry();
            // Fin du stream : fige l'item assistant dans l'historique statique.
            if (streamStarted) {
                historyStore.endAssistant();
            }
            if (response.usage) {
                turnInputTokens += response.usage.inputTokens;
                turnOutputTokens += response.usage.outputTokens;
            }
            if (response.quota)
                lastQuota = response.quota;
            // Update status bar avec les tokens réels + quota dès qu'ils arrivent.
            updateStatus({
                tokensIn: response.usage?.inputTokens ?? 0,
                tokensOut: response.usage?.outputTokens ?? Math.ceil(streamedChars / 4),
                ...(response.quota
                    ? {
                        quotaUsed: response.quota.used,
                        quotaLimit: response.quota.limit,
                        resetAt: response.quota.resetAt,
                    }
                    : {}),
            });
            this.messages.push({ role: "assistant", content: response.content });
            this.opts.onRecord?.("assistant", response.content);
            const text = extractText(response.content);
            // Si le stream n'a pas affiché de texte (par ex. response vide ou tool_use
            // only), on n'affiche rien. Si on a streamé du texte, inutile de ré-imprimer.
            if (!streamStarted && text)
                log.assistant(text);
            finalText = text || finalText;
            if (response.stopReason !== "tool_use") {
                this.stats.inputTokens += turnInputTokens;
                this.stats.outputTokens += turnOutputTokens;
                this.stats.turns += 1;
                setSessionTotals(this.stats.inputTokens, this.stats.outputTokens);
                updateStatus({ phase: "idle" });
                if (lastQuota)
                    this.stats.lastQuota = lastQuota;
                return finalText;
            }
            // Exécute chaque tool_use et injecte les tool_result en un seul message user.
            const toolResults = [];
            for (const block of response.content) {
                if (block.type !== "tool_use")
                    continue;
                this.stats.toolCalls += 1;
                // Gate permissions AVANT d'appeler tools.run.
                const policy = this.opts.getPolicyState?.();
                if (policy) {
                    const d = decide(policy, block.name);
                    if (d === "deny") {
                        logDenied(block.name, policy.mode === "plan"
                            ? "mode plan (read-only)"
                            : "refusé par règle");
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: `Tool ${block.name} refusé par la politique de permissions (mode ${policy.mode}).`,
                            is_error: true,
                        });
                        continue;
                    }
                    if (d === "ask") {
                        const decision = await askPermission(block.name, block.input);
                        if (decision === "deny") {
                            logDenied(block.name, "refusé par l'utilisateur");
                            toolResults.push({
                                type: "tool_result",
                                tool_use_id: block.id,
                                content: `L'utilisateur a refusé l'exécution de ${block.name}. Propose une alternative ou demande comment procéder.`,
                                is_error: true,
                            });
                            continue;
                        }
                        if (decision === "allow-session") {
                            this.opts.onAllowSession?.(block.name);
                        }
                        if (decision === "allow-persist") {
                            this.opts.onAllowPersist?.(block.name);
                        }
                    }
                }
                this.opts.onToolUse?.(block.name, block.input);
                updateStatus({ phase: "executing-tool", toolName: block.name });
                // Affichage compact Claude-Code-style : ◆ Name(label). Le résumé du
                // résultat est ajouté après l'exécution. Si le tool ne fournit pas de
                // formatters, fallback sur l'ancien affichage verbeux.
                const toolDef = this.opts.tools.get(block.name);
                const hasCompact = !!(toolDef?.formatInvocation || toolDef?.formatResult);
                if (hasCompact) {
                    const label = toolDef?.formatInvocation?.(block.input) ?? "";
                    log.toolCompact(block.name, label);
                }
                else {
                    log.tool(block.name, JSON.stringify(block.input).slice(0, 120));
                }
                try {
                    const output = await this.opts.tools.run(block.name, block.input, ctx);
                    this.opts.onToolResult?.(block.name, output);
                    if (hasCompact && toolDef?.formatResult) {
                        log.toolResultCompact(toolDef.formatResult(block.input, output));
                    }
                    else if (!hasCompact) {
                        log.toolResult(output);
                    }
                    else {
                        // Tool a formatInvocation mais pas formatResult : 1 ligne générique.
                        const lines = output.split("\n").length;
                        log.toolResultCompact(`${lines} lines returned`);
                    }
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: output,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (hasCompact) {
                        log.toolResultCompact(msg, true);
                    }
                    else {
                        log.error(`[${block.name}] ${msg}`);
                    }
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: `Erreur: ${msg}`,
                        is_error: true,
                    });
                }
            }
            this.messages.push({ role: "user", content: toolResults });
            // Record les tool_results pour que /resume restore l'état complet.
            this.opts.onRecord?.("tool_result", toolResults);
        }
        log.warn(`Boucle agent: limite d'itérations (${this.opts.maxIterations}) atteinte. ` +
            `Tape \`continue\` pour reprendre ou set AICLI_MAX_ITERATIONS=50 pour augmenter la limite.`);
        this.stats.inputTokens += turnInputTokens;
        this.stats.outputTokens += turnOutputTokens;
        this.stats.turns += 1;
        if (lastQuota)
            this.stats.lastQuota = lastQuota;
        return finalText;
    }
}
// Ré-export helper pour consommation externe (commande /usage).
export { formatQuotaStatus };
