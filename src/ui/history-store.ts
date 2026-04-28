import { EventEmitter } from "node:events";

// Store d'historique. Items "figés" (via <Static>) + un item streaming
// courant (rendu en zone mutable au-dessus de l'input, pour que le
// delta s'affiche live sans re-rendre toute la liste).

export type HistoryItem =
  | { type: "user"; text: string; id: number }
  | { type: "assistant"; text: string; id: number }
  | { type: "tool"; text: string; id: number }
  | { type: "info"; text: string; id: number }
  | { type: "warn"; text: string; id: number }
  | { type: "error"; text: string; id: number }
  | { type: "raw"; text: string; id: number };

// Events : `items-change` pour HistoryView (items figés) et `streaming-change`
// pour StreamingView (delta en cours). Avant : un seul event `change` qui
// déclenchait un setItems([...all]) O(n) sur chaque delta SSE = re-render
// quadratique du terminal. Séparés → HistoryView ne re-render que sur push
// effectif, StreamingView uniquement sur delta.
//
// Cap mémoire : sur une session longue (>1h, tools verbeux), items[] peut
// dépasser plusieurs dizaines de MB. Comme <Static> d'Ink a déjà écrit les
// vieux items dans le scrollback terminal et ne les re-render plus, on peut
// les évincer du store sans impact visuel — l'user retrouve l'historique
// dans le scrollback. Garde un compteur pour debug/info.
const MAX_ITEMS = 500;

class HistoryStore extends EventEmitter {
  private items: HistoryItem[] = [];
  private streaming: HistoryItem | null = null;
  private nextId = 1;
  private evictedCount = 0;

  constructor() {
    super();
    // Plusieurs vues s'abonnent (HistoryView, StreamingView, voire dev) —
    // 20 absorbe les remounts Ink + composants de debug sans warning.
    this.setMaxListeners(20);
  }

  getItems(): readonly HistoryItem[] {
    return this.items;
  }

  getStreaming(): HistoryItem | null {
    return this.streaming;
  }

  // Nombre d'items évincés depuis le début de la session (pour debug,
  // affichage status bar, etc.).
  getEvictedCount(): number {
    return this.evictedCount;
  }

  // Trim head si on dépasse MAX_ITEMS. Appelé après chaque push. O(1) amortized
  // (splice depuis le début est O(n) mais rare : on évince par batch d'1).
  private trimIfNeeded(): void {
    if (this.items.length > MAX_ITEMS) {
      const drop = this.items.length - MAX_ITEMS;
      this.items.splice(0, drop);
      this.evictedCount += drop;
    }
  }

  // Push un item "figé". S'il y avait un streaming en cours, on le fige
  // d'abord puis on ajoute le nouvel item.
  push(item: Omit<HistoryItem, "id">): number {
    if (this.streaming) {
      this.items.push(this.streaming);
      this.streaming = null;
      this.emit("streaming-change");
    }
    const id = this.nextId++;
    this.items.push({ ...item, id } as HistoryItem);
    this.trimIfNeeded();
    this.emit("items-change");
    return id;
  }

  // Démarre/continue un message assistant streamé. Tant qu'on appelle
  // appendAssistantDelta, l'item reste dans this.streaming (zone
  // mutable). endAssistant() le fige dans this.items.
  appendAssistantDelta(delta: string): void {
    if (!this.streaming || this.streaming.type !== "assistant") {
      // Si un streaming d'autre type existe, on le fige d'abord.
      if (this.streaming) {
        this.items.push(this.streaming);
        this.trimIfNeeded();
        this.emit("items-change");
      }
      this.streaming = {
        type: "assistant",
        text: delta,
        id: this.nextId++,
      };
    } else {
      (this.streaming as { text: string }).text += delta;
    }
    this.emit("streaming-change");
  }

  endAssistant(): void {
    if (this.streaming) {
      this.items.push(this.streaming);
      this.streaming = null;
      this.trimIfNeeded();
      this.emit("items-change");
      this.emit("streaming-change");
    }
  }

  // Retourne le texte assistant en cours de stream (utilisé par la loop
  // pour récupérer le partial au moment d'un abort user). Ne consomme pas
  // le buffer, ne fige pas — endAssistant() reste responsable du flush.
  getAssistantPartial(): string {
    if (this.streaming?.type === "assistant") {
      return (this.streaming as { text: string }).text;
    }
    return "";
  }

  clear(): void {
    this.items = [];
    this.streaming = null;
    this.evictedCount = 0;
    this.emit("items-change");
    this.emit("streaming-change");
  }
}

export const historyStore = new HistoryStore();

// Intercepte console.log / console.error / console.warn pour rediriger
// vers le store. Nécessaire parce que les commandes builtin (/help,
// /permissions, etc.) font `console.log(...)` direct au lieu de log.* —
// sans cette redirection, Ink masque leurs outputs.
//
// On garde les Function refs originales pour `_debug` si besoin.
let installed = false;
export function installConsolePatch(): void {
  if (installed) return;
  installed = true;
  const pushLine = (args: unknown[], type: "raw" | "warn" | "error") => {
    const text = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    historyStore.push({ type, text });
  };
  console.log = (...args: unknown[]) => pushLine(args, "raw");
  console.info = (...args: unknown[]) => pushLine(args, "raw");
  console.warn = (...args: unknown[]) => pushLine(args, "warn");
  console.error = (...args: unknown[]) => pushLine(args, "error");
}
