// Taille du context window (en tokens) par famille de modèle.
// Isolé dans lib/ pour éviter un import circulaire UI↔agent (compactor
// a besoin de cette info pour décider si un auto-compact préventif est
// nécessaire).

export function cleanProvider(name: string): string {
  const httpMatch = /^http\((.+)\)$/.exec(name);
  const inner = httpMatch ? httpMatch[1] : name;
  // Strip le préfixe "nvidia/" pour l'affichage UI. Le routing upstream
  // utilise l'ID complet via `this.opts.model`, pas via cette chaîne.
  return inner.startsWith("nvidia/") ? inner.slice("nvidia/".length) : inner;
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
