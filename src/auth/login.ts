import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { openBrowser } from "./open-browser.js";
import {
  saveCredentials,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  type Credentials,
} from "./store.js";
import { log, chalk } from "../utils/logger.js";

// Le baseUrl du site web (sans /api). Utilisé pour construire l'URL
// d'approbation https://chat.juliankerignard.fr/cli/auth?redirect=...
const DEFAULT_WEB_URL = "https://chat.juliankerignard.fr";
const TIMEOUT_MS = 180_000; // 3 minutes

interface LoginOptions {
  webUrl?: string; // ex: https://chat.juliankerignard.fr
  apiUrl?: string; // ex: https://chat.juliankerignard.fr/api
  model?: string;
}

// Flow /login loopback (style gh auth login) :
// 1. Génère un state aléatoire
// 2. Bind HTTP sur 127.0.0.1:0 (port random OS-assigned)
// 3. Ouvre le navigateur sur https://<host>/cli/auth?redirect=http://127.0.0.1:PORT/callback&state=STATE
// 4. Attend que le user clique "Autoriser" sur le site → redirect vers /callback?token=&state=
// 5. Vérifie le state, extrait le token, save dans ~/.aicli/credentials.json
// 6. Fallback manuel : prompt readline acceptant un paste du token (si le navigateur
//    ne s'ouvre pas ou si le loopback est bloqué par un firewall)
export async function runLoginFlow(opts: LoginOptions = {}): Promise<Credentials> {
  const webUrl = opts.webUrl ?? DEFAULT_WEB_URL;
  const apiUrl = opts.apiUrl ?? DEFAULT_BASE_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  const state = randomBytes(16).toString("hex");

  return new Promise<Credentials>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404).end();
        return;
      }
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const token = url.searchParams.get("token");
      const receivedState = url.searchParams.get("state");
      if (!token || receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(
          "<h1>État invalide</h1><p>Connexion refusée par sécurité. Relance /login.</p>",
        );
        settle(() => {
          server.close();
          reject(new Error("state mismatch ou token absent"));
        });
        return;
      }
      if (!token.startsWith("csm_")) {
        res.writeHead(400).end("<h1>Token invalide</h1>");
        settle(() => {
          server.close();
          reject(new Error("token ne commence pas par csm_"));
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`
<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>AI_CLI autorisé</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#2b2621;color:#f6f1e8;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}.c{text-align:center;padding:40px;max-width:420px}.t{color:#e27649;font-size:18px;margin-bottom:10px}.d{color:#bdb3a1;font-size:14px;line-height:1.5}</style>
</head><body><div class="c"><div class="t">✓ AI_CLI autorisé</div><div class="d">Tu peux fermer cet onglet et revenir au terminal.</div></div></body></html>
      `);
      const creds: Credentials = { token, baseUrl: apiUrl, model };
      saveCredentials(creds);
      settle(() => {
        server.close();
        resolve(creds);
      });
    });

    server.on("error", (err) => {
      settle(() => reject(err));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const authUrl = `${webUrl}/cli/auth?redirect=${encodeURIComponent(redirect)}&state=${state}`;

      console.log();
      log.info("Ouvre ce lien pour autoriser AI_CLI :");
      console.log("  " + chalk.hex("#e27649").underline(authUrl));
      console.log();
      log.faint(
        "  (écoute sur 127.0.0.1:" + port + ", timeout 3 min)",
      );
      log.faint(
        "  Si le navigateur ne s'ouvre pas, copie-colle l'URL ci-dessus",
      );
      log.faint("  ou paste ton token directement ici (commence par csm_).");
      console.log();

      openBrowser(authUrl);

      const timer = setTimeout(() => {
        settle(() => {
          server.close();
          reject(new Error("timeout — aucune autorisation reçue après 3 min"));
        });
      }, TIMEOUT_MS);
      server.on("close", () => clearTimeout(timer));
    });

    // Fallback manuel — prompt en parallèle. Si l'user colle un token avant
    // le callback HTTP, on l'accepte aussi. Les deux voies race ; settle()
    // garantit qu'une seule résolution a lieu.
    const rl = createInterface({ input: stdin, output: stdout });
    void (async () => {
      try {
        const pasted = (await rl.question(chalk.hex("#8a8270")("paste token ou Entrée pour attendre le browser › "))).trim();
        rl.close();
        if (!pasted) return; // attendre le callback
        if (!pasted.startsWith("csm_") || pasted.length < 20) {
          log.warn("Token invalide (doit commencer par csm_). J'attends toujours le navigateur.");
          return;
        }
        const creds: Credentials = {
          token: pasted,
          baseUrl: apiUrl,
          model,
        };
        saveCredentials(creds);
        settle(() => {
          server.close();
          resolve(creds);
        });
      } catch {
        // stdin fermé — on laisse le flow browser continuer
      }
    })();
  });
}
