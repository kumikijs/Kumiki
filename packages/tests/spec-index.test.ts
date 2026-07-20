// Mechanized guard for the spec index (docs/spec/index.md, docs/ja/spec/index.md).
// The index carries three machine-parseable tables, each delimited by HTML
// comment markers so this test can locate them without guessing at prose:
//
//   <!-- matrix:start -->   … 7-layer × feature matrix …   <!-- matrix:end -->
//   <!-- codes:start -->    … diagnostic code index …      <!-- codes:end -->
//   <!-- examples:start --> … feature-examples index …     <!-- examples:end -->
//
// Guarded edges (spec-drift.test.ts in packages/compiler already pins
// implementation ⇆ errors.md, so together the triangle closes):
//   1. index ⇆ spec body — every `./doc.md#anchor` link resolves to a real
//      heading anchor (computed with the same slugify VitePress uses) AND the
//      anchor starts with the label's own section/code prefix, so a link that
//      resolves but points at the wrong section is caught too. A separate check
//      forbids bare `doc.md#…` links (no `./`), which would slip past the
//      anchor scan entirely.
//   2. index ⇆ examples — the examples table lists exactly the files under
//      packages/examples/features/ (symmetric difference = 0).
//   3. index ⇆ errors.md — the code table lists exactly the (code, kind) pairs
//      errors.md documents, so dropping one row of a double-assigned code, or
//      renaming a kind on one side, fails.
//   4. EN ⇆ JA — both indices carry the same language-neutral structure
//      (matrix grid targets, code+kind sequence, example file set).
//
// Structural floors (matrix row/column counts, marker uniqueness, extraction
// minima) keep a broken regex or a mangled table from collapsing a set to
// empty and passing silently.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "@mdit-vue/shared";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tracks = {
  en: join(repoRoot, "docs", "spec"),
  ja: join(repoRoot, "docs", "ja", "spec"),
} as const;
const featuresDir = join(repoRoot, "packages", "examples", "features");

// The 7 layers are language-independent, so the layer columns can be validated
// against this closed set on both tracks.
const LAYERS = new Set(["type", "slot", "effect", "reducer", "tile", "fn", "app"]);

// Feature-dimension language-neutral keys. Each track spells the same key
// differently (EN "http" vs JA "HTTP/Storage"), so raw column text is not
// comparable across tracks — this table maps each display term to the shared
// key so both per-track vocabulary checks and EN⇆JA sync run on one basis.
// An unknown display term throws in normalizeFeature: typos and drive-by new
// vocabulary are caught rather than silently splitting the code/example sets.
const FEATURE_DISPLAY_TO_KEY: Record<"en" | "ja", Record<string, string>> = {
  en: {
    core: "core",
    stdlib: "stdlib",
    style: "style",
    routing: "routing",
    forms: "forms",
    http: "http",
    lifecycle: "lifecycle",
    testing: "testing",
  },
  ja: {
    コア: "core",
    標準ライブラリ: "stdlib",
    スタイル: "style",
    ルーティング: "routing",
    フォーム: "forms",
    "HTTP/Storage": "http",
    ライフサイクル: "lifecycle",
    テスト: "testing",
  },
};

function normalizeFeature(raw: string, label: string): string {
  const map = FEATURE_DISPLAY_TO_KEY[label as "en" | "ja"];
  const key = map?.[raw];
  if (!key) {
    throw new Error(
      `[${label}] unknown feature "${raw}" — add it to FEATURE_DISPLAY_TO_KEY.${label} (or fix the typo in the index).`,
    );
  }
  return key;
}

// Extraction-integrity floors (same idea as MIN_CODES in spec-drift.test.ts):
// if a regex or marker breaks, the affected set collapses toward empty and a
// symmetric-difference check could silently pass. Real content sits well above
// these floors.
const MIN_LINKS = 50;
const MIN_CODES = 30;
const MIN_EXAMPLES = 30;
const MIN_MATRIX_ROWS = 8;
const MATRIX_COLUMNS = 8; // Feature + the 7 layers.

function read(dir: string, file: string): string {
  return readFileSync(join(dir, file), "utf8");
}

// Yield the lines that lie outside fenced code blocks, honoring the CommonMark
// rule that a closing fence uses the same character and is at least as long as
// the opening one — so a 3-backtick line inside a 4-backtick fence does not
// falsely close it.
function* nonFenceLines(md: string): Generator<string> {
  let fence: { char: string; len: number } | null = null;
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      const char = m[1][0];
      const len = m[1].length;
      if (fence === null) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      continue;
    }
    if (fence === null) yield line;
  }
}

// Heading → anchor set, mirroring the VitePress pipeline: headings outside
// fenced code blocks, explicit `{#id}` overrides, @mdit-vue/shared slugify of
// the raw heading text, and markdown-it-anchor's `-1`, `-2`… suffixes for
// duplicate slugs. (The spec's headings carry no inline markup, so slugifying
// the raw line matches what VitePress emits.)
function collectAnchors(md: string): Set<string> {
  const anchors = new Set<string>();
  const used = new Map<string, number>();
  for (const line of nonFenceLines(md)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (!heading) continue;
    const explicit = heading[1].match(/\{#([^}]+)\}\s*$/);
    const slug = explicit ? explicit[1] : slugify(heading[1]);
    const n = used.get(slug) ?? 0;
    used.set(slug, n + 1);
    anchors.add(n === 0 ? slug : `${slug}-${n}`);
  }
  return anchors;
}

interface DocLink {
  label: string;
  doc: string;
  anchor: string | null;
  raw: string;
}

// `./doc.md` and `./doc.md#anchor` links, with their display label captured.
function collectDocLinks(md: string): DocLink[] {
  const links: DocLink[] = [];
  for (const m of md.matchAll(/\[([^\]]*)\]\(\.\/([\w.-]+\.md)(#([^)]+))?\)/g)) {
    links.push({ label: m[1], doc: m[2], anchor: m[4] ?? null, raw: m[0] });
  }
  return links;
}

// The anchor a §-section or diagnostic-code label must point at, derived from
// the label alone: `§1.3` → `_1-3`, `§2.2.3` → `_2-2-3`, `E0206` → `e0206`,
// `E02xx` → `e02xx`. Labels of any other shape (e.g. localized doc titles)
// return null and are exempt from the prefix check.
function expectedAnchorPrefix(label: string): string | null {
  const section = label.match(/^§([\d.]+)$/);
  if (section) return `_${section[1].replace(/\./g, "-")}`;
  const code = label.match(/^([EW]\d{2}(?:\d{2}|xx))$/);
  if (code) return code[1].toLowerCase();
  return null;
}

function markedSection(md: string, name: string, label: string): string {
  const startTag = `<!-- ${name}:start -->`;
  const endTag = `<!-- ${name}:end -->`;
  const starts = md.split(startTag).length - 1;
  const ends = md.split(endTag).length - 1;
  if (starts !== 1 || ends !== 1) {
    throw new Error(
      `[${label}] expected exactly one <!-- ${name}:start/end --> pair, found ${starts} start / ${ends} end marker(s)`,
    );
  }
  const start = md.indexOf(startTag);
  const end = md.indexOf(endTag);
  if (end < start) throw new Error(`[${label}] <!-- ${name}:end --> precedes its start marker`);
  return md.slice(start, end);
}

function tableRows(block: string, name: string, label: string): string[][] {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 3) throw new Error(`[${label}] ${name} table has no data rows`);
  if (!/^\|[\s:|-]+\|$/.test(lines[1].trim())) {
    throw new Error(`[${label}] ${name} table is missing its header separator row`);
  }
  return lines.slice(2).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim()),
  );
}

// Language-neutral cell signature: link labels that carry a section number
// (§…) or a diagnostic-code band (E02xx…) are kept verbatim; other labels
// (localized row titles) reduce to the target document alone.
function cellSignature(cell: string): string {
  const links = [...cell.matchAll(/\[([^\]]+)\]\(\.\/([\w.-]+\.md)[^)]*\)/g)].map(
    ([, label, doc]) => (label.startsWith("§") || /^[EW]\d/.test(label) ? `${doc}:${label}` : doc),
  );
  return links.length > 0 ? links.join(" ") : cell;
}

function matrixSignature(md: string, label: string): string[][] {
  return tableRows(markedSection(md, "matrix", label), "matrix", label).map((cells) =>
    cells.map(cellSignature),
  );
}

interface CodeRow {
  code: string;
  kind: string;
  layer: string;
  feature: string;
}

function codeRows(md: string, label: string): CodeRow[] {
  return tableRows(markedSection(md, "codes", label), "codes", label).map((cells) => ({
    code: cells[0]?.match(/\[([EW]\d{4})\]/)?.[1] ?? "?",
    kind: backtickKinds(cells[1] ?? ""),
    layer: cells[2] ?? "",
    feature: cells[3] ?? "",
  }));
}

// One "code kind" entry per row, e.g. "E0103 undef-ref / undef-slot".
function codeKindSignature(md: string, label: string): string[] {
  return codeRows(md, label).map((r) => `${r.code} ${r.kind}`);
}

interface ExampleRow {
  file: string;
  layers: string[];
  feature: string;
  spec: string;
}

function exampleRows(md: string, label: string): ExampleRow[] {
  // Column order: Example | Layers | Feature | Spec.
  return tableRows(markedSection(md, "examples", label), "examples", label).map((cells) => ({
    file: (cells[0] ?? "").replace(/`/g, "").trim(),
    layers: (cells[1] ?? "").split(",").map((s) => s.trim()),
    feature: cells[2] ?? "",
    spec: cells[3] ?? "",
  }));
}

function exampleFileSet(md: string, label: string): Set<string> {
  return new Set(exampleRows(md, label).map((r) => r.file));
}

function backtickKinds(cell: string): string {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]).join(" / ");
}

// (code, kind) pairs from errors.md `### E/W…` headings. Parenthetical
// qualifiers ("(opt-in via …)", "(warning)", full-width "（… で opt-in）") are
// stripped first so only the canonical kind name survives — matching the
// index's Kind column.
function errorsMdCodeKinds(dir: string): string[] {
  const out: string[] = [];
  for (const line of nonFenceLines(read(dir, "errors.md"))) {
    const m = line.match(/^### ([EW]\d{4})\b(.*)$/);
    if (!m) continue;
    const kinds = backtickKinds(m[2].replace(/\([^)]*\)|（[^）]*）/g, ""));
    out.push(`${m[1]} ${kinds}`.trimEnd());
  }
  return out;
}

function symmetricDiff(a: Set<string>, b: Set<string>): { onlyA: string[]; onlyB: string[] } {
  return {
    onlyA: [...a].filter((x) => !b.has(x)).sort(),
    onlyB: [...b].filter((x) => !a.has(x)).sort(),
  };
}

describe.each(Object.entries(tracks))("spec index (%s)", (label, dir) => {
  const index = read(dir, "index.md");

  it("has enough extractable content for the guards to be meaningful", () => {
    expect(collectDocLinks(index).length).toBeGreaterThan(MIN_LINKS);
    expect(codeKindSignature(index, label).length).toBeGreaterThan(MIN_CODES);
    expect(exampleFileSet(index, label).size).toBeGreaterThan(MIN_EXAMPLES);
  });

  it("matrix grid is structurally intact (row/column counts)", () => {
    const grid = matrixSignature(index, label);
    expect(grid.length).toBeGreaterThanOrEqual(MIN_MATRIX_ROWS);
    for (const row of grid) {
      expect(row.length, `matrix row "${row[0]}" has the wrong column count`).toBe(MATRIX_COLUMNS);
    }
  });

  it("internal spec links use the ./doc.md#anchor form the anchor check understands", () => {
    const bad = [...index.matchAll(/\]\(([^)]+)\)/g)]
      .map((m) => m[1])
      .filter((t) => /\.md(#|$)/.test(t) && !/^\.\/[\w.-]+\.md(#.+)?$/.test(t));
    if (bad.length > 0) {
      expect.fail(
        `[${label}] ${bad.length} spec link(s) do not use the ./doc.md#anchor form (so the anchor check skips them): ${bad.join(", ")}`,
      );
    }
  });

  it("every link resolves to a real anchor and points at the section its label names", () => {
    const anchorCache = new Map<string, Set<string>>();
    const problems: string[] = [];
    for (const link of collectDocLinks(index)) {
      let anchors = anchorCache.get(link.doc);
      if (!anchors) {
        anchors = collectAnchors(read(dir, link.doc));
        anchorCache.set(link.doc, anchors);
      }
      if (link.anchor === null) continue;
      const anchor = link.anchor;
      if (!anchors.has(anchor)) {
        // VitePress ids come out of slugify NFKD-decomposed (e.g. ド = ト +
        // U+3099), while editors usually type NFC. Anchors must match the id
        // byte-for-byte, so point the author at the canonical form.
        const canonical = [...anchors].find((a) => a.normalize("NFC") === anchor.normalize("NFC"));
        problems.push(
          canonical
            ? `${link.raw} — Unicode normalization mismatch; use the NFKD form VitePress emits: #${canonical}`
            : `${link.raw} — anchor does not exist`,
        );
        continue;
      }
      const prefix = expectedAnchorPrefix(link.label);
      if (prefix && anchor !== prefix && !anchor.startsWith(`${prefix}-`)) {
        problems.push(
          `${link.raw} — label "${link.label}" should point at an anchor starting with "${prefix}", but got "#${anchor}"`,
        );
      }
    }
    if (problems.length > 0) {
      expect.fail(`[${label}] ${problems.length} link problem(s):\n${problems.join("\n")}`);
    }
  });

  it("examples table lists exactly the files under packages/examples/features/", () => {
    const rows = exampleRows(index, label);
    // Symmetric with the code table's duplicate check below: a repeated
    // filename would silently collapse in exampleFileSet (Set) and in the
    // EN⇆JA sync's Object.fromEntries (last-wins), letting a stray extra row
    // pass unnoticed.
    const files = rows.map((r) => r.file);
    expect(new Set(files).size, `[${label}] duplicate rows in the index examples table`).toBe(
      files.length,
    );
    const onDisk = new Set(readdirSync(featuresDir).filter((f) => f.endsWith(".kumiki")));
    const { onlyA, onlyB } = symmetricDiff(onDisk, exampleFileSet(index, label));
    const msgs: string[] = [];
    if (onlyA.length > 0) {
      msgs.push(
        `[${label}] on disk but missing from the index examples table: ${onlyA.join(", ")} — add a row.`,
      );
    }
    if (onlyB.length > 0) {
      msgs.push(
        `[${label}] listed in the index but not on disk: ${onlyB.join(", ")} — drop the row (or restore the example).`,
      );
    }
    if (msgs.length > 0) expect.fail(msgs.join("\n"));
    // Extraction-integrity floor for the Spec column: cellSignature falls back
    // to the raw cell when no link matches, so a mangled table row (or a
    // uniformly empty Spec cell) would collapse both EN and JA to the same
    // empty signature and silently pass the sync check. Require each Spec cell
    // to carry at least one ./doc.md link.
    const specless = rows.filter((r) => !/\[[^\]]+\]\(\.\/[\w.-]+\.md/.test(r.spec));
    if (specless.length > 0) {
      expect.fail(
        `[${label}] examples rows have no ./doc.md link in the Spec column: ${specless.map((r) => r.file).join(", ")}`,
      );
    }
  });

  it("code table lists exactly the (code, kind) pairs errors.md documents", () => {
    const inIndex = codeKindSignature(index, label);
    const inErrors = errorsMdCodeKinds(dir);
    expect(new Set(inIndex).size, `[${label}] duplicate rows in the index code table`).toBe(
      inIndex.length,
    );
    const { onlyA, onlyB } = symmetricDiff(new Set(inErrors), new Set(inIndex));
    const msgs: string[] = [];
    if (onlyA.length > 0) {
      msgs.push(
        `[${label}] documented in errors.md but missing from (or mislabeled in) the index code table: ${onlyA.join(", ")}.`,
      );
    }
    if (onlyB.length > 0) {
      msgs.push(
        `[${label}] present in the index code table but not matching an errors.md heading: ${onlyB.join(", ")}.`,
      );
    }
    if (msgs.length > 0) expect.fail(msgs.join("\n"));
  });

  it("layer columns name real layers, and the feature vocabulary is consistent", () => {
    const badLayers: string[] = [];
    for (const r of codeRows(index, label)) {
      if (!LAYERS.has(r.layer)) badLayers.push(`code ${r.code}: layer "${r.layer}"`);
    }
    for (const r of exampleRows(index, label)) {
      for (const l of r.layers) {
        if (!LAYERS.has(l)) badLayers.push(`example ${r.file}: layer "${l}"`);
      }
    }
    if (badLayers.length > 0) {
      expect.fail(`[${label}] unknown layer name(s): ${badLayers.join("; ")}`);
    }
    // The Feature columns are free text per language; require the code and
    // example tables to draw from the same vocabulary so a typo introduces a
    // singleton that shows up as an asymmetry here.
    const codeFeatures = new Set(codeRows(index, label).map((r) => r.feature));
    const exampleFeatures = new Set(exampleRows(index, label).map((r) => r.feature));
    const { onlyA, onlyB } = symmetricDiff(codeFeatures, exampleFeatures);
    if (onlyA.length > 0 || onlyB.length > 0) {
      expect.fail(
        `[${label}] feature vocabulary diverges — only in code table: [${onlyA.join(", ")}], only in examples table: [${onlyB.join(", ")}]`,
      );
    }
    // Every feature term must map to a language-neutral key. Unknown terms fail
    // fast here rather than silently splitting EN⇆JA comparisons downstream.
    for (const raw of [...codeFeatures, ...exampleFeatures]) normalizeFeature(raw, label);
  });
});

describe("spec index — EN ⇆ JA sync", () => {
  const en = read(tracks.en, "index.md");
  const ja = read(tracks.ja, "index.md");

  it("matrix grids agree (row order, per-cell targets and § labels)", () => {
    expect(matrixSignature(ja, "ja")).toEqual(matrixSignature(en, "en"));
  });

  it("code tables agree (code + kind sequence)", () => {
    expect(codeKindSignature(ja, "ja")).toEqual(codeKindSignature(en, "en"));
  });

  it("code tables agree on the layer of each code", () => {
    const layers = (md: string, label: string) =>
      codeRows(md, label).map((r) => `${r.code} ${r.kind} → ${r.layer}`);
    expect(layers(ja, "ja")).toEqual(layers(en, "en"));
  });

  it("code tables agree on the feature of each code", () => {
    const features = (md: string, label: string) =>
      codeRows(md, label).map((r) => `${r.code} ${r.kind} → ${normalizeFeature(r.feature, label)}`);
    expect(features(ja, "ja")).toEqual(features(en, "en"));
  });

  it("example file sets agree", () => {
    const { onlyA, onlyB } = symmetricDiff(exampleFileSet(en, "en"), exampleFileSet(ja, "ja"));
    if (onlyA.length > 0 || onlyB.length > 0) {
      expect.fail(
        `examples tables diverge — EN only: [${onlyA.join(", ")}], JA only: [${onlyB.join(", ")}]`,
      );
    }
  });

  // The three checks below key by filename (already pinned by "example file
  // sets agree") so the diff message names the offending example directly.
  it("examples tables agree on the layers of each file", () => {
    const layersByFile = (md: string, label: string) =>
      Object.fromEntries(
        exampleRows(md, label).map((r) => [r.file, [...r.layers].sort()] as const),
      );
    expect(layersByFile(ja, "ja")).toEqual(layersByFile(en, "en"));
  });

  it("examples tables agree on the feature of each file (normalized to language-neutral keys)", () => {
    const featureByFile = (md: string, label: string) =>
      Object.fromEntries(
        exampleRows(md, label).map((r) => [r.file, normalizeFeature(r.feature, label)] as const),
      );
    expect(featureByFile(ja, "ja")).toEqual(featureByFile(en, "en"));
  });

  it("examples tables agree on the spec link (doc + § label) of each file", () => {
    // cellSignature reduces each `[§X.Y](./doc.md#…)` to `doc.md:§X.Y`, so
    // link targets and § labels compare cleanly across tracks despite the
    // language-specific anchor slugs on each side.
    const specByFile = (md: string, label: string) =>
      Object.fromEntries(
        exampleRows(md, label).map((r) => [r.file, cellSignature(r.spec)] as const),
      );
    expect(specByFile(ja, "ja")).toEqual(specByFile(en, "en"));
  });
});
