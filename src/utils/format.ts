// Helpers de formatage réutilisables. Extraits pour éviter la duplication
// (compact/truncate/formatBytes/splitLines existaient en 3-6 copies éparses).

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function truncate(s: string, max: number, ellipsis = "…"): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + ellipsis;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

// Split qui respecte CRLF Windows (important pour les sorties de commandes
// Windows, parser de fichiers Windows, etc.). Évite les `\r` résiduels.
export function splitLines(s: string): string[] {
  return s.split(/\r?\n/);
}
