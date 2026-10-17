import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { runTests, runTestsSource } from "../src/smoke.ts";
import { CLI_ARGV, runCli, SPAWN } from "./helpers/cli.ts";
import { APP_A, seed } from "./helpers/files.ts";

const TESTS = feature("28-tests");

describe("kumiki test", () => {
  it(
    "runs reducer-test + tile-test definitions with per-test timings and case counts",
    SPAWN,
    () => {
      const { stdout, code } = runCli(["test", TESTS]);
      expect(code).toBe(0);
      for (const name of [
        "app-renders-count",
        "greeting-renders-input",
        "add-creates-item",
        "add-surfaces-persist-error",
      ]) {
        expect(stdout).toContain(`PASS  ${name}`);
      }
      expect(stdout).toMatch(/PASS {2}inc-increments \(\d+ms\)/);
      expect(stdout).toMatch(/PASS {2}inc-dec-roundtrips \(100 cases, \d+ms\)/);
      expect(stdout).toContain("7/7 passed");
    },
  );

  it("refuses a batch the app's refinement rejects", SPAWN, () => {
    const { stdout, stderr } = runCli(["test", feature("63-reducer-batch-atomicity")]);
    expect(stdout).toContain("PASS  bump-commits-whole");
    expect(stdout).toContain("PASS  bump-at-ceiling-changes-nothing");
    expect(stdout).toContain("2/2 passed");
    expect(stderr).toContain(
      '[kumiki] reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3))',
    );
  });

  it("runs a reducer that reads the route slot", SPAWN, () => {
    const { stdout, code } = runCli(["test", feature("80-route-in-tests")]);
    expect(code).toBe(0);
    for (const name of [
      "route-defaults-to-empty",
      "seeded-route-drives-reducer",
      "partial-route-takes-defaults",
      "seeded-route-is-comparable",
      "wildcard-reads-the-route",
      "mocked-flow-sees-the-route",
      "replay-reads-the-route",
      "tile-reads-the-route",
    ]) {
      expect(stdout).toContain(`PASS  ${name}`);
    }
    expect(stdout).toMatch(/PASS {2}run-reducer-sees-route \(100 cases, \d+ms\)/);
    expect(stdout).toContain("9/9 passed");
  });

  it("filters by a name prefix", SPAWN, () => {
    const { stdout } = runCli(["test", TESTS, "inc-i*"]);
    expect(stdout).toContain("PASS  inc-increments");
    expect(stdout).toContain("1/1 passed");
    expect(stdout).not.toContain("dec-decrements");
  });

  it("--coverage reports reducer / effect / tile coverage", SPAWN, () => {
    const { stdout } = runCli(["test", TESTS, "--coverage"]);
    expect(stdout).toContain("coverage");
    expect(stdout).toMatch(/reducers {2}4\/4/);
    expect(stdout).toMatch(/tiles {5}2\/5/);
    expect(stdout).toContain("uncovered:");
  });
});

describe("kumiki test on a compile error", () => {
  const NOT_A_RECORD = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+", onClick=inc)
tile App = column(B, text(count.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test starts-at-41 =
    reducer-test inc
        given  = {slots: 41}
        expect = {slots: {count: 42}}
`;

  it("reports it with the file and the line and column `check` gives", SPAWN, () => {
    const file = seed(NOT_A_RECORD);
    const checked = runCli(["check", file]);
    expect(checked.code).toBe(1);
    const lines = checked.stderr.trim().split("\n");
    expect(lines).toEqual([
      "E0713 test-shape-invalid at 8:26: `given.slots` must be a record, `{<slot>: …}`",
    ]);

    const tested = runCli(["test", file]);
    expect(tested.code).toBe(1);
    expect(tested.stderr).toContain(file);
    for (const line of lines) expect(tested.stderr).toContain(line);
    expect(tested.stderr).toContain('in test "starts-at-41"');
  });

  it("prints the warnings `check` prints, before the errors", SPAWN, () => {
    const file = seed(`slot f : Text = ""
reducer recordFocus on=ui.focus(Card) do= f := "focused"
tile Card = box(text("hi"))
${NOT_A_RECORD}`);
    const checked = runCli(["check", file]);
    expect(checked.code).toBe(1);
    const lines = checked.stderr.trim().split("\n");
    expect(lines).toEqual([
      expect.stringMatching(/^W0212 /),
      expect.stringMatching(/^E0713 test-shape-invalid at 11:26: /),
    ]);

    const tested = runCli(["test", file]);
    expect(tested.code).toBe(1);
    const reported = tested.stderr.split("\n");
    const at = reported.findIndex((l) => l.includes(`compile failed (${file}):`));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(reported.slice(at + 1, at + 3)).toEqual([
      lines[0],
      `${lines[1]} (in test "starts-at-41")`,
    ]);
  });

  it("names no test when the diagnostic is outside one", SPAWN, () => {
    const file = seed(
      NOT_A_RECORD.replace("text(count.show)", "text(nope)").replace(
        "{slots: 41}",
        "{slots: {count: 41}}",
      ),
    );
    const tested = runCli(["test", file]);
    expect(tested.code).toBe(1);
    expect(tested.stderr).toMatch(/E0103 \S+ at 4:27: /);
    expect(tested.stderr).not.toContain("in test");
  });
});

describe("an episode-test whose log was never read", () => {
  const REPLAY = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test replay =
    episode-test
        load   = "log.jsonl"
        mocks  = {}
        expect = {slots-equal: from-log}
`;

  it("fails, naming the test and the log, when the source is run without its path", async () => {
    const [result] = await runTestsSource(REPLAY);
    expect(result).toMatchObject({
      name: "replay",
      pass: false,
      diffAt: "load",
      expected: 'the episodes in "log.jsonl"',
      actual:
        "no episode log was read: compile was given no readEpisodeLog, so nothing was replayed",
    });
  });
});

describe("one file after another in one process", () => {
  const WITH_TEST = `slot count : Int = 0
reducer inc on=ui.click(IncBtn) do= count := count + 1
tile IncBtn = button(text="+1", onClick=inc)
tile App = column(heading("Count: " + count.show), IncBtn)
${APP_A}
test inc-increments =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: IncBtn}}
        expect = {slots: {count: 2}, effects: []}
`;
  const NO_TEST = WITH_TEST.slice(0, WITH_TEST.indexOf("\ntest "));

  it("reports neither the tests nor the coverage of the file run before", async () => {
    const first = await runTests(seed(WITH_TEST, "a.kumiki"), undefined, [], { coverage: true });
    expect(first.results.map((r) => `${r.name}:${r.pass}`)).toEqual(["inc-increments:false"]);
    expect(first.coverage?.reducers.used).toEqual(["inc"]);

    const second = await runTests(seed(NO_TEST, "b.kumiki"), undefined, [], { coverage: true });
    expect(second.results.map((r) => r.name)).toEqual([]);
    expect({ total: second.total, failed: second.failed }).toEqual({ total: 0, failed: 0 });
    expect(second.coverage).toEqual({
      reducers: { total: ["inc"], used: [] },
      tiles: { total: ["IncBtn", "App"], used: [] },
      effects: { total: [], used: [] },
    });
  });

  it("prints `no tests found` when --watch re-runs a file whose last test was deleted", {
    timeout: 60000,
  }, async () => {
    const file = seed(WITH_TEST, "w.kumiki");
    const child = spawn(process.execPath, [...CLI_ARGV, "test", file, "--watch"], {
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (s: string) => {
      stdout += s;
    });
    child.stderr.setEncoding("utf8").on("data", (s: string) => {
      stderr += s;
    });
    const until = (done: () => boolean): Promise<void> =>
      new Promise((settle, fail) => {
        const check = (): void => {
          if (!done()) return;
          child.off("exit", exited);
          child.stdout.off("data", check);
          child.stderr.off("data", check);
          settle();
        };
        const exited = (): void => fail(new Error(`watcher exited:\n${stdout}\n${stderr}`));
        child.on("exit", exited);
        child.stdout.on("data", check);
        child.stderr.on("data", check);
        check();
      });
    const CHANGED = "— change detected —";
    const rerun = (): string => stdout.slice(stdout.indexOf(CHANGED));
    try {
      await until(() => stdout.includes("watching for changes"));
      expect(stdout).toContain("FAIL  inc-increments");

      writeFileSync(file, NO_TEST);
      // The watcher is installed just after it says it is watching, and a write that
      // lands first goes unseen, so the write repeats until one is picked up.
      const again = setInterval(() => writeFileSync(file, NO_TEST), 1000);
      try {
        await until(() => stdout.includes(CHANGED));
      } finally {
        clearInterval(again);
      }
      await until(
        () => /no tests found|\d+\/\d+ passed/.test(rerun()) || stderr.includes("test run failed"),
      );
      expect(rerun()).toContain("no tests found");
      expect(rerun()).not.toContain("inc-increments");
    } finally {
      child.kill();
    }
  });
});
