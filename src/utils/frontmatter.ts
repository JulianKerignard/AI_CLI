import YAML from "yaml";

export interface ParsedMarkdown {
  meta: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedMarkdown {
  if (!content.startsWith("---")) return { meta: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: content };
  const raw = content.slice(3, end).trim();
  const body = content.slice(end + 4).replace(/^\n/, "");
  try {
    const meta = (YAML.parse(raw) ?? {}) as Record<string, unknown>;
    return { meta, body };
  } catch {
    return { meta: {}, body: content };
  }
}
