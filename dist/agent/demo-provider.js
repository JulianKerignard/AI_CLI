/**
 * Provider démo : pas de vraie IA. Inspecte le dernier tour utilisateur
 * pour émettre un tool_use plausible, ou répond en texte. Permet de
 * démontrer la boucle complète sans clé API. Pseudo-streaming via onTextDelta
 * pour que l'UX corresponde au HttpProvider (newline final ajouté par AgentLoop).
 */
export class DemoProvider {
    name = "demo";
    counter = 0;
    async chat(opts) {
        const { messages, tools } = opts;
        const last = messages[messages.length - 1];
        // Si le dernier message est un tool_result, on "répond" avec un résumé.
        if (last?.role === "user" && last.content.some((b) => b.type === "tool_result")) {
            const toolOutputs = last.content
                .filter((b) => b.type === "tool_result")
                .map((b) => b.content)
                .join("\n---\n");
            const preview = toolOutputs.slice(0, 280);
            return {
                content: [
                    {
                        type: "text",
                        text: `Voilà ce que j'ai obtenu après l'appel d'outil :\n\n${preview}${toolOutputs.length > 280 ? "…" : ""}`,
                    },
                ],
                stopReason: "end_turn",
            };
        }
        const userText = last?.role === "user"
            ? last.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")
            : "";
        const lower = userText.toLowerCase();
        const has = (...kws) => kws.some((k) => lower.includes(k));
        const toolNames = new Set(tools.map((t) => t.name));
        const id = `call_${++this.counter}`;
        // Détection intention → tool_use
        if (toolNames.has("Read") && has("lis ", "lit ", "read ", "cat ", "montre")) {
            const match = userText.match(/[\w./\-]+\.[a-zA-Z]{1,6}/);
            const path = match?.[0] ?? "README.md";
            return {
                content: [
                    { type: "text", text: `Ok, je lis \`${path}\`.` },
                    { type: "tool_use", id, name: "Read", input: { path } },
                ],
                stopReason: "tool_use",
            };
        }
        if (toolNames.has("Bash") && has("exécute", "execute", "run ", "lance ", "ls", "pwd")) {
            const match = userText.match(/`([^`]+)`/);
            const command = match?.[1] ?? (process.platform === "win32" ? "dir" : "ls");
            return {
                content: [
                    { type: "text", text: `J'exécute \`${command}\`.` },
                    { type: "tool_use", id, name: "Bash", input: { command } },
                ],
                stopReason: "tool_use",
            };
        }
        if (toolNames.has("Write") && has("écris", "crée", "write ", "create ")) {
            return {
                content: [
                    { type: "text", text: "Je vais écrire un fichier exemple." },
                    {
                        type: "tool_use",
                        id,
                        name: "Write",
                        input: { path: "demo.txt", content: "Hello depuis le provider démo !\n" },
                    },
                ],
                stopReason: "tool_use",
            };
        }
        if (toolNames.has("Skill") && has("skill")) {
            const match = userText.match(/skill\s+([\w-]+)/i);
            const name = match?.[1] ?? "hello";
            return {
                content: [
                    { type: "text", text: `Je charge le skill \`${name}\`.` },
                    { type: "tool_use", id, name: "Skill", input: { name } },
                ],
                stopReason: "tool_use",
            };
        }
        if (toolNames.has("Agent") && has("agent", "explore", "explorer")) {
            const match = userText.match(/agent\s+([\w-]+)/i);
            const name = match?.[1] ?? "explorer";
            return {
                content: [
                    { type: "text", text: `Je délègue à l'agent \`${name}\`.` },
                    {
                        type: "tool_use",
                        id,
                        name: "Agent",
                        input: { name, prompt: userText },
                    },
                ],
                stopReason: "tool_use",
            };
        }
        // mcp__* tools : si la demande matche, appelle le premier mcp tool trouvé
        const mcpTool = tools.find((t) => t.name.startsWith("mcp__"));
        if (mcpTool && has("mcp")) {
            return {
                content: [
                    { type: "text", text: `J'appelle \`${mcpTool.name}\`.` },
                    { type: "tool_use", id, name: mcpTool.name, input: {} },
                ],
                stopReason: "tool_use",
            };
        }
        // Réponse texte générique
        return {
            content: [
                {
                    type: "text",
                    text: userText
                        ? `[provider démo] J'ai bien reçu : « ${userText.slice(0, 140)}${userText.length > 140 ? "…" : ""} ». Essaie « lis README.md », « exécute \`ls\` », « skill hello », ou « agent explorer ».`
                        : "[provider démo] Prêt. Tape /help pour les commandes.",
                },
            ],
            stopReason: "end_turn",
        };
    }
}
