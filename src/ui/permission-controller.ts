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

  getCurrent(): PermissionRequest | null {
    return this.current;
  }

  async ask(
    toolName: string,
    category: Category,
    input: Record<string, unknown>,
  ): Promise<PromptDecision> {
    if (this.current) {
      // Un prompt en cours : on annule l'ancien par sécurité (deny).
      this.current.resolve("deny");
    }
    return new Promise<PromptDecision>((resolve) => {
      this.current = { toolName, category, input, resolve };
      this.emit("change");
    });
  }

  close(decision: PromptDecision): void {
    const cur = this.current;
    this.current = null;
    if (cur) cur.resolve(decision);
    this.emit("change");
  }
}

export const permissionController = new PermissionController();
