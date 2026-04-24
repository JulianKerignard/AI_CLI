// Shortlist de modèles favoris pour /fav et résolution d'alias dans /model.
// Les alias reflètent ceux définis côté serveur dans site/lib/api-models.ts
// (MODEL_ALIASES). Dupliqués ici pour que le CLI puisse les résoudre
// localement sans round-trip. Si le serveur ajoute/renomme un alias, il
// faut mettre à jour cette map — le bridge l'accepte quand même côté
// requête (mapAnthropicModel fait la résolution), mais /model <alias>
// a besoin de connaître le fullId pour le matcher au catalog.

export const FAVORITE_ALIASES: Record<string, string> = {
  hy3: "openrouter/tencent/hy3-preview:free",
  "ling-1t": "openrouter/inclusionai/ling-2.6-1t:free",
  flash: "gemini-flash-latest",
  large: "mistral-large-latest",
  codestral: "codestral-latest",
  devstral: "devstral-latest",
};

// Ordre d'affichage dans /fav. Garde le même que le tableau saisi par
// l'user pour qu'il retrouve ses repères.
export const FAVORITE_ORDER: readonly string[] = [
  "hy3",
  "ling-1t",
  "flash",
  "large",
  "codestral",
  "devstral",
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
