import { EventEmitter } from "node:events";
import type { ModelItem } from "./ModelPicker.js";

// Pont async entre les commandes (ex: /model dans builtin.ts) et le
// composant ModelPicker. La commande fait `await pickerController.open(models)`
// qui affiche le picker dans l'App et attend la sélection.

type Resolver = (id: string | null) => void;

interface PickerRequest {
  items: ModelItem[];
  initial?: string;
  resolve: Resolver;
}

class PickerController extends EventEmitter {
  private current: PickerRequest | null = null;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  getCurrent(): PickerRequest | null {
    return this.current;
  }

  async open(items: ModelItem[], initial?: string): Promise<string | null> {
    if (this.current) {
      // Un picker déjà ouvert : on annule l'ancien et on ouvre le nouveau.
      this.current.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
      this.current = { items, initial, resolve };
      this.emit("change");
    });
  }

  close(id: string | null): void {
    const cur = this.current;
    this.current = null;
    if (cur) cur.resolve(id);
    this.emit("change");
  }
}

export const pickerController = new PickerController();
