// Every verb's exit code, asserted through a real process.
//
// An exit code is only honest when a shell can read it, so these spawn the CLI
// rather than calling the command functions — `process.exit` inside a command
// is exactly the thing under test. The convention the whole file encodes:
//
//   0  the verb did what it was asked
//   1  the verb ran and the operation failed (diagnostics remain, a name does
//      not resolve, a file is missing, a scenario is malformed)
//   2  the argument shape is wrong — decided before any work happens, so a `2`
//      never means "we looked at your program"
//
// The failure this guards against is silent: a verb that reports failure on
// stdout and exits 0 turns `kumiki fix --apply && next-step` into a pipeline
// that proceeds on a broken file.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(here, "../src/kumiki.ts");

// Each case pays for a node + tsx module load, not for compiler work.
const SPAWN = { timeout: 30_000 };

let dir: string;

function write(name: string, source: string): string {
  const file = join(dir, name);
  writeFileSync(file, source);
  return file;
}

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("npx", ["tsx", CLI_PATH, ...args], {
    stdio: "pipe",
    shell: true,
    encoding: "utf8",
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? 1 };
}

const CLEAN = `slot count : Int = 0
tile App = column(heading("Count: " + count.show))
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** `cnt` is a typo for `count`: one E0103, and `fix` has a repair branch for it. */
const FIXABLE = CLEAN.replace("count.show", "cnt.show");

/** A reducer bound to an event its target tile cannot fire — W0212, no errors. */
const WARN_ONLY = `slot count : Int = 0
reducer bump on=ui.focus(Card) do= count := count + 1
tile Card = box(heading("Count: " + count.show))
tile App = column(Card)
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** The warning above plus a repairable typo — the two must not interfere. */
const WARN_AND_FIXABLE = WARN_ONLY.replace("count.show", "cnt.show");

/** No `app`, so E0003 — a diagnostic `planFixes` has no repair branch for. */
const UNFIXABLE = `slot count : Int = 0
tile App = column(heading("Count: " + count.show))
`;

const WITH_TESTS = `slot count : Int = 0
reducer inc on=ui.click(IncBtn) do= count := count + 1
tile IncBtn = button(text="+1", onClick=inc)
tile App = column(heading("Count: " + count.show), IncBtn)
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test inc-works =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: IncBtn}}
        expect = {slots: {count: 1}, effects: []}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-exit-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("kumiki fix", () => {
  it("exits 1 in dry-run while the errors are still on disk", SPAWN, () => {
    const { stdout, code } = runCli(["fix", write("fix-dry.kumiki", FIXABLE)]);
    // The proposal is still printed — the exit code says the file is not fixed
    // yet, which is exactly what a dry run leaves behind.
    expect(stdout).toContain('replace "cnt" with "count"');
    expect(code).toBe(1);
  });

  it("exits 1 when nothing is repairable", SPAWN, () => {
    const { stdout, code } = runCli(["fix", write("fix-none.kumiki", UNFIXABLE)]);
    expect(stdout).toContain("(no auto-patches available)");
    expect(code).toBe(1);
  });

  it("exits 0 when --apply leaves the file clean", SPAWN, () => {
    const { stdout, code } = runCli(["fix", write("fix-apply.kumiki", FIXABLE), "--apply"]);
    expect(stdout).toContain("file now clean");
    expect(code).toBe(0);
  });

  it("exits 1 when --apply leaves errors behind", SPAWN, () => {
    // A second, unrepairable error alongside the repairable one: the patch
    // lands and the file is still broken, which is the case
    // `fix --apply && next-step` used to walk straight past.
    const file = write("fix-apply-partial.kumiki", `${FIXABLE}tile Orphan = column(zzz.show)\n`);
    const { stdout, code } = runCli(["fix", file, "--apply"]);
    expect(stdout).toContain("error(s) remain");
    expect(code).toBe(1);
  });

  it("exits 0 on a clean file", SPAWN, () => {
    const { stdout, code } = runCli(["fix", write("fix-clean.kumiki", CLEAN)]);
    expect(stdout).toBe("no errors\n");
    expect(code).toBe(0);
  });

  it("reports a warning-only file as clean rather than unrepairable", SPAWN, () => {
    // `check` calls this file `ok (1 warning)`. `fix` used to call the same
    // file `(no auto-patches available)` and list the warning as though it
    // were an error it had given up on.
    const { stdout, code } = runCli(["fix", write("fix-warn.kumiki", WARN_ONLY)]);
    expect(stdout).toBe("no errors\n");
    expect(code).toBe(0);
  });

  it("reports the parser's message when a patch breaks the file", SPAWN, () => {
    // The `}` inside the route string is what makes this reachable: the
    // missing-404 patch finds the end of the routes map by scanning for the
    // first `}`, so here it splices its entry into the middle of a string
    // literal and the result no longer parses. Nothing is written.
    //
    // A broken patch sets `regressionBlocked` too, so asking about the
    // rollback first told the reader the patch "would have introduced new
    // errors" and never that it had made the file unparseable.
    const src = `slot count : Int = 0
tile App = column(heading("Count: " + count.show))
app Demo
    caps   = []
    routes = {"/a}b" -> App}
    init   = []
`;
    const file = write("fix-breaks.kumiki", src);
    const { stdout, code } = runCli(["fix", file, "--apply"]);
    expect(stdout).toContain("fixes broke the file:");
    expect(stdout).not.toContain("rolled back");
    expect(readFileSync(file, "utf8")).toBe(src);
    expect(code).toBe(1);
  });

  it("holds --auto-patch to the same rule as the diagnostic path", SPAWN, () => {
    // The two halves of `fix` answer the same question and must answer it the
    // same way. A dry run here proposes a compile fix and leaves the file with
    // the error `check` exits 1 for, so this exits 1 too — and a test that
    // already passes exits 0 without anything to do.
    const blocked = `slot count : Int = 0
reducer inc on=ui.click(IncBtn) do= conut := count + 1
tile IncBtn = button(text="+1", onClick=inc)
tile App = column(heading("Count: " + count.show), IncBtn)
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test inc-works =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: IncBtn}}
        expect = {slots: {count: 1}, effects: []}
`;
    const dry = runCli(["fix", write("auto-dry.kumiki", blocked), "--auto-patch", "inc-works"]);
    expect(dry.stdout).toContain('replace "conut" with "count"');
    expect(dry.code).toBe(1);

    const passing = runCli([
      "fix",
      write("auto-ok.kumiki", WITH_TESTS),
      "--auto-patch",
      "inc-works",
    ]);
    expect(passing.code).toBe(0);
  });

  it("applies a patch to a file that also has a warning", SPAWN, () => {
    // The regression gate compares the diagnostics before and after the patch.
    // Counting the pre-existing warning on one side only makes it look newly
    // introduced, and the patch is rolled back for a warning it did not cause.
    const { stdout, code } = runCli([
      "fix",
      write("fix-warn-apply.kumiki", WARN_AND_FIXABLE),
      "--apply",
    ]);
    expect(stdout).toContain("file now clean");
    expect(code).toBe(0);
  });
});

describe("kumiki check", () => {
  it("unions the scope flags instead of keeping the first", SPAWN, () => {
    // `--types --refs` used to keep `--types` and silently drop the reference
    // errors the user named in the same command line.
    const src = `slot count : Int = "zero"
tile App = column(heading("Count: " + cnt.show))
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const { stderr, code } = runCli(["check", write("scope.kumiki", src), "--types", "--refs"]);
    expect(stderr).toContain("E0103");
    expect(stderr).toContain("E0201");
    expect(code).toBe(1);
  });

  it("still narrows when only one scope is given", SPAWN, () => {
    const src = `slot count : Int = 0
tile App = column(heading(count))
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const { stdout, code } = runCli(["check", write("scope-one.kumiki", src), "--refs"]);
    expect(stdout).toContain("ok");
    expect(code).toBe(0);
  });
});

describe("kumiki test", () => {
  it("fails when the filter matches nothing", SPAWN, () => {
    // A renamed test that no longer matches its CI filter is indistinguishable
    // from a passing suite unless this fails.
    const { stderr, code } = runCli(["test", write("test-filter.kumiki", WITH_TESTS), "nope*"]);
    expect(stderr).toContain('no tests match "nope*"');
    expect(code).toBe(1);
  });

  it("succeeds when a file simply has no tests", SPAWN, () => {
    // No filter, so nothing was asked for and nothing is missing.
    const { stdout, code } = runCli(["test", write("test-none.kumiki", CLEAN)]);
    expect(stdout).toContain("no tests found");
    expect(code).toBe(0);
  });
});

describe("kumiki refs / view", () => {
  it("fails on a qname that is not defined", SPAWN, () => {
    // "(no references)" for a name that does not exist reads as "safe to
    // delete" — the opposite of what a typo'd qname means.
    const { stderr, code } = runCli(["refs", write("refs.kumiki", CLEAN), "slot.nope"]);
    expect(stderr).toContain('Definition "slot.nope" not found');
    expect(code).toBe(1);
  });

  it("succeeds for a defined qname with no referrers", SPAWN, () => {
    const { stdout, code } = runCli(["refs", write("refs-ok.kumiki", CLEAN), "app.Demo"]);
    expect(stdout).toContain("(no references to app.Demo)");
    expect(code).toBe(0);
  });

  it("fails when --history names a file that does not exist", SPAWN, () => {
    const missing = join(dir, "not-here.kumiki");
    const { stderr, code } = runCli(["view", missing, "slot.count", "--history"]);
    expect(stderr).toContain(missing);
    expect(code).toBe(1);
  });

  it("succeeds when the file exists but has no history", SPAWN, () => {
    const { stdout, code } = runCli([
      "view",
      write("history.kumiki", CLEAN),
      "slot.count",
      "--history",
    ]);
    expect(stdout).toContain("(no history for slot.count)");
    expect(code).toBe(0);
  });
});

describe("kumiki list", () => {
  it("rejects a layer that is not one of the layers", SPAWN, () => {
    const { stderr, code } = runCli(["list", write("list.kumiki", CLEAN), "bogus"]);
    expect(stderr).toContain("bogus");
    // The message has to name the alternatives — the caller who typed `bogus`
    // has no other way to learn `motion` is a layer and `route` is not.
    expect(stderr).toContain("slot");
    expect(code).not.toBe(0);
  });

  it("succeeds for a real layer with no definitions in it", SPAWN, () => {
    const { stdout, code } = runCli(["list", write("list-empty.kumiki", CLEAN), "motion"]);
    expect(stdout.trim()).toBe("");
    expect(code).toBe(0);
  });
});

describe("argument shape", () => {
  it("prints a commander parse failure exactly once", SPAWN, () => {
    // Commander writes the diagnostic itself before throwing under
    // `exitOverride`, so a catch that re-prints it says everything twice.
    const { stderr, code } = runCli(["check", write("dup.kumiki", CLEAN), "--bogus"]);
    const hits = stderr.split("unknown option '--bogus'").length - 1;
    expect(hits).toBe(1);
    expect(stderr).toContain("Usage: kumiki check");
    expect(code).toBe(2);
  });

  it("exits 2 for a missing positional, before reading anything", SPAWN, () => {
    const { stderr, code } = runCli(["build", write("noout.kumiki", CLEAN)]);
    expect(stderr).toContain("Usage: kumiki build");
    expect(code).toBe(2);
  });
});

describe("kumiki run", () => {
  it("names the scenario file when it does not exist", SPAWN, () => {
    const missing = join(dir, "no-scenario.json");
    const { stderr, code } = runCli(["run", write("run-a.kumiki", CLEAN), missing]);
    expect(stderr).toContain(missing);
    expect(code).toBe(1);
  });

  it("names the scenario file when it is a directory", SPAWN, () => {
    const { stderr, code } = runCli(["run", write("run-b.kumiki", CLEAN), dir]);
    expect(stderr).toContain(dir);
    expect(code).toBe(1);
  });

  it("names the scenario file when the JSON is malformed", SPAWN, () => {
    const bad = write("bad.json", "{ not json");
    const { stderr, code } = runCli(["run", write("run-c.kumiki", CLEAN), bad]);
    expect(stderr).toContain(bad);
    expect(code).toBe(1);
  });

  it("says what a scenario document must contain", SPAWN, () => {
    // `{}` used to reach the runner and die on `scenario.steps is not
    // iterable` — a TypeError from inside the runtime for a document problem
    // the CLI could name.
    const empty = write("empty.json", "{}");
    const { stderr, code } = runCli(["run", write("run-d.kumiki", CLEAN), empty]);
    expect(stderr).toContain(empty);
    expect(stderr).toContain("steps");
    expect(code).toBe(1);
  });

  it("runs a well-formed scenario", SPAWN, () => {
    const scenario = write("ok.json", JSON.stringify({ steps: [{ expect: { noErrors: true } }] }));
    const { stdout, code } = runCli(["run", write("run-e.kumiki", CLEAN), scenario]);
    expect(stdout).toContain("scenario passed");
    expect(code).toBe(0);
  });
});
