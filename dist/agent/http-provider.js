import { RateLimiter } from "../lib/rate-limiter.js";
import { updateStatus } from "../utils/status-bar.js";
// Deux limiters côté CLI selon le provider du modèle actif :
// - Mistral free : 4 req/min → on cible 3/min (marge 25%)
// - NVIDIA NIM : 40 req/min par modèle sur free tier Developer → 30/min
//   (marge 25% anti-burst, les 10 restants absorbent les cron latency +
//   burst de tool calls parallèles)
//
// Les modèles NVIDIA sont préfixés "nvidia/" (convention Chat-Mistral).
// Les personas (maxime-latest, etc.) routent vers Mistral côté serveur,
// donc bucket Mistral côté client.
const MISTRAL_LIMITER = new RateLimiter({ capacity: 3, windowMs: 60_000 });
const NVIDIA_LIMITER = new RateLimiter({ capacity: 30, windowMs: 60_000 });
function isNvidiaModel(model) {
    return model.startsWith("nvidia/");
}
function limiterFor(model) {
    return isNvidiaModel(model) ? NVIDIA_LIMITER : MISTRAL_LIMITER;
}
// Attend la prochaine slot libre du limiter associé au modèle. Le status
// bar affiche "⏳ waiting Xs" avec countdown décroissant. Ne fait rien si
// la slot est immédiatement dispo.
async function waitWithStatus(limiter) {
    // Atomique : réserve la slot si dispo (= 0ms wait), sinon retourne le
    // delay sans toucher au bucket. Évite la race 2-callers qui dépassent
    // la capacité.
    let delayMs = limiter.reserveOrGetDelay();
    if (delayMs === 0) {
        const snap = limiter.snapshot();
        updateStatus({
            bucketUsed: snap.used,
            bucketCapacity: snap.capacity,
        });
        return;
    }
    // Pas de slot immédiate : on attend, puis on retente à chaque tick
    // (au cas où la concurrence a bougé).
    updateStatus({
        phase: "waiting-quota",
        waitingMsRemaining: delayMs,
    });
    while (delayMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(500, delayMs)));
        delayMs = limiter.reserveOrGetDelay();
        updateStatus({ waitingMsRemaining: delayMs > 0 ? delayMs : undefined });
    }
    const snap3 = limiter.snapshot();
    // Phase "loading" : entre la fin du wait bucket et le premier token
    // reçu. Cold start NVIDIA peut être long — l'user voit 'chargement
    // du modèle…' pour comprendre que c'est normal. Bascule automatique
    // en "streaming" dès le premier delta (agent/loop.ts).
    updateStatus({
        phase: "loading",
        waitingMsRemaining: undefined,
        bucketUsed: snap3.used,
        bucketCapacity: snap3.capacity,
    });
}
// Messages d'erreur user-friendly (vs "HTTP 401 depuis .../v1/messages :
// {\"error\":...}") pour que l'user sache quoi faire.
function buildFriendlyError(status, bodyText) {
    if (status === 401) {
        return new Error("Token API expiré ou invalide. Tape /login pour te reconnecter.");
    }
    if (status === 403) {
        return new Error("Accès refusé. Vérifie ta clé API via /login.");
    }
    if (status === 429) {
        return new Error("Quota dépassé ou rate limit. Attends ~1 min ou essaie un autre modèle via /best fast.");
    }
    if (status >= 500) {
        return new Error(`Serveur indisponible (HTTP ${status}). Réessaie dans quelques secondes.`);
    }
    if (status === 0) {
        return new Error("Réseau injoignable. Vérifie ta connexion.");
    }
    // 4xx autres : on passe le message upstream (potentiellement utile).
    const snippet = bodyText.slice(0, 160).replace(/\s+/g, " ").trim();
    return new Error(`Erreur ${status}${snippet ? ` : ${snippet}` : ""}`);
}
// Provider HTTP qui parle Anthropic Messages API. Cible : endpoint Chat-Mistral
// `POST /api/v1/messages` qui proxifie vers Mistral. Mode streaming SSE avec
// support tool_use (accumule les input_json_delta, JSON.parse à la fin du bloc).
export class HttpProvider {
    opts;
    name;
    constructor(opts) {
        this.opts = opts;
        this.name = `http(${opts.model})`;
    }
    async chat(opts) {
        const anthropicMessages = opts.messages.map((m) => ({
            role: m.role === "tool" ? "user" : m.role,
            content: m.content,
        }));
        const body = {
            model: this.opts.model,
            max_tokens: 8192,
            system: opts.system,
            messages: anthropicMessages,
            tools: opts.tools.length > 0
                ? opts.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.schema,
                }))
                : undefined,
            stream: true,
        };
        // Rate limiter + retry combinés. Le limiter empêche proactivement les
        // 429 (attente avant d'émettre). Si un 429 arrive quand même (d'autres
        // clients sur la même key, rate limit serveur côté scope), on honore
        // Retry-After + on passe le bucket en mode cold.
        // Choix du bucket selon le provider : Mistral (3/min) ou NVIDIA (50/min).
        const limiter = limiterFor(this.opts.model);
        const maxAttempts = 3;
        let res;
        let lastErrText = "";
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Attente bucket avec affichage live countdown dans le status bar.
            await waitWithStatus(limiter);
            res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.opts.token,
                    Accept: "text/event-stream",
                },
                body: JSON.stringify(body),
            });
            if (res.ok && res.body)
                break;
            lastErrText = await res.text().catch(() => "");
            if (res.status === 429 && attempt < maxAttempts - 1) {
                // Honor Retry-After (seconds) si header présent, sinon backoff fixe.
                const retryAfterHeader = res.headers.get("retry-after");
                const retryAfterMs = retryAfterHeader
                    ? Math.min(Number(retryAfterHeader) * 1000, 60_000)
                    : 8_000 * 2 ** attempt;
                limiter.markCold(retryAfterMs);
                // Status bar affiche le countdown du retry.
                updateStatus({
                    phase: "waiting-quota",
                    waitingMsRemaining: retryAfterMs,
                    toolName: `retry ${attempt + 1}/${maxAttempts}`,
                });
                const end = Date.now() + retryAfterMs;
                while (Date.now() < end) {
                    updateStatus({ waitingMsRemaining: Math.max(0, end - Date.now()) });
                    await new Promise((r) => setTimeout(r, 500));
                }
                updateStatus({
                    waitingMsRemaining: undefined,
                    toolName: undefined,
                    phase: "loading",
                });
                continue;
            }
            throw buildFriendlyError(res.status, lastErrText);
        }
        if (!res || !res.ok || !res.body) {
            throw buildFriendlyError(res?.status ?? 0, lastErrText);
        }
        // État accumulateur par index de content_block.
        const textAccum = new Map();
        const toolAccum = new Map();
        // Ordre d'apparition des blocks (pour reconstituer le content final).
        const blockOrder = [];
        let stopReason = "end_turn";
        let usage;
        const decoder = new TextDecoder();
        let buf = "";
        const reader = res.body.getReader();
        // Capture les erreurs mid-stream (undici "terminated" quand upstream coupe
        // la connexion, ex: Mistral 429 pendant le reasoning magistral). Si on a
        // déjà accumulé du text → return partial. Sinon throw retryable.
        let streamError = null;
        while (true) {
            let readResult;
            try {
                readResult = await reader.read();
            }
            catch (err) {
                streamError = err instanceof Error ? err : new Error(String(err));
                break;
            }
            const { value, done } = readResult;
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            // SSE : events séparés par \n\n. Chaque event a des lignes "field: value".
            // On ne se soucie que de "data:" ; on ignore "event:" qui est cosmétique.
            let sep;
            while ((sep = buf.indexOf("\n\n")) !== -1) {
                const chunk = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                const dataLines = [];
                for (const line of chunk.split("\n")) {
                    if (line.startsWith("data:"))
                        dataLines.push(line.slice(5).trimStart());
                }
                if (dataLines.length === 0)
                    continue;
                const jsonText = dataLines.join("\n");
                let event;
                try {
                    event = JSON.parse(jsonText);
                }
                catch {
                    continue;
                }
                switch (event.type) {
                    case "message_start":
                        if (event.message?.usage?.input_tokens !== undefined) {
                            usage = {
                                inputTokens: event.message.usage.input_tokens,
                                outputTokens: event.message.usage.output_tokens ?? 0,
                            };
                        }
                        break;
                    case "content_block_start": {
                        const idx = event.index ?? 0;
                        if (!blockOrder.includes(idx))
                            blockOrder.push(idx);
                        const cb = event.content_block;
                        if (cb?.type === "text") {
                            textAccum.set(idx, "");
                        }
                        else if (cb?.type === "tool_use" && cb.name && cb.id) {
                            toolAccum.set(idx, {
                                id: cb.id,
                                name: cb.name,
                                argsRaw: "",
                            });
                        }
                        break;
                    }
                    case "content_block_delta": {
                        const idx = event.index ?? 0;
                        const d = event.delta;
                        if (!d)
                            break;
                        if (d.type === "text_delta" && typeof d.text === "string") {
                            const prev = textAccum.get(idx) ?? "";
                            textAccum.set(idx, prev + d.text);
                            opts.onTextDelta?.(d.text);
                        }
                        else if (d.type === "input_json_delta" &&
                            typeof d.partial_json === "string") {
                            const t = toolAccum.get(idx);
                            if (t)
                                t.argsRaw += d.partial_json;
                        }
                        break;
                    }
                    case "content_block_stop": {
                        const idx = event.index ?? 0;
                        const t = toolAccum.get(idx);
                        if (t) {
                            let input = {};
                            if (t.argsRaw) {
                                try {
                                    input = JSON.parse(t.argsRaw);
                                }
                                catch {
                                    input = { _raw: t.argsRaw };
                                }
                            }
                            opts.onToolUse?.({
                                type: "tool_use",
                                id: t.id,
                                name: t.name,
                                input,
                            });
                        }
                        break;
                    }
                    case "message_delta":
                        if (event.delta?.stop_reason === "tool_use")
                            stopReason = "tool_use";
                        if (event.usage?.output_tokens !== undefined && usage) {
                            usage.outputTokens = event.usage.output_tokens;
                        }
                        break;
                    case "message_stop":
                        // Fin du flux — loop externe se termine naturellement au done reader.
                        break;
                    case "error":
                        throw new Error(`Stream error: ${event.error?.message ?? "unknown"}`);
                    case "ping":
                        // Heartbeat, rien à faire.
                        break;
                }
            }
        }
        // Reconstitue content[] dans l'ordre d'apparition.
        const content = [];
        for (const idx of blockOrder) {
            if (textAccum.has(idx)) {
                const text = textAccum.get(idx) ?? "";
                if (text.length > 0)
                    content.push({ type: "text", text });
            }
            else if (toolAccum.has(idx)) {
                const t = toolAccum.get(idx);
                let input = {};
                if (t.argsRaw) {
                    try {
                        input = JSON.parse(t.argsRaw);
                    }
                    catch {
                        input = { _raw: t.argsRaw };
                    }
                }
                content.push({
                    type: "tool_use",
                    id: t.id,
                    name: t.name,
                    input,
                });
                // Si le serveur n'a pas envoyé stop_reason tool_use explicite, on le
                // force dès qu'on a un tool_use dans le content.
                stopReason = "tool_use";
            }
        }
        // Stream coupé mid-way (upstream 429 déguisé, timeout réseau, etc.).
        // Si on a du contenu utile, on le return et laisse l'agent loop gérer.
        // Sinon throw une erreur "retryable" que loop.ts catche pour retry.
        if (streamError && content.length === 0) {
            const msg = streamError.message || "upstream connection interrupted";
            const err = new Error(`Stream upstream interrompu (${msg}). Probablement un rate limit provider — réessaie dans 30s.`);
            // Marque le bucket en cold pour que le prochain retry attende.
            limiter.markCold(30_000);
            throw err;
        }
        const quota = parseQuotaHeaders(res.headers);
        return { content, stopReason, usage, quota };
    }
}
function parseQuotaHeaders(h) {
    const used = num(h.get("X-Chat-Mistral-Quota-Used"));
    const limit = num(h.get("X-Chat-Mistral-Quota-Limit"));
    const remaining = num(h.get("X-Chat-Mistral-Quota-Remaining"));
    const windowHours = num(h.get("X-Chat-Mistral-Quota-Window-Hours"));
    if (used === undefined ||
        limit === undefined ||
        remaining === undefined ||
        windowHours === undefined) {
        return undefined;
    }
    const weight = num(h.get("X-Chat-Mistral-Weight"));
    const resetAt = h.get("X-Chat-Mistral-Quota-Reset-At") ?? undefined;
    return { used, limit, remaining, windowHours, resetAt, weight };
}
function num(v) {
    if (v === null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
