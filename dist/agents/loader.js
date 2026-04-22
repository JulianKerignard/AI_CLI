import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { subdirs } from "../utils/paths.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
export function loadSubAgents() {
    const agents = [];
    for (const dir of subdirs("agents")) {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (!statSync(full).isFile() || extname(entry) !== ".md")
                continue;
            const raw = readFileSync(full, "utf8");
            const { meta, body } = parseFrontmatter(raw);
            const name = (typeof meta.name === "string" && meta.name) || basename(entry, ".md");
            const description = (typeof meta.description === "string" && meta.description) || "(sans description)";
            const tools = Array.isArray(meta.tools)
                ? meta.tools.filter((t) => typeof t === "string")
                : undefined;
            agents.push({ name, description, systemPrompt: body.trim(), tools });
        }
    }
    return agents;
}
