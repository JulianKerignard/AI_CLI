// Token bucket sliding window client-side pour respecter le rate limit
// Mistral free plan (4 req/min). On cible 3 req/min (marge 25%) pour éviter
// les 429 visibles. Honor Retry-After côté serveur pour resserrer le bucket
// temporairement si on se fait quand même bloquer.

export interface RateLimiterOpts {
  // Capacité = nombre max de requêtes dans la fenêtre.
  capacity?: number;
  // Fenêtre en ms (sliding).
  windowMs?: number;
  // Callback émis quand on entre dans une attente (pour afficher status bar).
  // `cancel()` arrête le wait et throw AbortError si appelé.
  onWait?: (info: { delayMs: number; cancel: () => void }) => void;
}

const DEFAULT_CAPACITY = 3;
const DEFAULT_WINDOW_MS = 60_000;

export class RateLimiter {
  private timestamps: number[] = [];
  private capacity: number;
  private windowMs: number;
  // État "cold" : si on a reçu un 429, on resserre temporairement (2/min au
  // lieu de 3) pendant COLD_DURATION_MS.
  private coldUntil = 0;
  private readonly COLD_CAPACITY = 2;
  private readonly COLD_DURATION_MS = 5 * 60 * 1000;

  constructor(private opts: RateLimiterOpts = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  }

  private activeCapacity(): number {
    return Date.now() < this.coldUntil ? this.COLD_CAPACITY : this.capacity;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  // Temps d'attente en ms avant la prochaine slot libre (0 si dispo).
  // Ne consomme PAS la slot — utiliser reserveOrGetDelay pour atomic.
  waitFor(): number {
    const now = Date.now();
    this.trim(now);
    if (now < this.forcedWaitUntil) {
      return this.forcedWaitUntil - now;
    }
    if (this.timestamps.length < this.activeCapacity()) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, oldest + this.windowMs - now);
  }

  // Atomique : si une slot est libre, la réserve (push timestamp) et
  // retourne 0. Sinon retourne le delay ms sans rien push. Évite la
  // race où 2 callers voient tous deux waitFor()===0 et dépassent la
  // capacité au double record().
  reserveOrGetDelay(): number {
    const delay = this.waitFor();
    if (delay === 0) {
      this.timestamps.push(Date.now());
    }
    return delay;
  }

  // Signale qu'on vient d'émettre une requête (à appeler APRÈS l'attente, juste
  // avant le fetch). Tick immédiat pour que le prochain waitFor() voie la req.
  record(): void {
    this.timestamps.push(Date.now());
  }

  // Marque comme "cold" suite à un 429. Au lieu de push un timestamp
  // futur (qui ne serait jamais trimé et empoisonnerait le compteur),
  // on stocke une deadline séparée forcedWaitUntil lue par waitFor().
  markCold(retryAfterMs?: number): void {
    this.coldUntil = Date.now() + this.COLD_DURATION_MS;
    if (retryAfterMs && retryAfterMs > 0) {
      this.forcedWaitUntil = Math.max(
        this.forcedWaitUntil,
        Date.now() + retryAfterMs,
      );
    }
  }

  private forcedWaitUntil = 0;

  // Attend le prochain slot puis record. Émet onWait avec un `cancel()` si
  // l'attente dépasse 100ms.
  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const delayMs = this.waitFor();
      if (delayMs === 0) {
        this.record();
        return;
      }
      // Fire onWait pour l'UI status bar.
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
      };
      if (delayMs > 100 && this.opts.onWait) {
        this.opts.onWait({ delayMs, cancel });
      }
      // Sleep interruptible (AbortSignal + local cancel).
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        const abort = () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        };
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }
        // Poll 200ms pour vérifier cancel (lightweight).
        const poll = setInterval(() => {
          if (cancelled) {
            clearTimeout(t);
            clearInterval(poll);
            resolve();
          }
        }, 200);
        setTimeout(() => clearInterval(poll), delayMs + 100);
      });
      // Reboucle pour revérifier : après sleep, d'autres activités peuvent
      // avoir consommé la slot (rare en single-REPL, mais safe).
    }
  }

  // Snapshot pour /usage ou debug.
  snapshot(): {
    capacity: number;
    used: number;
    windowMs: number;
    cold: boolean;
    coldUntil: number;
  } {
    const now = Date.now();
    this.trim(now);
    return {
      capacity: this.activeCapacity(),
      used: this.timestamps.length,
      windowMs: this.windowMs,
      cold: now < this.coldUntil,
      coldUntil: this.coldUntil,
    };
  }
}
