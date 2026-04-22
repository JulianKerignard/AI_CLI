import search from "@inquirer/search";
import type { SlashCommand } from "./types.js";

// Picker interactif pour choisir une slash command. Utilise @inquirer/search
// qui gère le raw stdin + navigation ↑↓ + Tab/Enter select + Esc cancel +
// filtrage à la frappe. Retourne le nom de la commande choisie (sans le /)
// ou null si l'user annule.

export interface PickerChoice {
  command: SlashCommand;
}

export async function pickSlashCommand(
  commands: SlashCommand[],
  initialInput = "",
): Promise<string | null> {
  try {
    const chosen = await search({
      // Le "/" avant le message imite le prompt de saisie standard.
      message: "/",
      pageSize: 10,
      source: async (input) => {
        const q = (input ?? "").toLowerCase();
        const filtered = commands.filter((c) =>
          c.name.toLowerCase().startsWith(q),
        );
        // Si aucune match avec startsWith, retombe sur includes (fuzzy light).
        const final =
          filtered.length > 0
            ? filtered
            : commands.filter((c) => c.name.toLowerCase().includes(q));
        return final.map((c) => ({
          name: "/" + c.name,
          value: c.name,
          description: "  " + c.description,
        }));
      },
      // Pré-remplit si l'user a déjà tapé "/pe" avant Tab.
      default: initialInput || undefined,
    });
    return typeof chosen === "string" ? chosen : null;
  } catch (err) {
    // Esc / Ctrl+C → inquirer throw ExitPromptError, on retourne null proprement.
    if (
      err instanceof Error &&
      (err.name === "ExitPromptError" || /user force closed/i.test(err.message))
    ) {
      return null;
    }
    throw err;
  }
}
