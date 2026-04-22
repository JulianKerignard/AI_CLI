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

// Indices /10 pour affichage UI (status bar, /best).
// Qualité : flagship=10, strong/code/thinking=7, chat=5, small/persona=3.
export function qualityOutOf10(category: string): number {
  const cat = (category || "").toLowerCase();
  if (cat === "flagship") return 10;
  if (cat === "strong" || cat === "code" || cat === "thinking" || cat === "reasoning")
    return 7;
  if (cat === "chat") return 5;
  if (cat === "small" || cat === "persona") return 3;
  return 5;
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
  const quality = QUALITY_BY_CATEGORY[m.category] ?? 2;
  const speed = detectSpeed(m.description);
  const cost = Math.max(0, 5 - m.weight);
  const bonus = w.categoryBonus(m.category);

  const score =
    w.quality * quality + w.speed * speed + w.cost * cost + bonus;

  return {
    model: m,
    score,
    qualityOutOf10: qualityOutOf10(m.category),
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
