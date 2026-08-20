// Mechanized guard for the READMEs that document this repository.
//
// Every command and cross-reference in the examples READMEs used to be written
// against the pre-monorepo layout (`examples/apps/…`, run from `packages/cli`),
// so all of them named a path that does not exist. Prose cannot be trusted to
// stay in step with a directory that gains an example on every bug report, so
// the rules below are the ones a reader relies on, stated as assertions:
//
//   1. shape — every app directory carries both language tracks, and the index
//      table in packages/examples/README*.md lists exactly those directories,
//      each row linking the app it names and stating its real line count.
//   2. links — every relative link resolves on disk, every anchor names a real
//      heading, and a label that is a file name agrees with what it points at.
//      Self-references must be relative: an absolute https://github.com/…/blob/…
//      link is unresolvable from a checkout, and is how the previous rot got in.
//      These rules cover the root README/CONTRIBUTING and every README under
//      packages/, not just the examples: the same layout change broke links in
//      packages/e2e, packages/icons and the root README, so a guard that stopped
//      at one directory would leave the rot living next door.
//   3. commands — one documented invocation form, `pnpm kumiki <verb> …` from
//      the repository root, whose verb the CLI registers and whose arguments
//      exist. A weaker rule — every `packages/…` path in any fenced block
//      exists — covers the documents that legitimately show another form.
//   4. EN ⇆ JA — the two tracks of one README run the same commands.
//   5. uniformity — every app README carries the same sections, so a reader who
//      has read one knows where to look in the next.
//   6. cache — every file these rules resolve to is one of the task's turbo
//      inputs, because a rule that reads a file outside them can be satisfied by
//      a cached run that never looked at it.
//
// Extraction is fail-loud rather than best-effort: an unterminated fence, a link
// form the regex does not understand, or a scan that stops matching fails a test
// instead of quietly shrinking the set every rule above is checked against.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const examplesPrefix = "packages/examples/";
const appsRoot = join(repoRoot, "packages", "examples", "apps");
const turboConfig = join(here, "turbo.json");

// The two language tracks every README ships in.
const EN = "README.md";
const JA = "README.ja.md";

// Comfortably under what the tree holds today (96 commands, 236 links across 41
// documents) and far above zero. There is deliberately no floor on the number
// of apps: `appDirs()` is a directory read, which throws when it is pointed at
// nothing, so it cannot collapse the way a regex can — and a floor there would
// turn deleting an example into a failure that blames a broken extractor.
const MIN_COMMANDS = 60;
const MIN_LINKS = 140;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function appDirs(): string[] {
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// Installed dependencies and build outputs carry READMEs that are not ours to
// keep in step, and descending into them is most of what this scan would cost.
const IGNORED_DIRS = new Set(["node_modules", "dist", ".smoke-tmp", "test-results", ".turbo"]);
const ROOT_DOCS = [EN, JA, "CONTRIBUTING.md", "CONTRIBUTING.ja.md"];

// Every document that describes this repository to a reader: the root pair and
// every README under packages/, recursively, so a package or example group that
// grows one is covered without editing a list here. Paths come back relative to
// the repository root, which is what the links inside them resolve against.
//
// docs/ is deliberately out of scope, and not because something else covers it:
// it is published through VitePress, where a rendered page cannot resolve
// `../../packages/examples/…`. Absolute URLs are the right form for that
// audience and the wrong one for a README, so rule 2 must not reach it.
function docFiles(): string[] {
  const out = ROOT_DOCS.filter((name) => existsSync(join(repoRoot, name)));
  const descend = (rel: string): void => {
    for (const entry of readdirSync(join(repoRoot, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) descend(`${rel}/${entry.name}`);
      } else if (entry.name === EN || entry.name === JA) {
        out.push(`${rel}/${entry.name}`);
      }
    }
  };
  descend("packages");
  return out.sort();
}

const inExamples = (file: string): boolean => file.startsWith(examplesPrefix);

// Walk a markdown file line by line, reporting whether each line sits inside a
// fenced code block. Links are read outside fences (a link in a code sample is
// sample text, not a reference); commands are read inside them. The closing
// fence must use the same character and be at least as long as the opening one,
// per CommonMark, so a 3-backtick line inside a 4-backtick fence does not close
// it early.
//
// An unterminated fence throws. Left alone it would mark every line to the end
// of the file as fenced, silently removing them from the link rules — and in a
// document outside packages/examples, where no commands are collected, nothing
// downstream would notice.
function* walk(file: string, md: string): Generator<{ line: string; inFence: boolean }> {
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
    yield { line, inFence: fence !== null };
  }
  if (fence !== null) throw new Error(`unterminated code fence in ${file}`);
}

interface Link {
  file: string;
  target: string;
  label: string;
  raw: string;
}

// Every markdown link outside a fenced block, in-page anchors and mailto:
// included — the rules below filter, so that what was collected can be compared
// against the number of `](` occurrences and a link form the regex does not
// understand fails loudly instead of vanishing.
function collectLinks(file: string, md: string): Link[] {
  const out: Link[] = [];
  for (const { line, inFence } of walk(file, md)) {
    if (inFence) continue;
    for (const m of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      out.push({ file, target: m[2], label: m[1], raw: m[0] });
    }
  }
  return out;
}

// `](` outside fences: one per link the syntax can express, including the forms
// collectLinks' regex does not match — a target carrying a title, a target with
// a space in it. Compared against the collected count below.
function countLinkOpenings(file: string, md: string): number {
  let n = 0;
  for (const { line, inFence } of walk(file, md)) {
    if (!inFence) n += line.split("](").length - 1;
  }
  return n;
}

const isRelative = (target: string): boolean =>
  !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(target);

interface Command {
  file: string;
  line: string;
  verb: string;
  args: string[];
}

// `pnpm kumiki …` invocations inside fenced blocks. A line qualifies when the
// CLI is one of its tokens — including the pre-monorepo `pnpm --filter
// @kumikijs/cli exec tsx src/kumiki.ts …` form, which rule 3 then rejects by
// name rather than skipping it as unrecognized.
//
// Requiring the token is what keeps `└── app.kumiki`, an `import App from
// "./app.kumiki"` sample, and the continuation half of a line ending in `\` out
// of the set: they mention the word but invoke nothing, and treating them as
// commands would fail the suite with a message blaming the invocation form.
function collectCommands(file: string, md: string): Command[] {
  const out: Command[] = [];
  for (const { line, inFence } of walk(file, md)) {
    if (!inFence) continue;
    const text = line.trim();
    if (text.startsWith("#")) continue;
    const tokens = text.split(/\s+/);
    const at = tokens.findIndex((t) => t === "kumiki" || t.endsWith("kumiki.ts"));
    if (at === -1) continue;
    out.push({ file, line: text, verb: tokens[at + 1] ?? "", args: tokens.slice(at + 2) });
  }
  return out;
}

// Repository paths named anywhere inside a fenced block, whatever the command
// around them. This is the rule that reaches the documents rule 3 cannot: the
// root README and packages/e2e both run examples, and packages/cli documents
// the installed-CLI form, so one invocation form cannot be imposed on all of
// them — but every path they show still has to exist.
function fencedPaths(file: string, md: string): string[] {
  const out: string[] = [];
  for (const { line, inFence } of walk(file, md)) {
    if (!inFence) continue;
    for (const token of line.trim().split(/\s+/)) {
      const path = token.replace(/[,;)"'`]+$/, "");
      if (!path.startsWith("packages/")) continue;
      // A placeholder or a glob stands for a path rather than naming one.
      if (/[<>*?]/.test(path)) continue;
      out.push(path);
    }
  }
  return out;
}

// The arguments that name something the command reads. A flag is not a path,
// and `./out` is not one either — it matches neither branch below, having no
// source extension and not living under packages/. Matching on "a source, a
// scenario, or a fixture" in addition to the `packages/` prefix keeps the check
// awake when a path is written against the wrong root, which is the failure
// this file exists for.
function inputPaths(command: Command): string[] {
  return command.args.filter(
    (a) => !a.startsWith("-") && (/\.(kumiki|json|jsonl)$/.test(a) || a.startsWith("packages/")),
  );
}

// The verbs the CLI answers to, read from the `.command("…")` calls that decide
// them. Reading the sources rather than importing is deliberate: kumiki.ts runs
// main() on import, so importing it from a test would execute the CLI.
function registeredVerbs(): Set<string> {
  const dir = join(repoRoot, "packages", "cli", "src", "commands");
  const verbs = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => [...read(join(dir, f)).matchAll(/\.command\(\s*"([\w-]+)"/g)].map((m) => m[1]));
  if (verbs.length < 15) {
    throw new Error(
      `read ${verbs.length} verbs out of packages/cli/src/commands — the .command("…") scan broke, so every command below would be called unknown`,
    );
  }
  return new Set(verbs);
}

function markedSection(md: string, name: string, file: string): string {
  const startTag = `<!-- ${name}:start -->`;
  const endTag = `<!-- ${name}:end -->`;
  const starts = md.split(startTag).length - 1;
  const ends = md.split(endTag).length - 1;
  if (starts !== 1 || ends !== 1) {
    throw new Error(
      `[${file}] expected exactly one <!-- ${name}:start/end --> pair, found ${starts} start / ${ends} end marker(s)`,
    );
  }
  const start = md.indexOf(startTag);
  const end = md.indexOf(endTag);
  if (end < start) throw new Error(`[${file}] <!-- ${name}:end --> precedes its start marker`);
  return md.slice(start, end);
}

interface AppRow {
  name: string;
  target: string | null;
  lines: number | null;
}

// Rows of the apps index: | [NN-name](./apps/NN-name/) | NN lines | takeaways |
function appRows(md: string, file: string): AppRow[] {
  const block = markedSection(md, "apps", file);
  const rows = block
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .slice(2)
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  return rows.map((cells) => {
    const link = cells[0]?.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
    return {
      name: link?.[1] ?? cells[0] ?? "?",
      target: link?.[2] ?? null,
      lines: Number.parseInt(cells[1] ?? "", 10) || null,
    };
  });
}

// Lines as `wc -l` counts them for a file that ends in a newline: the trailing
// newline ends the last line rather than starting an empty one. A file without
// a final newline counts one higher here than `wc -l` reports; every app.kumiki
// ends with one.
function lineCount(path: string): number {
  const lines = read(path).split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

// GitHub's heading slug, which is what a README's in-page anchors are resolved
// against by GitHub and by npm. Deliberately not VitePress' slugger, the one
// spec-index.test.ts borrows: VitePress emits `_4-8-icons` where GitHub emits
// `48-icons`, and a README is not rendered by VitePress.
function githubAnchors(md: string, file: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const { line, inFence } of walk(file, md)) {
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    const slug = m[1]
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    anchors.add(n === 0 ? slug : `${slug}-${n}`);
  }
  return anchors;
}

// A turbo input glob as a regular expression over repository-relative paths.
// Matching a path against the patterns beats expanding the patterns into a file
// set: `node:fs`'s globSync would do the latter, but it does not exist on the
// Node the CI workflow pins, and this is the whole vocabulary turbo.json uses.
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` spans any number of directories, including none.
        out += pattern[i + 2] === "/" ? "(?:[^/]+/)*" : ".*";
        i += pattern[i + 2] === "/" ? 2 : 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

// The cache inputs this task declares, as matchers. A rule that reads a file no
// pattern covers can be satisfied by a cached run that never looked at it — and
// the CI workflow restores .turbo, so that stale green is reachable there too,
// not only locally.
function declaredInputMatchers(): RegExp[] {
  const config = JSON.parse(read(turboConfig)) as { tasks: { test: { inputs: string[] } } };
  const patterns = config.tasks.test.inputs;
  if (patterns.length < 5) throw new Error("read too few inputs out of packages/tests/turbo.json");
  return (
    patterns
      // The package's own files, which no rule here resolves a link to.
      .filter((raw) => raw !== "$TURBO_DEFAULT$")
      .map((raw) =>
        globToRegExp(
          raw.startsWith("$TURBO_ROOT$/")
            ? raw.slice("$TURBO_ROOT$/".length)
            : `packages/tests/${raw}`,
        ),
      )
  );
}

const allDocs = docFiles();
const exampleReadmes = allDocs.filter(inExamples);
const allLinks = allDocs.flatMap((rel) => collectLinks(rel, read(join(repoRoot, rel))));
const relativeLinks = allLinks.filter((l) => isRelative(l.target));
// Commands are read from the examples only: those are the READMEs that teach
// the CLI, and they are the ones the single documented invocation form binds.
const allCommands = exampleReadmes.flatMap((rel) =>
  collectCommands(rel, read(join(repoRoot, rel))),
);

const targetOf = (link: Link): string =>
  resolve(repoRoot, dirname(link.file), link.target.split("#")[0]);

const bare = (label: string): string => label.replace(/`/g, "");

describe("READMEs — shape", () => {
  it("has enough extractable content for the guards to be meaningful", () => {
    expect(allLinks.length).toBeGreaterThanOrEqual(MIN_LINKS);
    expect(allCommands.length).toBeGreaterThanOrEqual(MIN_COMMANDS);
  });

  it("every app directory carries both language tracks", () => {
    const missing = appDirs().flatMap((name) =>
      [EN, JA].filter((f) => !existsSync(join(appsRoot, name, f))).map((f) => `apps/${name}/${f}`),
    );
    if (missing.length > 0) {
      expect.fail(`${missing.length} README(s) missing:\n${missing.join("\n")}`);
    }
  });

  it.each([EN, JA])("%s's index table lists exactly the apps on disk", (track) => {
    const rows = appRows(read(join(repoRoot, "packages", "examples", track)), track);
    const listed = rows.map((r) => r.name);
    expect(new Set(listed).size, `[${track}] duplicate rows in the apps table`).toBe(listed.length);
    expect(listed).toEqual(appDirs());
  });

  it.each([EN, JA])("%s's index table links each row to the app it names", (track) => {
    const problems = appRows(read(join(repoRoot, "packages", "examples", track)), track)
      .map((row) => {
        if (row.target === null) return `${row.name}: the row names an app but links nothing`;
        return row.target === `./apps/${row.name}/`
          ? null
          : `${row.name}: the row links ${row.target}`;
      })
      .filter((p): p is string => p !== null);
    if (problems.length > 0) expect.fail(problems.join("\n"));
  });

  it.each([EN, JA])("%s's index table states each app's real size", (track) => {
    const problems = appRows(read(join(repoRoot, "packages", "examples", track)), track)
      .map((row) => {
        const actual = lineCount(join(appsRoot, row.name, "app.kumiki"));
        return row.lines === actual
          ? null
          : `${row.name}: table says ${row.lines ?? "?"} lines, app.kumiki has ${actual}`;
      })
      .filter((p): p is string => p !== null);
    if (problems.length > 0) expect.fail(problems.join("\n"));
  });

  // Exact equality, on purpose: a reader who has read one app README should
  // know where to look in the next, so a section is added to all eleven or to
  // none. Every shape is compared against every other rather than against a
  // chosen baseline, so adding a `00-…` app cannot silently redefine what the
  // rest are measured by.
  it("every app README carries the same sections", () => {
    const sections = (file: string) =>
      [...walk(file, read(join(repoRoot, file)))]
        .filter(({ line, inFence }) => !inFence && line.startsWith("## "))
        .map(({ line }) => line.slice(3).trim())
        .join(" / ");
    for (const track of [EN, JA]) {
      const shapes = new Map<string, string[]>();
      for (const name of appDirs()) {
        const shape = sections(`packages/examples/apps/${name}/${track}`);
        shapes.set(shape, [...(shapes.get(shape) ?? []), name]);
      }
      if (shapes.size > 1) {
        expect.fail(
          `[${track}] app READMEs disagree on their sections:\n${[...shapes]
            .map(([shape, apps]) => `  ${apps.join(", ")}: ${shape}`)
            .join("\n")}`,
        );
      }
    }
  });
});

describe("READMEs — links", () => {
  it("every link the markdown expresses is one the scan understands", () => {
    const problems = allDocs
      .map((rel) => {
        const md = read(join(repoRoot, rel));
        const expected = countLinkOpenings(rel, md);
        const actual = collectLinks(rel, md).length;
        return expected === actual ? null : `${rel}: ${expected} link opening(s), ${actual} parsed`;
      })
      .filter((p): p is string => p !== null);
    if (problems.length > 0) {
      expect.fail(
        `a link form the scan does not parse is invisible to every rule below:\n${problems.join("\n")}`,
      );
    }
  });

  it("every relative link resolves on disk", () => {
    const dead = relativeLinks.filter(
      (l) => l.target.split("#")[0] !== "" && !existsSync(targetOf(l)),
    );
    if (dead.length > 0) {
      expect.fail(
        `${dead.length} dead link(s):\n${dead.map((l) => `${l.file}: ${l.raw}`).join("\n")}`,
      );
    }
  });

  it("every anchor on a relative link names a heading in the file it points at", () => {
    const problems: string[] = [];
    for (const link of relativeLinks) {
      const [path, anchor] = link.target.split("#");
      if (!anchor || !path.endsWith(".md")) continue;
      const absolute = targetOf(link);
      if (!existsSync(absolute)) continue; // the dead-link rule above reports it
      if (!githubAnchors(read(absolute), path).has(anchor)) {
        problems.push(`${link.file}: ${link.raw}`);
      }
    }
    if (problems.length > 0) {
      expect.fail(`${problems.length} anchor(s) name no heading:\n${problems.join("\n")}`);
    }
  });

  // Narrow on purpose: a label that is a bare file name is claiming to be the
  // path, so the two have to agree. A label that names a package
  // (`@kumikijs/cli` → `./packages/cli/`) or carries prose is not.
  it("a link whose label is a file name points at that file", () => {
    const problems = relativeLinks
      .filter((l) => /^[\w./-]+\.(md|kumiki|json|ts)$/.test(bare(l.label)))
      .filter((l) => !l.target.split("#")[0].endsWith(bare(l.label)))
      .map((l) => `${l.file}: ${l.raw}`);
    if (problems.length > 0) {
      expect.fail(
        `${problems.length} link(s) label one file and point at another:\n${problems.join("\n")}`,
      );
    }
  });

  it("references into this repository are relative, not absolute GitHub URLs", () => {
    // The organisation is not pinned: this repository has moved orgs once, and
    // GitHub redirects the old paths, so a link under the previous owner would
    // work for a reader and be invisible to a rule that named only the current
    // one.
    const absolute = allLinks.filter((l) =>
      /^https?:\/\/(www\.)?github\.com\/[^/]+\/Kumiki\/(blob|tree)\//i.test(l.target),
    );
    if (absolute.length > 0) {
      expect.fail(
        `${absolute.length} self-reference(s) written as an absolute GitHub URL — a checkout cannot resolve those, and they pin a branch:\n${absolute
          .map((l) => `${l.file}: ${l.raw}`)
          .join("\n")}`,
      );
    }
  });
});

describe("READMEs — commands", () => {
  it("every command in the examples uses the documented invocation form", () => {
    const wrong = allCommands.filter((c) => !/^pnpm kumiki\b/.test(c.line));
    if (wrong.length > 0) {
      expect.fail(
        `${wrong.length} command(s) are not "pnpm kumiki <verb> …" run from the repository root:\n${wrong
          .map((c) => `${c.file}: ${c.line}`)
          .join("\n")}`,
      );
    }
  });

  // That form is a pnpm script, so it is only as real as the script.
  it("the repository root still defines the kumiki script the form invokes", () => {
    const pkg = JSON.parse(read(join(repoRoot, "package.json"))) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.kumiki;
    expect(script, 'the root package.json has no "kumiki" script').toBeDefined();
    expect(script).toContain("packages/cli/src/kumiki.ts");
  });

  it("every command names a verb the CLI registers", () => {
    const verbs = registeredVerbs();
    const unknown = allCommands.filter((c) => !verbs.has(c.verb));
    if (unknown.length > 0) {
      expect.fail(
        `${unknown.length} command(s) name a verb kumiki does not have:\n${unknown
          .map((c) => `${c.file}: ${c.verb}`)
          .join("\n")}`,
      );
    }
  });

  it("every path a command names exists, relative to the repository root", () => {
    const dead: string[] = [];
    for (const c of allCommands) {
      for (const arg of inputPaths(c)) {
        if (!existsSync(join(repoRoot, arg))) dead.push(`${c.file}: ${arg} (in "${c.line}")`);
      }
    }
    if (dead.length > 0) {
      expect.fail(
        `${dead.length} command argument(s) name a path that does not exist:\n${dead.join("\n")}`,
      );
    }
  });

  it("every repository path shown in a fenced block exists", () => {
    const dead: string[] = [];
    for (const rel of allDocs) {
      for (const path of fencedPaths(rel, read(join(repoRoot, rel)))) {
        if (!existsSync(join(repoRoot, path))) dead.push(`${rel}: ${path}`);
      }
    }
    if (dead.length > 0) {
      expect.fail(`${dead.length} path(s) shown in a code block do not exist:\n${dead.join("\n")}`);
    }
  });

  it("a command's paths belong to the example it documents", () => {
    const strays: string[] = [];
    for (const c of allCommands) {
      const dir = posix.dirname(c.file);
      // Only an app's own README is bound to its own files; the index README
      // one level up documents them all.
      if (!/^packages\/examples\/apps\/[^/]+$/.test(dir)) continue;
      for (const arg of inputPaths(c)) {
        if (!arg.startsWith(`${dir}/`)) strays.push(`${c.file}: ${arg}`);
      }
    }
    if (strays.length > 0) {
      expect.fail(
        `${strays.length} command(s) in an example's README point at a different example:\n${strays.join("\n")}`,
      );
    }
  });

  // Without this, the EN ⇆ JA comparison below is satisfied by two empty command
  // lists, and a `Run` block could be emptied in both tracks while the
  // section-shape rule — which only sees `## ` headings — stayed green.
  it("every app README documents how to run its app", () => {
    const silent = appDirs().flatMap((name) =>
      [EN, JA]
        .map((track) => `packages/examples/apps/${name}/${track}`)
        .filter((rel) => !allCommands.some((c) => c.file === rel)),
    );
    if (silent.length > 0) {
      expect.fail(`${silent.length} app README(s) show no command:\n${silent.join("\n")}`);
    }
  });

  it("the two language tracks of a README run the same commands", () => {
    const problems: string[] = [];
    for (const rel of exampleReadmes) {
      if (!rel.endsWith(EN)) continue;
      const ja = `${rel.slice(0, -EN.length)}${JA}`;
      if (!exampleReadmes.includes(ja)) {
        problems.push(`${rel}: has no ${JA} counterpart`);
        continue;
      }
      const lines = (f: string) => allCommands.filter((c) => c.file === f).map((c) => c.line);
      if (lines(rel).join("\n") !== lines(ja).join("\n")) {
        problems.push(`${rel}:\n  EN: ${lines(rel).join(" ; ")}\n  JA: ${lines(ja).join(" ; ")}`);
      }
    }
    if (problems.length > 0) expect.fail(`command blocks diverge:\n${problems.join("\n")}`);
  });
});

describe("READMEs — cache", () => {
  it("every file these rules resolve to is one of the task's turbo inputs", () => {
    const declared = declaredInputMatchers();
    const missing = new Set<string>();
    let covered = 0;
    for (const link of relativeLinks) {
      if (link.target.split("#")[0] === "") continue;
      const absolute = targetOf(link);
      // A directory outlives any single file, and turbo hashes files, so only
      // file targets can be pinned here.
      if (!existsSync(absolute) || statSync(absolute).isDirectory()) continue;
      const rel = relative(repoRoot, absolute).replace(/\\/g, "/");
      if (declared.some((m) => m.test(rel))) covered++;
      else missing.add(rel);
    }
    if (missing.size > 0) {
      expect.fail(
        `${missing.size} link target(s) sit outside packages/tests/turbo.json's inputs, so deleting one replays a cached green:\n${[
          ...missing,
        ]
          .sort()
          .join("\n")}`,
      );
    }
    // A matcher that accepted everything would pass this test by accepting
    // nothing to check; a matcher that accepted nothing would too, by finding
    // no targets at all.
    expect(covered).toBeGreaterThan(100);
  });
});
