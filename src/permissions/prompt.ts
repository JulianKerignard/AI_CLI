import { log, chalk } from "../utils/logger.js";
import { suspendStatus, resumeStatus } from "../utils/status-bar.js";
import { categorize } from "./policy.js";

// Prompt interactif avant une action sensible. Affiche tool + preview des
// paramètres + options y/n/A (always this session) / P (persist always).
// Retourne:
//   "allow"         → autorisé pour CE call uniquement
//   "allow-session" → autoriser ce tool pour le reste de la session
//   "allow-persist" → autoriser et persister dans permissions.json
//   "deny"          → refuser (renvoie un tool_result d'erreur au modèle)
//
// Implémenté via @inquirer/select — cohérent avec le reste du CLI (qui est
// "tout inquirer") et évite de créer un readline parallèle qui tuait le
// REPL quand le prompt de permission s'affichait pendant un tool call.

export type PromptDecision =
  | "allow"
  | "allow-session"
  | "allow-persist"
  | "deny";

// Abrège l'input d'un tool pour l'affichage (max 120 chars par valeur).
function formatInput(input: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    let val: string;
    if (typeof v === "string") {
      val = v.length > 120 ? v.slice(0, 120) + "…" : v;
      val = val.replace(/\n/g, "⏎");
    } else {
      val = JSON.stringify(v);
      if (val.length > 120) val = val.slice(0, 120) + "…";
    }
    lines.push(`    ${chalk.hex("#bdb3a1")(k)}  ${chalk.hex("#f6f1e8")(val)}`);
  }
  return lines;
}

export async function askPermission(
  toolName: string,
  input: Record<string, unknown>,
): Promise<PromptDecision> {
  const category = categorize(toolName);
  const catLabel =
    category === "execute"
      ? chalk.hex("#c76a5f")("execute")
      : category === "edit"
        ? chalk.hex("#ec9470")("edit")
        : chalk.hex("#bdb3a1")("safe");

  console.log();
  console.log(
    chalk.hex("#e27649")("⚠  ") +
      chalk.hex("#f6f1e8").bold("Permission requise") +
      chalk.hex("#8a8270")(" · ") +
      catLabel +
      chalk.hex("#8a8270")(" · ") +
      chalk.hex("#ec9470").bold(toolName),
  );
  const lines = formatInput(input);
  for (const l of lines) console.log(l);

  const { default: select } = await import("@inquirer/select");
  suspendStatus();
  try {
    const choice = await select<PromptDecision>({
      message: "Autoriser ?",
      choices: [
        { name: "Yes — une fois", value: "allow" },
        { name: "Always this session", value: "allow-session" },
        { name: "Persist always (enregistre)", value: "allow-persist" },
        { name: "No — refuser", value: "deny" },
      ],
      default: "allow",
    });
    return choice;
  } catch {
    // Ctrl-C / Esc → refus par défaut (plus safe que d'autoriser).
    return "deny";
  } finally {
    resumeStatus();
  }
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
