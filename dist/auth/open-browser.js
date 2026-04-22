import { exec } from "node:child_process";
// Ouvre une URL dans le navigateur par défaut de l'OS. Non-bloquant
// (détaché du process CLI via unref). Les erreurs sont avalées car on
// affiche l'URL en texte dans tous les cas — l'user peut toujours
// copier-coller manuellement si le navigateur ne s'ouvre pas.
export function openBrowser(url) {
    // Sur Windows, `start` est un builtin cmd + son 1er arg quoté est le TITRE
    // de la fenêtre (pas l'URL), donc on passe "" comme titre avant l'URL.
    // Sans ce fix, les URLs avec `&` (query params) sont interprétées comme
    // des commandes chainées et le navigateur ne s'ouvre pas.
    const quoted = JSON.stringify(url);
    const cmd = process.platform === "darwin"
        ? `open ${quoted}`
        : process.platform === "win32"
            ? `cmd /c start "" ${quoted}`
            : `xdg-open ${quoted}`;
    const child = exec(cmd, (err) => {
        if (err) {
            // noop — URL affichée en texte par l'appelant
        }
    });
    child.unref();
}
