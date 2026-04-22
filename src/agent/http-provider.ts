import type {
  Provider,
  Message,
  ProviderResponse,
  ProviderUsage,
  ProviderQuota,
  ContentBlock,
} from "./provider.js";
import type { Tool } from "../tools/types.js";

interface Opts {
  token: string;
  baseUrl: string; // ex: https://chat.juliankerignard.fr/api (sans /v1)
  model: string;
}

// Provider HTTP qui parle Anthropic Messages API. Cible : endpoint Chat-Mistral
// `POST /api/v1/messages` qui proxifie vers Mistral. Non-streaming pour V1 —
// on attend la réponse complète avant de la push dans la loop. Le streaming
// nécessiterait de refactor l'interface `Provider` en async iterator.

export class HttpProvider implements Provider {
  readonly name: string;

  constructor(private opts: Opts) {
    this.name = `http(${opts.model})`;
  }

  async chat(opts: {
    system: string;
    messages: Message[];
    tools: Tool[];
  }): Promise<ProviderResponse> {
    // Le format Message de AI_CLI est déjà 100% compatible Anthropic Messages API
    // (blocks text/tool_use/tool_result). Seule transformation : role "tool"
    // n'existe pas côté Anthropic — on le mappe à "user" (où vit tool_result).
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
      stream: false,
    };

    const res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.opts.token,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} depuis ${this.opts.baseUrl}/v1/messages : ${text.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as {
      content?: ContentBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content = Array.isArray(data.content) ? data.content : [];
    // Anthropic stop_reason : end_turn | max_tokens | stop_sequence | tool_use
    // AI_CLI n'utilise que "end_turn" | "tool_use" dans la loop.
    const stopReason: "end_turn" | "tool_use" =
      data.stop_reason === "tool_use" ? "tool_use" : "end_turn";

    const usage: ProviderUsage | undefined =
      typeof data.usage?.input_tokens === "number" &&
      typeof data.usage?.output_tokens === "number"
        ? {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
          }
        : undefined;

    // Quota headers X-Chat-Mistral-Quota-* exposés par /api/v1/messages.
    // Fallback silencieux si absents (autre backend Anthropic-compatible).
    const quota = parseQuotaHeaders(res.headers);

    return { content, stopReason, usage, quota };
  }
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
