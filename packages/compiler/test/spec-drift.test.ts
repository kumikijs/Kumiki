// Mechanized guard: the diagnostic code set emitted by the compiler must
// equal the code set documented in the normative spec — on both EN
// (docs/spec/errors.md) and JA (docs/ja/spec/errors.md) tracks.
//
// Design decision (documented in docs/spec/errors.md / docs/ja/spec/errors.md
// under "The Form of an Error" / "エラーの形"): the checker's coded diagnostics
// come from packages/compiler/src/typecheck.ts. The lexer throws `LexError`
// and the parser throws `ParseError` — both carry `message` + `pos` but no
// `code`, by design (single-shot; no recovery).
//
// Two tools nevertheless have to put a parse failure *into* a diagnostic list —
// `kumiki fix`'s rollback report and the MCP tools' JSON envelope — and both
// synthesize `E0000` for it. So the implementation side of this guard is every
// file that emits a code, not the checker alone: a code invented in a tool and
// documented nowhere is the same drift as one invented in the checker.
//
// If a new code is introduced, add it to typecheck.ts AND to both errors.md
// files in the same PR. If a code is removed from typecheck.ts, drop its
// section from both errors.md files in the same PR. The symmetric-difference
// assertion below will fail the CI until both sides agree.

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_PROP_ROWS, INPUT_ELEMENTS, PROP_TYPE_SPELLING } from "../src/builtin-props.ts";
import { REFINEMENT_PREDS, refinementBases } from "../src/refinements.ts";
import { UI_LIFTS } from "../src/ui-lifts.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/compiler/test/ → repo root
const repoRoot = path.resolve(here, "..", "..", "..");

const CODE_RE = /code:\s*"(E\d{4}|W\d{4})"/g;
const HEADING_RE = /^### (E\d{4}|W\d{4})\b/gm;

// Regex-integrity floor. If both sides drop below this simultaneously the
// symmetric difference could go empty and the whole guard would silently pass
// — worse, a partial regex breakage (impl-only) yields a fail message that
// tells the reader to delete every spec section. Any real refactor keeps the
// count well above this floor; drop it only if the code-band table is
// deliberately shrunk.
const MIN_CODES = 30;

/**
 * Markdown under `dir`. The English pass skips `ja/`, which the Japanese pass
 * walks against its own catalog.
 */
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

  // errors.md is the one place a code is defined. A second table elsewhere in
  // the spec — ai-edit.md carried one, giving E0302 two incompatible meanings —
  // makes "the code is a permanent contract" untrue of the document that says
  // it. Any code named anywhere in the spec has to resolve here.
  it("names no diagnostic code the spec does not define", () => {
    // Every document, not only `docs/spec`: the guide names codes too, and one
    // deleted tomorrow would leave it holding a dangling reference — the
    // ai-edit.md failure this guard exists to prevent, one directory over.
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

// The same guard for §W0212's "allowed root tile kinds" table, which is the
// published copy of `UI_LIFTS` and was hand-synced on both tracks every time a
// row moved. Codes had this and the table did not, so a row could drift in
// either direction — a spec that documents a lift the compiler does not make,
// or a lift the compiler makes and nobody wrote down — and no tier would say
// so. The `ev` column also has to agree, so a row added to one side alone
// fails rather than being skipped as unmatched.
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

  /**
   * The table as `ev -> kinds`, with `null` for a cell that names no kind —
   * the `hover` row, whose value is prose and differs per track ("any tile" /
   * "任意の tile"). Keyed off the backticks rather than the prose, so the two
   * tracks parse identically and a translated cell is not a diff.
   */
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
      // Extraction floor: a broken regex that matched nothing would make every
      // comparison below vacuous.
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

// The same guard for §E0804's predicate/base table, the published copy of what
// each entry of `REFINEMENTS` tests. A row that names a base the predicate
// cannot test documents a program E0804 refuses, and a base missing from a row
// hides one it accepts. Keyed off the backticks, so both tracks parse alike.
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

// The same guard for stdlib.md §2.3.11's prop table, the published copy of
// `BUILTIN_PROP_ROWS`. A row typing a prop the checker does not hold to that
// type, or a prop the checker types that no row lists, is a program the spec
// and `check` disagree about. forms.md types the input elements' props (§5.3)
// and the form's (§5.2.1) in tables of its own, so each type written there has
// to be the one the checker holds the prop to as well.
describe("stdlib §2.3.11's prop table matches BUILTIN_PROP_ROWS", () => {
  /** The body under the heading `heading` matches, up to the next `##` / `###` heading. */
  function section(file: string, heading: RegExp): string {
    const source = readFileSync(file, "utf8");
    const start = source.search(heading);
    expect(start, `${file} has no heading matching ${heading}`).toBeGreaterThanOrEqual(0);
    const body = source.slice(source.indexOf("\n", start) + 1);
    const end = body.search(/^#{2,3} /m);
    return end < 0 ? body : body.slice(0, end);
  }

  const backticked = (cell: string | undefined): string[] =>
    [...(cell ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);

  /**
   * The cells of each three-cell table row whose first cell names something in
   * backticks — which skips the header and the `|---|` separator.
   */
  function rows(text: string): string[][] {
    return text
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) => line.split("|").slice(1, -1))
      .filter((cells) => cells.length === 3 && backticked(cells[0]).length > 0);
  }

  /** §2.3.11 as `"<tile> <prop>" -> type`, keyed off the backticks so both tracks parse alike. */
  function propTable(file: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const [props, type, tiles] of rows(section(file, /^### 2\.3\.11 /m))) {
      const spelled = backticked(type);
      expect(spelled, `${file} §2.3.11 row "${props}" names one type`).toHaveLength(1);
      for (const tile of backticked(tiles)) {
        for (const prop of backticked(props)) {
          const key = `${tile} ${prop}`;
          expect(out.has(key), `${file} §2.3.11 lists "${key}" in two rows`).toBe(false);
          out.set(key, spelled[0] as string);
        }
      }
    }
    return out;
  }

  /** A forms.md table as `prop -> type`, for the rows whose type is one written in backticks. */
  function typedProps(file: string, heading: RegExp): Map<string, string> {
    const out = new Map<string, string>();
    for (const [prop, type] of rows(section(file, heading))) {
      const spelled = backticked(type);
      if (spelled.length === 1) out.set(backticked(prop)[0] as string, spelled[0] as string);
    }
    return out;
  }

  const expected = new Map(
    BUILTIN_PROP_ROWS.flatMap((row) =>
      row.tiles.flatMap((tile) =>
        row.props.map((prop) => [`${tile} ${prop}`, PROP_TYPE_SPELLING[row.type]] as const),
      ),
    ),
  );

  const TRACKS = {
    en: path.join(repoRoot, "docs", "spec"),
    ja: path.join(repoRoot, "docs", "ja", "spec"),
  } as const;

  for (const [track, dir] of Object.entries(TRACKS)) {
    it(`lists the props the checker types, with the same types, on the ${track} track`, () => {
      const table = propTable(path.join(dir, "stdlib.md"));
      expect(Object.fromEntries([...table].sort())).toEqual(
        Object.fromEntries([...expected].sort()),
      );
    });

    it(`types forms.md §5.3's props on every input element as the checker does, on the ${track} track`, () => {
      const typed = typedProps(path.join(dir, "forms.md"), /^## 5\.3 /m);
      // `id` is the one typed row left to stdlib §2.3.10's common props, which
      // every kind takes.
      expect([...typed.keys()].sort()).toEqual([
        "auto-complete",
        "auto-focus",
        "disabled",
        "id",
        "placeholder",
        "readonly",
        "required",
      ]);
      for (const [prop, type] of typed) {
        if (prop === "id") continue;
        for (const tile of INPUT_ELEMENTS) {
          expect(expected.get(`${tile} ${prop}`), `${track} forms §5.3 "${prop}" on ${tile}`).toBe(
            type,
          );
        }
      }
    });

    it(`types forms.md §5.2.1's form props as the checker does, on the ${track} track`, () => {
      const typed = typedProps(path.join(dir, "forms.md"), /^### 5\.2\.1 /m);
      expect([...typed.keys()].sort()).toEqual(["auto-complete", "novalidate"]);
      for (const [prop, type] of typed) {
        expect(expected.get(`form ${prop}`), `${track} forms §5.2.1 "${prop}"`).toBe(type);
      }
    });
  }

  it("takes the input elements to be the elements of stdlib §2.3.4", () => {
    const table = section(path.join(TRACKS.en, "stdlib.md"), /^### 2\.3\.4 /m);
    expect(rows(table).map(([element]) => backticked(element)[0])).toEqual([...INPUT_ELEMENTS]);
  });
});
