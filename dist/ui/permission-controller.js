import { EventEmitter } from "node:events";
class PermissionController extends EventEmitter {
    current = null;
    queue = [];
    getCurrent() {
        return this.current;
    }
    async ask(toolName, category, input) {
        return new Promise((resolve) => {
            const req = { toolName, category, input, resolve };
            if (this.current) {
                // Prompt déjà actif : on queue. L'user ne verra le nouveau
                // qu'après avoir résolu le courant — évite les deny silencieux.
                this.queue.push(req);
            }
            else {
                this.current = req;
                this.emit("change");
            }
        });
    }
    close(decision) {
        const cur = this.current;
        this.current = this.queue.shift() ?? null;
        if (cur)
            cur.resolve(decision);
        this.emit("change");
    }
}
export const permissionController = new PermissionController();
