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
// So the rule is mechanical: if a package ships test files, it declares a
// `typecheck` script, and the config that script runs contains every one of
// them. This test reads the packages off disk rather than from a list, so a new
// package — or a second test directory in an existing one — is covered the day
// it appears.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, "..");

/** Directories that hold generated or installed files, never sources. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "test-tmp",
  "test-results",
  "playwright-report",
  ".turbo",
  ".smoke-tmp",
]);

const isTestFile = (name: string): boolean =>
  name.endsWith(".test.ts") || name.endsWith(".spec.ts");

/** Compare paths the way both Windows and tsc's own output can agree on. */
const norm = (p: string): string => p.replace(/\\/g, "/").toLowerCase();

function collectTestFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectTestFiles(join(dir, entry.name), found);
    } else if (isTestFile(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

interface Pkg {
  readonly dir: string;
  readonly name: string;
  readonly typecheck: string | undefined;
  readonly testFiles: readonly string[];
}

function packages(): Pkg[] {
  const out: Pkg[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifest = join(dir, "package.json");
    try {
      statSync(manifest);
    } catch {
      continue;
    }
    const json: { name?: string; scripts?: Record<string, string> } = JSON.parse(
      readFileSync(manifest, "utf8"),
    );
    out.push({
      dir,
      name: json.name ?? entry.name,
      typecheck: json.scripts?.typecheck,
      testFiles: collectTestFiles(dir),
    });
  }
  return out;
}

/**
 * The tsconfig a `typecheck` script runs. `tsc -p x.json` names it; a bare
 * `tsc` uses `tsconfig.json`.
 */
function configOf(pkg: Pkg): string {
  const flag = pkg.typecheck?.match(/-p\s+(\S+)/);
  return join(pkg.dir, flag?.[1] ?? "tsconfig.json");
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

/**
 * The files `tsc -p <config>` would put in its program: as tsc writes them,
 * and lowercased for the comparisons that have to survive Windows. Only the
 * comparisons may use the lowercased form — a path handed back to git has to
 * keep the case the filesystem gave it, or a case-sensitive checkout reads it
 * as a path outside the repository.
 */
function programOf(configPath: string): { files: string[]; normed: Set<string> } {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, parseHost);
  if (!parsed) throw new Error(`could not read ${configPath}`);
  const fatal = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (fatal.length > 0) {
    throw new Error(
      `${configPath}: ${fatal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")}`,
    );
  }
  return { files: parsed.fileNames, normed: new Set(parsed.fileNames.map(norm)) };
}

/** The subset of `paths` that git does not track, as git itself reports it. */
function ignoredByGit(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: packagesDir,
    input: paths.map((p) => relative(packagesDir, p)).join("\n"),
    encoding: "utf8",
  });
  // 0 = some path is ignored, 1 = none is, anything else is git failing.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr || result.error}`);
  }
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

const withTests = packages().filter((p) => p.testFiles.length > 0);

describe("test files are typechecked", () => {
  it("finds the packages that ship tests", () => {
    // A floor, not a list: the point of reading from disk is that a new package
    // joins without an edit here, and the guard below still covers it. The
    // floor only catches a walk that has stopped walking.
    expect(withTests.length).toBeGreaterThanOrEqual(8);
  });

  it.each(
    withTests.map((p) => [p.name, p] as const),
  )("%s declares a typecheck script", (_, pkg) => {
    expect(pkg.typecheck, `${pkg.name} ships ${pkg.testFiles.length} test file(s)`).toBeDefined();
  });

  it.each(
    withTests.map((p) => [p.name, p] as const),
  )("%s typechecks every test file it ships", (_, pkg) => {
    const program = programOf(configOf(pkg));
    const missing = pkg.testFiles.filter((f) => !program.normed.has(norm(f)));
    expect(missing.map((f) => norm(f).slice(norm(packagesDir).length + 1))).toEqual([]);
  });

  it.each(
    withTests.map((p) => [p.name, p] as const),
  )("%s keeps generated fixtures out of its program", (_, pkg) => {
    // Several suites write fixtures under `test-tmp/` and git ignores them.
    // Inside a typecheck program they would make `pnpm typecheck` answer
    // differently depending on whether the suite had run first, so the
    // question asked here is git's: is any file of this package's own — its
    // installed dependencies aside — one that the repository does not track?
    const owned = programOf(configOf(pkg)).files.filter(
      (f) => norm(f).startsWith(`${norm(pkg.dir)}/`) && !norm(f).includes("/node_modules/"),
    );
    expect(ignoredByGit(owned)).toEqual([]);
  });
});
