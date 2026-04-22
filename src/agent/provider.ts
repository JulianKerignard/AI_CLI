import type { Tool, ToolCall } from "../tools/types.js";

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextBlock {
  type: "text";
  text: string;
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

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

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

export interface Provider {
  name: string;
  chat(opts: {
    system: string;
    messages: Message[];
    tools: Tool[];
  }): Promise<ProviderResponse>;
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
