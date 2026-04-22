import { log, chalk } from "../utils/logger.js";
import { categorize } from "./policy.js";
import { permissionController } from "../ui/permission-controller.js";

// Prompt interactif avant une action sensible. Retourne:
//   "allow"         → autorisé pour CE call uniquement
//   "allow-session" → autoriser ce tool pour le reste de la session
//   "allow-persist" → autoriser et persister dans permissions.json
//   "deny"          → refuser (renvoie un tool_result d'erreur au modèle)
//
// Implémenté via PermissionPicker (composant Ink natif). Précédemment
// utilisait @inquirer/select qui créait un readline parallèle à Ink —
// résultat : artefacts visuels et InputBox fantôme après chaque prompt.

export type PromptDecision =
  | "allow"
  | "allow-session"
  | "allow-persist"
  | "deny";

export async function askPermission(
  toolName: string,
  input: Record<string, unknown>,
): Promise<PromptDecision> {
  const category = categorize(toolName);
  return permissionController.ask(toolName, category, input);
}

// Notifie l'user qu'un tool a été refusé (pour plan mode / deny pattern).
export function logDenied(toolName: string, reason: string): void {
  log.warn(
    chalk.hex("#c76a5f")("✗ ") +
      chalk.hex("#f6f1e8").bold(toolName) +
      chalk.hex("#8a8270")(" refusé — ") +
      chalk.hex("#bdb3a1")(reason),
  );
}
