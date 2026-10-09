import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFINEMENT_PREDS, refinementBases } from "../src/refinements.ts";
import { UI_LIFTS } from "../src/ui-lifts.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/compiler/test/ → repo root
const repoRoot = path.resolve(here, "..", "..", "..");

const CODE_RE = /code:\s*"(E\d{4}|W\d{4})"/g;
const HEADING_RE = /^### (E\d{4}|W\d{4})\b/gm;

const MIN_CODES = 30;

function markdownUnder(dir: string, skipJa: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (skipJa && entry.name === "ja") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownUnder(full, skipJa, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function collect(source: string, re: RegExp): Set<string> {
  const set = new Set<string>();
  for (const m of source.matchAll(re)) set.add(m[1]!);
  return set;
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

function report(label: string, implSide: Set<string>, specSide: Set<string>): string {
  const missingInSpec = diff(implSide, specSide);
  const missingInImpl = diff(specSide, implSide);
  const lines: string[] = [];
  if (missingInSpec.length > 0) {
    lines.push(
      `[${label}] impl emits but spec is missing: ${missingInSpec.join(", ")} — add a "### <code> \`<kind>\`" section to the spec.`,
    );
  }
  if (missingInImpl.length > 0) {
    lines.push(
      `[${label}] spec documents but impl no longer emits: ${missingInImpl.join(", ")} — drop the section from the spec (or restore the code in the emitter that lost it).`,
    );
  }
  return lines.join("\n");
}

/** Every file that assigns a diagnostic code, checker and tools alike. */
const EMITTERS = [
  ["packages", "compiler", "src", "typecheck.ts"],
  ["packages", "cli", "src", "fix.ts"],
  ["packages", "mcp", "src", "index.ts"],
];

describe("spec ⇆ implementation diagnostic code-set drift", () => {
  const implSrc = EMITTERS.map((parts) => readFileSync(path.join(repoRoot, ...parts), "utf8")).join(
    "\n",
  );
  const specEnSrc = readFileSync(path.join(repoRoot, "docs", "spec", "errors.md"), "utf8");
  const specJaSrc = readFileSync(path.join(repoRoot, "docs", "ja", "spec", "errors.md"), "utf8");
  const implCodes = collect(implSrc, CODE_RE);
  const specEnCodes = collect(specEnSrc, HEADING_RE);
  const specJaCodes = collect(specJaSrc, HEADING_RE);

  it("extraction regexes still match the expected shapes on all three sides", () => {
    expect(implCodes.size).toBeGreaterThan(MIN_CODES);
    expect(specEnCodes.size).toBeGreaterThan(MIN_CODES);
    expect(specJaCodes.size).toBeGreaterThan(MIN_CODES);
  });

  it("EN spec (docs/spec/errors.md) documents exactly the codes the implementation emits", () => {
    const msg = report("EN", implCodes, specEnCodes);
    if (msg !== "") expect.fail(msg);
  });

  it("JA spec (docs/ja/spec/errors.md) documents exactly the codes the implementation emits", () => {
    const msg = report("JA", implCodes, specJaCodes);
    if (msg !== "") expect.fail(msg);
  });

  it("names no diagnostic code the spec does not define", () => {
    const unknown: string[] = [];
    for (const [track, defined] of [
      ["docs", specEnCodes],
      ["docs/ja", specJaCodes],
    ] as [string, Set<string>][]) {
      const dir = path.join(repoRoot, ...track.split("/"));
      for (const file of markdownUnder(dir, track === "docs")) {
        if (file.endsWith("errors.md")) continue;
        const text = readFileSync(file, "utf8");
        for (const code of text.match(/E\d{4}|W\d{4}/g) ?? []) {
          if (!defined.has(code)) unknown.push(`${path.relative(repoRoot, file)}: ${code}`);
        }
      }
    }
    expect([...new Set(unknown)].sort()).toEqual([]);
  });
});

describe("§W0212's lift table matches UI_LIFTS", () => {
  /** `### W0212 …` up to the next `### `, on either track. */
  function w0212Section(file: string): string {
    const source = readFileSync(file, "utf8");
    const start = source.search(/^### W0212\b/m);
    expect(start, `${file} has no §W0212 heading`).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start + 1);
    const end = rest.search(/^### /m);
    return end < 0 ? rest : rest.slice(0, end);
  }

  function liftTable(file: string): Map<string, ReadonlySet<string> | null> {
    const out = new Map<string, ReadonlySet<string> | null>();
    for (const line of w0212Section(file).split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1);
      if (cells.length !== 2) continue;
      const ev = cells[0]?.match(/`([a-z]+)`/)?.[1];
      // Skips the header (its cell is `ui.<ev>`, which does not match) and the
      // `|---|---|` separator.
      if (ev === undefined) continue;
      const kinds = [...(cells[1] ?? "").matchAll(/`([a-z]+)`/g)].map((m) => m[1] as string);
      out.set(ev, kinds.length === 0 ? null : new Set(kinds));
    }
    return out;
  }

  const TRACKS = {
    en: path.join(repoRoot, "docs", "spec", "errors.md"),
    ja: path.join(repoRoot, "docs", "ja", "spec", "errors.md"),
  } as const;

  const expected = new Map(UI_LIFTS.map((l) => [l.ev as string, l.tiles]));

  for (const [track, file] of Object.entries(TRACKS)) {
    it(`extracts one row per lift row on the ${track} track`, () => {
      expect(liftTable(file).size).toBe(UI_LIFTS.length);
    });

    it(`lists the same ui-kinds as UI_LIFTS on the ${track} track`, () => {
      expect([...liftTable(file).keys()].sort()).toEqual([...expected.keys()].sort());
    });

    it(`lists the same tile kinds per ui-kind on the ${track} track`, () => {
      const table = liftTable(file);
      for (const [ev, tiles] of expected) {
        const documented = table.get(ev);
        if (tiles === null) {
          expect(documented, `${track} §W0212 row "${ev}"`).toBeNull();
        } else {
          expect(documented, `${track} §W0212 row "${ev}"`).toEqual(new Set(tiles));
        }
      }
    });
  }
});

describe("§E0804's base table matches the refinement table", () => {
  function e0804Section(file: string): string {
    const source = readFileSync(file, "utf8");
    const start = source.search(/^### E0804\b/m);
    expect(start, `${file} has no §E0804 heading`).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start + 1);
    const end = rest.search(/^### /m);
    return end < 0 ? rest : rest.slice(0, end);
  }

  /** The table as `predicate -> bases`, one entry per predicate a row names. */
  function baseTable(file: string): Map<string, ReadonlySet<string>> {
    const out = new Map<string, ReadonlySet<string>>();
    const backticked = (cell: string | undefined): string[] =>
      [...(cell ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
    for (const line of e0804Section(file).split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1);
      if (cells.length !== 3) continue;
      const preds = backticked(cells[0]);
      // The header and the separator name no predicate.
      if (preds.length === 0) continue;
      for (const pred of preds) {
        expect(out.has(pred), `${file} lists "${pred}" in two rows`).toBe(false);
        out.set(pred, new Set(backticked(cells[2])));
      }
    }
    return out;
  }

  const TRACKS = {
    en: path.join(repoRoot, "docs", "spec", "errors.md"),
    ja: path.join(repoRoot, "docs", "ja", "spec", "errors.md"),
  } as const;

  for (const [track, file] of Object.entries(TRACKS)) {
    it(`lists every registered predicate once on the ${track} track`, () => {
      expect([...baseTable(file).keys()].sort()).toEqual([...REFINEMENT_PREDS].sort());
    });

    it(`lists the bases each predicate tests on the ${track} track`, () => {
      const table = baseTable(file);
      for (const pred of REFINEMENT_PREDS) {
        expect(table.get(pred), `${track} §E0804 row "${pred}"`).toEqual(
          new Set(refinementBases(pred)),
        );
      }
    });
  }
});
