import { EventEmitter } from "node:events";
class SessionController extends EventEmitter {
    current = null;
    getCurrent() {
        return this.current;
    }
    async open(items) {
        if (this.current)
            this.current.resolve(null);
        return new Promise((resolve) => {
            this.current = { items, resolve };
            this.emit("change");
        });
    }
    close(path) {
        const cur = this.current;
        this.current = null;
        if (cur)
            cur.resolve(path);
        this.emit("change");
    }
}
export const sessionController = new SessionController();
