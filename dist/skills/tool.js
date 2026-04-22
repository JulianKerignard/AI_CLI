export function makeSkillTool(skills, agent) {
    return {
        name: "Skill",
        description: "Active un skill enregistré. Input { name }. Le contenu du skill est injecté comme note système pour le tour suivant.",
        schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Nom du skill à activer" },
            },
            required: ["name"],
        },
        async run(input) {
            const name = String(input.name ?? "");
            const skill = skills.find((s) => s.name === name);
            if (!skill) {
                return `Skill inconnu: ${name}. Disponibles: ${skills.map((s) => s.name).join(", ") || "(aucun)"}`;
            }
            agent.appendSystemNote(`Skill '${skill.name}' activé.\nInstructions:\n${skill.prompt}`);
            return `Skill '${skill.name}' chargé. Les instructions seront appliquées au prochain tour.`;
        },
    };
}
