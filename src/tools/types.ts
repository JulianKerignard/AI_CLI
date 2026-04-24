// Schema JSON minimal envoyé avec les tools à l'API. On supporte les
// types de base + array avec items (pour AskUser qui prend un array de
// string options). Pas besoin d'un validateur complet — c'est juste ce
// que le modèle lit pour former ses tool_use.
interface ToolParamSchema {
  type: string;
  description?: string;
  items?: { type: string };
}

export interface ToolSchema {
  type: "object";
  properties: Record<string, ToolParamSchema>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  schema: ToolSchema;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  // Format compact pour l'affichage REPL. Si présent, le loop affiche
  //   ◆ Name(label)
  //     ⎿ result summary
  // au lieu de dumper l'input JSON + le full output. Le output complet
  // reste envoyé au modèle via tool_result — c'est juste l'UX.
  formatInvocation?: (input: Record<string, unknown>) => string;
  formatResult?: (input: Record<string, unknown>, output: string) => string;
}

export interface ToolContext {
  cwd: string;
  abortSignal?: AbortSignal;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

