// Cache partagé du catalogue /api/v1/models. Avant : /model, /best, et
// BetterModelWatcher re-fetchaient la même URL indépendamment. Maintenant
// un seul fetch par intervalle TTL + invalidation manuelle (ex: sur
// onLogin quand on change de serveur).

export interface CatalogModel {
  id: string;
  provider: string;
  category: string;
  weight: number;
  vision?: boolean;
  web_search?: boolean;
  description?: string;
  // Mesures live depuis le cron VPS — tous les providers (NVIDIA / Mistral /
  // Google / OpenRouter) depuis l'extension du bridge /api/v1/models.
  // Permet au watcher + /best + /model de scorer/trier finement.
  ttftMs?: number | null;
  tokPerSec?: number | null;
  measuredAt?: number;
  speed?: string;
  // Alias courts exposés par le serveur (ex: ["large", "mistral"]). Le premier
  // est traité comme primaire (affiché dans le picker /model). Si absent côté
  // serveur, le CLI retombe sur la liste hardcodée dans favorites.ts.
  aliases?: string[];
  // Marque les modèles que le serveur veut voir dans /model et /best. Si aucun
  // modèle du catalog n'a ce flag, le CLI retombe sur la shortlist hardcodée.
  favorite?: boolean;
}

const TTL_MS = 30_000;
let cache: { models: CatalogModel[]; expiresAt: number } | null = null;
let inflight: Promise<CatalogModel[]> | null = null;

interface Creds {
  token: string;
  baseUrl: string;
}

export async function fetchCatalog(
  creds: Creds,
  opts: { signal?: AbortSignal; force?: boolean } = {},
): Promise<CatalogModel[]> {
  const now = Date.now();
  if (!opts.force && cache && cache.expiresAt > now) return cache.models;
  if (!opts.force && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${creds.baseUrl}/v1/models`, {
        headers: { "x-api-key": creds.token },
        signal: opts.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} depuis /v1/models`);
      }
      const data = (await res.json()) as { models: CatalogModel[] };
      const models = data.models ?? [];
      cache = { models, expiresAt: Date.now() + TTL_MS };
      return models;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateCatalog(): void {
  cache = null;
  inflight = null;
}

// Accès synchrone au catalog actuel (pour modelSupportsVision qui doit
// répondre sans async roundtrip). Retourne [] si pas encore fetch.
export function listCatalogModels(): CatalogModel[] {
  return cache?.models ?? [];
}
