export function extractToolCalls(response) {
    return response.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}
export function extractText(content) {
    return content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
}
// Détection des modèles vision : lookup dans le catalog (source de vérité :
// champ `vision: boolean` exposé par /api/v1/models). Fallback regex si le
// catalog n'est pas encore chargé (jamais fetch + offline).
const VISION_FALLBACK_PATTERN = /mistral-(large|medium|small)-latest|gemini-/i;
export async function modelSupportsVision(modelId) {
    try {
        const { listCatalogModels } = await import("../lib/model-catalog.js");
        const models = listCatalogModels();
        const m = models.find((x) => x.id === modelId);
        if (m && typeof m.vision === "boolean")
            return m.vision;
    }
    catch {
        /* catalog pas dispo */
    }
    return VISION_FALLBACK_PATTERN.test(modelId);
}
