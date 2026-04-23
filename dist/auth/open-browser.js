import { spawn } from "node:child_process";
// Ouvre une URL dans le navigateur par défaut. Utilise spawn() avec args
// array (PAS exec + template string) pour éviter toute injection shell si
// un attaquant contrôle webUrl dans le futur.
export function openBrowser(url) {
    let cmd;
    let args;
    if (process.platform === "darwin") {
        cmd = "open";
        args = [url];
    }
    else if (process.platform === "win32") {
        // Windows `start` via cmd : 1er argument vide = titre de fenêtre.
        cmd = "cmd";
        args = ["/c", "start", "", url];
    }
    else {
        cmd = "xdg-open";
        args = [url];
    }
    try {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.unref();
        child.on("error", () => {
            // noop — l'URL est affichée en texte par l'appelant de toute façon
        });
    }
    catch {
        // noop
    }
}
