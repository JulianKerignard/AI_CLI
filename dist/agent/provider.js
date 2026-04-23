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
// Détection des modèles vision côté bridge /api/v1/models.
// Le champ `vision: boolean` est déjà exposé par le bridge pour chaque
// modèle du catalog — voir model-catalog.ts.
const VISION_MODELS_PATTERN = /mistral-(large|medium|small)-latest|gemini-/i;
export function modelSupportsVision(modelId) {
    return VISION_MODELS_PATTERN.test(modelId);
}
