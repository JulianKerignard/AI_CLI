import { EventEmitter } from "node:events";
import type { SessionSummary } from "../sessions/store.js";

// Controller du SessionPicker — ouvert par /resume, pilote l'affichage
// dans l'App (remplace temporairement l'InputBox).

type Resolver = (path: string | null) => void;

interface Request {
  items: SessionSummary[];
  showCwd: boolean;
  resolve: Resolver;
}

class SessionController extends EventEmitter {
  private current: Request | null = null;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  getCurrent(): Request | null {
    return this.current;
  }

  async open(
    items: SessionSummary[],
    showCwd = false,
  ): Promise<string | null> {
    if (this.current) this.current.resolve(null);
    return new Promise<string | null>((resolve) => {
      this.current = { items, showCwd, resolve };
      this.emit("change");
    });
  }

  close(path: string | null): void {
    const cur = this.current;
    this.current = null;
    if (cur) cur.resolve(path);
    this.emit("change");
  }
}

export const sessionController = new SessionController();
