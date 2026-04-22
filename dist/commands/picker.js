import search from "@inquirer/search";
export async function pickSlashCommand(commands, initialInput = "") {
    try {
        const chosen = await search({
            // Le "/" avant le message imite le prompt de saisie standard.
            message: "/",
            pageSize: 10,
            source: async (input) => {
                const q = (input ?? "").toLowerCase();
                const filtered = commands.filter((c) => c.name.toLowerCase().startsWith(q));
                // Si aucune match avec startsWith, retombe sur includes (fuzzy light).
                const final = filtered.length > 0
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
    }
    catch (err) {
        // Esc / Ctrl+C → inquirer throw ExitPromptError, on retourne null proprement.
        if (err instanceof Error &&
            (err.name === "ExitPromptError" || /user force closed/i.test(err.message))) {
            return null;
        }
        throw err;
    }
}
