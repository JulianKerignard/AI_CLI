import { EventEmitter } from "node:events";

// Pont async entre Ink (qui détecte Esc dans App.tsx via useInput) et la
// loop agent (qui détient le AbortController du fetch SSE). On ne veut pas
// faire dépendre App.tsx de l'instance Loop directement — l'emitter sert
// de bus simple.
//
// Flow :
//   user → Esc → useInput dans App.tsx → interruptController.request()
//     → emit "interrupt" → loop écoute, appelle this.abort() → abort()
//     → fetch/reader throw AbortError → loop catch → message partial
//     poussé dans l'historique → REPL prêt pour le prochain input.

class InterruptController extends EventEmitter {
  // Demande d'interruption. La loop décide si elle est applicable (ignore
  // si pas de tour en cours).
  request(): void {
    this.emit("interrupt");
  }
}

export const interruptController = new InterruptController();
interruptController.setMaxListeners(20);
