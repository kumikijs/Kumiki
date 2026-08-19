// Mechanized guard for the READMEs that document this repository.
//
// Every command and cross-reference in those files used to be written against
// the pre-monorepo layout (`examples/apps/…`, run from `packages/cli`), so all
// of them named a path that does not exist. Prose cannot be trusted to stay in
// step with a directory that gains an example on every bug report, so the rules
// below are the ones a reader relies on, stated as assertions:
//
//   1. shape — every app directory carries both language tracks, and the index
//      table in packages/examples/README*.md lists exactly those directories,
//      with the line count each app actually has.
//   2. links — every relative link resolves on disk. Self-references must be
//      relative: an absolute https://github.com/…/blob/… link is unresolvable
//      from a checkout, and is how the previous rot got in. This rule covers
//      the root README/CONTRIBUTING and every README under packages/, not just
//      the examples: the same layout change broke links in packages/e2e,
//      packages/icons and the root README, so a guard that stopped at one
//      directory would leave the rot living next door.
//   3. commands — one documented invocation form, `pnpm kumiki <verb> …` from
//      the repository root (the form the root README and CLAUDE.md use), whose
//      verb the CLI registers and whose `packages/…` arguments exist.
//   4. EN ⇆ JA — the two tracks of one README run the same commands.
//
// Extraction floors (MIN_*) keep a broken regex from collapsing a set to empty
// and passing silently, the same guard spec-index.test.ts carries.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const examplesPrefix = "packages/examples/";
const appsRoot = join(repoRoot, "packages", "examples", "apps");

// The two language tracks every README ships in.
const EN = "README.md";
const JA = "README.ja.md";

// Comfortably under what the tree holds today (11 apps, 96 commands, 236
// links across 41 documents) and far above zero, so a broken extractor fails
// here instead of turning every rule below into a check on an empty set.
const MIN_APPS = 11;
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
// docs/ is left out on purpose — spec-index.test.ts already guards it.
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
function* walk(md: string): Generator<{ line: string; inFence: boolean }> {
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
}

interface Link {
  file: string;
  target: string;
  raw: string;
}

// Markdown links outside fenced blocks, minus in-page anchors and mailto:.
// External http(s) links are kept: rule 2 below rejects the ones that point
// back into this repository, which are the ones a checkout can resolve itself.
function collectLinks(file: string, md: string): Link[] {
  const out: Link[] = [];
  for (const { line, inFence } of walk(md)) {
    if (inFence) continue;
    for (const m of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const target = m[2];
      if (target.startsWith("#") || target.startsWith("mailto:")) continue;
      out.push({ file, target, raw: m[0] });
    }
  }
  return out;
}

interface Command {
  file: string;
  line: string;
  verb: string;
  args: string[];
}

// `pnpm kumiki …` invocations inside fenced blocks. A line is a command if it
// mentions the CLI at all — including the pre-monorepo `pnpm --filter
// @kumikijs/cli exec tsx src/kumiki.ts …` form, which rule 3 then rejects by
// name rather than skipping it as unrecognized.
function collectCommands(file: string, md: string): Command[] {
  const out: Command[] = [];
  for (const { line, inFence } of walk(md)) {
    if (!inFence) continue;
    const text = line.trim();
    if (!/\bkumiki\b/.test(text)) continue;
    if (text.startsWith("#")) continue;
    const tokens = text.split(/\s+/);
    const at = tokens.findIndex((t) => t === "kumiki" || t.endsWith("kumiki.ts"));
    out.push({
      file,
      line: text,
      verb: tokens[at + 1] ?? "",
      args: tokens.slice(at + 2),
    });
  }
  return out;
}

// The arguments that name something the command reads. An output directory
// (`./out`) is exempt because the command creates it; a flag is not a path.
// Keying on "a source, a scenario, or a fixture" rather than on the
// `packages/` prefix keeps the check from going quiet the moment a path is
// written against the wrong root — which is the failure this file exists for.
function inputPaths(command: Command): string[] {
  return command.args.filter(
    (a) => !a.startsWith("-") && (/\.(kumiki|json|jsonl)$/.test(a) || a.startsWith("packages/")),
  );
}

// The verbs the CLI registers, read from the one place that decides them:
// buildProgram() in packages/cli/src/kumiki.ts. Reading the source (rather than
// importing) is deliberate — kumiki.ts runs main() on import, so importing it
// from a test would execute the CLI.
function registeredVerbs(): Set<string> {
  const src = read(join(repoRoot, "packages", "cli", "src", "kumiki.ts"));
  const verbs = [...src.matchAll(/^\s*register(\w+)\(program\);/gm)].map((m) => m[1].toLowerCase());
  if (verbs.length < 15) {
    throw new Error(
      `read ${verbs.length} verbs out of buildProgram() — the register(...) scan broke, so every command below would be called unknown`,
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
  return rows.map((cells) => ({
    name: cells[0]?.match(/\[([^\]]+)\]/)?.[1] ?? cells[0] ?? "?",
    lines: Number.parseInt(cells[1] ?? "", 10) || null,
  }));
}

// Lines as `wc -l` counts them: a trailing newline ends the last line rather
// than starting an empty one.
function lineCount(path: string): number {
  const lines = read(path).split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

const allDocs = docFiles();
const exampleReadmes = allDocs.filter(inExamples);
const allLinks = allDocs.flatMap((rel) => collectLinks(rel, read(join(repoRoot, rel))));
// Commands are read from the examples only: those are the READMEs that teach
// the CLI, and they are the ones the single documented invocation form binds.
const allCommands = exampleReadmes.flatMap((rel) =>
  collectCommands(rel, read(join(repoRoot, rel))),
);

describe("examples READMEs — shape", () => {
  it("has enough extractable content for the guards to be meaningful", () => {
    expect(appDirs().length).toBeGreaterThanOrEqual(MIN_APPS);
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

  it("every app README follows the same section structure", () => {
    const sections = (md: string) =>
      md
        .split(/\r?\n/)
        .filter((l) => l.startsWith("## "))
        .map((l) => l.slice(3).trim());
    const problems: string[] = [];
    for (const track of [EN, JA]) {
      const shape = new Map<string, string[]>();
      for (const name of appDirs()) shape.set(name, sections(read(join(appsRoot, name, track))));
      const reference = shape.get(appDirs()[0]) ?? [];
      for (const [name, own] of shape) {
        if (own.join(" / ") !== reference.join(" / ")) {
          problems.push(`apps/${name}/${track}: [${own}] ≠ [${reference}]`);
        }
      }
    }
    if (problems.length > 0) {
      expect.fail(`app READMEs disagree on their sections:\n${problems.join("\n")}`);
    }
  });
});

describe("package READMEs — links", () => {
  it("every relative link resolves on disk", () => {
    const dead = allLinks
      .filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target))
      .filter((l) => {
        const path = l.target.split("#")[0];
        if (path === "") return false;
        return !existsSync(resolve(repoRoot, dirname(l.file), path));
      });
    if (dead.length > 0) {
      expect.fail(
        `${dead.length} dead link(s):\n${dead.map((l) => `${l.file}: ${l.raw}`).join("\n")}`,
      );
    }
  });

  it("references into this repository are relative, not absolute GitHub URLs", () => {
    const absolute = allLinks.filter((l) =>
      /^https?:\/\/(www\.)?github\.com\/kumikijs\/Kumiki\/(blob|tree)\//i.test(l.target),
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

describe("examples READMEs — commands", () => {
  it("every command uses the documented invocation form", () => {
    const wrong = allCommands.filter((c) => !/^pnpm kumiki\b/.test(c.line));
    if (wrong.length > 0) {
      expect.fail(
        `${wrong.length} command(s) are not "pnpm kumiki <verb> …" run from the repository root:\n${wrong
          .map((c) => `${c.file}: ${c.line}`)
          .join("\n")}`,
      );
    }
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

  it("a command's paths belong to the example it documents", () => {
    const strays: string[] = [];
    for (const c of allCommands) {
      const dir = posix.dirname(c.file);
      // Only an app's own README is bound to its own files; the index README
      // one level up documents them all.
      if (!/^packages\/examples\/apps\/[^/]+$/.test(dir)) continue;
      const own = `${dir}/`;
      for (const arg of inputPaths(c)) {
        if (!arg.startsWith(own)) strays.push(`${c.file}: ${arg}`);
      }
    }
    if (strays.length > 0) {
      expect.fail(
        `${strays.length} command(s) in an example's README point at a different example:\n${strays.join("\n")}`,
      );
    }
  });

  it("the two language tracks of a README run the same commands", () => {
    const problems: string[] = [];
    for (const rel of exampleReadmes) {
      if (!rel.endsWith(EN)) continue;
      const ja = rel.replace(new RegExp(`${EN}$`), JA);
      if (!exampleReadmes.includes(ja)) continue;
      const lines = (f: string) => allCommands.filter((c) => c.file === f).map((c) => c.line);
      if (lines(rel).join("\n") !== lines(ja).join("\n")) {
        problems.push(`${rel}:\n  EN: ${lines(rel).join(" ; ")}\n  JA: ${lines(ja).join(" ; ")}`);
      }
    }
    if (problems.length > 0) expect.fail(`command blocks diverge:\n${problems.join("\n")}`);
  });
});
