import { chalk } from "./utils/logger.js";
import { suspendStatus, resumeStatus } from "./utils/status-bar.js";

// Wrapper autour de @inquirer/input pour la boucle REPL principale.
//
// Pourquoi pas readline : @inquirer/search (picker /model) crée son propre
// readline sur process.stdin ; si on a déjà un readline parent, les deux se
// marchent dessus et le close de l'un cascade un close sur l'autre — le
// CLI quitte brutalement. En restant "tout inquirer", un seul prompt
// possède le stdin à la fois, plus de collision.
//
// ⚠ Pas d'historique ↑↓ en V1 — @inquirer/input ne l'expose pas nativement.
// À ajouter via un createPrompt custom + useKeypress si besoin.

const PROMPT_MSG = chalk.hex("#e27649").bold("»");

export async function promptLine(): Promise<string> {
  const { default: input } = await import("@inquirer/input");
  suspendStatus();
  try {
    const answer = await input({
      message: PROMPT_MSG,
      theme: {
        prefix: "",
        spinner: { interval: 80, frames: ["·", "∙", "•"] },
      },
    });
    return answer;
  } finally {
    resumeStatus();
  }
}
