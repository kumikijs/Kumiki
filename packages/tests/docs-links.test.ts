// Every relative Markdown link under docs/ has to land somewhere real: the file
// it names must exist, and a `#fragment` must name a heading id VitePress
// actually emits. `ignoreDeadLinks: false` in the VitePress config only covers
// the page half — a fragment that matches no heading builds and deploys clean,
// and the reader is dropped at the top of the page instead of at the section
// the sentence promised them.
//
// spec-index.test.ts used to run the anchor check, for the links inside
// `index.md` alone. Every other cross-file link in the tree was unchecked, and
// 24 of them did not resolve — two of those in the guide, which is why this
// walk starts at the VitePress source root instead of at the two spec folders.
//
// Anchors come from VitePress' own `createMarkdownRenderer`, built out of
// `resolveConfig()`, so `{#id}` overrides, the duplicate-id suffix, and any
// `markdown.anchor.slugify` added later all come from the same code path that
// ships anchors to production. There is no second slugify implementation here
// to drift out of step with the site.
//
// The trap behind most of those 24: VitePress slugifies with
// `.normalize("NFKD")` and then strips only U+0300–U+036F. A dakuten kana
// decomposes to base + U+3099, which is outside that range, so it survives into
// the id in decomposed form while a hand-typed fragment is composed. The two
// never compare equal, so a Japanese heading carrying a voiced kana is
// unlinkable from another file unless the heading declares an explicit
// `{#ascii-anchor}`. The last two tests pin both halves of that.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer, type MarkdownRenderer, resolveConfig } from "vitepress";
import { beforeAll, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..", "..", "docs");
const jaSpec = join(docsRoot, "ja", "spec");

/** Docs-relative and forward-slashed, so a message reads the same on every OS. */
const show = (absolute: string): string => relative(docsRoot, absolute).split(sep).join("/");

// Extraction-integrity floors, in the spirit of MIN_LINKS in spec-index.test.ts:
// if the walk or one of the regexes breaks, the collected set collapses toward
// empty and every check below passes over nothing. Real content sits far above
// these — 46 documents and ~800 links at the time of writing.
const MIN_DOCS = 30;
const MIN_LINKS = 500;
const MIN_ANCHORED_LINKS = 300;

// Directories under the source root that are not content: VitePress' own config
// and theme, installed packages, build output.
const SKIPPED_DIRS = new Set([".vitepress", "node_modules", "dist", "cache", "public"]);

function markdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) markdownFiles(path, acc);
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
  /** The target exactly as written, e.g. `./errors.md` or `../spec/errors.md`. */
  target: string;
  /** Absolute path the target resolves to. */
  path: string;
  anchor: string | null;
  raw: string;
}

// `[label](target.md)` and `[label](target.md#anchor)`. A target carrying a
// scheme (https:, mailto:) names something outside this tree and is left alone;
// a target starting with `/` is site-absolute and resolves from the source root.
const MD_LINK = /\[([^\]]*)\]\(([^)\s]*?\.md)(#([^)\s]*))?\)/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function collectLinks(file: string): DocLink[] {
  const links: DocLink[] = [];
  for (const [line, text] of proseLines(readFileSync(file, "utf8"))) {
    for (const m of text.matchAll(MD_LINK)) {
      const target = defined(m[2], "the link target just matched");
      if (HAS_SCHEME.test(target)) continue;
      links.push({
        file,
        line,
        label: defined(m[1], "the link label just matched"),
        target,
        path: target.startsWith("/")
          ? join(docsRoot, target.slice(1))
          : resolve(dirname(file), target),
        anchor: m[4] ?? null,
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

let renderer: MarkdownRenderer;
let files: string[] = [];
let links: DocLink[] = [];
/** Heading ids per document, filled only for documents some fragment aims at. */
const anchors = new Map<string, Set<string>>();

function headingIds(md: string): Set<string> {
  // Match both quoting styles VitePress could plausibly emit. The current build
  // uses `id="…"`; a version bump swapping to single quotes must fail at the
  // empty-set floor below rather than silently yield nothing.
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
  // would be a flood of misleading "anchor does not exist".
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

describe("links between documents under docs/", () => {
  it("finds enough documents and links for the checks below to mean anything", () => {
    expect(files.length).toBeGreaterThanOrEqual(MIN_DOCS);
    expect(links.length).toBeGreaterThanOrEqual(MIN_LINKS);
    expect(links.filter((l) => l.anchor !== null).length).toBeGreaterThanOrEqual(
      MIN_ANCHORED_LINKS,
    );
  });

  it("every relative Markdown link names a file that exists", () => {
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
    // If the heading-id regex breaks against a VitePress render change, every
    // set collapses to empty and the next test reports "no such heading" for
    // every link in the tree. Naming the document here keeps the real cause in
    // front of whoever reads the failure.
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
      const prefix = link.anchor === null ? null : expectedAnchorPrefix(link.label);
      if (prefix === null || link.anchor === null) continue;
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
    // The spec is a flat folder per track. `./doc.md` is the only shape that
    // stays inside one track by construction, so a spec page can never quietly
    // send a reader into the other language.
    const problems = links
      .filter((l) => /^(ja\/)?spec\//.test(show(l.file)))
      .filter((l) => !/^\.\/[\w.-]+\.md$/.test(l.target))
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
const VOICED_MARK = String.fromCodePoint(0x3099);

describe("the voiced-kana anchor trap", () => {
  it("VitePress still emits a decomposed id, so a composed fragment cannot match it", () => {
    // The reason every Japanese heading another document links to carries an
    // explicit ASCII anchor. If VitePress ever composes its ids, this goes red
    // and says the workaround has become optional.
    const ids = [...headingIds("## ダークモード\n")];
    const id = defined(ids[0], "the id VitePress emitted for a voiced-kana heading");
    expect(id.normalize("NFC")).toBe("ダークモード");
    expect(id, "still decomposed").not.toBe(id.normalize("NFC"));
    expect(id).toContain(VOICED_MARK);
  });

  it("the dark-mode link resolves because the heading it names declares an ASCII anchor", () => {
    // One named pair, so the class stays covered by something a reader can
    // follow. The general fragment check above is what enforces it; this test
    // exists to keep a heading with a voiced kana among the linked-to set, which
    // an explicit anchor otherwise hides — once the id is ASCII, nothing in the
    // resolved data says a dakuten was ever involved.
    const link = links.find(
      (l) =>
        show(l.file) === "ja/spec/errors.md" &&
        show(l.path) === "ja/spec/style.md" &&
        l.anchor === "_4-6-dark-mode",
    );
    expect(link, "ja/spec/errors.md should link to ja/spec/style.md#_4-6-dark-mode").toBeDefined();
    const heading = defined(
      readFileSync(join(jaSpec, "style.md"), "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("#") && l.includes("{#_4-6-dark-mode}")),
      "the Japanese heading that declares the dark-mode anchor",
    );
    expect(heading.normalize("NFD"), "the heading text carries a voiced kana").toContain(
      VOICED_MARK,
    );
  });
});
