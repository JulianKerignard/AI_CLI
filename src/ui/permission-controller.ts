import { EventEmitter } from "node:events";
import type { PromptDecision } from "../permissions/prompt.js";

// Pont async entre askPermission (agent loop) et le composant
// PermissionPicker. La commande fait
// `await permissionController.ask(toolName, category, input)` qui
// affiche le picker dans l'App et attend la décision.

type Category = "safe" | "edit" | "execute";
type Resolver = (d: PromptDecision) => void;

interface PermissionRequest {
  toolName: string;
  category: Category;
  input: Record<string, unknown>;
  resolve: Resolver;
}

class PermissionController extends EventEmitter {
  private current: PermissionRequest | null = null;
  private queue: PermissionRequest[] = [];

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  getCurrent(): PermissionRequest | null {
    return this.current;
  }

  async ask(
    toolName: string,
    category: Category,
    input: Record<string, unknown>,
  ): Promise<PromptDecision> {
    return new Promise<PromptDecision>((resolve) => {
      const req: PermissionRequest = { toolName, category, input, resolve };
      if (this.current) {
        // Prompt déjà actif : on queue. L'user ne verra le nouveau
        // qu'après avoir résolu le courant — évite les deny silencieux.
        this.queue.push(req);
      } else {
        this.current = req;
        this.emit("change");
      }
    });
  }

  close(decision: PromptDecision): void {
    const cur = this.current;
    this.current = this.queue.shift() ?? null;
    if (cur) cur.resolve(decision);
    this.emit("change");
  }
}

export const permissionController = new PermissionController();
