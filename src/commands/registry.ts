import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { SlashCommand, CommandContext } from "./types.js";
import { builtinCommands } from "./builtin.js";
import { subdirs } from "../utils/paths.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { log } from "../utils/logger.js";

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();

  constructor() {
    // builtin
    for (const c of builtinCommands(() => [...this.commands.values()])) {
      this.commands.set(c.name, c);
    }
    // custom depuis .aicli/commands/*.md
    for (const dir of subdirs("commands")) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (!statSync(full).isFile() || extname(entry) !== ".md") continue;
        const raw = readFileSync(full, "utf8");
        const { meta, body } = parseFrontmatter(raw);
        const name = basename(entry, ".md");
        const description =
          (typeof meta.description === "string" && meta.description) ||
          body.split("\n")[0].slice(0, 80) ||
          "Commande personnalisée";
        this.commands.set(name, {
          name,
          description,
          async run({ agent }, args) {
            const prompt = body.replace(/\$ARGUMENTS/g, args).trim();
            if (!prompt) {
              log.warn(`Commande /${name} vide.`);
              return;
            }
            await agent.send(prompt);
          },
        });
      }
    }
  }

  list(): SlashCommand[] {
    return [...this.commands.values()];
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  async run(input: string, ctx: CommandContext): Promise<boolean> {
    if (!input.startsWith("/")) return false;
    const rest = input.slice(1).trim();
    const space = rest.indexOf(" ");
    const name = space === -1 ? rest : rest.slice(0, space);
    const args = space === -1 ? "" : rest.slice(space + 1);
    const cmd = this.commands.get(name);
    if (!cmd) {
      log.warn(`Commande inconnue: /${name}. Essaie /help.`);
      return true;
    }
    await cmd.run(ctx, args);
    return true;
  }
}
