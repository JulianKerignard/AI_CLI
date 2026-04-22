import type {
  Provider,
  ChatOptions,
  ProviderResponse,
  ProviderUsage,
  ProviderQuota,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
} from "./provider.js";
import { RateLimiter } from "../lib/rate-limiter.js";
import { log, chalk } from "../utils/logger.js";
import { updateStatus } from "../utils/status-bar.js";

interface Opts {
  token: string;
  baseUrl: string; // ex: https://chat.juliankerignard.fr/api (sans /v1)
  model: string;
}

// Rate limiter singleton côté CLI : 3 req/min (marge 25% sous le plafond
// Mistral free 4/min). Partagé entre tous les HttpProviders (même si on
// hot-swap sur /login, le bucket reste).
const SHARED_LIMITER = new RateLimiter({
  capacity: 3,
  windowMs: 60_000,
});

export function getSharedLimiter(): RateLimiter {
  return SHARED_LIMITER;
}

// Attend la prochaine slot libre. Le status bar affiche "⏳ waiting Xs" avec
// countdown décroissant. Ne fait rien si la slot est immédiatement dispo.
async function waitWithStatus(): Promise<void> {
  const initial = SHARED_LIMITER.waitFor();
  const snap = SHARED_LIMITER.snapshot();
  // Toujours push le bucket dans le status bar (pour visibilité même sans wait).
  updateStatus({
    bucketUsed: snap.used,
    bucketCapacity: snap.capacity,
  });
  if (initial === 0) {
    SHARED_LIMITER.record();
    const snap2 = SHARED_LIMITER.snapshot();
    updateStatus({
      bucketUsed: snap2.used,
      bucketCapacity: snap2.capacity,
    });
    return;
  }
  const start = Date.now();
  const end = start + initial;
  updateStatus({ phase: "waiting-quota", waitingMsRemaining: initial });
  // Tick 500ms pour la déco du countdown dans le status bar.
  while (Date.now() < end) {
    const remainingMs = Math.max(0, end - Date.now());
    updateStatus({ waitingMsRemaining: remainingMs });
    await new Promise((r) => setTimeout(r, 500));
  }
  SHARED_LIMITER.record();
  const snap3 = SHARED_LIMITER.snapshot();
  updateStatus({
    phase: "thinking",
    waitingMsRemaining: undefined,
    bucketUsed: snap3.used,
    bucketCapacity: snap3.capacity,
  });
}

// Provider HTTP qui parle Anthropic Messages API. Cible : endpoint Chat-Mistral
// `POST /api/v1/messages` qui proxifie vers Mistral. Mode streaming SSE avec
// support tool_use (accumule les input_json_delta, JSON.parse à la fin du bloc).

export class HttpProvider implements Provider {
  readonly name: string;

  constructor(private opts: Opts) {
    this.name = `http(${opts.model})`;
  }

  async chat(opts: ChatOptions): Promise<ProviderResponse> {
    const anthropicMessages = opts.messages.map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content,
    }));

    const body = {
      model: this.opts.model,
      max_tokens: 8192,
      system: opts.system,
      messages: anthropicMessages,
      tools:
        opts.tools.length > 0
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
    const maxAttempts = 3;
    let res: Response | undefined;
    let lastErrText = "";
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Attente bucket avec affichage live countdown dans le status bar.
      await waitWithStatus();

      res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.opts.token,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });

      if (res.ok && res.body) break;

      lastErrText = await res.text().catch(() => "");

      if (res.status === 429 && attempt < maxAttempts - 1) {
        // Honor Retry-After (seconds) si header présent, sinon backoff fixe.
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Math.min(Number(retryAfterHeader) * 1000, 60_000)
          : 8_000 * 2 ** attempt;
        SHARED_LIMITER.markCold(retryAfterMs);
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
          phase: "thinking",
        });
        continue;
      }
      throw new Error(
        `HTTP ${res.status} depuis ${this.opts.baseUrl}/v1/messages : ${lastErrText.slice(0, 200)}`,
      );
    }
    if (!res || !res.ok || !res.body) {
      throw new Error(
        `HTTP ${res?.status ?? "?"} après ${maxAttempts} essais : ${lastErrText.slice(0, 200)}`,
      );
    }

    // État accumulateur par index de content_block.
    const textAccum = new Map<number, string>();
    const toolAccum = new Map<
      number,
      { id: string; name: string; argsRaw: string }
    >();
    // Ordre d'apparition des blocks (pour reconstituer le content final).
    const blockOrder: number[] = [];
    let stopReason: "end_turn" | "tool_use" = "end_turn";
    let usage: ProviderUsage | undefined;

    const decoder = new TextDecoder();
    let buf = "";
    const reader = res.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE : events séparés par \n\n. Chaque event a des lignes "field: value".
      // On ne se soucie que de "data:" ; on ignore "event:" qui est cosmétique.
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLines: string[] = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;
        const jsonText = dataLines.join("\n");
        let event: AnthropicSseEvent;
        try {
          event = JSON.parse(jsonText);
        } catch {
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
            if (!blockOrder.includes(idx)) blockOrder.push(idx);
            const cb = event.content_block;
            if (cb?.type === "text") {
              textAccum.set(idx, "");
            } else if (cb?.type === "tool_use" && cb.name && cb.id) {
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
            if (!d) break;
            if (d.type === "text_delta" && typeof d.text === "string") {
              const prev = textAccum.get(idx) ?? "";
              textAccum.set(idx, prev + d.text);
              opts.onTextDelta?.(d.text);
            } else if (
              d.type === "input_json_delta" &&
              typeof d.partial_json === "string"
            ) {
              const t = toolAccum.get(idx);
              if (t) t.argsRaw += d.partial_json;
            }
            break;
          }

          case "content_block_stop": {
            const idx = event.index ?? 0;
            const t = toolAccum.get(idx);
            if (t) {
              let input: Record<string, unknown> = {};
              if (t.argsRaw) {
                try {
                  input = JSON.parse(t.argsRaw);
                } catch {
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
            if (event.delta?.stop_reason === "tool_use") stopReason = "tool_use";
            if (event.usage?.output_tokens !== undefined && usage) {
              usage.outputTokens = event.usage.output_tokens;
            }
            break;

          case "message_stop":
            // Fin du flux — loop externe se termine naturellement au done reader.
            break;

          case "error":
            throw new Error(
              `Stream error: ${event.error?.message ?? "unknown"}`,
            );

          case "ping":
            // Heartbeat, rien à faire.
            break;
        }
      }
    }

    // Reconstitue content[] dans l'ordre d'apparition.
    const content: ContentBlock[] = [];
    for (const idx of blockOrder) {
      if (textAccum.has(idx)) {
        const text = textAccum.get(idx) ?? "";
        if (text.length > 0) content.push({ type: "text", text } as TextBlock);
      } else if (toolAccum.has(idx)) {
        const t = toolAccum.get(idx)!;
        let input: Record<string, unknown> = {};
        if (t.argsRaw) {
          try {
            input = JSON.parse(t.argsRaw);
          } catch {
            input = { _raw: t.argsRaw };
          }
        }
        content.push({
          type: "tool_use",
          id: t.id,
          name: t.name,
          input,
        } as ToolUseBlock);
        // Si le serveur n'a pas envoyé stop_reason tool_use explicite, on le
        // force dès qu'on a un tool_use dans le content.
        stopReason = "tool_use";
      }
    }

    const quota = parseQuotaHeaders(res.headers);
    return { content, stopReason, usage, quota };
  }
}

// ===== SSE event shape côté Anthropic =====
interface AnthropicSseEvent {
  type: string;
  index?: number;
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    input?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
}

function parseQuotaHeaders(h: Headers): ProviderQuota | undefined {
  const used = num(h.get("X-Chat-Mistral-Quota-Used"));
  const limit = num(h.get("X-Chat-Mistral-Quota-Limit"));
  const remaining = num(h.get("X-Chat-Mistral-Quota-Remaining"));
  const windowHours = num(h.get("X-Chat-Mistral-Quota-Window-Hours"));
  if (
    used === undefined ||
    limit === undefined ||
    remaining === undefined ||
    windowHours === undefined
  ) {
    return undefined;
  }
  const weight = num(h.get("X-Chat-Mistral-Weight"));
  const resetAt = h.get("X-Chat-Mistral-Quota-Reset-At") ?? undefined;
  return { used, limit, remaining, windowHours, resetAt, weight };
}

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
