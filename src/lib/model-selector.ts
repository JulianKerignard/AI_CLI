// Algo de sélection du meilleur modèle selon des critères user.
// Chaque modèle reçoit un score composite ; le picker retourne le top.

export interface ScorableModel {
  id: string;
  provider: string; // "mistral" | "nvidia" | "persona"
  category: string; // "chat" | "code" | "thinking" | "flagship" | "strong" | "small"
  weight: number; // Crédits par call
  description?: string; // Contient "rapide"/"moyen"/"lent" côté NVIDIA
}

export type SelectionMode = "balanced" | "fast" | "quality" | "code" | "cheap";

// Scores bruts (pour calcul composite interne).
const QUALITY_BY_CATEGORY: Record<string, number> = {
  flagship: 4,
  strong: 3,
  thinking: 3,
  code: 3,
  chat: 2,
  reasoning: 3,
  persona: 1,
  small: 1,
  nvidia: 2,
};

const SPEED_BY_TAG: Record<string, number> = {
  rapide: 3,
  moyen: 2,
  lent: 0,
};

function detectSpeed(description: string | undefined): number {
  if (!description) return 3; // Mistral sans tag : supposé rapide
  if (/\brapide\b/i.test(description)) return SPEED_BY_TAG.rapide;
  if (/\bmoyen\b/i.test(description)) return SPEED_BY_TAG.moyen;
  if (/\blent\b/i.test(description)) return SPEED_BY_TAG.lent;
  return 3;
}

// Note qualité /10 basée sur les benchmarks publics (LMArena, MMLU,
// HumanEval, SWE-bench, GPQA, LiveCodeBench) et le consensus de la
// communauté LLM à la sortie du modèle. Révisable quand de nouveaux
// benchmarks sortent.
//
// Grille indicative :
//   9.5-10 : frontier (top LMArena, égale ou dépasse GPT-4/Claude)
//   8.5-9  : très bon, compétitif sur la plupart des tâches
//   7.5-8  : solide généraliste ou excellent spé (code/reasoning)
//   6.5-7  : correct pour sa taille / usage ciblé
//   5-6    : modèles petits/anciens, dépannage
//   < 5    : legacy
const MODEL_QUALITY: Record<string, number> = {
  // ===== NVIDIA whitelist =====
  "meta/llama-3.3-70b-instruct": 8,
  "meta/llama-3.1-8b-instruct": 6,
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": 8.5,
  "nvidia/llama-3.3-nemotron-super-49b-v1.5": 7.5,
  "openai/gpt-oss-120b": 8,
  "google/gemma-3-27b-it": 7,
  "moonshotai/kimi-k2.5": 9,
  "moonshotai/kimi-k2-thinking": 9.5,
  "z-ai/glm4.7": 8,
  "minimaxai/minimax-m2.5": 7.5,
  "qwen/qwen3-coder-480b-a35b-instruct": 9, // top open code
  "qwen/qwen2.5-coder-32b-instruct": 8,
  "qwen/qwen3-next-80b-a3b-thinking": 8.5,
  "microsoft/phi-4-mini-instruct": 6,

  // ===== NVIDIA candidats =====
  "meta/llama-3.1-405b-instruct": 8,
  "deepseek-ai/deepseek-v3.2": 9.5, // frontier
  "deepseek-ai/deepseek-v3.1-terminus": 9,
  "mistralai/mistral-large-3-675b-instruct-2512": 9,
  "mistralai/mistral-medium-3-instruct": 7.5,
  "mistralai/mistral-nemotron": 7,
  "mistralai/devstral-2-123b-instruct-2512": 8.5,
  "z-ai/glm-5.1": 8,
  "z-ai/glm5": 8.5,
  "minimaxai/minimax-m2.7": 8,
  "meta/llama-4-maverick-17b-128e-instruct": 7.5,
  "google/gemma-3-12b-it": 6,
  "nvidia/llama-3.1-nemotron-70b-instruct": 7.5,
  "nvidia/nemotron-nano-3-30b-a3b": 6.5,
  "nvidia/nemotron-3-nano-30b-a3b": 6.5,
  "nvidia/nvidia-nemotron-nano-9b-v2": 5.5,

  // ===== Mistral directs (via MISTRAL_API_KEY) =====
  "mistral-large-latest": 8,
  "mistral-medium-latest": 7,
  "mistral-small-latest": 5.5,
  "magistral-medium-latest": 8, // reasoning
  "magistral-small-latest": 6.5,
  "codestral-latest": 7.5,
  "devstral-latest": 8,
};

// Préfixe NVIDIA_PROVIDER_PREFIX = "nvidia/" : côté /api/v1/models les ids
// sont préfixés. On strippe avant lookup.
function normalizeModelId(id: string): string {
  if (id.startsWith("nvidia/")) return id.slice("nvidia/".length);
  return id;
}

// Display-only : strip le préfixe "nvidia/" pour l'affichage UI. L'ID complet
// reste utilisé pour les requêtes API, credentials, sessions.
export function displayModelId(id: string): string {
  return normalizeModelId(id);
}

// Fallback par catégorie pour les modèles inconnus (pas dans MODEL_QUALITY).
function qualityFallback(category: string): number {
  const cat = (category || "").toLowerCase();
  if (cat === "flagship") return 9;
  if (cat === "strong") return 7.5;
  if (cat === "code" || cat === "thinking" || cat === "reasoning") return 7.5;
  if (cat === "chat") return 6;
  if (cat === "small" || cat === "persona") return 4;
  return 6;
}

// Indices /10 pour affichage UI (status bar, /best). Priorité : lookup
// benchmark map → fallback par catégorie.
export function qualityOutOf10(category: string, id?: string): number {
  if (id) {
    const key = normalizeModelId(id);
    const score = MODEL_QUALITY[key];
    if (typeof score === "number") return score;
  }
  return qualityFallback(category);
}

// Vitesse : rapide=10, moyen=6, lent=2, inconnu=8 (Mistral sans tag).
export function speedOutOf10(description: string | undefined): number {
  if (!description) return 8;
  if (/\brapide\b/i.test(description)) return 10;
  if (/\bmoyen\b/i.test(description)) return 6;
  if (/\blent\b/i.test(description)) return 2;
  return 8;
}

interface Weights {
  quality: number;
  speed: number;
  cost: number;
  categoryBonus: (cat: string) => number;
}

function weightsFor(mode: SelectionMode): Weights {
  switch (mode) {
    case "fast":
      return {
        quality: 1,
        speed: 4,
        cost: 1,
        categoryBonus: () => 0,
      };
    case "quality":
      return {
        quality: 4,
        speed: 1,
        cost: 0,
        categoryBonus: (c) => (c === "flagship" ? 2 : 0),
      };
    case "code":
      return {
        quality: 2,
        speed: 2,
        cost: 1,
        categoryBonus: (c) => (c === "code" ? 5 : 0),
      };
    case "cheap":
      return {
        quality: 1,
        speed: 1,
        cost: 4,
        categoryBonus: () => 0,
      };
    case "balanced":
    default:
      return {
        quality: 2,
        speed: 2,
        cost: 1,
        categoryBonus: () => 0,
      };
  }
}

export interface ScoredModel {
  model: ScorableModel;
  score: number; // Score composite (ranking interne)
  qualityOutOf10: number;
  speedOutOf10: number;
  breakdown: {
    quality: number;
    speed: number;
    cost: number;
    bonus: number;
  };
}

export function scoreModel(
  m: ScorableModel,
  mode: SelectionMode,
): ScoredModel {
  const w = weightsFor(mode);
  // Score qualité interne 1-4 dérivé de la note /10 (benchmarks).
  // Ranking cohérent avec ce qu'on affiche à l'user.
  const qRaw = qualityOutOf10(m.category, m.id);
  const quality = Math.max(1, Math.min(4, qRaw / 2.5));
  const speed = detectSpeed(m.description);
  const cost = Math.max(0, 5 - m.weight);
  const bonus = w.categoryBonus(m.category);

  const score =
    w.quality * quality + w.speed * speed + w.cost * cost + bonus;

  return {
    model: m,
    score,
    qualityOutOf10: qualityOutOf10(m.category, m.id),
    speedOutOf10: speedOutOf10(m.description),
    breakdown: { quality, speed, cost, bonus },
  };
}

export function pickBest(
  models: ScorableModel[],
  mode: SelectionMode,
): ScoredModel[] {
  return models
    .map((m) => scoreModel(m, mode))
    .sort((a, b) => b.score - a.score);
}
