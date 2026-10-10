import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the repo's docs/spec directory. Override with KUMIKI_SPEC_DIR. */
export function specDir(): string {
  const env = process.env.KUMIKI_SPEC_DIR;
  if (env) return env;
  // src/ and dist/ both sit three levels below the repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "docs", "spec");
}

export function listSpecDocs(): string[] {
  const dir = specDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

export function getSpecDoc(name: string): string | null {
  const dir = specDir();
  const file = name.endsWith(".md") ? name : `${name}.md`;
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export type SpecHit = { doc: string; line: number; text: string };

export function searchSpec(query: string, maxHits = 40): SpecHit[] {
  const dir = specDir();
  const needle = query.toLowerCase();
  const hits: SpecHit[] = [];
  for (const doc of listSpecDocs()) {
    const lines = readFileSync(join(dir, doc), "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.toLowerCase().includes(needle)) {
        hits.push({ doc, line: i + 1, text: line.trim() });
        if (hits.length >= maxHits) return hits;
      }
    }
  }
  return hits;
}
