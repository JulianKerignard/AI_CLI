import { EventEmitter } from "node:events";

// Pont async entre le tool AskUser (appelé depuis l'agent loop) et le
// composant AskPicker Ink. Le tool fait `await askController.open(...)`,
// le composant affiche la question + options (ou un input texte libre si
// pas d'options), l'user choisit/tape, le tool récupère la réponse.
//
// Différent de pickerController (model picker) : items sont des strings
// simples + une question en header, pas des ModelItem typés.

type Resolver = (answer: string | null) => void;

export interface AskRequest {
  question: string;
  options?: string[];
  resolve: Resolver;
}

class AskController extends EventEmitter {
  private current: AskRequest | null = null;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  getCurrent(): AskRequest | null {
    return this.current;
  }

  async open(
    question: string,
    options?: string[],
  ): Promise<string | null> {
    if (this.current) {
      // Annule la question précédente si une nouvelle arrive (l'agent
      // a sûrement décidé de poser autre chose). Peu probable en pratique.
      this.current.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
      this.current = { question, options, resolve };
      this.emit("change");
    });
  }

  close(answer: string | null): void {
    const cur = this.current;
    this.current = null;
    if (cur) cur.resolve(answer);
    this.emit("change");
  }
}

export const askController = new AskController();
