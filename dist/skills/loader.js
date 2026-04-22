import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { subdirs } from "../utils/paths.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
export function loadSkills() {
    const skills = [];
    for (const dir of subdirs("skills")) {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (!statSync(full).isDirectory())
                continue;
            const file = join(full, "SKILL.md");
            if (!existsSync(file))
                continue;
            const raw = readFileSync(file, "utf8");
            const { meta, body } = parseFrontmatter(raw);
            const name = (typeof meta.name === "string" && meta.name) || entry;
            const description = (typeof meta.description === "string" && meta.description) || "(sans description)";
            const tools = Array.isArray(meta.tools)
                ? meta.tools.filter((t) => typeof t === "string")
                : undefined;
            skills.push({ name, description, prompt: body.trim(), tools });
        }
    }
    return skills;
}
