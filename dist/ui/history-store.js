import { EventEmitter } from "node:events";
// Events : `items-change` pour HistoryView (items figés) et `streaming-change`
// pour StreamingView (delta en cours). Avant : un seul event `change` qui
// déclenchait un setItems([...all]) O(n) sur chaque delta SSE = re-render
// quadratique du terminal. Séparés → HistoryView ne re-render que sur push
// effectif, StreamingView uniquement sur delta.
class HistoryStore extends EventEmitter {
    items = [];
    streaming = null;
    nextId = 1;
    getItems() {
        return this.items;
    }
    getStreaming() {
        return this.streaming;
    }
    // Push un item "figé". S'il y avait un streaming en cours, on le fige
    // d'abord puis on ajoute le nouvel item.
    push(item) {
        if (this.streaming) {
            this.items.push(this.streaming);
            this.streaming = null;
            this.emit("streaming-change");
        }
        const id = this.nextId++;
        this.items.push({ ...item, id });
        this.emit("items-change");
        return id;
    }
    // Démarre/continue un message assistant streamé. Tant qu'on appelle
    // appendAssistantDelta, l'item reste dans this.streaming (zone
    // mutable). endAssistant() le fige dans this.items.
    appendAssistantDelta(delta) {
        if (!this.streaming || this.streaming.type !== "assistant") {
            // Si un streaming d'autre type existe, on le fige d'abord.
            if (this.streaming) {
                this.items.push(this.streaming);
                this.emit("items-change");
            }
            this.streaming = {
                type: "assistant",
                text: delta,
                id: this.nextId++,
            };
        }
        else {
            this.streaming.text += delta;
        }
        this.emit("streaming-change");
    }
    endAssistant() {
        if (this.streaming) {
            this.items.push(this.streaming);
            this.streaming = null;
            this.emit("items-change");
            this.emit("streaming-change");
        }
    }
    clear() {
        this.items = [];
        this.streaming = null;
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
export function installConsolePatch() {
    if (installed)
        return;
    installed = true;
    const pushLine = (args, type) => {
        const text = args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" ");
        historyStore.push({ type, text });
    };
    console.log = (...args) => pushLine(args, "raw");
    console.info = (...args) => pushLine(args, "raw");
    console.warn = (...args) => pushLine(args, "warn");
    console.error = (...args) => pushLine(args, "error");
}
