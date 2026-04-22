# AI_CLI

Un CLI interactif **à la Claude Code**, écrit en TypeScript. Squelette complet avec :

- 💬 **REPL conversationnel** avec boucle d'agent (tool_use → tool_result → réponse)
- 🔧 **Slash commands** builtin + custom (`.aicli/commands/*.md`)
- 🎯 **Skills** rechargeables (`.aicli/skills/*/SKILL.md`)
- 🤖 **Sub-agents** spécialisés avec contexte isolé (`.aicli/agents/*.md`)
- 🔌 **Client MCP** stdio (JSON-RPC 2.0) — branche des serveurs externes (`.aicli/mcp.json`)

> Par défaut, AI_CLI tourne en **mode démo** (stub sans IA). Lance `/login` dans le REPL pour te brancher sur [chat.juliankerignard.fr](https://chat.juliankerignard.fr) et parler à Mistral via l'endpoint Anthropic-compatible.

## Quickstart

```bash
npm install
npm run build
npm start          # ou: npm run dev  (via tsx)
```

Dans le REPL :

```
» /login                 # ouvre le navigateur → autorise → token sauvegardé
» /status                # affiche l'état d'auth
» hello                  # parle à Mistral (si loggé) ou au stub
» /tools
» lis README.md          # tool_use Read
» exécute `ls -la`        # tool_use Bash
» /logout                # supprime le token local
» /exit
```

## Login avec chat.juliankerignard.fr

Le flow `/login` fonctionne comme `gh auth login` :

1. Le CLI ouvre ton navigateur sur `https://chat.juliankerignard.fr/cli/auth?…`
2. Si tu es déjà loggé, tu cliques **Autoriser** → le token est renvoyé automatiquement via un callback loopback (`http://127.0.0.1:PORT/callback`)
3. Sinon tu te connectes d'abord, puis tu es redirigé sur la page d'approbation
4. Le token est stocké dans `~/.aicli/credentials.json` (chmod 0600)

### Fallback manuel

Si le navigateur ne s'ouvre pas ou si le loopback est bloqué (firewall, Docker, SSH), l'URL s'affiche en clair dans le terminal et tu peux coller le token directement au prompt. La page web affiche aussi le token avec un bouton copier.

### Variables d'environnement

Priorité absolue sur le fichier de credentials — idéal en CI/Docker :

| Variable | Rôle |
|---|---|
| `AICLI_AUTH_TOKEN` | Token `csm_…` (aussi : `ANTHROPIC_AUTH_TOKEN`) |
| `AICLI_BASE_URL` | `https://chat.juliankerignard.fr/api` par défaut |
| `AICLI_MODEL` | `mistral-large-latest` par défaut |

### Révocation

`/logout` supprime le fichier local mais **ne révoque pas la clé côté serveur**. Pour la révoquer, va sur [chat.juliankerignard.fr/profile](https://chat.juliankerignard.fr/profile) et supprime la clé `AI_CLI <date>`.

## Structure

```
src/
├── index.ts           entry point (bin "aicli")
├── repl.ts            boucle readline + dispatch
├── agent/
│   ├── provider.ts    interface Provider + types messages
│   ├── demo-provider.ts   stub sans IA
│   └── loop.ts        boucle tool_use / tool_result
├── tools/             Read, Write, Bash + registry
├── commands/          slash commands (builtin + custom .md)
├── skills/            loader + Skill tool
├── agents/            loader + runner + Agent tool
├── mcp/               client stdio JSON-RPC + config
└── utils/             logger, paths, frontmatter
```

## Ajouter une slash command

Crée `.aicli/commands/<nom>.md` :

```markdown
---
description: Ma commande qui fait X
---
Fais X avec l'argument `$ARGUMENTS`.
```

Elle devient `/<nom>` automatiquement.

## Ajouter un skill

Crée `.aicli/skills/<nom>/SKILL.md` :

```markdown
---
name: monskill
description: Ce que fait ce skill
---
Instructions système injectées quand le skill est activé via le tool Skill.
```

## Ajouter un sub-agent

Crée `.aicli/agents/<nom>.md` :

```markdown
---
name: monagent
description: Agent spécialisé pour X
tools:
  - Read
  - Bash
---
Système prompt décrivant la mission du sub-agent.
```

## Brancher un serveur MCP

Copie `.aicli/mcp.json.example` → `.aicli/mcp.json` et adapte. Les outils seront préfixés `mcp__<server>__<tool>` et exposés à l'agent.

## Brancher un autre backend Anthropic-compatible

Le `HttpProvider` (`src/agent/http-provider.ts`) parle le format Anthropic Messages API (`POST /v1/messages`). Pour cibler un autre endpoint (Claude officiel, proxy maison, etc.), set `AICLI_BASE_URL` et `AICLI_AUTH_TOKEN` — le CLI s'en sert directement sans repasser par le flow `/login`.

## Rate limit Mistral et optimisations

Le plan gratuit Mistral = **4 requêtes/minute**. Un agent qui enchaîne plusieurs tool_use sature vite. AI_CLI inclut plusieurs protections :

| Mécanisme | Effet |
|---|---|
| **Rate limiter client** | Token bucket sliding 60s, cap 3 req/min (marge 25%). Affiche `⏳ waiting Xs` au lieu de 429. |
| **Compaction auto** | À >30 messages ou >60k tokens estimés, résumé les plus anciens via 1 appel LLM. `/compact` force manuellement. |
| **Honor Retry-After** | Sur 429, backoff basé sur le header serveur et bucket en mode "cold" 5 min. |
| **Cache serveur** | Réponses identiques (même system+messages+tools) mises en cache 5 min côté `/api/v1/messages`. |
| **parallel_tool_calls** | Mistral émet plusieurs tool_use dans une seule réponse quand possible. |
| **Caps outputs tools** | Bash stdout/stderr capés à 32k chars (tail), Grep à 25k bytes — évite de gonfler l'historique. |

Si le rate limit reste bloquant même avec tout ça : **upgrade Mistral vers un plan payant** (~$25/mois passe à ~60 RPM). Voir https://mistral.ai/pricing.

### Commandes utiles

```
/usage           tokens + quota session
/usage detail    20 derniers appels API (historique serveur)
/compact         force un résumé de l'historique
```

### Variables d'environnement (extra)

| Variable | Rôle |
|---|---|
| `AICLI_COMPACT_THRESHOLD` | Mettre à `0` pour désactiver la compaction auto |
| `AICLI_DEBUG` | `1` → affiche les stacks sur erreurs non-fatales |

## Licence

MIT
