import type { Tool, ToolCall } from "../tools/types.js";

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextBlock {
  type: "text";
  text: string;
}

// Image format Anthropic : base64 inline. Utilisé pour les modèles vision
// (mistral-large/medium/small, gemini-*, certains NVIDIA). Le bridge
// /api/v1/messages convertit en format provider (imageUrl Mistral, inline_data
// Gemini). Taille max ~6MB base64 côté bridge.
export interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    data: string; // base64 sans préfixe data:
  };
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface Message {
  role: Role;
  content: ContentBlock[];
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderQuota {
  used: number;
  limit: number;
  remaining: number;
  windowHours: number;
  resetAt?: string;
  weight?: number;
}

export interface ProviderResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use";
  usage?: ProviderUsage;
  quota?: ProviderQuota;
}

export interface ChatOptions {
  system: string;
  messages: Message[];
  tools: Tool[];
  // Callback streaming : appelé pour chaque delta de texte au fur et à mesure
  // de la réception. Les providers qui ne supportent pas le streaming peuvent
  // l'ignorer et tout renvoyer à la fin (mode non-streaming).
  onTextDelta?: (delta: string) => void;
  // Callback pour signaler qu'un tool_use a été reçu (block complet, args parsés).
  // Utile pour afficher "◆ Read(…)" en live avant d'exécuter le tool.
  onToolUse?: (block: ToolUseBlock) => void;
}

export interface Provider {
  name: string;
  chat(opts: ChatOptions): Promise<ProviderResponse>;
}

export function extractToolCalls(response: ProviderResponse): ToolCall[] {
  return response.content
    .filter((b): b is ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

export function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Détection des modèles vision côté bridge /api/v1/models.
// Le champ `vision: boolean` est déjà exposé par le bridge pour chaque
// modèle du catalog — voir model-catalog.ts.
const VISION_MODELS_PATTERN =
  /mistral-(large|medium|small)-latest|gemini-/i;
export function modelSupportsVision(modelId: string): boolean {
  return VISION_MODELS_PATTERN.test(modelId);
}
