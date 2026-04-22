import { exec } from "node:child_process";

// Ouvre une URL dans le navigateur par défaut de l'OS. Non-bloquant
// (détaché du process CLI via unref). Les erreurs sont avalées car on
// affiche l'URL en texte dans tous les cas — l'user peut toujours
// copier-coller manuellement si le navigateur ne s'ouvre pas.
export function openBrowser(url: string): void {
  // Sur Windows, `start` est un builtin cmd qui prend le 1er arg comme
  // titre de fenêtre. Sans "" initial, l'URL devient le titre et on ouvre
  // un cmd vide au lieu du navigateur.
  const full =
    process.platform === "darwin"
      ? `open ${JSON.stringify(url)}`
      : process.platform === "win32"
        ? `cmd /c start "" ${JSON.stringify(url)}`
        : `xdg-open ${JSON.stringify(url)}`;
  const child = exec(full, (err) => {
    if (err) {
      // noop — URL affichée en texte par l'appelant
    }
  });
  child.unref();
}
