import { EventEmitter } from "node:events";
class InputController extends EventEmitter {
    pending = null;
    _disabled = false;
    get disabled() {
        return this._disabled;
    }
    setDisabled(v) {
        if (this._disabled !== v) {
            this._disabled = v;
            this.emit("disabled-change");
        }
    }
    waitForLine() {
        if (this.pending) {
            // Un seul await à la fois. Si un prev existe (shouldn't), on reject.
            this.pending.reject(new Error("waitForLine overridden"));
        }
        return new Promise((resolve, reject) => {
            this.pending = { resolve, reject };
        });
    }
    // Appelé par InputBox quand Enter.
    submit(line) {
        const p = this.pending;
        this.pending = null;
        if (p)
            p.resolve(line);
    }
    // Appelé par InputBox quand Ctrl-C (interrupt). Le REPL reçoit un
    // throw "INTERRUPT" et gère le double-Ctrl-C côté boucle.
    interrupt() {
        const p = this.pending;
        this.pending = null;
        if (p)
            p.reject(new Error("INTERRUPT"));
    }
    // Appelé par InputBox quand Shift+Tab. Le REPL écoute cet event et
    // cycle entre default → accept-edits → plan → bypass → default.
    cyclePermissionMode() {
        this.emit("cycle-permission-mode");
    }
}
export const inputController = new InputController();
