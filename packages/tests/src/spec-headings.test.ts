import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const specFiles = ["docs/spec", "docs/ja/spec"].flatMap((dir) =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${dir}/${f}`),
);

/** Headings written more than once, outside fenced code blocks. */
function repeatedHeadings(md: string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  let fenced = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced || !/^#+ /.test(line)) continue;
    if (seen.has(line)) repeated.add(line);
    seen.add(line);
  }
  return [...repeated];
}

// Two sections under one heading share its anchor, so a link reaches only the first, and a copy
// a merge left behind reads as current text beside the section it was copied from.
it.each(specFiles)("%s writes each heading once", (file) => {
  expect(repeatedHeadings(readFileSync(path.join(root, file), "utf8"))).toEqual([]);
});
