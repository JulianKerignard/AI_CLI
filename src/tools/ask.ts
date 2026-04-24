import type { Tool } from "./types.js";
import { askController } from "../ui/ask-controller.js";

// Tool AskUser : le modèle pose une question à l'user, avec ou sans
// options prédéfinies. Mode "options" = picker avec flèches ↑↓. Mode
// "texte libre" = input classique. Retourne la réponse (ou "(aucune
// réponse)" si l'user Esc).
//
// À utiliser uniquement quand la demande est ambiguë ou destructive sans
// contexte clair. Poser une question triviale (ex: "je peux lire
// package.json ?") est un anti-pattern — le modèle doit juste agir.

export const askTool: Tool = {
  name: "AskUser",
  description:
    "Pose une question à l'user quand la demande est ambiguë ou destructive sans contexte. Fournis des options si un choix multiple est naturel (picker), sinon laisse vide pour une réponse texte libre. NE PAS utiliser pour des questions triviales — seulement quand agir sans clarification risque de casser ou de faire perdre du temps à l'user.",
  formatInvocation: (input) => {
    const q = String(input.question ?? "");
    return q.length > 70 ? q.slice(0, 70) + "…" : q;
  },
  formatResult: (_input, output) => {
    return output.length > 80 ? output.slice(0, 80) + "…" : output;
  },
  schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "La question à poser, concise et claire.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Liste d'options prédéfinies (2-6 items). Si fournie, affiche un picker. Sinon input texte libre.",
      },
    },
    required: ["question"],
  },
  async run(input) {
    const question = String(input.question ?? "").trim();
    if (!question) return "(question vide, skip)";
    const rawOptions = Array.isArray(input.options)
      ? (input.options as unknown[])
          .map((o) => String(o).trim())
          .filter((o) => o.length > 0)
      : undefined;
    const options =
      rawOptions && rawOptions.length > 0 ? rawOptions : undefined;
    const answer = await askController.open(question, options);
    if (answer === null) return "(aucune réponse, user a annulé)";
    return answer;
  },
};
