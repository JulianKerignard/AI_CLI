import type {
  Message,
  ContentBlock,
  Provider,
} from "./provider.js";
import { log } from "../utils/logger.js";

// Compaction automatique de l'historique agent, inspirée de Claude Code.
// Remplace les N premiers tours par un résumé texte, préservant uniquement
// les messages "vivants" (le dernier assistant avec tool_use non résolus +
// les tool_result correspondants + la dernière question user).
//
// Déclenchée avant chaque provider.chat() dans loop.ts si :
// - messages.length > MAX_MESSAGES OU
// - approxTokens(messages) > MAX_TOKENS_ESTIMATE

const MAX_MESSAGES = 30; // ~15 turns user+assistant
const MAX_TOKENS_ESTIMATE = 60_000; // char/4 approx — fallback absolu
const KEEP_TAIL_MESSAGES = 10; // garde les N derniers messages intacts
const ABSOLUTE_MIN_HEAD = 4; // ne compact pas si moins de 4 messages à résumer

// Seuil relatif au context window du modèle courant.
// - <64k ctx : 60% (petits modèles, marge pour un Bash/Read volumineux)
// - >=64k ctx : 70% (gros modèles, plus permissif)
// Avec facteur de sécurité 1.2 sur l'estimation tokens (char/4 sous-
// estime de ~15-20% sur JSON/code).
const RELATIVE_THRESHOLD_SMALL = 0.60;
const RELATIVE_THRESHOLD_LARGE = 0.70;
const SMALL_CTX_BOUNDARY = 64_000;
const TOKEN_ESTIMATE_SAFETY = 1.2;

// Flag opt-out via env AICLI_COMPACT_THRESHOLD=0.
const DISABLED = process.env.AICLI_COMPACT_THRESHOLD === "0";

export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text") chars += b.text.length;
      else if (b.type === "tool_use") chars += JSON.stringify(b.input).length;
      else if (b.type === "tool_result") chars += b.content.length;
    }
  }
  return Math.ceil(chars / 4);
}

export function shouldCompact(
  messages: Message[],
  contextWindow?: number,
): boolean {
  if (DISABLED) return false;
  const tokens = estimateTokens(messages);
  // Critère relatif adaptatif : 60% sur les petits ctx (<64K), 70% sur
  // les gros. Avec facteur de sécurité 1.2. Laisse plus de marge aux
  // modèles 32K contre un gros Bash/Read qui explose d'un coup.
  if (contextWindow && contextWindow > 0) {
    const threshold =
      contextWindow < SMALL_CTX_BOUNDARY
        ? RELATIVE_THRESHOLD_SMALL
        : RELATIVE_THRESHOLD_LARGE;
    const relativeLimit = contextWindow * threshold;
    if (tokens * TOKEN_ESTIMATE_SAFETY > relativeLimit) return true;
  }
  // Critère absolu (fallback si contextWindow inconnu).
  if (messages.length <= MAX_MESSAGES) {
    return tokens > MAX_TOKENS_ESTIMATE;
  }
  return true;
}

// Identifie les tool_use_id utilisés dans la queue (tail à garder).
// Leurs tool_result correspondants DOIVENT rester intacts dans l'historique
// pour que Mistral ne se plaigne pas de "tool_result without preceding tool_use".
function extractOpenToolUseIds(tailMessages: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const m of tailMessages) {
    for (const b of m.content) {
      if (b.type === "tool_use") ids.add(b.id);
      if (b.type === "tool_result") ids.add(b.tool_use_id);
    }
  }
  return ids;
}

// Compacte messages[] en place via 1 appel LLM (le provider courant).
// Retourne true si une compaction a eu lieu, false sinon.
//
// INVARIANT : appel synchrone avant provider.chat() dans la boucle.
// N'introduire JAMAIS un watcher async qui pourrait muter messages[]
// pendant un streaming en cours → race condition.
export async function compactMessages(
  messages: Message[],
  provider: Provider,
  systemPrompt: string,
  contextWindow?: number,
): Promise<boolean> {
  if (!shouldCompact(messages, contextWindow)) return false;
  if (messages.length <= ABSOLUTE_MIN_HEAD + KEEP_TAIL_MESSAGES) return false;

  const headCount = messages.length - KEEP_TAIL_MESSAGES;
  const head = messages.slice(0, headCount);
  const tail = messages.slice(headCount);
  // Vérifie qu'aucun tool_result du tail ne pointe vers un tool_use du head :
  // si oui, on inclut ce tour dans le tail pour préserver la continuité.
  // (Cas rare mais casserait Mistral avec "orphan tool_result".)
  const tailOpenIds = extractOpenToolUseIds(tail);
  let splitAt = headCount;
  while (splitAt > ABSOLUTE_MIN_HEAD) {
    const lastHeadMsg = messages[splitAt - 1];
    const lastHeadToolUseIds = new Set<string>();
    for (const b of lastHeadMsg.content) {
      if (b.type === "tool_use") lastHeadToolUseIds.add(b.id);
    }
    const leaksToTail = [...lastHeadToolUseIds].some((id) => tailOpenIds.has(id));
    if (!leaksToTail) break;
    splitAt -= 1;
  }
  if (splitAt <= ABSOLUTE_MIN_HEAD) return false;
  const finalHead = messages.slice(0, splitAt);
  const finalTail = messages.slice(splitAt);

  // Construit le prompt de compaction. On demande un résumé factuel,
  // priorité aux décisions, fichiers touchés, tools majeurs.
  const compactPrompt: Message[] = [
    ...finalHead,
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `[META] Résume de façon factuelle tout ce qui précède en gardant :
1. La requête initiale de l'utilisateur
2. Les décisions prises et les choix techniques
3. Les fichiers examinés/modifiés (chemins)
4. Les résultats clés des tools (pas les détails verbeux)
5. L'état actuel du travail en cours

Format : un seul paragraphe dense, sans bullet points. Max 400 mots. Ne réponds PAS au format markdown artifact, pas de titres. Commence directement par le résumé factuel.`,
        },
      ],
    },
  ];

  log.faint(
    `[compact] résumé des ${splitAt} premiers messages (${estimateTokens(finalHead)} tokens)…`,
  );

  const response = await provider.chat({
    system: systemPrompt,
    messages: compactPrompt,
    tools: [], // Pas de tools pendant la compaction — juste du texte.
  });

  const summaryText = response.content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!summaryText) {
    log.warn("[compact] résumé vide, skip compaction.");
    return false;
  }

  // Remplace messages[] en place : [summary_user_message, ...tail]
  const summaryMessage: Message = {
    role: "user",
    content: [
      {
        type: "text",
        text: `[résumé auto des ${splitAt} messages précédents]\n\n${summaryText}`,
      },
    ],
  };

  messages.length = 0;
  messages.push(summaryMessage);
  messages.push(...finalTail);

  log.faint(
    `[compact] ${splitAt} → 1 messages, ${estimateTokens(finalHead)} → ${estimateTokens([summaryMessage])} tokens.`,
  );

  return true;
}
