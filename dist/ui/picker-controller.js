import { EventEmitter } from "node:events";
class PickerController extends EventEmitter {
    current = null;
    getCurrent() {
        return this.current;
    }
    async open(items, initial) {
        if (this.current) {
            // Un picker déjà ouvert : on annule l'ancien et on ouvre le nouveau.
            this.current.resolve(null);
        }
        return new Promise((resolve) => {
            this.current = { items, initial, resolve };
            this.emit("change");
        });
    }
    close(id) {
        const cur = this.current;
        this.current = null;
        if (cur)
            cur.resolve(id);
        this.emit("change");
    }
}
export const pickerController = new PickerController();
