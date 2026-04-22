import { exec } from "node:child_process";
// Ouvre une URL dans le navigateur par défaut de l'OS. Non-bloquant
// (détaché du process CLI via unref). Les erreurs sont avalées car on
// affiche l'URL en texte dans tous les cas — l'user peut toujours
// copier-coller manuellement si le navigateur ne s'ouvre pas.
export function openBrowser(url) {
    const cmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "start"
            : "xdg-open";
    const child = exec(`${cmd} ${JSON.stringify(url)}`, (err) => {
        if (err) {
            // noop — URL affichée en texte par l'appelant
        }
    });
    child.unref();
}
