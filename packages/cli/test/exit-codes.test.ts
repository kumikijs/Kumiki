import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { seed, tempDir } from "./helpers/files.ts";
import { asAgent } from "./helpers/op-log.ts";

const write = (name: string, source: string): string => seed(source, name);

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

describe("kumiki fix", () => {
  it("exits 1 in dry-run while the errors are still on disk", SPAWN, () => {
    const { stdout, code } = runCli(["fix", write("fix-dry.kumiki", FIXABLE)]);
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
    const { stdout, code } = runCli(["fix", write("fix-warn.kumiki", WARN_ONLY)]);
    expect(stdout).toBe("no errors (1 warning)\n");
    expect(code).toBe(0);
  });

  it("keeps a repair that clears an error and reveals a warning", SPAWN, () => {
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
    expect(stdout).toContain("file now clean (1 warning)");
    expect(stderr).toContain("W0212");
    expect(readFileSync(file, "utf8")).toContain("ui.focus(Card)");
    expect(code).toBe(0);
    // …and `check` says the same thing about the same file.
    const after = runCli(["check", file]);
    expect(after.stderr).toContain("W0212");
    expect(after.code).toBe(0);
  });

  it("exits 0 when the missing-404 patch repairs a routes map with a `}` in a route", SPAWN, () => {
    const src = `slot count : Int = 0
tile App = column(heading("Count: " + count.show))
app Demo
    caps   = []
    routes = {"/a}b" -> App}
    init   = []
`;
    const file = write("fix-brace-in-route.kumiki", src);
    const { stdout, code } = runCli(["fix", file, "--apply"]);
    expect(stdout).toContain("file now clean");
    expect(readFileSync(file, "utf8")).toContain('routes = {"/a}b" -> App, "/404" -> NotFound}');
    expect(code).toBe(0);
  });

  it("holds --auto-patch to the same rule as the diagnostic path", SPAWN, () => {
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

  describe("--apply under an ownership lock", () => {
    /** `cout` is a typo for `count`, so the one repair rewrites `reducer.inc`. */
    const TYPO_IN_REDUCER = `slot count : Int = 0
reducer inc on=ui.click(Btn) do= count := cout + 1
tile Btn = button(text="+", onClick=inc)
tile App = column(Btn, text(count.show))
app C
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

    /** The program above, with `pattern` locked by agent:a through the `lock` verb. */
    function lockedBy(name: string, pattern: string): string {
      const file = write(name, TYPO_IN_REDUCER);
      asAgent("agent:a");
      expect(runCli(["lock", file, "agent:a", pattern]).code).toBe(0);
      return file;
    }

    it(
      "exits 1 and writes nothing when the repair changes another agent's definition",
      SPAWN,
      () => {
        const file = lockedBy("fix-locked.kumiki", "*");
        asAgent("agent:b");
        const { stdout, stderr, code } = runCli(["fix", file, "--apply"]);
        expect(stdout).toBe(
          '(auto-patch rolled back — lock violation: reducer.inc is locked by agent:a (pattern "*"). Set KUMIKI_AUTHOR=agent:a to edit.)\n',
        );
        // The error the repair was for is still in the file, and still reported.
        expect(stderr).toBe('E0103 Reference to undefined name "cout"\n');
        expect(readFileSync(file, "utf8")).toBe(TYPO_IN_REDUCER);
        expect(code).toBe(1);
      },
    );

    it("applies the repair for the lock's owner", SPAWN, () => {
      const file = lockedBy("fix-locked-owner.kumiki", "*");
      const { stdout, code } = runCli(["fix", file, "--apply"]);
      expect(stdout).toBe("applied 1 fix(es) — file now clean\n");
      expect(readFileSync(file, "utf8")).toBe(TYPO_IN_REDUCER.replace("cout", "count"));
      expect(code).toBe(0);
    });

    it("applies a repair that changes no locked definition", SPAWN, () => {
      const file = lockedBy("fix-locked-other.kumiki", "slot.*");
      asAgent("agent:b");
      const { stdout, code } = runCli(["fix", file, "--apply"]);
      expect(stdout).toBe("applied 1 fix(es) — file now clean\n");
      expect(readFileSync(file, "utf8")).toBe(TYPO_IN_REDUCER.replace("cout", "count"));
      expect(code).toBe(0);
    });
  });

  it("applies a patch to a file that also has a warning", SPAWN, () => {
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
    const { stderr, code } = runCli(["refs", write("refs.kumiki", CLEAN), "slot.nope"]);
    expect(stderr).toContain('Definition "slot.nope" not found');
    expect(code).toBe(1);
  });

  it("fails on a qname that is not defined under view --with-deps, as without it", SPAWN, () => {
    const file = write("view-deps.kumiki", CLEAN);
    const res = runCli(["view", file, "slot.nope", "--with-deps"]);
    expect(res).toMatchObject({
      stdout: "",
      stderr: 'Definition "slot.nope" not found\n',
      code: 1,
    });
    expect(runCli(["view", file, "slot.nope"])).toEqual(res);
  });

  it("prints a defined qname after its dependencies under view --with-deps", SPAWN, () => {
    const res = runCli(["view", write("view-deps-ok.kumiki", CLEAN), "tile.App", "--with-deps"]);
    expect(res).toMatchObject({
      stdout: 'slot count : Int = 0\n\ntile App = column(heading("Count: " + count.show))\n',
      stderr: "",
      code: 0,
    });
  });

  it("succeeds for a defined qname with no referrers", SPAWN, () => {
    const { stdout, code } = runCli(["refs", write("refs-ok.kumiki", CLEAN), "app.Demo"]);
    expect(stdout).toContain("(no references to app.Demo)");
    expect(code).toBe(0);
  });

  it("fails when --history names a file that does not exist", SPAWN, () => {
    const missing = join(tempDir(), "not-here.kumiki");
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
    expect(stderr).toContain("slot");
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
    const missing = join(tempDir(), "no-scenario.json");
    const { stderr, code } = runCli(["run", write("run-a.kumiki", CLEAN), missing]);
    expect(stderr).toContain(missing);
    expect(code).toBe(1);
  });

  it("names the scenario file when it is a directory", SPAWN, () => {
    const dir = tempDir();
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
    const bad = write("step-not-object.json", JSON.stringify({ steps: [{}, "click"] }));
    const { stderr, code } = runCli(["run", write("run-f.kumiki", CLEAN), bad]);
    expect(stderr).toContain(bad);
    expect(stderr).toContain("steps[1]");
    expect(code).toBe(1);
  });

  it("says what a scenario document must contain", SPAWN, () => {
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

  it("fix --auto-patch --apply exits 1 when the gate refuses the patch", SPAWN, () => {
    const src = `slot count : Int = 0
slot other : Int = 1
fn step() -> Int = 3 - 2
reducer inc on=ui.click(Btn1) do= count := count + step()
tile Btn1 = button(text="+")
tile App = column(Btn1)
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test inc-adds-two =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}
        expect = {slots: {count: 2}, effects: []}
`;
    const file = write("auto-refused.kumiki", src);
    const { stdout, code } = runCli(["fix", file, "--auto-patch", "inc-adds-two", "--apply"]);
    expect(stdout).toContain('refused fix for "inc-adds-two"');
    expect(readFileSync(file, "utf8")).toBe(src);
    expect(code).toBe(1);
  });
});
