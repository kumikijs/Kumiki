// The benchmark corpus as a gate.
//
// `packages/examples` is written to pass, so it says little about a checker
// that is deliberately one-sided: a false positive there would be spotted while
// the example was being written. The recorded single-pass model outputs under
// `packages/benchmarks` are the opposite — real programs, several hundred lines
// each, written by someone who never saw a compiler error. That makes them the
// corpus a new check has to survive without inventing a diagnostic.
//
// Two of them do not parse and one does not typecheck. Those are *findings*
// about the models, recorded in `learning-cost/summary.md`, so they are listed
// here with the diagnostic each is expected to produce rather than skipped:
// a file that stops failing, or fails differently, is drift worth seeing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const benchmarksDir = join(here, "..", "benchmarks");

/**
 * The corpus entries that are known not to be clean, with the first diagnostic
 * each produces. `summary.md` scores all three as failures; this pins *how*
 * they fail so a change that silently alters the reason shows up.
 */
const KNOWN_BAD: Record<string, "parse" | readonly string[]> = {
  // `$1` used in tiles that declare no `in=` (E0103 ×23, the failure
  // `summary.md` records), plus the calls that pass an argument to one of
  // those tiles — accepted before value checking, dropped silently at render.
  "learning-cost/v3-issue-tracker/results/Gemini/output.kumiki": ["E0103", "E0213", "W0212"],
  "learning-cost/v4-project-management/results/Claude/output.kumiki": "parse",
  "learning-cost/v4-project-management/results/Gemini/output.kumiki": "parse",
};

// `packages/benchmarks` has its own `node_modules`, and the workspace links
// under it lead back into other packages' test fixtures — hundreds of
// throwaway `.kumiki` files that are not corpus.
const SKIP_DIRS = new Set(["node_modules", ".turbo", "dist"]);

function listKumikiFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listKumikiFiles(full));
    else if (entry.endsWith(".kumiki")) out.push(full);
  }
  return out;
}

/** `"parse"` when the source does not parse, otherwise the diagnostic codes. */
function outcome(source: string): "parse" | string[] {
  try {
    return check(parse(lex(source))).map((e) => e.code);
  } catch {
    return "parse";
  }
}

const files = listKumikiFiles(benchmarksDir).map((f) => ({
  path: f,
  rel: relative(benchmarksDir, f).replaceAll("\\", "/"),
}));

describe("benchmark corpus", () => {
  it("finds the recorded outputs", () => {
    // Floor: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  for (const { path, rel } of files) {
    const expected = KNOWN_BAD[rel];
    if (expected === undefined) {
      it(`checks clean: ${rel}`, () => {
        const result = outcome(readFileSync(path, "utf8"));
        expect(result, `${rel} no longer checks clean`).toEqual([]);
      });
      continue;
    }
    const label = expected === "parse" ? "parse error" : expected.join(" + ");
    it(`fails as recorded (${label}): ${rel}`, () => {
      const result = outcome(readFileSync(path, "utf8"));
      if (expected === "parse") {
        expect(result, `${rel} now parses — update summary.md and KNOWN_BAD`).toBe("parse");
        return;
      }
      expect(result, `${rel} now parses cleanly — update summary.md`).not.toBe("parse");
      // Distinct codes, not counts: a count would churn on any wording or
      // cascade change, while a code appearing or disappearing is the signal.
      expect([...new Set(result as string[])].sort(), `${rel} diagnostics changed`).toEqual([
        ...expected,
      ]);
    });
  }

  it("does not list a KNOWN_BAD entry that no longer exists", () => {
    const present = new Set(files.map((f) => f.rel));
    expect(Object.keys(KNOWN_BAD).filter((k) => !present.has(k))).toEqual([]);
  });

  it("stays an order of magnitude under the parser's nesting limit", () => {
    // The limit is only defensible if real programs are nowhere near it, and
    // that claim is in the spec (language.md §1.2.3). Computed rather than
    // written down, because a number in a comment drifts silently and this
    // one is load-bearing: raising the limit to admit ordinary code would
    // mean the limit was wrong.
    const deepest = Math.max(
      ...files.map((f) => {
        try {
          return astDepth(parse(lex(readFileSync(f.path, "utf8"))).defs);
        } catch {
          return 0; // the two recorded parse failures
        }
      }),
    );
    expect(deepest).toBeGreaterThan(0);
    expect(deepest, `deepest corpus tree is ${deepest}`).toBeLessThan(PARSER_NESTING_LIMIT / 10);
  });
});

/** The bound `parser.ts` enforces, as documented in language.md §1.2.3. */
const PARSER_NESTING_LIMIT = 256;

/** How deeply AST nodes nest — what the parser's budget is spent on. */
function astDepth(node: unknown): number {
  if (Array.isArray(node)) return Math.max(0, ...node.map(astDepth));
  if (node && typeof node === "object") {
    const fields = Object.values(node as Record<string, unknown>);
    const inner = Math.max(0, ...fields.map(astDepth));
    return "kind" in (node as object) ? inner + 1 : inner;
  }
  return 0;
}
