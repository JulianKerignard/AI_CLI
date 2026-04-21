import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { SubAgent } from "./types.js";
import { subdirs } from "../utils/paths.js";
import { parseFrontmatter } from "../utils/frontmatter.js";

export function loadSubAgents(): SubAgent[] {
  const agents: SubAgent[] = [];
  for (const dir of subdirs("agents")) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isFile() || extname(entry) !== ".md") continue;
      const raw = readFileSync(full, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const name = (typeof meta.name === "string" && meta.name) || basename(entry, ".md");
      const description =
        (typeof meta.description === "string" && meta.description) || "(sans description)";
      const tools = Array.isArray(meta.tools)
        ? (meta.tools as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined;
      agents.push({ name, description, systemPrompt: body.trim(), tools });
    }
  }
  return agents;
}
