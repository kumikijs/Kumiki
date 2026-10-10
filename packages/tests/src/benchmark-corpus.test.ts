import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// Recorded model outputs, written without ever seeing a compiler error: a new check has to
// survive them without inventing a diagnostic, and the ones that fail must keep failing the
// way learning-cost/summary.md scores them.
const benchmarksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "benchmarks");

const KNOWN_BAD: Record<string, "parse" | readonly string[]> = {
  "learning-cost/v3-issue-tracker/results/Gemini/output.kumiki": ["E0103", "E0213", "W0212"],
  "learning-cost/v3-issue-tracker/results/Codex/output.kumiki": ["E0128"],
  "learning-cost/v4-project-management/results/Claude/output.kumiki": "parse",
  "learning-cost/v4-project-management/results/Gemini/output.kumiki": "parse",
};

// The workspace links under benchmarks/node_modules lead into other packages' fixtures.
const SKIP_DIRS = new Set(["node_modules", ".turbo", "dist"]);

function kumikiFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return kumikiFiles(path);
    return entry.name.endsWith(".kumiki") ? [path] : [];
  });
}

/** `"parse"` when the source does not parse, otherwise its distinct diagnostic codes. */
function outcome(path: string): "parse" | string[] {
  let program: ReturnType<typeof parse>;
  try {
    program = parse(lex(readFileSync(path, "utf8")));
  } catch {
    return "parse";
  }
  return [...new Set(check(program).map((e) => e.code))].sort();
}

const files = kumikiFiles(benchmarksDir).map((path) => ({
  path,
  rel: relative(benchmarksDir, path).replaceAll("\\", "/"),
}));

describe("benchmark corpus", () => {
  it("finds the recorded outputs", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
    const present = new Set(files.map((f) => f.rel));
    expect(Object.keys(KNOWN_BAD).filter((rel) => !present.has(rel))).toEqual([]);
  });

  it.each(files.filter((f) => KNOWN_BAD[f.rel] === undefined))("checks clean: $rel", ({ path }) => {
    expect(outcome(path)).toEqual([]);
  });

  it.each(
    files.flatMap((f) => {
      const expected = KNOWN_BAD[f.rel];
      return expected === undefined ? [] : [{ ...f, expected }];
    }),
  )("fails as recorded: $rel", ({ path, expected }) => {
    expect(outcome(path)).toEqual(expected === "parse" ? "parse" : [...expected]);
  });
});
