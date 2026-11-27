import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guideRoots, readGuide, specDocs } from "@kumikijs/cli";

export function listSpecDocs(): string[] {
  return specDocs().map((d) => `${d}.md`);
}

export function getSpecDoc(name: string): string | null {
  const found = readGuide(name);
  return found?.kind === "spec" ? found.text : null;
}

export type SpecHit = { doc: string; line: number; text: string };

export function searchSpec(query: string, maxHits = 40): SpecHit[] {
  // The spec the CLI ships with, so an installed server reads the spec of its own version.
  const dir = guideRoots().spec;
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
