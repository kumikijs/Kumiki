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
//      heading anchor, computed with the same slugify VitePress uses.
//   2. index ⇆ examples — the examples table lists exactly the files under
//      packages/examples/features/ (symmetric difference = 0).
//   3. index ⇆ errors.md — the code table lists exactly the `### E/W` codes
//      errors.md documents.
//   4. EN ⇆ JA — both indices carry the same language-neutral structure
//      (matrix grid targets, code+kind sequence, example file set).

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

// Extraction-integrity floors (same idea as MIN_CODES in spec-drift.test.ts):
// if a regex or marker breaks, the affected set collapses toward empty and a
// symmetric-difference check could silently pass. Real content sits well above
// these floors.
const MIN_LINKS = 50;
const MIN_CODES = 30;
const MIN_EXAMPLES = 30;

function read(dir: string, file: string): string {
  return readFileSync(join(dir, file), "utf8");
}

// Heading → anchor set, mirroring the VitePress pipeline: headings outside
// fenced code blocks, explicit `{#id}` overrides, @mdit-vue/shared slugify,
// and markdown-it-anchor's `-1`, `-2`… suffixes for duplicate slugs.
function collectAnchors(md: string): Set<string> {
  const anchors = new Set<string>();
  const used = new Map<string, number>();
  let fence: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
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
  doc: string;
  anchor: string | null;
  raw: string;
}

function collectDocLinks(md: string): DocLink[] {
  const links: DocLink[] = [];
  for (const m of md.matchAll(/\]\(\.\/([\w.-]+\.md)(#([^)]+))?\)/g)) {
    links.push({ doc: m[1], anchor: m[3] ?? null, raw: m[0] });
  }
  return links;
}

function markedSection(md: string, name: string, label: string): string {
  const start = md.indexOf(`<!-- ${name}:start -->`);
  const end = md.indexOf(`<!-- ${name}:end -->`);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`[${label}] index is missing the <!-- ${name}:start/end --> markers`);
  }
  return md.slice(start, end);
}

function tableRows(block: string): string[][] {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  // Drop the header row and the |---| separator row.
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
  return tableRows(markedSection(md, "matrix", label)).map((cells) => cells.map(cellSignature));
}

// One entry per code row: "E0001 missing-404" (all backticked kinds joined).
function codesSignature(md: string, label: string): string[] {
  return tableRows(markedSection(md, "codes", label)).map((cells) => {
    const code = cells[0]?.match(/\[([EW]\d{4})\]/)?.[1] ?? "?";
    const kinds = [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]).join(" / ");
    return `${code} ${kinds}`;
  });
}

function exampleFiles(md: string, label: string): Set<string> {
  const block = markedSection(md, "examples", label);
  return new Set([...block.matchAll(/[\w][\w.-]*\.kumiki/g)].map((m) => m[0]));
}

function symmetricDiff(a: Set<string>, b: Set<string>): { onlyA: string[]; onlyB: string[] } {
  return {
    onlyA: [...a].filter((x) => !b.has(x)).sort(),
    onlyB: [...b].filter((x) => !a.has(x)).sort(),
  };
}

const CODE_HEADING_RE = /^### ([EW]\d{4})\b/;

function errorsMdCodes(dir: string): Set<string> {
  const codes = new Set<string>();
  let fence: string | null = null;
  for (const line of read(dir, "errors.md").split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = line.match(CODE_HEADING_RE);
    if (m) codes.add(m[1]);
  }
  return codes;
}

describe.each(Object.entries(tracks))("spec index (%s)", (label, dir) => {
  const index = read(dir, "index.md");

  it("has enough extractable content for the guards to be meaningful", () => {
    expect(collectDocLinks(index).length).toBeGreaterThan(MIN_LINKS);
    expect(codesSignature(index, label).length).toBeGreaterThan(MIN_CODES);
    expect(exampleFiles(index, label).size).toBeGreaterThan(MIN_EXAMPLES);
  });

  it("every ./doc.md#anchor link resolves to a real heading anchor", () => {
    const anchorCache = new Map<string, Set<string>>();
    const broken: string[] = [];
    for (const link of collectDocLinks(index)) {
      let anchors = anchorCache.get(link.doc);
      if (!anchors) {
        anchors = collectAnchors(read(dir, link.doc));
        anchorCache.set(link.doc, anchors);
      }
      if (link.anchor === null || anchors.has(link.anchor)) continue;
      // VitePress ids come out of slugify NFKD-decomposed (e.g. ド = ト +
      // U+3099), while editors usually type NFC. Anchors must match the id
      // byte-for-byte, so point the author at the canonical form.
      const anchor = link.anchor;
      const canonical = [...anchors].find((a) => a.normalize("NFC") === anchor.normalize("NFC"));
      broken.push(
        canonical
          ? `${link.raw} — Unicode normalization mismatch; use the NFKD form VitePress emits: #${canonical}`
          : link.raw,
      );
    }
    if (broken.length > 0) {
      expect.fail(
        `[${label}] ${broken.length} link(s) point at anchors that do not exist:\n${broken.join("\n")}`,
      );
    }
  });

  it("examples table lists exactly the files under packages/examples/features/", () => {
    const onDisk = new Set(readdirSync(featuresDir).filter((f) => f.endsWith(".kumiki")));
    const inIndex = exampleFiles(index, label);
    const { onlyA, onlyB } = symmetricDiff(onDisk, inIndex);
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
  });

  it("code table lists exactly the codes errors.md documents", () => {
    const inErrors = errorsMdCodes(dir);
    const inIndex = new Set(codesSignature(index, label).map((s) => s.split(" ")[0]));
    const { onlyA, onlyB } = symmetricDiff(inErrors, inIndex);
    const msgs: string[] = [];
    if (onlyA.length > 0) {
      msgs.push(
        `[${label}] documented in errors.md but missing from the index code table: ${onlyA.join(", ")}.`,
      );
    }
    if (onlyB.length > 0) {
      msgs.push(
        `[${label}] listed in the index code table but not documented in errors.md: ${onlyB.join(", ")}.`,
      );
    }
    if (msgs.length > 0) expect.fail(msgs.join("\n"));
  });
});

describe("spec index — EN ⇆ JA sync", () => {
  const en = read(tracks.en, "index.md");
  const ja = read(tracks.ja, "index.md");

  it("matrix grids agree (row order, per-cell targets and § labels)", () => {
    expect(matrixSignature(ja, "ja")).toEqual(matrixSignature(en, "en"));
  });

  it("code tables agree (code + kind sequence)", () => {
    expect(codesSignature(ja, "ja")).toEqual(codesSignature(en, "en"));
  });

  it("example file sets agree", () => {
    const { onlyA, onlyB } = symmetricDiff(exampleFiles(en, "en"), exampleFiles(ja, "ja"));
    if (onlyA.length > 0 || onlyB.length > 0) {
      expect.fail(
        `examples tables diverge — EN only: [${onlyA.join(", ")}], JA only: [${onlyB.join(", ")}]`,
      );
    }
  });
});
