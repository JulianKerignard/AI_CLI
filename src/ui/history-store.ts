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

class HistoryStore extends EventEmitter {
  private items: HistoryItem[] = [];
  private streaming: HistoryItem | null = null;
  private nextId = 1;

  getItems(): readonly HistoryItem[] {
    return this.items;
  }

  getStreaming(): HistoryItem | null {
    return this.streaming;
  }

  // Push un item "figé". S'il y avait un streaming en cours, on le fige
  // d'abord puis on ajoute le nouvel item.
  push(item: Omit<HistoryItem, "id">): number {
    if (this.streaming) {
      this.items.push(this.streaming);
      this.streaming = null;
    }
    const id = this.nextId++;
    this.items.push({ ...item, id } as HistoryItem);
    this.emit("change");
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
      }
      this.streaming = {
        type: "assistant",
        text: delta,
        id: this.nextId++,
      };
    } else {
      (this.streaming as { text: string }).text += delta;
    }
    this.emit("change");
  }

  endAssistant(): void {
    if (this.streaming) {
      this.items.push(this.streaming);
      this.streaming = null;
      this.emit("change");
    }
  }

  clear(): void {
    this.items = [];
    this.streaming = null;
    this.emit("change");
  }
}

export const historyStore = new HistoryStore();
