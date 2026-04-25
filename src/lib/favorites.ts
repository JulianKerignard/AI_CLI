// Résolution des modèles favoris pour /model, /best et BetterModelWatcher.
//
// Source de vérité : le catalog `/api/v1/models` côté bridge. Si le serveur
// expose `favorite: true` + `aliases: string[]` sur ses modèles, on dérive
// la shortlist directement de là. Sinon (ancien serveur), on retombe sur
// FALLBACK_FAVORITES — la liste qu'on avait avant ce refactor.
//
// Avantage : ajouter un favori côté serveur ne demande plus de release CLI.

import type { CatalogModel } from "./model-catalog.js";

// Fallback : utilisé tant que le serveur ne renvoie pas le flag `favorite`
// + `aliases`. À supprimer une fois le bridge mis à jour partout.
const FALLBACK_FAVORITES: ReadonlyArray<{ alias: string; fullId: string }> = [
  { alias: "hy3", fullId: "openrouter/tencent/hy3-preview:free" },
  { alias: "ling-1t", fullId: "openrouter/inclusionai/ling-2.6-1t:free" },
  { alias: "flash", fullId: "google/gemini-flash-latest" },
  { alias: "large", fullId: "mistral-large-latest" },
  { alias: "codestral", fullId: "codestral-latest" },
  { alias: "devstral", fullId: "devstral-latest" },
  { alias: "nemotron", fullId: "nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1" },
  { alias: "gpt-oss", fullId: "nvidia/openai/gpt-oss-120b" },
  { alias: "qwen-coder", fullId: "nvidia/qwen/qwen2.5-coder-32b-instruct" },
  { alias: "kimi-k2", fullId: "nvidia/moonshotai/kimi-k2-instruct" },
  { alias: "kimi-thinking", fullId: "nvidia/moonshotai/kimi-k2-thinking" },
  { alias: "flash-lite", fullId: "google/gemini-flash-lite-latest" },
];

export interface ResolvedFavorites {
  // alias → fullId (inclut alias primaires ET secondaires si serveur en expose).
  aliases: Record<string, string>;
  // alias primaires dans l'ordre d'affichage du picker /model.
  order: string[];
  // Set des fullIds favoris (utilisé pour filtrer le catalog dans /best
  // et BetterModelWatcher).
  fullIds: ReadonlySet<string>;
  // "catalog" si le serveur a fourni les flags, "fallback" sinon. Utile pour
  // logs/debug — on peut ainsi savoir qu'il faut updater le serveur.
  source: "catalog" | "fallback";
}

// Dérive la shortlist depuis le catalog runtime. Si le serveur ne renvoie
// rien d'utile (aucun model.favorite || aucun aliases), retombe sur
// FALLBACK_FAVORITES.
export function resolveFavoritesFromCatalog(
  catalog: ReadonlyArray<CatalogModel>,
): ResolvedFavorites {
  const tagged = catalog.filter(
    (m) => m.favorite === true && Array.isArray(m.aliases) && m.aliases.length > 0,
  );

  if (tagged.length > 0) {
    const aliases: Record<string, string> = {};
    const order: string[] = [];
    const fullIds = new Set<string>();
    for (const m of tagged) {
      const list = m.aliases ?? [];
      const primary = list[0];
      if (!primary) continue;
      aliases[primary.toLowerCase()] = m.id;
      order.push(primary);
      for (const alt of list.slice(1)) {
        aliases[alt.toLowerCase()] = m.id;
      }
      fullIds.add(m.id);
    }
    return { aliases, order, fullIds, source: "catalog" };
  }

  // Fallback : aucun model.favorite côté serveur → on utilise la shortlist
  // hardcodée. On ne filtre PAS sur la présence dans le catalog ici (le
  // call site le fait déjà via byId.get(fullId) → null skip).
  const aliases: Record<string, string> = {};
  for (const f of FALLBACK_FAVORITES) {
    aliases[f.alias.toLowerCase()] = f.fullId;
  }
  return {
    aliases,
    order: FALLBACK_FAVORITES.map((f) => f.alias),
    fullIds: new Set(FALLBACK_FAVORITES.map((f) => f.fullId)),
    source: "fallback",
  };
}

// Helper pour le switch direct `/model <alias>`. Retourne null si l'input
// n'est pas un alias connu (laisse le call site essayer de matcher comme
// fullId direct).
export function resolveAlias(
  favorites: ResolvedFavorites,
  input: string,
): string | null {
  return favorites.aliases[input.trim().toLowerCase()] ?? null;
}
