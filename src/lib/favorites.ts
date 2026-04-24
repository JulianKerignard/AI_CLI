// Shortlist de modèles favoris pour /fav et résolution d'alias dans /model.
// Les alias reflètent ceux définis côté serveur dans site/lib/api-models.ts
// (MODEL_ALIASES). Dupliqués ici pour que le CLI puisse les résoudre
// localement sans round-trip. Si le serveur ajoute/renomme un alias, il
// faut mettre à jour cette map — le bridge l'accepte quand même côté
// requête (mapAnthropicModel fait la résolution), mais /model <alias>
// a besoin de connaître le fullId pour le matcher au catalog.

// Note : les fullIds doivent matcher EXACTEMENT ce que retourne
// /api/v1/models côté serveur. Les IDs Google et OpenRouter sont préfixés
// ("google/", "openrouter/") dans le catalog, même si MODEL_ALIASES côté
// site n'a pas le préfixe (la résolution ajoute le préfixe via
// resolveGoogleId/resolveOpenRouterId avant la requête).
export const FAVORITE_ALIASES: Record<string, string> = {
  hy3: "openrouter/tencent/hy3-preview:free",
  "ling-1t": "openrouter/inclusionai/ling-2.6-1t:free",
  flash: "google/gemini-flash-latest",
  large: "mistral-large-latest",
  codestral: "codestral-latest",
  devstral: "devstral-latest",
  nemotron: "nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "gpt-oss": "nvidia/openai/gpt-oss-120b",
  "qwen-coder": "nvidia/qwen/qwen2.5-coder-32b-instruct",
  "kimi-k2": "nvidia/moonshotai/kimi-k2-instruct",
  "kimi-thinking": "nvidia/moonshotai/kimi-k2-thinking",
  "flash-lite": "google/gemini-flash-lite-latest",
};

// Ordre d'affichage dans le picker. Garde le même que le tableau saisi
// par l'user pour qu'il retrouve ses repères.
export const FAVORITE_ORDER: readonly string[] = [
  "hy3",
  "ling-1t",
  "flash",
  "large",
  "codestral",
  "devstral",
  "nemotron",
  "gpt-oss",
  "qwen-coder",
  "kimi-k2",
  "kimi-thinking",
  "flash-lite",
];

// Résolution alias → fullId. Retourne null si pas un alias connu.
export function resolveFavoriteAlias(input: string): string | null {
  const hit = FAVORITE_ALIASES[input.toLowerCase()];
  return hit ?? null;
}

// Set des fullIds favoris (pour filtrer le catalog dans /fav).
export const FAVORITE_FULL_IDS: ReadonlySet<string> = new Set(
  Object.values(FAVORITE_ALIASES),
);
