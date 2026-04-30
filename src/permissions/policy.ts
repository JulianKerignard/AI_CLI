// Système de permissions style Claude Code. 4 modes globaux + catégorisation
// par tool + allowlist session. Le "policy engine" est pur : aucune I/O.

export type PermissionMode =
  | "default"      // ask pour edit/execute, auto pour safe
  | "accept-edits" // auto pour safe+edit, ask pour execute
  | "bypass"       // auto pour tout (dangereux — usage CI ou session de confiance)
  | "plan";        // read-only : safe auto, tout le reste DENY

export type ToolCategory = "safe" | "edit" | "execute";

export type Decision = "allow" | "deny" | "ask";

const SAFE_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "Ls",
  // AskUser = pose une question à l'user via Ink picker. Aucune IO système,
  // doit passer en plan mode (l'agent a besoin de clarifier pour son plan).
  "AskUser",
  // BashOutput = lecture seule des logs d'un shell background lancé via
  // Bash run_in_background. Aucune IO disque, juste un read d'un buffer
  // mémoire — safe en plan mode pour que l'agent puisse monitor.
  "BashOutput",
]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit"]);
// KillShell = action destructive (tue un process). Catégorie execute,
// même politique que Bash : ask en default, auto en accept-edits/bypass,
// deny en plan.
const EXECUTE_TOOLS: ReadonlySet<string> = new Set(["Bash", "KillShell"]);

// Categorize un tool par nom. Pour les tools MCP / skills / sub-agents (noms
// arbitraires), fallback sur "safe" — l'user peut toujours refuser via le prompt
// ou activer le mode plan s'il veut un contrôle strict.
export function categorize(toolName: string): ToolCategory {
  if (SAFE_TOOLS.has(toolName)) return "safe";
  if (EDIT_TOOLS.has(toolName)) return "edit";
  if (EXECUTE_TOOLS.has(toolName)) return "execute";
  // MCP tools préfixés mcp__ : considérés execute par défaut (réseau / IO opaque).
  if (toolName.startsWith("mcp__")) return "execute";
  // Sub-agents (tool "Agent") : execute car ils invoquent leurs propres tools.
  if (toolName === "Agent") return "execute";
  // Skill tool : safe (injection de prompt pur, pas d'IO).
  if (toolName === "Skill") return "safe";
  return "safe";
}

export interface PolicyState {
  mode: PermissionMode;
  sessionAllowed: ReadonlySet<string>; // tools auto-allowés pour la session courante
  alwaysAllow: ReadonlySet<string>;    // tools auto-allowés persistants (store.json)
}

export function decide(
  state: PolicyState,
  toolName: string,
): Decision {
  if (state.sessionAllowed.has(toolName)) return "allow";
  if (state.alwaysAllow.has(toolName)) return "allow";

  const category = categorize(toolName);

  if (state.mode === "bypass") return "allow";

  if (state.mode === "plan") {
    if (category === "safe") return "allow";
    return "deny";
  }

  if (state.mode === "accept-edits") {
    if (category === "safe" || category === "edit") return "allow";
    return "ask";
  }

  // default
  if (category === "safe") return "allow";
  return "ask";
}

export function modeLabel(mode: PermissionMode): string {
  switch (mode) {
    case "default":
      return "default (ask edit/execute)";
    case "accept-edits":
      return "accept-edits (auto edit, ask execute)";
    case "bypass":
      return "bypass (auto tout — ⚠ dangereux)";
    case "plan":
      return "plan (read-only, deny edit/execute)";
  }
}

export function isValidMode(v: string): v is PermissionMode {
  return (
    v === "default" || v === "accept-edits" || v === "bypass" || v === "plan"
  );
}
