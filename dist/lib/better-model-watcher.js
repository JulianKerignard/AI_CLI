import { scoreModel } from "./model-selector.js";
import { updateStatus } from "../utils/status-bar.js";
// Poller background qui fetch /api/v1/models toutes les 2 min et
// détecte s'il existe un modèle avec un meilleur score que le modèle
// courant selon le mode (default "balanced"). Si oui, set
// state.suggestedBetter dans la status bar (affiché en ligne phase).
//
// Reset à chaque switch de modèle (onLogin) via clearSuggestion().
const POLL_INTERVAL_MS = 60 * 1000;
const MIN_SCORE_DELTA = 1.5; // Seuil pour déclencher une suggestion
export class BetterModelWatcher {
    timer = null;
    abortCtrl = null;
    stopped = false;
    getToken;
    mode;
    constructor(getToken, mode = "balanced") {
        this.getToken = getToken;
        this.mode = mode;
    }
    start() {
        if (this.timer || this.stopped)
            return;
        // Premier tick rapide (3s) pour avoir les indices Q/V affichés dès
        // l'ouverture du REPL. Puis poll régulier chaque 60s.
        this.timer = setTimeout(() => this.tick(), 3_000);
    }
    // Force un fetch immédiat (pour /refresh ou après un switch de modèle).
    forceRefresh() {
        if (this.stopped)
            return;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => this.tick(), 0);
    }
    stop() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        // Abort le fetch en cours si stop() arrive au milieu d'un tick.
        if (this.abortCtrl) {
            this.abortCtrl.abort();
            this.abortCtrl = null;
        }
    }
    setMode(mode) {
        this.mode = mode;
    }
    // Reset la suggestion (ex: l'user vient de changer de modèle via
    // /model ou /best — on oublie la suggestion précédente).
    clearSuggestion() {
        updateStatus({ suggestedBetter: null });
    }
    async tick() {
        try {
            await this.check();
        }
        catch {
            // Silencieux — si /v1/models tombe, on re-essaie au prochain tick.
        }
        if (!this.stopped) {
            this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
        }
    }
    async check() {
        const creds = this.getToken();
        if (!creds)
            return;
        this.abortCtrl = new AbortController();
        const timer = setTimeout(() => this.abortCtrl?.abort(), 10_000);
        const { fetchCatalog } = await import("./model-catalog.js");
        let models;
        try {
            // Cache partagé avec /model et /best — 1 seul fetch TTL 60s.
            const cached = await fetchCatalog(creds, { signal: this.abortCtrl.signal });
            models = cached;
        }
        catch {
            return;
        }
        finally {
            clearTimeout(timer);
            this.abortCtrl = null;
        }
        if (this.stopped)
            return;
        if (models.length === 0)
            return;
        const scored = models
            .map((m) => scoreModel(m, this.mode))
            .sort((a, b) => b.score - a.score);
        const current = scored.find((s) => s.model.id === creds.model);
        const top = scored[0];
        if (!top)
            return;
        // Push toujours les Q/V du modèle courant (pour l'UI permanente).
        const currentUpdate = current
            ? {
                currentQuality: current.qualityOutOf10,
                currentSpeed: current.speedOutOf10,
            }
            : {};
        if (top.model.id === creds.model) {
            updateStatus({ ...currentUpdate, suggestedBetter: null });
            return;
        }
        const currentScore = current?.score ?? 0;
        if (top.score - currentScore < MIN_SCORE_DELTA) {
            updateStatus({ ...currentUpdate, suggestedBetter: null });
            return;
        }
        updateStatus({
            ...currentUpdate,
            suggestedBetter: {
                id: top.model.id,
                qualityOutOf10: top.qualityOutOf10,
                speedOutOf10: top.speedOutOf10,
            },
        });
    }
}
