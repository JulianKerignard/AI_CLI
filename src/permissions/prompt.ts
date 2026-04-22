import type { Interface as ReadlineInterface } from "node:readline";
import { log, chalk } from "../utils/logger.js";
import { categorize } from "./policy.js";

// Singleton du readline du REPL principal. Injecté par repl.ts au setup.
// On NE crée PAS un nouveau readline ici : deux interfaces sur le même
// stdin se disputent les events et peuvent tuer le REPL (symptôme :
// "ça me sort du CLI" après un prompt de permission ou un pick).
let sharedRl: ReadlineInterface | null = null;

export function setPermissionReadline(rl: ReadlineInterface): void {
  sharedRl = rl;
}

// Promise wrapper autour de rl.question (readline classique = callback).
function askLine(rl: ReadlineInterface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    (rl as ReadlineInterface & {
      question: (q: string, cb: (ans: string) => void) => void;
    }).question(prompt, (ans) => resolve(ans));
  });
}

// Prompt interactif avant une action sensible. Affiche tool + preview des
// paramètres + options y/n/A (always this session) / P (persist always).
// Retourne:
//   "allow"      → autorisé pour CE call uniquement
//   "allow-session" → autoriser ce tool pour le reste de la session
//   "allow-persist" → autoriser et persister dans permissions.json
//   "deny"       → refuser (renvoie un tool_result d'erreur au modèle)

export type PromptDecision =
  | "allow"
  | "allow-session"
  | "allow-persist"
  | "deny";

// Abrège l'input d'un tool pour l'affichage (max 80 chars par valeur).
function formatInput(input: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    let val: string;
    if (typeof v === "string") {
      val = v.length > 120 ? v.slice(0, 120) + "…" : v;
      // Escape les retours à la ligne pour rester sur une ligne lisible.
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
    category === "execute" ? chalk.hex("#c76a5f")("execute")
    : category === "edit" ? chalk.hex("#ec9470")("edit")
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
  console.log();

  if (!sharedRl) {
    // Fallback défensif : si setPermissionReadline() n'a pas été appelé,
    // on refuse par sécurité (éviter de créer un 2e readline qui casse
    // le REPL principal).
    log.warn("permissions readline non initialisé — refus par défaut");
    return "deny";
  }
  const prompt =
    chalk.hex("#8a8270")("  ") +
    chalk.hex("#f6f1e8")("[") +
    chalk.hex("#e27649").bold("y") +
    chalk.hex("#f6f1e8")("]es  [") +
    chalk.hex("#f6f1e8").bold("n") +
    chalk.hex("#f6f1e8")("]o  [") +
    chalk.hex("#ec9470").bold("a") +
    chalk.hex("#f6f1e8")("]lways this session  [") +
    chalk.hex("#ec9470").bold("p") +
    chalk.hex("#f6f1e8")("]ersist always ") +
    chalk.hex("#8a8270")("› ");
  try {
    const raw = await askLine(sharedRl, prompt);
    const answer = raw.trim().toLowerCase();
    if (answer === "y" || answer === "yes" || answer === "o" || answer === "")
      return "allow";
    if (answer === "a" || answer === "always") return "allow-session";
    if (answer === "p" || answer === "persist") return "allow-persist";
    return "deny";
  } catch {
    return "deny";
  }
  // Pas de rl.close() : on NE ferme PAS le readline partagé — il est
  // celui du REPL principal, il doit rester vivant pour le prochain prompt.
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
