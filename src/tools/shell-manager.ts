import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { detectShell } from "./shell-detect.js";

// Manager pour shells lancés en arrière-plan via Bash run_in_background.
// Pattern Claude Code : l'agent peut lancer un dev server / test runner /
// build long, recevoir un shell_id immédiatement, puis lire les logs au
// fil de l'eau via BashOutput sans bloquer la boucle agent.
//
// Cap mémoire : 8 MB par shell pour les buffers stdout/stderr — au-delà
// on rolling-window les bytes les plus anciens (un dev server bavard
// peut générer GB de logs sur une session longue, on évite l'OOM).
//
// Cleanup : process.on('exit') tue tous les shells encore en cours pour
// pas laisser de zombies si le REPL exit (Ctrl-C, /exit, crash).

const MAX_BUFFER_BYTES = 8 * 1024 * 1024; // 8 MB par shell

export type ShellStatus = "running" | "done" | "killed" | "error";

interface ShellState {
  id: string;
  command: string;
  cwd: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: number;
  endedAt: number | null;
  status: ShellStatus;
  // Offset (en chars combinés stdout+stderr) jusqu'où l'agent a déjà lu
  // via BashOutput. getOutput() retourne le delta depuis cet offset.
  lastReadOffset: number;
}

class ShellManager {
  private shells = new Map<string, ShellState>();
  private cleanupInstalled = false;

  // Génère un id court lisible (8 chars hex). Collisions improbables
  // pour <100 shells/session — pas de namespace nécessaire.
  private newId(): string {
    return randomBytes(4).toString("hex");
  }

  // Installe le cleanup global au 1er spawn — pas avant pour éviter
  // d'ajouter des handlers process inutiles si le user n'utilise jamais
  // les background shells.
  private ensureCleanup(): void {
    if (this.cleanupInstalled) return;
    this.cleanupInstalled = true;
    process.on("exit", () => {
      for (const s of this.shells.values()) {
        if (s.status === "running") {
          try {
            s.child.kill("SIGKILL");
          } catch {
            // Process déjà mort.
          }
        }
      }
    });
  }

  spawn(command: string, cwd: string): { id: string; pid?: number } {
    this.ensureCleanup();
    const id = this.newId();
    const shell = detectShell();
    const child = spawn(shell.cmd, shell.args(command), {
      cwd,
      env: process.env,
      // detached:false pour que SIGINT du parent propage aux children
      // (sinon un Ctrl-C dans le REPL ne tue pas le dev server bg).
      detached: false,
    });
    const state: ShellState = {
      id,
      command,
      cwd,
      child,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      endedAt: null,
      status: "running",
      lastReadOffset: 0,
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      state.stdout += chunk.toString();
      if (state.stdout.length > MAX_BUFFER_BYTES) {
        const drop = state.stdout.length - MAX_BUFFER_BYTES;
        state.stdout = state.stdout.slice(drop);
        // Ajuste lastReadOffset si on a coupé en dessous (sinon on
        // retournerait du delta négatif au prochain getOutput). On
        // retient juste de quoi rester cohérent.
        state.lastReadOffset = Math.max(0, state.lastReadOffset - drop);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      state.stderr += chunk.toString();
      if (state.stderr.length > MAX_BUFFER_BYTES) {
        const drop = state.stderr.length - MAX_BUFFER_BYTES;
        state.stderr = state.stderr.slice(drop);
      }
    });
    child.on("close", (code, signal) => {
      state.exitCode = code;
      state.signal = signal;
      state.endedAt = Date.now();
      if (state.status === "running") {
        state.status = signal ? "killed" : "done";
      }
    });
    child.on("error", () => {
      state.status = "error";
      state.endedAt = Date.now();
    });
    this.shells.set(id, state);
    return { id, pid: child.pid };
  }

  // Retourne le delta stdout+stderr depuis le dernier getOutput, et
  // avance lastReadOffset. filter optionnel = regex à matcher ligne par
  // ligne sur le combiné stdout (pas stderr).
  getOutput(
    id: string,
    filter?: RegExp,
  ): {
    found: true;
    stdout: string;
    stderr: string;
    status: ShellStatus;
    exitCode: number | null;
    runtimeMs: number;
  } | { found: false } {
    const s = this.shells.get(id);
    if (!s) return { found: false };
    // Le delta = uniquement la nouvelle portion stdout depuis lastRead.
    // stderr retourné en entier à chaque appel (souvent court, infos
    // d'erreur précieuses pour l'agent même en re-read).
    const newStdout = s.stdout.slice(s.lastReadOffset);
    s.lastReadOffset = s.stdout.length;
    let stdout = newStdout;
    if (filter) {
      stdout = newStdout
        .split("\n")
        .filter((l) => filter.test(l))
        .join("\n");
    }
    const runtimeMs = (s.endedAt ?? Date.now()) - s.startedAt;
    return {
      found: true,
      stdout,
      stderr: s.stderr,
      status: s.status,
      exitCode: s.exitCode,
      runtimeMs,
    };
  }

  kill(
    id: string,
  ): { found: true; status: ShellStatus } | { found: false } {
    const s = this.shells.get(id);
    if (!s) return { found: false };
    if (s.status !== "running") {
      // Déjà terminé : pas d'erreur, juste retourne le status courant.
      return { found: true, status: s.status };
    }
    try {
      s.child.kill("SIGTERM");
      // Force kill après 2s si toujours en vie.
      setTimeout(() => {
        if (s.status === "running") {
          try {
            s.child.kill("SIGKILL");
          } catch {
            // Déjà mort.
          }
        }
      }, 2000).unref();
    } catch {
      // Process déjà mort entre le check et le kill — race bénin.
    }
    s.status = "killed";
    return { found: true, status: "killed" };
  }

  list(): Array<{
    id: string;
    command: string;
    status: ShellStatus;
    runtimeMs: number;
    exitCode: number | null;
  }> {
    const out: Array<{
      id: string;
      command: string;
      status: ShellStatus;
      runtimeMs: number;
      exitCode: number | null;
    }> = [];
    for (const s of this.shells.values()) {
      out.push({
        id: s.id,
        command: s.command,
        status: s.status,
        runtimeMs: (s.endedAt ?? Date.now()) - s.startedAt,
        exitCode: s.exitCode,
      });
    }
    return out;
  }

  // Évince les shells terminés depuis plus de N minutes pour pas
  // accumuler indéfiniment. Appelé manuellement via /shells clean ou
  // au-delà de 50 shells stockés. Préserve les running.
  prune(maxAgeMs = 60 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, s] of this.shells.entries()) {
      if (s.status === "running") continue;
      if (s.endedAt && now - s.endedAt > maxAgeMs) {
        this.shells.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

export const shellManager = new ShellManager();
