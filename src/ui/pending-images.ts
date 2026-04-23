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
