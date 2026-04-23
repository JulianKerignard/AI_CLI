// Cache partagé du catalogue /api/v1/models. Avant : /model, /best, et
// BetterModelWatcher re-fetchaient la même URL indépendamment. Maintenant
// un seul fetch par intervalle TTL + invalidation manuelle (ex: sur
// onLogin quand on change de serveur).
const TTL_MS = 30_000;
let cache = null;
let inflight = null;
export async function fetchCatalog(creds, opts = {}) {
    const now = Date.now();
    if (!opts.force && cache && cache.expiresAt > now)
        return cache.models;
    if (!opts.force && inflight)
        return inflight;
    inflight = (async () => {
        try {
            const res = await fetch(`${creds.baseUrl}/v1/models`, {
                headers: { "x-api-key": creds.token },
                signal: opts.signal,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} depuis /v1/models`);
            }
            const data = (await res.json());
            const models = data.models ?? [];
            cache = { models, expiresAt: Date.now() + TTL_MS };
            return models;
        }
        finally {
            inflight = null;
        }
    })();
    return inflight;
}
export function invalidateCatalog() {
    cache = null;
    inflight = null;
}
// Accès synchrone au catalog actuel (pour modelSupportsVision qui doit
// répondre sans async roundtrip). Retourne [] si pas encore fetch.
export function listCatalogModels() {
    return cache?.models ?? [];
}
