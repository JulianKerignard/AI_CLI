# CLAUDE.md

Guide d'orientation pour Claude Code (et autres agents IA) bossant sur ce repo.

## Vue d'ensemble

`@juliank./aicli` — CLI interactif TypeScript inspiré de Claude Code. REPL agent
avec tools, skills, sub-agents, MCP, permissions, rate limiting. Provider HTTP
qui parle l'API Anthropic Messages, branché par défaut sur `chat.juliankerignard.fr`.

- **Runtime** : Node 18+ ESM, single-file bundle esbuild
- **UI** : Ink 7 + React 19 (composants ANSI)
- **Branche dev** : `develop` (auto-publish `@dev`)
- **Branche stable** : `main` (publish manuel `@latest`)

## Commandes

```bash
npm install        # 1ère fois
npm run dev        # tsx src/index.ts (boucle hot-reload manuelle)
npm run typecheck  # tsc --noEmit (DOIT passer avant commit)
npm run build      # esbuild → dist/index.js
npm start          # node dist/index.js (après build)
npm pack --dry-run # vérifier le contenu du tarball npm
```

Pas de tests pour l'instant (cf. roadmap v0.4.0).

## Architecture

```
src/
├── index.ts              CLI entry point
├── repl.ts               Boucle REPL + App React Ink
├── agent/
│   ├── provider.ts       Types Message/ContentBlock (Anthropic-compatible)
│   ├── http-provider.ts  Client HTTP streaming SSE + rate limit + retry 429
│   ├── loop.ts           Boucle agent : tool_use → execute → tool_result
│   └── compactor.ts      Résumé auto historique (>30 msgs ou >60K tokens)
├── tools/                Read, Write, Edit, Bash, Glob, Grep, Ls, AskUser
├── commands/             Slash commands (/help, /login, /model, /best...)
├── skills/               Skills rechargeables depuis .aicli/skills/*/SKILL.md
├── agents/               Sub-agents depuis .aicli/agents/*.md
├── mcp/                  Client stdio JSON-RPC 2.0
├── permissions/          4 modes : default / accept-edits / bypass / plan
├── auth/                 OAuth loopback + fallback manuel
├── lib/                  rate-limiter, model-catalog, model-selector, favorites
├── ui/                   Composants Ink + controllers (input, picker, status)
└── utils/                logger, paths, frontmatter, status-bar, path-guard
```

## Conventions

### Code

- **Strict TS** activé. **Aucun `any`** dans `src/`. Tout doit être typé.
- **Pas de tests** pour l'instant — viser quand même du code testable (fonctions
  pures dans `lib/`, `permissions/policy.ts`, `agent/compactor.ts`...).
- **Commentaires** : expliquer le **WHY**, pas le WHAT. Si le code est clair,
  pas besoin de doc. Voir `src/lib/rate-limiter.ts` ou `src/agent/http-provider.ts`
  pour le style attendu.
- **Imports dynamiques** (`await import("...")`) utilisés dans les commandes
  pour code-splitting. Garder le pattern.
- **Erreurs user-facing en français** (`http-provider.ts:88-113`). Action-oriented
  ("Tape /login pour te reconnecter").

### Git

- Branche dev : `develop`. Branche stable : `main`.
- Commits conventionnels : `feat(scope):`, `fix(scope):`, `chore:`, `refactor:`.
  Bump auto : `feat:` → minor, `fix:` → patch, `breaking:` → major.
- `[skip ci]` dans les commits auto-générés (release bumps) pour éviter les boucles.
- **Toujours créer un nouveau commit** après une PR review, jamais `--amend` sur
  un commit déjà poussé.

### Build & dist

- `dist/` est **commité volontairement** (cf. `.gitignore`) pour permettre
  `npm i -g github:JulianKerignard/AI_CLI`.
- Toujours `npm run build` avant de commiter si `src/` change (le dist/index.js
  doit refléter la source).
- `npm run typecheck` doit passer avant tout push.

### Versioning

Voir `VERSIONING.md`. Résumé :

- **`develop` → `@dev`** : auto-publish prerelease à chaque push (workflow
  `publish-dev.yml`). Bump `0.X.Y-dev.N`.
- **`main` → `@latest`** : publish manuel via `gh workflow run publish-stable.yml
  -f bump=minor` (ou `patch`/`major`). Crée tag `vX.Y.Z`.

## Configuration utilisateur

`.aicli/` (à la racine projet ou `~/.aicli`) :

```
.aicli/
├── credentials.json    Token API (chmod 0600), généré par /login
├── store.json          Allowlist permissions persistante
├── history.json        Readline history
├── commands/*.md       Custom slash commands
├── skills/*/SKILL.md   Skills rechargeables
├── agents/*.md         Sub-agents
└── mcp.json            Servers MCP stdio
```

### Variables d'environnement utiles

| Var | Rôle |
|---|---|
| `AICLI_AUTH_TOKEN` | Override credentials.json |
| `AICLI_BASE_URL` | Endpoint API (défaut : `https://chat.juliankerignard.fr/api`) |
| `AICLI_MODEL` | Modèle par défaut |
| `AICLI_MODE` | `default` / `accept-edits` / `bypass` / `plan` |
| `AICLI_DEBUG` | Stack traces détaillées |
| `AICLI_DEBUG_MCP` | Debug MCP client |
| `AICLI_COMPACT_THRESHOLD` | `0` désactive la compaction auto |
| `AICLI_MAX_ITERATIONS` | Max turns agent (défaut 25) |

## Principes design

- **Provider abstrait** : aucune logique Anthropic-specific dans le REPL. Tout
  passe par l'interface `Provider` (`src/agent/provider.ts`).
- **Permissions = policy pure** : `src/permissions/policy.ts` ne fait pas d'I/O.
  Toutes les décisions sont déterministes, testables.
- **Rate limit en 3 couches** : token bucket préventif → retry 429 + Retry-After
  → markCold sur stream-cut. Voir `src/agent/http-provider.ts`.
- **Tool registry unifié** : builtin + skills + sub-agents + MCP exposés au LLM
  comme un seul espace de noms. MCP préfixé `mcp__<server>__<tool>`.
- **Catalog-driven** : depuis PR #4, la shortlist favoris `/model` est dérivée
  de `/api/v1/models` (champs `favorite`, `aliases`). Fallback hardcodé si le
  bridge n'expose pas encore les flags.

## Pièges connus

- **chalk@5 sur Windows** : raison du bundling esbuild. Ne pas dépendre de
  chalk@5 directement (override @4 dans package.json).
- **react-devtools-core** : peer dep optionnelle d'ink, stubbée à la build
  (`scripts/stub-react-devtools.mjs`). Ne pas l'utiliser.
- **Sourcemap dans dist/** : commit OK (debug en clone), mais **exclu du tarball
  npm** via `package.json#files`. Si tu rajoutes un fichier dans `dist/`, pense
  à updater `files`.
- **`.aicli/commands/*.md`** : quand tu testes un custom command localement,
  ne le commite pas dans le repo principal (c'est user config).

## Roadmap

Voir audit & plan dans la PR #4 et issues GitHub. Priorités :

1. **v0.3.1** (patch) : sprint 1 quick wins — UA dynamique, CLAUDE.md,
   pr.yml, npm cache, MCP timeout, `.npmignore` sourcemap.
2. **v0.4.0** (minor) : Vitest + tests sur `permissions/policy`,
   `agent/compactor`, `lib/rate-limiter`, `tools/path-guard`, `lib/favorites`.
   Split `commands/builtin.ts`. CHANGELOG auto.
3. **v0.5.0** (minor) : MCP reconnexion, vision pipeline, `/resume`, telemetry
   opt-in.
4. **v1.0.0** (major) : sandbox Bash, frontmatter schema versionning, provider
   plugin system, site doc.
