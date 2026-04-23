import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type { ImageBlock } from "../agent/provider.js";

// Store module-level des images attachées en attente. Reset après chaque
// submit. Max 4 images par message (limite bridge /api/v1/messages).
//
// Usage :
//   /image ./screenshot.png  → addImage(...)
//   submit                   → getAndClear() puis injecté en content_block
//                              dans le prochain Message user.

const MIME_BY_EXT: Record<string, ImageBlock["source"]["media_type"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Cap ~6MB base64 = ~4.5MB raw. Évite de faire exploser le bridge + tokens.
const MAX_IMAGE_BYTES = 4_500_000;
const MAX_IMAGES = 4;

export interface PendingImage {
  path: string;
  displayName: string;
  block: ImageBlock;
  sizeBytes: number;
}

const pending: PendingImage[] = [];

export async function addImage(rawPath: string, cwd: string): Promise<PendingImage> {
  if (pending.length >= MAX_IMAGES) {
    throw new Error(`Max ${MAX_IMAGES} images par message (déjà atteint).`);
  }
  const abs = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    throw new Error(`Fichier introuvable : ${rawPath}`);
  }
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image trop grosse (${Math.round(info.size / 1024)}k, max 4.5M). Resize ou compress.`,
    );
  }
  const ext = extname(abs).toLowerCase();
  const mediaType = MIME_BY_EXT[ext];
  if (!mediaType) {
    throw new Error(
      `Extension non supportée : ${ext}. Formats : png, jpg, webp, gif.`,
    );
  }
  const buf = await readFile(abs);
  const b64 = buf.toString("base64");
  const item: PendingImage = {
    path: abs,
    displayName: basename(abs),
    sizeBytes: info.size,
    block: {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: b64 },
    },
  };
  pending.push(item);
  return item;
}

export function listPending(): ReadonlyArray<PendingImage> {
  return pending;
}

export function clearPending(): void {
  pending.length = 0;
}

export function takeAllAndClear(): PendingImage[] {
  const out = [...pending];
  pending.length = 0;
  return out;
}

// Récupère l'image PNG du clipboard OS et l'attache. Supporte macOS
// (osascript builtin, pas de dep), Linux (xclip/wl-paste), Windows (pwsh).
// Écrit un PNG temporaire dans /tmp (ou equivalent) puis addImage().
export async function pasteFromClipboard(cwd: string): Promise<PendingImage> {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const tmpPath = join(
    tmpdir(),
    `aicli-paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );

  if (process.platform === "darwin") {
    // AppleScript : copie le clipboard PNG en fichier. Retourne "ok" ou
    // "error: ..." dans stdout pour qu'on sache si ça a marché.
    const script = `
      try
        set png_data to the clipboard as «class PNGf»
        set f to open for access POSIX file "${tmpPath}" with write permission
        set eof f to 0
        write png_data to f
        close access f
        return "ok"
      on error err
        return "error: " & err
      end try
    `;
    const proc = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
    const out = (proc.stdout ?? "").trim();
    if (!out.startsWith("ok")) {
      throw new Error(
        out.startsWith("error:")
          ? `Clipboard sans image (${out.slice(7)}). Fais un screenshot (Cmd+Shift+4) ou copy une image d'abord.`
          : "Clipboard sans image. Fais un screenshot (Cmd+Shift+4) ou copy une image d'abord.",
      );
    }
  } else if (process.platform === "linux") {
    // Essaie wl-paste (Wayland) puis xclip (X11).
    let ok = false;
    const wl = spawnSync("bash", [
      "-c",
      `wl-paste --type image/png > "${tmpPath}" 2>/dev/null`,
    ]);
    if (wl.status === 0) ok = true;
    if (!ok) {
      const x = spawnSync("bash", [
        "-c",
        `xclip -selection clipboard -t image/png -o > "${tmpPath}" 2>/dev/null`,
      ]);
      if (x.status === 0) ok = true;
    }
    if (!ok) {
      throw new Error(
        "Clipboard sans image ou wl-paste/xclip manquant. Installe : apt install xclip (ou wl-clipboard sur Wayland).",
      );
    }
  } else if (process.platform === "win32") {
    // PowerShell : Get-Clipboard -Format Image + .Save(path).
    const pwshScript = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $img.Save('${tmpPath.replace(/\\/g, "\\\\")}'); Write-Host 'ok' } else { Write-Host 'error: no image in clipboard' }`;
    const proc = spawnSync("powershell", ["-NoProfile", "-Command", pwshScript], {
      encoding: "utf8",
    });
    const out = (proc.stdout ?? "").trim();
    if (!out.startsWith("ok")) {
      throw new Error(
        "Clipboard sans image. Fais Print Screen ou copy une image d'abord.",
      );
    }
  } else {
    throw new Error(`Plateforme ${process.platform} non supportée.`);
  }

  return await addImage(tmpPath, cwd);
}
