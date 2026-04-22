// Système de permissions style Claude Code. 4 modes globaux + catégorisation
// par tool + allowlist session. Le "policy engine" est pur : aucune I/O.
const SAFE_TOOLS = new Set(["Read", "Glob", "Grep", "Ls"]);
const EDIT_TOOLS = new Set(["Write", "Edit"]);
const EXECUTE_TOOLS = new Set(["Bash"]);
// Categorize un tool par nom. Pour les tools MCP / skills / sub-agents (noms
// arbitraires), fallback sur "safe" — l'user peut toujours refuser via le prompt
// ou activer le mode plan s'il veut un contrôle strict.
export function categorize(toolName) {
    if (SAFE_TOOLS.has(toolName))
        return "safe";
    if (EDIT_TOOLS.has(toolName))
        return "edit";
    if (EXECUTE_TOOLS.has(toolName))
        return "execute";
    // MCP tools préfixés mcp__ : considérés execute par défaut (réseau / IO opaque).
    if (toolName.startsWith("mcp__"))
        return "execute";
    // Sub-agents (tool "Agent") : execute car ils invoquent leurs propres tools.
    if (toolName === "Agent")
        return "execute";
    // Skill tool : safe (injection de prompt pur, pas d'IO).
    if (toolName === "Skill")
        return "safe";
    return "safe";
}
export function decide(state, toolName) {
    if (state.sessionAllowed.has(toolName))
        return "allow";
    if (state.alwaysAllow.has(toolName))
        return "allow";
    const category = categorize(toolName);
    if (state.mode === "bypass")
        return "allow";
    if (state.mode === "plan") {
        if (category === "safe")
            return "allow";
        return "deny";
    }
    if (state.mode === "accept-edits") {
        if (category === "safe" || category === "edit")
            return "allow";
        return "ask";
    }
    // default
    if (category === "safe")
        return "allow";
    return "ask";
}
export function modeLabel(mode) {
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
export function isValidMode(v) {
    return (v === "default" || v === "accept-edits" || v === "bypass" || v === "plan");
}
