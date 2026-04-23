import { readFile, writeFile } from "node:fs/promises";
import { resolvePath, guardPath } from "../utils/path-guard.js";
// Edit : remplacement exact de chaîne dans un fichier existant. Pattern
// Claude Code — plus sûr que Write sur un fichier existant car la chaîne
// à remplacer doit être unique (sinon erreur, demande plus de contexte).
export const editTool = {
    name: "Edit",
    description: "Remplace une chaîne exacte par une autre dans un fichier existant. old_string doit être unique dans le fichier (sinon entourer de plus de contexte). replace_all=true remplace toutes les occurrences.",
    formatInvocation: (input) => String(input.path ?? ""),
    formatResult: (_input, output) => {
        // output = "Édité <path> (N remplacement[s])"
        const m = /\((\d+) remplacement/.exec(output);
        const count = m ? Number(m[1]) : 1;
        return `${count} replacement${count > 1 ? "s" : ""}`;
    },
    schema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Chemin du fichier à éditer" },
            old_string: {
                type: "string",
                description: "Chaîne exacte à remplacer (unique dans le fichier)",
            },
            new_string: {
                type: "string",
                description: "Chaîne de remplacement",
            },
            replace_all: {
                type: "boolean",
                description: "Remplacer toutes les occurrences (défaut: false)",
            },
        },
        required: ["path", "old_string", "new_string"],
    },
    async run(input, ctx) {
        const raw = String(input.path ?? "");
        const oldStr = String(input.old_string ?? "");
        const newStr = String(input.new_string ?? "");
        const replaceAll = Boolean(input.replace_all ?? false);
        if (!raw)
            throw new Error("Edit: 'path' manquant");
        if (!oldStr)
            throw new Error("Edit: 'old_string' vide");
        if (oldStr === newStr)
            throw new Error("Edit: old_string et new_string identiques");
        const abs = resolvePath(raw, ctx.cwd);
        guardPath(abs, { mode: "write", cwd: ctx.cwd });
        const content = await readFile(abs, "utf8");
        const occurrences = countOccurrences(content, oldStr);
        if (occurrences === 0) {
            throw new Error(`Edit: old_string non trouvée dans ${abs}. Vérifie la casse, les espaces et les retours à la ligne.`);
        }
        if (occurrences > 1 && !replaceAll) {
            throw new Error(`Edit: old_string trouvée ${occurrences}× dans ${abs}. Entoure-la de plus de contexte ou passe replace_all=true.`);
        }
        const updated = replaceAll
            ? content.split(oldStr).join(newStr)
            : content.replace(oldStr, newStr);
        await writeFile(abs, updated, "utf8");
        return `Édité ${abs} (${occurrences} remplacement${occurrences > 1 ? "s" : ""})`;
    },
};
function countOccurrences(haystack, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let i = 0;
    while ((i = haystack.indexOf(needle, i)) !== -1) {
        count++;
        i += needle.length;
    }
    return count;
}
