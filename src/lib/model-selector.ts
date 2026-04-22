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

const QUALITY_BY_CATEGORY: Record<string, number> = {
  flagship: 4,
  strong: 3,
  thinking: 3,
  code: 3,
  chat: 2,
  reasoning: 3,
  persona: 1,
  small: 1,
  nvidia: 2, // catégorie générique
};

const SPEED_BY_TAG: Record<string, number> = {
  rapide: 3,
  moyen: 2,
  lent: 0,
};

function detectSpeed(description: string | undefined): number {
  if (!description) return 2; // inconnu → moyen par défaut
  if (/\brapide\b/i.test(description)) return SPEED_BY_TAG.rapide;
  if (/\bmoyen\b/i.test(description)) return SPEED_BY_TAG.moyen;
  if (/\blent\b/i.test(description)) return SPEED_BY_TAG.lent;
  // Mistral n'a pas de tag — on suppose rapide (ils le sont en pratique).
  return 3;
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
  score: number;
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
  const cost = Math.max(0, 5 - m.weight); // weight 1 → 4, weight 4 → 1
  const bonus = w.categoryBonus(m.category);

  const score =
    w.quality * quality + w.speed * speed + w.cost * cost + bonus;

  return {
    model: m,
    score,
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
