// Every link under docs/ that names somewhere in this tree has to land: the
// page it names must exist, and a `#fragment` must name a heading id VitePress
// actually emits. `ignoreDeadLinks: false` in the VitePress config only covers
// the page half — a fragment that matches no heading builds and deploys clean,
// and the reader is dropped at the top of the page instead of at the section
// the sentence promised them. Same-page `[x](#anchor)` links are not checked by
// VitePress at all: its link plugin skips `#`-prefixed hrefs before they reach
// the dead-link pass.
//
// spec-index.test.ts used to run the anchor check, for the links inside
// `index.md` alone. Every other link in the tree was unchecked, including the
// ones in the guide — which is why this walk starts at the VitePress source
// root instead of at the two spec folders.
//
// Anchors come from VitePress' own `createMarkdownRenderer`, built out of
// `resolveConfig()`, so `{#id}` overrides, the duplicate-id suffix, and any
// `markdown.anchor.slugify` added later all come from the same code path that
// ships anchors to production. There is no second slugify implementation here
// to drift out of step with the site.
//
// One trap is worth naming, because nothing on screen reveals it. VitePress
// slugifies with `.normalize("NFKD")` and then strips only U+0300–U+036F. A
// dakuten kana decomposes to base + U+3099, outside that range, so it survives
// into the id decomposed. A fragment typed in an editor comes out composed and
// does not match; a fragment stored decomposed does — links in this tree rely
// on that. Since the two spellings are indistinguishable on screen, a new link
// should name an explicit `{#ascii-anchor}` on the heading instead. The last
// two tests pin both halves of that.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer, type MarkdownRenderer, resolveConfig } from "vitepress";
import { beforeAll, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..", "..", "docs");

/** Docs-relative and forward-slashed, so a message reads the same on every OS. */
const show = (absolute: string): string => relative(docsRoot, absolute).split(sep).join("/");

// Extraction-integrity floors, in the spirit of MIN_LINKS in spec-index.test.ts:
// if the walk or one of the regexes breaks, the collected set collapses toward
// empty and every check below passes over nothing.
//
// The floor is per content area rather than a single total, because a whole
// directory is the unit that goes missing — a name added to NEVER_WALKED, a bug
// in the recursion. Of the 46 documents in the tree today, 16 are the two guide
// folders and 4 more (the two READMEs, the changelog, a design note) contain no
// links at all, so a single total set below the survivors would sail through
// exactly the regression that widening this walk to the guide was meant to
// prevent.
const AREAS = ["spec", "ja/spec", "guide", "ja/guide"];
const MIN_DOCS_PER_AREA = 5;
const MIN_LINKS = 500;
const MIN_ANCHORED_LINKS = 300;

// Directory names the walk never enters: VitePress' own config, theme and
// caches; installed packages; static assets; turbo's scratch output. None holds
// Markdown a reader can navigate to.
const NEVER_WALKED = new Set([".vitepress", ".turbo", "node_modules", "public"]);

function markdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!NEVER_WALKED.has(entry)) markdownFiles(path, acc);
    } else if (entry.endsWith(".md")) {
      acc.push(path);
    }
  }
  return acc;
}

// Lines outside fenced code blocks, numbered from 1. A link written inside a
// fence is sample text — VitePress renders it verbatim and no reader can click
// it — so checking it would fail examples that are deliberately illustrative.
// The closing-fence rule is CommonMark's: same character, at least as long as
// the opener, so a 3-backtick line inside a 4-backtick fence does not close it.
function* proseLines(md: string): Generator<[number, string]> {
  let fence: { char: string; len: number } | null = null;
  let lineNo = 0;
  for (const line of md.split(/\r?\n/)) {
    lineNo += 1;
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      const marker = defined(m[1], "the fence marker just matched");
      const char = marker.slice(0, 1);
      if (fence === null) fence = { char, len: marker.length };
      else if (char === fence.char && marker.length >= fence.len) fence = null;
      continue;
    }
    if (fence === null) yield [lineNo, line];
  }
}

interface DocLink {
  /** Absolute path of the document the link was written in. */
  file: string;
  line: number;
  label: string;
  /** The destination exactly as written: `./errors.md`, `../guide/`, `#anchor`. */
  target: string;
  /** Absolute path of the document the link lands in — the file itself, for `#anchor`. */
  path: string;
  anchor: string | null;
  raw: string;
}

const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Destinations that are files to download or display rather than pages to read.
const ASSET = /\.(svg|png|jpe?g|gif|webp|ico|json|ts|js|mjs|cjs|css|kumiki|zip)$/i;

/**
 * The document a destination lands in, or null if it is not a page in this tree.
 *
 * Three shapes reach here, and all three are checked: `./doc.md` inside the
 * spec, `../guide/` and `/guide/playground` in prose (VitePress serves those
 * with `cleanUrls`), and `#anchor` for a link into the same page. Excluding the
 * extensionless pair would leave the cross-track and sibling-form tests below
 * with nothing to say about the only two links that could violate them.
 */
function landingPage(file: string, destination: string): string | null {
  if (destination.startsWith("#")) return file;
  if (ASSET.test(destination)) return null;
  const from = destination.startsWith("/") ? docsRoot : dirname(file);
  const path = resolve(from, destination.startsWith("/") ? destination.slice(1) : destination);
  if (destination.endsWith(".md")) return path;
  return destination.endsWith("/") ? join(path, "index.md") : `${path}.md`;
}

function collectLinks(file: string): DocLink[] {
  const links: DocLink[] = [];
  for (const [line, text] of proseLines(readFileSync(file, "utf8"))) {
    for (const m of text.matchAll(MD_LINK)) {
      const target = defined(m[2], "the link destination just matched");
      if (HAS_SCHEME.test(target)) continue;
      const hash = target.indexOf("#");
      const page = landingPage(file, hash <= 0 ? target : target.slice(0, hash));
      if (page === null) continue;
      links.push({
        file,
        line,
        label: defined(m[1], "the link label just matched"),
        target,
        path: page,
        anchor: hash === -1 ? null : target.slice(hash + 1),
        raw: m[0],
      });
    }
  }
  return links;
}

/**
 * The anchor a §-section or diagnostic-code label commits to, derived from the
 * label alone: `§1.3` → `_1-3`, `E0206` → `e0206`, `E02xx` → `e02xx`. Any other
 * shape (a prose label, a localized doc title) returns null and is exempt.
 */
function expectedAnchorPrefix(label: string): string | null {
  const section = label.match(/^§([\d.]+)$/);
  if (section) return `_${defined(section[1], "the § number").replace(/\./g, "-")}`;
  const code = label.match(/^([EW]\d{2}(?:\d{2}|xx))$/);
  if (code) return defined(code[1], "the diagnostic code").toLowerCase();
  return null;
}

/** The half of the tree a path belongs to. Japanese pages all live under `ja/`. */
const trackOf = (path: string): "en" | "ja" =>
  show(path).startsWith("ja/") || show(path) === "README.ja.md" ? "ja" : "en";

/** Whether a path is one of the two flat spec folders. */
const inSpecFolder = (path: string): boolean => /^(ja\/)?spec\/[^/]+$/.test(show(path));

let renderer: MarkdownRenderer;
let files: string[] = [];
let links: DocLink[] = [];
/** Heading ids per document, filled only for documents some fragment aims at. */
const anchors = new Map<string, Set<string>>();

function headingIds(md: string): Set<string> {
  return new Set(
    [...renderer.render(md).matchAll(/<h[1-6][^>]*\bid=["']([^"']+)["']/g)].map((m) =>
      defined(m[1], "the heading id just matched"),
    ),
  );
}

beforeAll(async () => {
  const config = await resolveConfig(docsRoot);
  // Shiki has no `kumiki` grammar registered on a raw MarkdownRenderer — that
  // only happens through the full VitePress pipeline — so it warns once per
  // fenced block. Drop those and let everything else through: an unresolved
  // plugin or a broken `{#id}` override has to be visible, or the only symptom
  // would be a flood of misleading "no heading with that id".
  const logger = {
    warn: (msg: string) => {
      if (!/language.*kumiki.*is not loaded/i.test(msg)) console.warn(msg);
    },
  };
  // One renderer for the whole tree: `docsRoot` is VitePress' own source root,
  // so this is the configuration the site is built with, locales included.
  renderer = defined(
    await createMarkdownRenderer(docsRoot, config.markdown, config.site.base, logger),
    "the MarkdownRenderer VitePress builds for the docs root",
  );
  files = markdownFiles(docsRoot);
  links = files.flatMap(collectLinks);
  // Render only the documents a fragment actually aims at — Shiki highlights
  // every fenced block, which is most of the cost of this file.
  for (const link of links) {
    if (link.anchor === null || anchors.has(link.path)) continue;
    if (!files.includes(link.path)) continue;
    anchors.set(link.path, headingIds(readFileSync(link.path, "utf8")));
  }
}, 60_000);

describe("links under docs/", () => {
  it("finds enough documents and links for the checks below to mean anything", () => {
    for (const area of AREAS) {
      const inArea = files.filter((f) => show(f).startsWith(`${area}/`));
      expect(inArea.length, `documents found under ${area}/`).toBeGreaterThanOrEqual(
        MIN_DOCS_PER_AREA,
      );
    }
    expect(links.length).toBeGreaterThanOrEqual(MIN_LINKS);
    expect(links.filter((l) => l.anchor !== null).length).toBeGreaterThanOrEqual(
      MIN_ANCHORED_LINKS,
    );
  });

  it("every link names a page that exists", () => {
    // Compared against the walked set rather than asked of the filesystem: a
    // link that differs only in case resolves on Windows and 404s on the Linux
    // box that builds the site, and only an exact comparison catches that here.
    const known = new Set(files);
    const problems = links
      .filter((l) => !known.has(l.path))
      .map((l) => `${show(l.file)}:${l.line}: ${l.raw} — ${show(l.path)} does not exist`);
    if (problems.length > 0) {
      expect.fail(`${problems.length} dead link(s):\n${problems.join("\n")}`);
    }
  });

  it("every document a fragment aims at yields at least one heading id", () => {
    // The regex above accepts either quoting style, so what this floor catches
    // is a change in the shape of the emitted heading — the id moving onto a
    // child anchor, or off the element entirely. Without it every set collapses
    // to empty and the next test reports "no such heading" for every link in
    // the tree instead of naming the one thing that broke.
    const empty = [...anchors].filter(([, ids]) => ids.size === 0).map(([path]) => show(path));
    if (empty.length > 0) {
      expect.fail(
        `extracted 0 heading ids from: ${empty.join(", ")} — the <h…> id regex likely broke`,
      );
    }
  });

  it("every fragment names a heading that document emits", () => {
    const problems: string[] = [];
    for (const link of links) {
      if (link.anchor === null) continue;
      const ids = anchors.get(link.path);
      if (!ids) continue; // the dead-link test above already owns this one
      if (ids.has(link.anchor)) continue;
      // A composed fragment against a decomposed id is the dakuten trap. Say so
      // where it applies, since "no such heading" reads as a typo and the two
      // spellings are indistinguishable in an editor.
      const decomposed = [...ids].find(
        (id) => id.normalize("NFC") === link.anchor?.normalize("NFC"),
      );
      problems.push(
        `${show(link.file)}:${link.line}: ${link.raw} — ${
          decomposed
            ? `Unicode normalization mismatch. The id is decomposed (#${decomposed}); give the heading an explicit {#ascii-anchor} and link to that instead`
            : "no heading with that id"
        }`,
      );
    }
    if (problems.length > 0) {
      expect.fail(`${problems.length} unresolved fragment(s):\n${problems.join("\n")}`);
    }
  });

  it("a link labelled with a § or a diagnostic code points at that section", () => {
    const problems: string[] = [];
    for (const link of links) {
      const prefix = expectedAnchorPrefix(link.label);
      if (prefix === null) continue;
      // No fragment at all is the purest form of what this test is named for:
      // a label naming one section, dropping the reader at the top of a file
      // that documents a hundred of them.
      if (link.anchor === null) {
        problems.push(
          `${show(link.file)}:${link.line}: ${link.raw} — label "${link.label}" names a section but the link has no fragment`,
        );
        continue;
      }
      if (link.anchor === prefix || link.anchor.startsWith(`${prefix}-`)) continue;
      problems.push(
        `${show(link.file)}:${link.line}: ${link.raw} — label "${link.label}" promises an anchor starting with "${prefix}"`,
      );
    }
    if (problems.length > 0) {
      expect.fail(`${problems.length} mislabelled link(s):\n${problems.join("\n")}`);
    }
  });

  it("a spec document reaches its siblings with the ./doc.md form", () => {
    // Each spec track is a flat folder. `./doc.md` is the only shape that
    // cannot leave it, so holding sibling links to it is what makes "a spec
    // page never sends a reader into the other language" structural rather
    // than a thing someone has to remember. Links that leave the folder —
    // the index pointing at `../guide/` — are a different destination and
    // are covered by the cross-track test instead.
    const problems = links
      .filter((l) => inSpecFolder(l.file) && inSpecFolder(l.path) && l.path !== l.file)
      .filter((l) => !/^\.\/[\w.-]+\.md$/.test(l.target.split("#")[0] ?? l.target))
      .map((l) => `${show(l.file)}:${l.line}: ${l.raw}`);
    if (problems.length > 0) {
      expect.fail(`${problems.length} spec link(s) not in ./doc.md form:\n${problems.join("\n")}`);
    }
  });

  it("no link crosses between the English and Japanese trees", () => {
    const problems = links
      .filter((l) => trackOf(l.file) !== trackOf(l.path))
      .map(
        (l) =>
          `${show(l.file)}:${l.line}: ${l.raw} — ${trackOf(l.file)} page linking into the ${trackOf(l.path)} tree`,
      );
    if (problems.length > 0) {
      expect.fail(`${problems.length} cross-track link(s):\n${problems.join("\n")}`);
    }
  });

  it("no reference-style link definitions, which the inline scan cannot see", () => {
    // `[label]: ./doc.md#anchor` on its own line is valid Markdown and invisible
    // to MD_LINK. Rather than grow a second parser, keep the tree to the one
    // form — the whole corpus is written that way already.
    const problems: string[] = [];
    for (const file of files) {
      for (const [line, text] of proseLines(readFileSync(file, "utf8"))) {
        if (/^\s{0,3}\[[^\]]+\]:\s*\S*\.md/.test(text)) {
          problems.push(`${show(file)}:${line}: ${text.trim()}`);
        }
      }
    }
    if (problems.length > 0) {
      expect.fail(
        `${problems.length} reference-style link definition(s) — rewrite as [label](./doc.md#anchor):\n${problems.join("\n")}`,
      );
    }
  });
});

// U+3099 COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK — what NFKD splits ダ into.
// U+309A is its handakuten counterpart, which パ decomposes to.
const VOICED_MARKS = [String.fromCodePoint(0x3099), String.fromCodePoint(0x309a)];
const carriesVoicedMark = (text: string): boolean =>
  VOICED_MARKS.some((mark) => text.normalize("NFD").includes(mark));
const isAscii = (text: string): boolean => [...text].every((ch) => (ch.codePointAt(0) ?? 0) < 0x80);

describe("the voiced-kana anchor trap", () => {
  it("VitePress still emits a decomposed id, so a composed fragment cannot match it", () => {
    const ids = [...headingIds("## ダークモード\n")];
    const id = defined(ids[0], "the id VitePress emitted for a voiced-kana heading");
    expect(id.normalize("NFC")).toBe("ダークモード");
    expect(id, "still decomposed").not.toBe(id.normalize("NFC"));
    expect(id).toContain(VOICED_MARKS[0]);
    // Going red here is not "the workaround is now optional": every link in the
    // tree that stores its fragment decomposed stops matching on the same day.
    // This is the check that would tell us, instead of the site quietly losing
    // a few dozen anchors.
  });

  it("a voiced-kana heading is reachable from another document through an ASCII anchor", () => {
    // Stated as an invariant rather than as one named pair, so a legitimate
    // rename of any section does not have to touch this file. What it holds
    // onto is that the convention stays exercised: writing the fragment
    // decomposed also works, so nothing else in the suite would notice if the
    // tree drifted back to spellings no one can proofread.
    const declared = new Set<string>();
    for (const file of files) {
      for (const [, text] of proseLines(readFileSync(file, "utf8"))) {
        const m = text.match(/^#{1,6}\s+(.*?)\s*\{#([^}]+)\}\s*$/);
        if (!m) continue;
        const [, heading, anchor] = [m[0], defined(m[1], "heading text"), defined(m[2], "anchor")];
        if (carriesVoicedMark(heading) && isAscii(anchor)) declared.add(`${show(file)}#${anchor}`);
      }
    }
    expect(declared.size, "headings with a voiced kana and an ASCII anchor").toBeGreaterThan(0);
    const reached = links.filter(
      (l) => l.path !== l.file && l.anchor !== null && declared.has(`${show(l.path)}#${l.anchor}`),
    );
    expect(
      reached.length,
      `no cross-document link names one of: ${[...declared].join(", ")}`,
    ).toBeGreaterThan(0);
  });
});
