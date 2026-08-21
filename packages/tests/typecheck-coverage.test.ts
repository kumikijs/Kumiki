// Every test file has to be inside a typechecked program.
//
// Vitest strips types without checking them, so a test file that no `tsc`
// invocation covers can go on compiling forever while its assertions stop
// meaning anything. The shape that motivated this guard:
//
//   expect(seen.filter((d) => d.kind === "stale-closure-risk")).toEqual([]);
//
// where `kind` no longer has that member. The filter is structurally empty, the
// test is green, and the contract it was written to hold goes unchecked. A
// typechecked test file reports that comparison as TS2367.
//
// So the rule is mechanical: if a workspace package ships test files, it
// declares a `typecheck` script, and the config that script runs contains every
// one of them.
//
// Both halves of "every" come from a tool rather than from a list here: pnpm
// enumerates the workspace (so `docs`, which is a package outside `packages/`,
// is covered), and git enumerates the test files (so a walk that stopped
// recursing cannot quietly shrink the set, and generated fixtures — untracked
// by definition — cannot swell it).

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

/** Compare paths the way both Windows and tsc's own output can agree on. */
const norm = (p: string): string => p.replace(/\\/g, "/").toLowerCase();

function capture(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: true });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.error}`);
  }
  return result.stdout;
}

interface Pkg {
  readonly dir: string;
  readonly name: string;
  readonly typecheck: string | undefined;
  testFiles: string[];
}

/** The workspace as pnpm resolves it, root entry aside. */
function workspacePackages(): Pkg[] {
  const listed: { name: string; path: string }[] = JSON.parse(
    capture("pnpm", ["list", "--recursive", "--depth", "-1", "--json"], repoRoot),
  );
  return listed
    .filter((entry) => norm(entry.path) !== norm(repoRoot))
    .map((entry) => {
      const json: { scripts?: Record<string, string> } = JSON.parse(
        readFileSync(join(entry.path, "package.json"), "utf8"),
      );
      return {
        dir: entry.path,
        name: entry.name,
        typecheck: json.scripts?.typecheck,
        testFiles: [],
      };
    });
}

/** Every test file the repository tracks, whichever extension it wears. */
function trackedTestFiles(): string[] {
  const patterns = ["ts", "tsx", "mts", "cts"].flatMap((ext) => [`*.test.${ext}`, `*.spec.${ext}`]);
  return capture("git", ["ls-files", "-z", ...patterns], repoRoot)
    .split("\0")
    .filter((line) => line.length > 0)
    .map((rel) => join(repoRoot, rel));
}

/**
 * The tsconfig a `typecheck` script runs.
 *
 * Anything this cannot read for certain is an error rather than a fall back to
 * `tsconfig.json`. A wrong guess is silent, and for `@kumikijs/tests` — whose
 * `tsconfig.json` carries the widest include in the repository — it would pass
 * while the config the script actually runs covered nothing.
 */
function configOf(pkg: Pkg): string {
  const script = pkg.typecheck?.trim();
  if (script === undefined) throw new Error(`${pkg.name} declares no typecheck script`);
  const refuse = (why: string): never => {
    throw new Error(
      `${pkg.name}: cannot tell which config "${script}" runs (${why}). Teach configOf the new shape rather than letting it fall back.`,
    );
  };
  const tokens = script.split(/\s+/);
  if (tokens[0] !== "tsc") refuse("not a bare tsc invocation");
  if (/[&|;]/.test(script)) refuse("more than one command");
  if (tokens.includes("-b") || tokens.includes("--build")) refuse("build mode reads its own graph");

  const named: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "-p" || token === "--project") {
      const value = tokens[i + 1];
      if (value === undefined || value.startsWith("-")) {
        refuse("-p with no config after it");
      } else {
        named.push(value);
        i++;
      }
    } else if (token.startsWith("--project=")) {
      named.push(token.slice("--project=".length));
    } else if (!token.startsWith("-")) {
      refuse("a file argument, which makes tsc ignore the config entirely");
    }
  }
  if (named.length > 1) refuse("more than one config");
  return join(pkg.dir, named[0] ?? "tsconfig.json");
}

const parseHost: ts.ParseConfigFileHost = {
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  },
};

function parseConfig(configPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, parseHost);
  if (!parsed) throw new Error(`could not read ${configPath}`);
  const fatal = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (fatal.length > 0) {
    throw new Error(
      `${configPath}: ${fatal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")}`,
    );
  }
  return parsed;
}

/**
 * The files `tsc -p <config>` would put in its program: as tsc writes them,
 * and lowercased for the comparisons that have to survive Windows. Only the
 * comparisons may use the lowercased form — a path handed back to git has to
 * keep the case the filesystem gave it, or a case-sensitive checkout reads it
 * as a path outside the repository.
 */
function programOf(configPath: string): { files: string[]; normed: Set<string> } {
  const files = parseConfig(configPath).fileNames;
  return { files, normed: new Set(files.map(norm)) };
}

/**
 * Directories a config excludes from its own tree, as `exclude: ["x/**"]`
 * entries. File-shaped exclusions (`src/dev/client.ts`) are not these.
 */
function excludedDirs(configPath: string): string[] {
  const raw: { exclude?: unknown } = parseConfig(configPath).raw ?? {};
  const entries = Array.isArray(raw.exclude) ? raw.exclude : [];
  return entries
    .filter((entry): entry is string => typeof entry === "string" && entry.endsWith("/**"))
    .map((entry) => join(dirname(configPath), entry.slice(0, -"/**".length)));
}

/**
 * The subset of `paths` a `.gitignore` rule matches, as git reports it.
 *
 * This asks about ignore rules, not about tracking: a generated file that no
 * rule happens to match is untracked, would make `pnpm typecheck` depend on
 * whether the suite had run, and is not caught here. Every generated tree in
 * this repository is ignored by name, so the two coincide today.
 */
function ignoredByGit(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: repoRoot,
    input: paths.map((p) => relative(repoRoot, p)).join("\n"),
    encoding: "utf8",
  });
  // 0 = some path is ignored, 1 = none is, anything else is git failing.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr || result.error}`);
  }
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

const allPackages = workspacePackages();
const allTestFiles = trackedTestFiles();

/** Longest-prefix wins, so a package nested inside another still claims its own. */
const ownerOf = (file: string): Pkg | undefined => {
  let owner: Pkg | undefined;
  for (const pkg of allPackages) {
    if (!norm(file).startsWith(`${norm(pkg.dir)}/`)) continue;
    if (!owner || pkg.dir.length > owner.dir.length) owner = pkg;
  }
  return owner;
};

const orphans: string[] = [];
for (const file of allTestFiles) {
  const owner = ownerOf(file);
  if (owner) owner.testFiles.push(file);
  else orphans.push(relative(repoRoot, file));
}

const withTests = allPackages.filter((p) => p.testFiles.length > 0);
const cases = withTests.map((p) => [p.name, p] as const);

describe("test files are typechecked", () => {
  // Floors, at today's counts rather than below them: `it.each([])` registers
  // zero tests and reports nothing at all, so an enumeration that came back
  // empty would leave this file silently green instead of red.
  it("finds every package that ships tests", () => {
    expect(withTests.length).toBeGreaterThanOrEqual(10);
  });

  it("finds every test file the repository tracks", () => {
    expect(allTestFiles.length).toBeGreaterThanOrEqual(123);
  });

  it("leaves no test file outside a workspace package", () => {
    // A test file somewhere pnpm does not know about is run by nobody and
    // checked by nobody — `packages/examples` has no manifest, so a
    // `.test.ts` dropped there would be exactly that.
    expect(orphans).toEqual([]);
  });

  it.each(cases)("%s declares a typecheck script", (_, pkg) => {
    expect(pkg.typecheck, `${pkg.name} ships ${pkg.testFiles.length} test file(s)`).toBeDefined();
  });

  it.each(cases)("%s typechecks every test file it ships", (_, pkg) => {
    const program = programOf(configOf(pkg));
    const missing = pkg.testFiles.filter((f) => !program.normed.has(norm(f)));
    expect(missing.map((f) => relative(repoRoot, f))).toEqual([]);
  });

  it.each(cases)("%s keeps generated fixtures out of its program", (_, pkg) => {
    // Several suites write fixtures under `test-tmp/` and git ignores them.
    // Inside a typecheck program they would make `pnpm typecheck` answer
    // differently depending on whether the suite had run first.
    //
    // A config's exclusions are only observable when there is something to
    // exclude, so each excluded directory gets a file for the duration of this
    // test. Without that, a fresh clone — where no suite has run yet — would
    // see an empty `test-tmp` and pass whether the exclusion was there or not.
    const config = configOf(pkg);
    const sentinels = excludedDirs(config).map((dir) => join(dir, "typecheck-coverage-probe.ts"));
    for (const sentinel of sentinels) {
      mkdirSync(dirname(sentinel), { recursive: true });
      writeFileSync(sentinel, "export const probe = true;\n");
    }
    try {
      const owned = programOf(config).files.filter(
        (f) => norm(f).startsWith(`${norm(pkg.dir)}/`) && !norm(f).includes("/node_modules/"),
      );
      // If the prefix match ever stops matching, `owned` empties and the
      // assertion below goes permanently, silently green.
      expect(owned.length).toBeGreaterThan(0);
      expect(ignoredByGit(owned).map((f) => f.replace(/\\/g, "/"))).toEqual([]);
    } finally {
      for (const sentinel of sentinels) rmSync(sentinel, { force: true });
    }
  });
});
