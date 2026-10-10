import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { APP_A, seed, seedCopy } from "./helpers/files.ts";

const COUNTER = app("01-counter");

describe("kumiki check strict flags", () => {
  /** `cheque` is a typo for `check`, which @kumikijs/icons has. */
  const UNKNOWN_ICON = `slot _ : Text = ""
tile Bad = icon(name="cheque")
tile App = column(Bad)
${APP_A}`;

  const SELECTOR_ID_MISMATCH = `slot x : Int = 0
reducer add on=ui.submit(NewForm#nw) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile App = column(NewForm)
${APP_A}`;

  it.each([
    ["--strict-icons", UNKNOWN_ICON, ["E0704", "unknown-icon", "cheque"]],
    [
      "--strict-selector-id",
      SELECTOR_ID_MISMATCH,
      ["E0212", "selector-id-mismatch", "NewForm#nw", '"new"'],
    ],
  ])("%s turns what plain check lets pass into a failure", SPAWN, (flag, source, reported) => {
    const file = seed(source);
    const lax = runCli(["check", file]);
    expect(lax.code).toBe(0);
    expect(lax.out).toContain("ok");
    const strict = runCli(["check", file, flag]);
    expect(strict.code).toBe(1);
    for (const text of reported) expect(strict.out).toContain(text);
  });

  it.each([
    [
      "--strict-icons",
      `slot _ : Text = ""
tile Good = icon(name="logo")
tile App = column(Good)
theme Light = { icons: { logo: "M3 3h18v18H3z" } }
${APP_A}`,
    ],
    ["--strict-selector-id", SELECTOR_ID_MISMATCH.replace("NewForm#nw", "NewForm#new")],
  ])("%s accepts what it can resolve", SPAWN, (flag, source) => {
    const { out, code } = runCli(["check", seed(source), flag]);
    expect(code).toBe(0);
    expect(out).toContain("ok");
  });

  // E0212 sits in the band `--types` selects anyway, so only `--refs` and `--effects` show it is kept as a strict code.
  const SCOPES = ["--types", "--refs", "--effects"];
  it.each([
    ...SCOPES.map((scope) => ["--strict-icons", scope, UNKNOWN_ICON, /E0704/] as const),
    ...SCOPES.map(
      (scope) => ["--strict-selector-id", scope, SELECTOR_ID_MISMATCH, /E0212/] as const,
    ),
    [
      "--strict-a11y",
      "--types",
      `slot _ : Text = ""\ntile Pic = image(src="/x.png")\ntile App = column(Pic)\n${APP_A}`,
      /E070[123]/,
    ] as const,
  ])("%s still reports its band under %s", SPAWN, (flag, scope, source, code) => {
    const result = runCli(["check", seed(source), flag, scope]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(code);
  });
});

describe("kumiki check warnings", () => {
  const W0212_SRC = `slot f : Text = ""
reducer recordFocus on=ui.focus(Card) do= f := "focused"
tile Card = box(text("hi"))
tile App = column(Card)
${APP_A}`;

  it.each([[[]], [["--refs"]]])(
    "reports W0212 on stderr and exits 0 with flags %o",
    SPAWN,
    (flags) => {
      const { stdout, stderr, code } = runCli(["check", seed(W0212_SRC), ...flags]);
      expect(code).toBe(0);
      expect(stderr).toContain("W0212");
      expect(stderr).toContain("ui-event-tile-mismatch");
      expect(stdout).toContain("ok (1 warning)");
    },
  );
});

describe("kumiki check: a program needs exactly one app", () => {
  const NO_APP = 'type N = Int\nslot count : N = 0\ntile App = column(heading("v"))\n';

  it.each([
    ["definitions but no entry point", NO_APP],
    ["an empty file", ""],
    ["whitespace and comments only", "\n  \n# nothing to see\n"],
  ])("fails on %s", SPAWN, (_, source) => {
    const { stdout, stderr, code } = runCli(["check", seed(source)]);
    expect(code).toBe(1);
    expect(stderr).toContain("error E0003 missing-app at 1:1");
    expect(stdout.trim()).toBe("");
  });

  it("reports the same failure from build, rather than an uncaught throw", SPAWN, () => {
    const file = seed(NO_APP);
    const { stderr, code } = runCli(["build", file, join(dirname(file), "out")]);
    expect(code).toBe(1);
    expect(stderr).toContain("error E0003 missing-app at 1:1");
    expect(stderr).not.toContain("No app definition found");
  });

  it("still passes a file that has an app", SPAWN, () => {
    const { stdout, code } = runCli(["check", COUNTER]);
    expect(code).toBe(0);
    expect(stdout).toContain("ok");
  });

  it("keeps the structural diagnostics visible under a scope flag", SPAWN, () => {
    const missingApp = runCli(["check", seed(NO_APP), "--refs"]);
    expect(missingApp.code).toBe(1);
    expect(missingApp.stderr).toContain("error E0003 missing-app");
    const no404 = seed(
      'tile App = column(heading("v"))\napp A caps=[] routes={"/" -> App} init=[]\n',
    );
    const missing404 = runCli(["check", no404, "--types"]);
    expect(missing404.code).toBe(1);
    expect(missing404.stderr).toContain("error E0001 missing-404");
  });

  it("does not block an AI edit that leaves the program incomplete", SPAWN, () => {
    const file = seed("");
    const added = runCli(["add", file, "slot", "count", "Int", "=", "0"]);
    expect(added.code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("slot count");
    expect(runCli(["check", file]).code).toBe(1);
  });

  it("catches an app that a cascading remove deleted", SPAWN, () => {
    const file = seedCopy(COUNTER, "counter.kumiki");
    const removed = runCli(["remove", file, "slot.count", "--cascade"]);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("cascaded app.Counter");
    expect(removed.stdout).toMatch(/\(op_/);
    const { stderr, code } = runCli(["check", file]);
    expect(code).toBe(1);
    expect(stderr).toContain("error E0003 missing-app");
  });

  describe("E0004 duplicate-app", () => {
    const TWO_APPS = `slot n : Int = 0
tile App   = column(text(n.show))
tile Other = column(text("x"))
app First  caps=[] routes={"/" -> App,    "/404" -> App}   init=[]
app Second caps=[] routes={"/x" -> Other, "/404" -> Other} init=[]
`;

    it("fails check, naming the app past the first", SPAWN, () => {
      const { stdout, stderr, code } = runCli(["check", seed(TWO_APPS)]);
      expect(code).toBe(1);
      expect(stderr).toContain("error E0004 duplicate-app at 5:1");
      expect(stderr).toContain("Second");
      expect(stdout.trim()).toBe("");
    });

    it("stops a build, which would drop the second app's routes", SPAWN, () => {
      const file = seed(TWO_APPS);
      const outDir = join(dirname(file), "out");
      const { stderr, code } = runCli(["build", file, outDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("error E0004 duplicate-app");
      expect(existsSync(join(outDir, "app.js"))).toBe(false);
    });
  });

  it("kumiki fix reports the diagnostics it cannot repair, not just the ones it can", SPAWN, () => {
    const file = seed("slot count : Int = 0\ntile App = column(text(cout.show))\n");
    const { stdout, stderr, code } = runCli(["fix", file]);
    expect(code).toBe(1);
    expect(stdout).toContain('fix: replace "cout" with "count"');
    expect(stdout).toContain("(no auto-patch for 1 of 2)");
    expect(stderr).toContain("E0003 Program has no app definition [no-repair-branch]");
  });
});
