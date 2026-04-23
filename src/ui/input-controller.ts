import { EventEmitter } from "node:events";

// Pont entre la boucle REPL (async loop) et le composant InputBox React.
// Le REPL fait `await inputController.waitForLine()` ; le composant
// InputBox appelle `inputController.submit(line)` quand l'user tape Enter.
//
// Ctrl-C : submit(null) pour signaler une interruption (le REPL compte
// les doubles Ctrl-C et exit si applicable).

type Resolver = (line: string) => void;
type Rejecter = (err: Error) => void;

class InputController extends EventEmitter {
  private pending:
    | { resolve: Resolver; reject: Rejecter }
    | null = null;
  private _disabled = false;

  get disabled(): boolean {
    return this._disabled;
  }

  setDisabled(v: boolean): void {
    if (this._disabled !== v) {
      this._disabled = v;
      this.emit("disabled-change");
    }
  }

  waitForLine(): Promise<string> {
    if (this.pending) {
      // Un seul await à la fois. Si un prev existe (shouldn't), on reject.
      this.pending.reject(new Error("waitForLine overridden"));
    }
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  // Appelé par InputBox quand Enter.
  submit(line: string): void {
    const p = this.pending;
    this.pending = null;
    if (p) p.resolve(line);
  }

  // Appelé par InputBox quand Ctrl-C (interrupt). Le REPL reçoit un
  // throw "INTERRUPT" et gère le double-Ctrl-C côté boucle.
  interrupt(): void {
    const p = this.pending;
    this.pending = null;
    if (p) p.reject(new Error("INTERRUPT"));
  }

  // Appelé par InputBox quand Shift+Tab. Le REPL écoute cet event et
  // cycle entre default → accept-edits → plan → bypass → default.
  cyclePermissionMode(): void {
    this.emit("cycle-permission-mode");
  }
}

export const inputController = new InputController();
