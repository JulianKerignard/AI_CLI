// Cleanup alt-screen sur signal/exit/crash. Sans ça, un crash en mode
// fullscreen laisse le terminal coincé dans l'écran alternatif (curseur
// caché, scrollback indispo, prompt invisible). Le user doit alors
// `reset` ou ouvrir un nouveau terminal — UX catastrophique.
//
// Ink 7 expose `Instance.cleanup()` qui sort proprement de l'alt-screen.
// On stocke la référence ici pour que les signal handlers (déclarés
// très tôt dans index.ts, avant que startRepl monte Ink) puissent
// déclencher le cleanup quand l'instance existe.
//
// Idempotent : appelable plusieurs fois sans dommage. Reset après le
// 1er appel pour éviter une double-cleanup au exit normal.

type CleanupFn = () => void;

let registered: CleanupFn | null = null;
let didCleanup = false;

export function registerScreenCleanup(fn: CleanupFn): void {
  registered = fn;
  didCleanup = false;
}

export function triggerScreenCleanup(): void {
  if (didCleanup) return;
  didCleanup = true;
  if (registered) {
    try {
      registered();
    } catch {
      // Cleanup ne doit jamais throw — on ignore proprement.
    }
    registered = null;
  }
  // Belt-and-suspenders : écrit l'ANSI escape directement au cas où Ink
  // ne serait pas instancié (crash très tôt avant render). Quitte alt-
  // screen + restore curseur.
  try {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l\x1b[?25h");
    }
  } catch {
    // process.stdout fermé : rien à faire.
  }
}

// Câble les handlers globaux. Appelé une seule fois depuis index.ts
// AVANT le premier render Ink. Idempotent via le flag installed.
let installed = false;
export function installSignalHandlers(): void {
  if (installed) return;
  installed = true;

  // 'exit' = ultime safety net (toujours déclenché). Les autres handlers
  // appellent process.exit() → 'exit' s'enchaîne et fait le cleanup
  // final si pas déjà fait.
  process.on("exit", triggerScreenCleanup);

  // SIGINT (Ctrl+C) : Ink gère déjà via exitOnCtrlC=false côté repl,
  // mais on s'assure du cleanup au cas où le REPL skip le handler
  // (race condition au boot, ou crash mid-stream).
  process.on("SIGINT", () => {
    triggerScreenCleanup();
    process.exit(130);
  });

  process.on("SIGTERM", () => {
    triggerScreenCleanup();
    process.exit(143);
  });

  process.on("SIGHUP", () => {
    triggerScreenCleanup();
    process.exit(129);
  });

  // uncaughtException : index.ts a déjà un handler qui log + continue.
  // On ne process.exit() PAS ici (pour ne pas overrider ce comportement),
  // mais on cleanup pour pas laisser le terminal cassé si on plante.
  // Ink restera mounté tant que uncaughtException ne tue pas le process,
  // donc on ne peut pas appeler son cleanup ici. On écrit juste l'ANSI
  // escape de secours si on est encore en alt-screen.
  process.on("uncaughtException", () => {
    // Ne PAS appeler triggerScreenCleanup ici — ça désinstallerait le
    // cleanup Ink qui pourrait encore être nécessaire si l'app survit.
    // Juste belt-and-suspenders ANSI au cas où.
    if (process.stdout.isTTY) {
      try {
        process.stdout.write("\x1b[?25h");
      } catch {
        // ignore
      }
    }
  });
}
