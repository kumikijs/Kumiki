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

// Each case pays for a node + tsx module load, not for compiler work, and the
// whole file is spawns — so the limits are generous enough to survive a
// saturated machine running the rest of the suite alongside it.
//
// The child gets its own: `spawnSync` blocks the worker's event loop, so a hung
// CLI cannot be interrupted by vitest's timeout — the run would stop rather
// than fail. The child's limit is the shorter one so it always fires first.
const CHILD_TIMEOUT_MS = 60_000;
const SPAWN = { timeout: 70_000 };

let dir: string;

function write(name: string, source: string): string {
  const file = join(dir, name);
  writeFileSync(file, source);
  return file;
}

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  // `node --import tsx` rather than `npx tsx`: same interpreter, without npm's
  // per-call resolution — which this file would pay for ~35 times.
  const res = spawnSync(process.execPath, ["--import", "tsx", CLI_PATH, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  // A process that never started, or one a signal killed, has `status: null`.
  // Folding that into 1 would make every `toBe(1)` in this file pass without
  // the CLI running at all, which is the one result a test about exit codes
  // must not accept.
  if (res.error) throw res.error;
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: res.status ?? Number.NaN,
  };
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
    // were an error it had given up on. The count travels with the verdict for
    // the same reason: a bare `no errors` from one verb and `ok (1 warning)`
    // from the other are two answers about a file neither of them will change.
    const { stdout, code } = runCli(["fix", write("fix-warn.kumiki", WARN_ONLY)]);
    expect(stdout).toBe("no errors (1 warning)\n");
    expect(code).toBe(0);
  });

  it("keeps a repair that clears an error and reveals a warning", SPAWN, () => {
    // `Crd` is undefined (E0211). The patch resolves it to `Card` — and a
    // `box` cannot fire `focus`, so W0212 appears where nothing was reported
    // before. The gate compares errors only, in both directions: rolling this
    // back would leave the file holding an error to avoid holding an advisory
    // diagnostic. The decision, not an accident of which side was filtered.
    const src = `slot count : Int = 0
reducer bump on=ui.focus(Crd) do= count := count + 1
tile Card = box(heading("Count: " + count.show))
tile App = column(Card)
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const file = write("fix-reveals-warning.kumiki", src);
    const { stdout, stderr, code } = runCli(["fix", file, "--apply"]);
    // The count comes from the gate's own re-check, so it is the warning the
    // repair revealed rather than whatever the file had before it.
    expect(stdout).toContain("file now clean (1 warning)");
    expect(stderr).toContain("W0212");
    expect(readFileSync(file, "utf8")).toContain("ui.focus(Card)");
    expect(code).toBe(0);
    // …and `check` says the same thing about the same file.
    const after = runCli(["check", file]);
    expect(after.stderr).toContain("W0212");
    expect(after.code).toBe(0);
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
  it("rejects a word that labels no definition", SPAWN, () => {
    const { stderr, code } = runCli(["list", write("list.kumiki", CLEAN), "bogus"]);
    expect(stderr).toContain("bogus");
    // The message has to name the alternatives — the caller who typed `bogus`
    // has no other way to learn `motion` is a filter and `route` is not.
    expect(stderr).toContain("slot");
    // 2, not merely non-zero: commander decides this before the file is read,
    // which is the line between the two failing codes.
    expect(code).toBe(2);
  });

  it("succeeds for a real label with no definitions under it", SPAWN, () => {
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

  it("names the step that is not a step", SPAWN, () => {
    // The container can be right while an element is not: `steps: ["click"]`
    // reaches the runner as a string where a step object belongs.
    const bad = write("step-not-object.json", JSON.stringify({ steps: [{}, "click"] }));
    const { stderr, code } = runCli(["run", write("run-f.kumiki", CLEAN), bad]);
    expect(stderr).toContain(bad);
    expect(stderr).toContain("steps[1]");
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

// The rows in the §9.2.5 table that this PR documents without changing. They
// are stated as a contract, so they are asserted as one — the mechanisms live
// in `smoke.ts`, and nothing else pins the codes they exit with.
describe("the verbs the table documents but this change does not touch", () => {
  const PANICS = `slot count : Int = 0
reducer boom on=ui.click(BoomBtn) do= panic("boom")
tile BoomBtn = button(text="go", onClick=boom)
tile App = column(heading("Count: " + count.show), BoomBtn)
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("smoke exits 1 when a file that compiles throws on interaction", SPAWN, () => {
    const { stderr, code } = runCli(["smoke", write("smoke-panics.kumiki", PANICS)]);
    expect(stderr).toContain("runtime smoke failed");
    expect(code).toBe(1);
  });

  it("smoke exits 0 when the app mounts and survives", SPAWN, () => {
    const { code } = runCli(["smoke", write("smoke-ok.kumiki", WITH_TESTS)]);
    expect(code).toBe(0);
  });

  it("run exits 1 when a step's assertion fails", SPAWN, () => {
    const scenario = write(
      "fails.json",
      JSON.stringify({ steps: [{ expect: { state: { count: 9 } } }] }),
    );
    const { stdout, code } = runCli(["run", write("run-fail.kumiki", CLEAN), scenario]);
    expect(stdout).toContain("scenario FAILED");
    expect(code).toBe(1);
  });

  // The marker and the reason line are the whole point of the fault channel: an
  // agent reads them, and nothing else pins them. Drop the `actionError` term
  // from any reporter's verdict and this is what catches it — the step prints
  // `[ok] step 0: click #typo` above `scenario FAILED`, which is the exact
  // misreading the channel exists to prevent.
  it("run marks a step whose action could not run as FAIL, and says why", SPAWN, () => {
    // No `expect`: the failed action is the only thing that can fail this step.
    const scenario = write(
      "action-fault.json",
      JSON.stringify({ steps: [{ do: { click: "#typo" } }] }),
    );
    const { stdout, code } = runCli(["run", write("run-fault.kumiki", CLEAN), scenario]);
    expect(stdout).toContain("[FAIL] step 0: click #typo");
    expect(stdout).toContain("action failed: no element matching selector #typo");
    expect(stdout).toContain("scenario FAILED");
    expect(code).toBe(1);
  });

  it("test exits 1 when a test fails", SPAWN, () => {
    // Same file as the passing case with the expectation moved off by one, so
    // the difference between the two runs is the test result and nothing else.
    const failing = WITH_TESTS.replace(
      "expect = {slots: {count: 1}",
      "expect = {slots: {count: 7}",
    );
    const { stdout, code } = runCli(["test", write("test-fails.kumiki", failing)]);
    expect(stdout).toContain("FAIL");
    expect(code).toBe(1);
    expect(runCli(["test", write("test-passes.kumiki", WITH_TESTS)]).code).toBe(0);
  });

  it("fix --auto-patch exits 1 for a test name that does not exist", SPAWN, () => {
    const { code } = runCli([
      "fix",
      write("auto-missing.kumiki", WITH_TESTS),
      "--auto-patch",
      "no-such-test",
    ]);
    expect(code).toBe(1);
  });
});
