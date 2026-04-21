# AI_CLI

Un CLI interactif **à la Claude Code**, écrit en TypeScript. Squelette complet avec :

- 💬 **REPL conversationnel** avec boucle d'agent (tool_use → tool_result → réponse)
- 🔧 **Slash commands** builtin + custom (`.aicli/commands/*.md`)
- 🎯 **Skills** rechargeables (`.aicli/skills/*/SKILL.md`)
- 🤖 **Sub-agents** spécialisés avec contexte isolé (`.aicli/agents/*.md`)
- 🔌 **Client MCP** stdio (JSON-RPC 2.0) — branche des serveurs externes (`.aicli/mcp.json`)

> ⚠️ Ce CLI tourne en **mode démo** : le provider IA est un stub qui simule les réponses et les tool calls à partir de mots-clés. Parfait pour tester l'architecture sans clé API. Pour brancher le vrai SDK Anthropic, remplace `src/agent/demo-provider.ts`.

## Quickstart

```bash
npm install
npm run build
npm start          # ou: npm run dev  (via tsx)
```

Dans le REPL :

```
» /help
» /tools
» lis README.md          # le provider démo émet un tool_use Read
» exécute `ls -la`        # tool_use Bash
» skill hello            # charge le skill "hello"
» agent explorer .       # délègue à un sub-agent
» /review src/index.ts   # slash command custom
» /exit
```

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

## Brancher le vrai Claude

Remplace `DemoProvider` dans `src/agent/demo-provider.ts` par une implémentation qui appelle `@anthropic-ai/sdk` (en respectant `Provider` dans `src/agent/provider.ts`). Rien d'autre à changer.

## Licence

MIT
