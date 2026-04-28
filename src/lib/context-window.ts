// Taille du context window (en tokens) par famille de modèle.
// Isolé dans lib/ pour éviter un import circulaire UI↔agent (compactor
// a besoin de cette info pour décider si un auto-compact préventif est
// nécessaire).

// Strip total des préfixes provider et de leur owner pour l'affichage UI.
// Choix produit (cf. PR #21 site) : on ne montre AUCUN nom de provider à
// l'user. Le routing upstream continue d'utiliser l'ID complet via
// `this.opts.model`, pas via cette chaîne. Aligné avec lib/format.ts
// shortModelLabel côté site.
export function cleanProvider(name: string): string {
  const httpMatch = /^http\((.+)\)$/.exec(name);
  let s = httpMatch ? httpMatch[1] : name;
  // 1. Préfixe provider (le 1er segment).
  if (s.startsWith("nvidia/")) s = s.slice("nvidia/".length);
  else if (s.startsWith("openrouter/")) s = s.slice("openrouter/".length);
  else if (s.startsWith("google/")) s = s.slice("google/".length);
  // 2. Owner restant (ex: "openai/gpt-oss-120b" → "gpt-oss-120b").
  const slashIdx = s.indexOf("/");
  if (slashIdx !== -1) s = s.slice(slashIdx + 1);
  // 3. Suffixes techniques.
  s = s.replace(/:free$/, "").replace(/-instruct$/, "");
  // 4. Préfixes Mistral redondants + cosmétique -latest.
  if (s.startsWith("mistral-")) s = s.slice("mistral-".length);
  s = s.replace(/-latest$/, "");
  return s;
}

// Estimation du coût "incompressible" envoyé à chaque requête : system
// prompt + schémas JSON des tools. Ces tokens sont facturés à chaque tour
// et consomment du context window, mais ils ne représentent PAS la
// conversation user. Permet au status bar d'afficher une jauge "ctx
// disponible pour la conversation" plutôt qu'un chiffre qui part déjà à
// 3-4k au premier "salut".
// Heuristique char/4 (même ratio que estimateTokens() dans compactor).
export function estimateBaselineTokens(
  system: string,
  tools: Array<{ name: string; description: string; schema: unknown }>,
): number {
  let chars = system.length;
  for (const t of tools) {
    chars += t.name.length;
    chars += t.description.length;
    chars += JSON.stringify(t.schema).length;
  }
  return Math.ceil(chars / 4);
}

export function contextWindowFor(model: string): number {
  const m = cleanProvider(model).toLowerCase();
  // NVIDIA NIM — valeurs documentées sur build.nvidia.com.
  if (m.includes("kimi-k2")) return 256_000;
  if (m.includes("qwen3-coder")) return 256_000;
  if (m.includes("qwen3-next")) return 256_000;
  if (m.includes("qwen2.5-coder")) return 32_000;
  if (m.includes("nemotron-ultra")) return 128_000;
  if (m.includes("nemotron-super")) return 128_000;
  if (m.includes("gpt-oss")) return 131_000;
  if (m.includes("llama-3.3-70b")) return 128_000;
  if (m.includes("llama-3.1-405b")) return 128_000;
  if (m.includes("llama-3.1-8b")) return 128_000;
  if (m.includes("phi-4")) return 16_000;
  if (m.includes("glm-5") || m.includes("glm5")) return 200_000;
  if (m.includes("glm4")) return 128_000;
  if (m.includes("minimax-m")) return 1_000_000;
  // Mistral
  if (m.includes("codestral") || m.includes("devstral")) return 256_000;
  if (m.includes("small")) return 32_000;
  if (m.includes("large") || m.includes("medium")) return 128_000;
  if (m.includes("magistral")) return 40_000;
  return 128_000;
}
