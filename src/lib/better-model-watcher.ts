import { scoreModel, type SelectionMode } from "./model-selector.js";
import { updateStatus } from "../utils/status-bar.js";

// Poller background qui fetch /api/v1/models toutes les 2 min et
// détecte s'il existe un modèle avec un meilleur score que le modèle
// courant selon le mode (default "balanced"). Si oui, set
// state.suggestedBetter dans la status bar (affiché en ligne phase).
//
// Reset à chaque switch de modèle (onLogin) via clearSuggestion().

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const MIN_SCORE_DELTA = 1.5; // Seuil pour déclencher une suggestion

interface ApiModel {
  id: string;
  provider: string;
  category: string;
  weight: number;
  description?: string;
}

export class BetterModelWatcher {
  private timer: NodeJS.Timeout | null = null;
  private getToken: () => { token: string; baseUrl: string; model: string } | null;
  private mode: SelectionMode;

  constructor(
    getToken: () => { token: string; baseUrl: string; model: string } | null,
    mode: SelectionMode = "balanced",
  ) {
    this.getToken = getToken;
    this.mode = mode;
  }

  start(): void {
    if (this.timer) return;
    // Première passe après 30s (laisse le startup se stabiliser), puis
    // cycle régulier.
    this.timer = setTimeout(() => this.tick(), 30_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setMode(mode: SelectionMode): void {
    this.mode = mode;
  }

  // Reset la suggestion (ex: l'user vient de changer de modèle via
  // /model ou /best — on oublie la suggestion précédente).
  clearSuggestion(): void {
    updateStatus({ suggestedBetter: null });
  }

  private async tick(): Promise<void> {
    try {
      await this.check();
    } catch {
      // Silencieux — si /v1/models tombe, on re-essaie au prochain tick.
    }
    if (this.timer !== null) {
      this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
    }
  }

  private async check(): Promise<void> {
    const creds = this.getToken();
    if (!creds) return;
    const res = await fetch(`${creds.baseUrl}/v1/models`, {
      headers: { "x-api-key": creds.token },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { models: ApiModel[] };
    const models = data.models ?? [];
    if (models.length === 0) return;

    const scored = models
      .map((m) => scoreModel(m, this.mode))
      .sort((a, b) => b.score - a.score);

    const current = scored.find((s) => s.model.id === creds.model);
    const top = scored[0];
    if (!top) return;

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
