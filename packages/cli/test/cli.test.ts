import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, feature } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_ARGV, runCli } from "./helpers/cli.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER_PATH = app("01-counter");
const ROUTING_PATH = feature("18-routing");
const STORAGE_PATH = feature("20-effect-storage");
const INPUT_BIND_PATH = feature("13-text-input-bind");
const REPLAY_COUNTER = resolve(here, "fixtures/replay/counter.kumiki");
const REPLAY_COUNTER_LOG = resolve(here, "fixtures/replay/counter.log.jsonl");
const REPLAY_PERSIST = resolve(here, "fixtures/replay/persist.kumiki");
const REPLAY_PERSIST_LOG = resolve(here, "fixtures/replay/persist.log.jsonl");

describe("kumiki build CLI (per-app DCE, #71)", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "kumiki-cli-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function build(input: string): void {
    execFileSync(process.execPath, [...CLI_ARGV, "build", input, outDir], {
      stdio: "pipe",
    });
  }

  it("counter ships index.html, app.js, and ONLY its runtime modules", { timeout: 30000 }, () => {
    build(COUNTER_PATH);
    expect(existsSync(join(outDir, "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "app.js"))).toBe(true);
    // The monolithic runtime.js is gone — replaced by the pruned module set.
    expect(existsSync(join(outDir, "runtime.js"))).toBe(false);
    const expected = [
      "core.js",
      "stdlib.js",
      "tiles-layout.js",
      "tiles-text-heading.js",
      "tiles-input-button.js",
      "tiles-input-shared.js",
    ];
    for (const f of expected) {
      expect(existsSync(join(outDir, "runtime", f)), `runtime/${f} missing`).toBe(true);
    }
    // No router / collection / overlay / effect-handler code for a counter (#71 AC).
    for (const f of [
      "router.js",
      "testkit.js",
      "effects-storage.js",
      "effects-http.js",
      "effects-toast.js",
      "effects-confirm.js",
      "tiles-text.js",
      "tiles-text-link.js",
      "tiles-text-icon.js",
      "tiles-input.js",
      "tiles-input-select.js",
      "tiles-input-textarea.js",
      "tiles-collection.js",
      "tiles-overlay.js",
      "tiles-media.js",
      "tiles-status.js",
    ]) {
      expect(existsSync(join(outDir, "runtime", f)), `runtime/${f} should not ship`).toBe(false);
    }

    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/app.js"></script>');

    const app = readFileSync(join(outDir, "app.js"), "utf8");
    expect(app).toContain('import { mountCore } from "./runtime/core.js"');
    expect(app).toContain('tile: "IncBtn"');
    expect(app).toContain('_h("inc")');

    const total = expected
      .map((f) => readFileSync(join(outDir, "runtime", f)).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(64_000);
    const core = readFileSync(join(outDir, "runtime", "core.js"), "utf8");
    expect(core).not.toContain(": AppShape"); // minified, types stripped
  });

  it("the built counter mounts — app.js + runtime modules render into #root", {
    timeout: 30000,
  }, async () => {
    build(COUNTER_PATH);
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      await import(pathToFileURL(join(outDir, "app.js")).href);
      expect(root.textContent).toContain("Count: 0");
    } finally {
      root.remove();
    }
  });

  it("the built counter patches in place — the heading element survives a bump", {
    timeout: 30000,
  }, async () => {
    build(COUNTER_PATH);
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      await import(pathToFileURL(join(outDir, "app.js")).href);
      const heading = root.querySelector("h1") as HTMLElement;
      expect(heading.textContent).toContain("Count: 0");
      // A marker the runtime never writes: it survives a patch, not a rebuild.
      heading.dataset.probe = "seeded";
      const incBtn = [...root.querySelectorAll("button")].find((b) => b.textContent === "+");
      incBtn?.click();
      expect(root.textContent).toContain("Count: 1");
      expect(root.querySelector("h1")).toBe(heading);
      expect((root.querySelector("h1") as HTMLElement).dataset.probe).toBe("seeded");
    } finally {
      root.remove();
    }
  });

  it("the built input keeps its element across a bound-value change", {
    timeout: 30000,
  }, async () => {
    build(INPUT_BIND_PATH);
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      await import(pathToFileURL(join(outDir, "app.js")).href);
      const input = root.querySelector("input") as HTMLInputElement;
      input.dataset.probe = "seeded";
      input.value = "ada";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // The heading re-renders from the same slot, so the whole tree diffed.
      expect(root.textContent).toContain("Hello, ada");
      expect(root.querySelector("input")).toBe(input);
      expect((root.querySelector("input") as HTMLElement).dataset.probe).toBe("seeded");
    } finally {
      root.remove();
    }
  });

  it("a routing app ships router.js and the built artifact navigates", {
    timeout: 30000,
  }, async () => {
    build(ROUTING_PATH);
    expect(existsSync(join(outDir, "runtime", "router.js"))).toBe(true);
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    (globalThis as { __kumikiMount?: unknown }).__kumikiMount = { router: "memory" };
    try {
      await import(pathToFileURL(join(outDir, "app.js")).href);
      expect(root.textContent).toContain("Home");
      (root.querySelector('[data-kumiki-tile="link"]') as HTMLAnchorElement).click();
      expect(root.textContent).toContain("Item 42");
    } finally {
      delete (globalThis as { __kumikiMount?: unknown }).__kumikiMount;
      root.remove();
    }
  });

  it("a storage app ships effects-storage.js (and no http module)", { timeout: 30000 }, () => {
    build(STORAGE_PATH);
    expect(existsSync(join(outDir, "runtime", "effects-storage.js"))).toBe(true);
    expect(existsSync(join(outDir, "runtime", "effects-http.js"))).toBe(false);
    const app = readFileSync(join(outDir, "app.js"), "utf8");
    expect(app).toContain('from "./runtime/effects-storage.js"');
  });
});

describe("kumiki check --strict-icons", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-strict-icons-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // `cheque` is a deliberate typo for `check`; not in @kumikijs/icons.
  const UNKNOWN = `slot _ : Text = ""
tile Bad = icon(name="cheque")
tile App = column(Bad)
app StrictIcons
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("default check (no flag) lets the unknown literal name pass", { timeout: 30000 }, () => {
    const file = join(dir, "bad.kumiki");
    writeFileSync(file, UNKNOWN);
    const { out, code } = runCli(["check", file]);
    expect(code).toBe(0);
    expect(out).toContain("ok");
  });

  it("--strict-icons surfaces E0704 and exits 1", { timeout: 30000 }, () => {
    const file = join(dir, "bad.kumiki");
    writeFileSync(file, UNKNOWN);
    const { out, code } = runCli(["check", file, "--strict-icons"]);
    expect(code).toBe(1);
    expect(out).toContain("E0704");
    expect(out).toContain("unknown-icon");
    expect(out).toContain("cheque");
  });

  it("--strict-icons accepts a custom name declared in theme.icons", { timeout: 30000 }, () => {
    const file = join(dir, "themed.kumiki");
    writeFileSync(
      file,
      `slot _ : Text = ""
tile Good = icon(name="logo")
tile App = column(Good)
theme Light = { icons: { logo: "M3 3h18v18H3z" } }
app StrictThemed
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const { out, code } = runCli(["check", file, "--strict-icons"]);
    expect(code).toBe(0);
    expect(out).toContain("ok");
  });

  for (const scope of ["--types", "--refs", "--effects"]) {
    it(`--strict-icons + ${scope} still surfaces E0704`, { timeout: 30000 }, () => {
      const file = join(dir, "bad.kumiki");
      writeFileSync(file, UNKNOWN);
      const { out, code } = runCli(["check", file, "--strict-icons", scope]);
      expect(code).toBe(1);
      expect(out).toContain("E0704");
    });
  }

  it("--strict-a11y + --types still surfaces the a11y band", { timeout: 30000 }, () => {
    const file = join(dir, "a11y.kumiki");
    writeFileSync(
      file,
      `slot _ : Text = ""
tile Pic = image(src="/x.png")
tile App = column(Pic)
app StrictA11y
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const { out, code } = runCli(["check", file, "--strict-a11y", "--types"]);
    expect(code).toBe(1);
    expect(out).toMatch(/E070[123]/);
  });
});

describe("kumiki check --strict-selector-id", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-strict-selid-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const MISMATCH = `slot x : Int = 0
reducer add on=ui.submit(NewForm#nw) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile App = column(NewForm)
app SelIdApp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("default check (no flag) lets a literal id mismatch pass", { timeout: 30000 }, () => {
    const file = join(dir, "bad.kumiki");
    writeFileSync(file, MISMATCH);
    const { out, code } = runCli(["check", file]);
    expect(code).toBe(0);
    expect(out).toContain("ok");
  });

  it("--strict-selector-id surfaces E0212 and exits 1", { timeout: 30000 }, () => {
    const file = join(dir, "bad.kumiki");
    writeFileSync(file, MISMATCH);
    const { out, code } = runCli(["check", file, "--strict-selector-id"]);
    expect(code).toBe(1);
    expect(out).toContain("E0212");
    expect(out).toContain("selector-id-mismatch");
    expect(out).toContain("NewForm#nw");
    expect(out).toContain('"new"');
  });

  it("--strict-selector-id accepts a matching literal id", { timeout: 30000 }, () => {
    const file = join(dir, "good.kumiki");
    writeFileSync(
      file,
      `slot x : Int = 0
reducer add on=ui.submit(NewForm#new) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile App = column(NewForm)
app OkApp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const { out, code } = runCli(["check", file, "--strict-selector-id"]);
    expect(code).toBe(0);
    expect(out).toContain("ok");
  });

  for (const scope of ["--types", "--refs", "--effects"]) {
    it(`--strict-selector-id + ${scope} still surfaces E0212`, { timeout: 30000 }, () => {
      const file = join(dir, "bad.kumiki");
      writeFileSync(file, MISMATCH);
      const { out, code } = runCli(["check", file, "--strict-selector-id", scope]);
      expect(code).toBe(1);
      expect(out).toContain("E0212");
    });
  }
});

describe("kumiki check (W0212 ui-event-tile-mismatch)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-w0212-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const W0212_SRC = `slot f : Text = ""
reducer recordFocus on=ui.focus(Card) do= f := "focused"
tile Card = box(text("hi"))
tile App = column(Card)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  it("emits W0212 to stderr and exits 0 with an `ok (1 warning)` summary", {
    timeout: 30000,
  }, () => {
    const file = join(dir, "warn.kumiki");
    writeFileSync(file, W0212_SRC);
    const { stdout, stderr, code } = runCli(["check", file]);
    expect(code).toBe(0);
    expect(stderr).toContain("W0212");
    expect(stderr).toContain("ui-event-tile-mismatch");
    expect(stdout).toContain("ok (1 warning)");
  });

  it("--refs still surfaces W0212 (scope filtering does not silence warnings)", {
    timeout: 30000,
  }, () => {
    const file = join(dir, "warn.kumiki");
    writeFileSync(file, W0212_SRC);
    const { stdout, stderr, code } = runCli(["check", file, "--refs"]);
    expect(code).toBe(0);
    expect(stderr).toContain("W0212");
    expect(stdout).toContain("ok (1 warning)");
  });
});

describe("kumiki smoke with a manifest-registered capability", () => {
  const CUSTOM_CAP = feature("27-custom-capability");

  it("smokes a file whose capability is declared in kumiki.caps.json", { timeout: 30000 }, () => {
    const out = execFileSync(process.execPath, [...CLI_ARGV, "smoke", CUSTOM_CAP], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(out).toContain("ok");
  });
});

describe("kumiki check and the capability manifest", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kumiki-caps-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(join(root, "src", "app.kumiki"), CUSTOM_CAP_SRC);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const CUSTOM_CAP_SRC = `slot sent : Int = 0
effect track cap=telemetry.track in={name: Text} out=Unit
reducer fire on=ui.click(B) do= emit track({name: "x"})
tile B = button(text="b")
tile App = column(B, text(sent.show))
app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
`;

  function check(): { stdout: string; stderr: string; code: number } {
    const res = spawnSync(
      process.execPath,
      [...CLI_ARGV, "check", join(root, "src", "app.kumiki")],
      {
        stdio: "pipe",
        encoding: "utf8",
      },
    );
    return {
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      code: res.status ?? (res.error ? 1 : 0),
    };
  }

  it("reads a manifest at the project root, not only beside the source", {
    timeout: 60_000,
  }, () => {
    writeFileSync(
      join(root, "kumiki.caps.json"),
      JSON.stringify({ capabilities: ["telemetry.track"] }),
    );
    const { stdout, code } = check();
    expect(code).toBe(0);
    expect(stdout).toContain("ok");
  });

  it("names the directories it searched when there is no manifest", { timeout: 60_000 }, () => {
    const { stderr, code } = check();
    expect(code).toBe(1);
    expect(stderr).toContain("E0302");
    expect(stderr).toContain("no kumiki.caps.json found");
    expect(stderr).toContain(join(root, "src"));
  });

  it("says nothing about manifests when the diagnostic is not about capabilities", {
    timeout: 60_000,
  }, () => {
    writeFileSync(
      join(root, "src", "app.kumiki"),
      `tile App = column(text(nope))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    const { stderr, code } = check();
    expect(code).toBe(1);
    expect(stderr).toContain("E0103");
    expect(stderr).not.toContain("kumiki.caps.json");
  });

  it("says the same thing from build, which fails on the same diagnostic", {
    timeout: 60_000,
  }, () => {
    const res = spawnSync(
      process.execPath,
      [...CLI_ARGV, "build", join(root, "src", "app.kumiki"), join(root, "out")],
      { stdio: "pipe", encoding: "utf8" },
    );
    expect(res.status).toBe(1);
    expect(res.stderr ?? "").toContain("E0302");
    expect(res.stderr ?? "").toContain("no kumiki.caps.json found");
  });

  it("names the manifest it read when that manifest lacks the capability", {
    timeout: 60_000,
  }, () => {
    const manifest = join(root, "kumiki.caps.json");
    writeFileSync(manifest, JSON.stringify({ capabilities: ["telemetry.identify"] }));
    const { stderr, code } = check();
    expect(code).toBe(1);
    expect(stderr).toContain("E0302");
    expect(stderr).toContain(manifest);
  });
});

describe("kumiki test (in-language test runner)", () => {
  const TESTS = feature("28-tests");

  it("runs reducer-test + tile-test definitions and reports pass", { timeout: 30000 }, () => {
    const out = execFileSync(process.execPath, [...CLI_ARGV, "test", TESTS], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(out).toContain("PASS  inc-increments");
    expect(out).toContain("PASS  app-renders-count");
    expect(out).toContain("PASS  greeting-renders-input");
    expect(out).toContain("PASS  add-creates-item");
    expect(out).toContain("PASS  add-surfaces-persist-error");
    expect(out).toMatch(/PASS {2}inc-dec-roundtrips \(100 cases, \d+ms\)/);
    expect(out).toContain("7/7 passed");
  });

  it("refuses a batch the app's refinement rejects", { timeout: 30000 }, () => {
    const file = feature("63-reducer-batch-atomicity");
    const res = spawnSync(process.execPath, [...CLI_ARGV, "test", file], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(res.stdout).toContain("PASS  bump-commits-whole");
    expect(res.stdout).toContain("PASS  bump-at-ceiling-changes-nothing");
    expect(res.stdout).toContain("2/2 passed");
    expect(res.stderr).toContain(
      '[kumiki] reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3))',
    );
  });

  it("runs a reducer that reads the route slot", { timeout: 30000 }, () => {
    const file = feature("80-route-in-tests");
    const out = execFileSync(process.execPath, [...CLI_ARGV, "test", file], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(out).toContain("PASS  route-defaults-to-empty");
    expect(out).toContain("PASS  seeded-route-drives-reducer");
    expect(out).toContain("PASS  partial-route-takes-defaults");
    expect(out).toContain("PASS  seeded-route-is-comparable");
    expect(out).toContain("PASS  wildcard-reads-the-route");
    expect(out).toContain("PASS  mocked-flow-sees-the-route");
    expect(out).toContain("PASS  replay-reads-the-route");
    expect(out).toContain("PASS  tile-reads-the-route");
    expect(out).toMatch(/PASS {2}run-reducer-sees-route \(100 cases, \d+ms\)/);
    expect(out).toContain("9/9 passed");
  });

  it("filters by a name prefix", { timeout: 30000 }, () => {
    const out = execFileSync(process.execPath, [...CLI_ARGV, "test", TESTS, "inc-i*"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(out).toContain("PASS  inc-increments");
    expect(out).toContain("1/1 passed");
    expect(out).not.toContain("dec-decrements");
  });

  it("reports per-test timings and a property case count", { timeout: 30000 }, () => {
    const out = execFileSync(process.execPath, [...CLI_ARGV, "test", TESTS], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(out).toMatch(/PASS {2}inc-increments \(\d+ms\)/);
    expect(out).toMatch(/PASS {2}inc-dec-roundtrips \(100 cases, \d+ms\)/);
  });

  it("--coverage reports reducer / effect / tile coverage", { timeout: 30000 }, () => {
    const out = execFileSync(process.execPath, [...CLI_ARGV, "test", TESTS, "--coverage"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(out).toContain("coverage");
    expect(out).toMatch(/reducers {2}4\/4/);
    expect(out).toMatch(/tiles {5}2\/5/);
    expect(out).toContain("uncovered:");
  });

  describe("a compile error", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "kumiki-test-diag-"));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

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

    const cli = (args: string[]) =>
      spawnSync(process.execPath, [...CLI_ARGV, ...args], { stdio: "pipe", encoding: "utf8" });

    it("is reported with the file and the line and column `check` gives", {
      timeout: 30000,
    }, () => {
      const file = join(dir, "not-a-record.kumiki");
      writeFileSync(file, NOT_A_RECORD);
      const checked = cli(["check", file]);
      expect(checked.status).toBe(1);
      const lines = checked.stderr.trim().split("\n");
      expect(lines).toEqual([
        "E0713 test-shape-invalid at 8:26: `given.slots` must be a record, `{<slot>: …}`",
      ]);

      const tested = cli(["test", file]);
      expect(tested.status).toBe(1);
      expect(tested.stderr).toContain(file);
      for (const line of lines) expect(tested.stderr).toContain(line);
      expect(tested.stderr).toContain('in test "starts-at-41"');
    });

    it("prints the warnings `check` prints, before the errors", { timeout: 30000 }, () => {
      // A `box` cannot fire `focus`, so subscribing to one is W0212.
      const file = join(dir, "warned.kumiki");
      writeFileSync(
        file,
        `slot f : Text = ""
reducer recordFocus on=ui.focus(Card) do= f := "focused"
tile Card = box(text("hi"))
${NOT_A_RECORD}`,
      );
      const checked = cli(["check", file]);
      expect(checked.status).toBe(1);
      const lines = checked.stderr.trim().split("\n");
      expect(lines).toEqual([
        expect.stringMatching(/^W0212 /),
        expect.stringMatching(/^E0713 test-shape-invalid at 11:26: /),
      ]);

      const tested = cli(["test", file]);
      expect(tested.status).toBe(1);
      const reported = tested.stderr.split("\n");
      const at = reported.findIndex((l) => l.includes(`compile failed (${file}):`));
      expect(at).toBeGreaterThanOrEqual(0);
      expect(reported.slice(at + 1, at + 3)).toEqual([
        lines[0],
        `${lines[1]} (in test "starts-at-41")`,
      ]);
    });

    it("names no test when the diagnostic is outside one", { timeout: 30000 }, () => {
      const file = join(dir, "unknown-name.kumiki");
      writeFileSync(
        file,
        NOT_A_RECORD.replace("text(count.show)", "text(nope)").replace(
          "{slots: 41}",
          "{slots: {count: 41}}",
        ),
      );
      const tested = cli(["test", file]);
      expect(tested.status).toBe(1);
      expect(tested.stderr).toMatch(/E0103 \S+ at 4:27: /);
      expect(tested.stderr).not.toContain("in test");
    });
  });
});

describe("kumiki fix --auto-patch (fix from a failing test)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-fixtest-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run the CLI, capturing stdout+stderr and the exit code without throwing. */
  // A tile-test whose rendered text comes from a single typo'd source literal.
  const BEHAVIORAL = `tile Title = heading("Helo")
tile App = column(Title)
app FixDemo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test title-text =
    tile-test Title
        given  = {slots: {}}
        expect = heading("Hello")
`;

  it("dry-run proposes the literal patch and does not modify the file", { timeout: 30000 }, () => {
    const file = join(dir, "behavioral.kumiki");
    writeFileSync(file, BEHAVIORAL);
    const { out, code } = runCli(["fix", file, "--auto-patch", "title-text"]);
    expect(code).toBe(1);
    expect(out).toContain('replace "Helo" with "Hello"');
    // File untouched (AC4).
    expect(readFileSync(file, "utf8")).toContain('heading("Helo")');
  });

  it("--apply patches the literal and the test then passes", { timeout: 30000 }, () => {
    const file = join(dir, "behavioral.kumiki");
    writeFileSync(file, BEHAVIORAL);
    const { out, code } = runCli(["fix", file, "--auto-patch", "title-text", "--apply"]);
    expect(code).toBe(0);
    expect(out).toContain("PASSES");
    const after = readFileSync(file, "utf8");
    expect(after).toContain('heading("Hello")');
    expect(after).not.toContain('"Helo"');
    // The runner now agrees the test passes.
    const verify = runCli(["test", file]);
    expect(verify.out).toContain("PASS  title-text");
    expect(verify.out).toContain("1/1 passed");
  });

  it("repairs a compile error blocking the test, then runs it (AC3)", { timeout: 30000 }, () => {
    const file = join(dir, "compile-blocked.kumiki");
    writeFileSync(
      file,
      `slot count : Int = 0
reducer inc on=ui.click(IncBtn) do= conut := count + 1
tile IncBtn = button(text="+1", onClick=inc)
tile App = column(heading("Count: " + count.show), IncBtn)
app FixDemo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test inc-works =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: IncBtn}}
        expect = {slots: {count: 1}, effects: []}
`,
    );
    const { out, code } = runCli(["fix", file, "--auto-patch", "inc-works", "--apply"]);
    expect(code).toBe(0);
    expect(out).toContain("compile fix");
    const after = readFileSync(file, "utf8");
    expect(after).toContain("count := count + 1");
    expect(after).not.toContain("conut");
    // Test runs and passes on the repaired file.
    const verify = runCli(["test", file]);
    expect(verify.out).toContain("PASS  inc-works");
  });

  it("auto-patches a numeric slot mismatch by flipping the reducer operator (issue #156)", {
    timeout: 30000,
  }, () => {
    const file = join(dir, "arith-patch.kumiki");
    const source = `slot count : Int = 0
reducer dec on=ui.click(DecBtn) do= count := count - 1
tile DecBtn = button(text="-1", onClick=dec)
tile App = column(heading("Count: " + count.show), DecBtn)
app FixDemo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test dec-should-add =
    reducer-test dec
        given  = {slots: {count: 0}, event: {type: ui.click, target: DecBtn}}
        expect = {slots: {count: 1}, effects: []}
`;
    writeFileSync(file, source);
    const { code } = runCli(["fix", file, "--auto-patch", "dec-should-add", "--apply"]);
    expect(code).toBe(0);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("count := count + 1");
    expect(after).not.toContain("count := count - 1");
  });

  it("does not patch a literal that lives only in a test fixture", { timeout: 30000 }, () => {
    const file = join(dir, "fixture-only.kumiki");
    const source = `slot msg : Text = "x"
tile Msg = heading(msg.show)
tile App = column(Msg)
app FixDemo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
test msg-text =
    tile-test Msg
        given  = {slots: {msg: "Helo"}}
        expect = heading("Hello")
`;
    writeFileSync(file, source);
    const { out, code } = runCli(["fix", file, "--auto-patch", "msg-text", "--apply"]);
    expect(code).toBe(1);
    expect(out).toContain("no auto-patch available");
    // The fixture's "Helo" must be left intact — no self-mutating PASS.
    expect(readFileSync(file, "utf8")).toBe(source);
  });
});

describe("kumiki replay (episode log replay, §10.5.3)", () => {
  it("replays a single episode and prints its steps + final slots", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "ep_0001",
    ]);
    expect(code).toBe(0);
    expect(out).toContain("episode ep_0001");
    expect(out).toContain("[reducer] inc");
    expect(out).toContain("count: 0 -> 1");
    expect(out).toContain("final slots:");
    expect(out).toMatch(/"count":\s*1/);
    expect(out).toContain("1 episode(s) replayed");
  });

  it("replays multiple episodes from a JSONL log in order", { timeout: 30000 }, () => {
    const { out, code } = runCli(["replay", REPLAY_COUNTER, "--from-log", REPLAY_COUNTER_LOG]);
    expect(code).toBe(0);
    // Episodes appear in log order.
    const i1 = out.indexOf("episode ep_0001");
    const i2 = out.indexOf("episode ep_0002");
    const i3 = out.indexOf("episode ep_0003");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    // Cumulative slot state: starts at 0, ends at 3.
    expect(out).toMatch(/"count":\s*3/);
    expect(out).toContain("3 episode(s) replayed");
  });

  it("--mock 'effect: ok(value)' replaces a recorded effect outcome", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_PERSIST,
      "--from-log",
      REPLAY_PERSIST_LOG,
      "--mock",
      "persist:ok(null)",
    ]);
    expect(code).toBe(0);
    // The .ok branch fires: status becomes "saved".
    expect(out).toMatch(/"status":\s*"saved"/);
    // And NOT the .err branch's value.
    expect(out).not.toMatch(/"status":\s*"disk full"/);
  });

  it("--mock 'effect: err(<json>)' on a storage effect delivers the Text the handler would", {
    timeout: 30000,
  }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_PERSIST,
      "--from-log",
      REPLAY_PERSIST_LOG,
      "--mock",
      'persist: err({"message":"blocked"})',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('[effect-end] persist err = "blocked" (mock:fixed)');
    expect(out).toMatch(/"status":\s*"blocked"/);
  });

  it("--mock 'effect: from-log' resolves to the recorded effect-end", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_PERSIST,
      "--from-log",
      REPLAY_PERSIST_LOG,
      "--mock",
      "persist:from-log",
    ]);
    expect(code).toBe(0);
    // The recorded effect-end is err("disk full") → drives persistFailed.
    expect(out).toMatch(/"status":\s*"disk full"/);
  });

  it("--mock 'effect: ignore' drops the effect entirely", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_PERSIST,
      "--from-log",
      REPLAY_PERSIST_LOG,
      "--mock",
      "persist:ignore",
    ]);
    expect(code).toBe(0);
    // Neither .ok nor .err fired → status stays at its default "".
    expect(out).toMatch(/"status":\s*""/);
    expect(out).not.toMatch(/"status":\s*"disk full"/);
    expect(out).not.toMatch(/"status":\s*"saved"/);
  });

  it("--mock can be specified multiple times", { timeout: 30000 }, () => {
    // Pass two mocks; the persist one takes effect, the other is harmless.
    const { out, code } = runCli([
      "replay",
      REPLAY_PERSIST,
      "--from-log",
      REPLAY_PERSIST_LOG,
      "--mock",
      "persist:ignore",
      "--mock",
      "noop:from-log",
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/"status":\s*""/);
  });

  it("--until-step N stops replay at step N and reports stop", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "--until-step",
      "1",
    ]);
    expect(code).toBe(0);
    expect(out).toContain("stopped at step 1");
    // Only the first reducer step ran → count == 1, not 3.
    expect(out).toMatch(/"count":\s*1/);
    expect(out).not.toMatch(/"count":\s*3/);
  });

  it("<episode-id> argument filters to a single episode", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "ep_0002",
    ]);
    expect(code).toBe(0);
    expect(out).toContain("episode ep_0002");
    expect(out).not.toContain("episode ep_0001");
    expect(out).not.toContain("episode ep_0003");
    expect(out).toContain("1 episode(s) replayed");
  });

  it("unknown episode-id exits 1 with 'episode <id> not found'", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "ep_nope",
    ]);
    expect(code).toBe(1);
    expect(out).toContain("episode ep_nope not found");
  });

  it("invalid --mock syntax exits 2 with parse error message", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "--mock",
      "garbage",
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/invalid --mock/);
  });

  it("missing --from-log shows usage and exits 2", { timeout: 30000 }, () => {
    const { out, code } = runCli(["replay", REPLAY_COUNTER]);
    expect(code).toBe(2);
    expect(out).toMatch(/--from-log/);
  });

  it("rejects more than one positional <episode-id> with exit 2", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "ep_0001",
      "ep_0002",
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/unexpected positional/);
  });

  // Spec §10.5.3 step counter is 1-indexed; `--until-step 0` is a misuse.
  it("--until-step 0 is rejected with exit 2", { timeout: 30000 }, () => {
    const { out, code } = runCli([
      "replay",
      REPLAY_COUNTER,
      "--from-log",
      REPLAY_COUNTER_LOG,
      "--until-step",
      "0",
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/--until-step/);
    expect(out).toMatch(/positive integer/);
  });
});

describe("kumiki check (E0003 missing-app)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-e0003-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, source: string): string {
    const file = join(dir, name);
    writeFileSync(file, source);
    return file;
  }

  const CASES: Array<[string, string]> = [
    [
      "definitions but no entry point",
      'type N = Int\nslot count : N = 0\ntile App = column(heading("v"))\n',
    ],
    ["an empty file", ""],
    ["whitespace and comments only", "\n  \n# nothing to see\n"],
  ];

  for (const [label, source] of CASES) {
    it(`fails on ${label}`, { timeout: 30000 }, () => {
      const file = write("noapp.kumiki", source);
      const { stdout, stderr, code } = runCli(["check", file]);
      expect(code).toBe(1);
      expect(stderr).toContain("E0003 missing-app at 1:1");
      expect(stdout.trim()).toBe("");
    });
  }

  it("reports the same failure from build, rather than an uncaught throw", {
    timeout: 30000,
  }, () => {
    const file = write("noapp.kumiki", CASES[0]![1]);
    const { stderr, code } = runCli(["build", file, join(dir, "out")]);
    expect(code).toBe(1);
    expect(stderr).toContain("E0003 missing-app at 1:1");
    expect(stderr).not.toContain("No app definition found");
  });

  it("still passes a file that has an app", { timeout: 30000 }, () => {
    const { stdout, code } = runCli(["check", COUNTER_PATH]);
    expect(code).toBe(0);
    expect(stdout).toContain("ok");
  });

  for (const scope of ["--types", "--refs", "--effects"]) {
    it(`survives ${scope}`, { timeout: 30000 }, () => {
      const file = write("noapp.kumiki", CASES[0]![1]);
      const { stderr, code } = runCli(["check", file, scope]);
      expect(code).toBe(1);
      expect(stderr).toContain("E0003 missing-app");
    });
  }

  it("keeps the other structural diagnostic (E0001) visible under --types", {
    timeout: 30000,
  }, () => {
    const file = write(
      "no404.kumiki",
      'tile App = column(heading("v"))\napp A caps=[] routes={"/" -> App} init=[]\n',
    );
    const { stderr, code } = runCli(["check", file, "--types"]);
    expect(code).toBe(1);
    expect(stderr).toContain("E0001 missing-404");
  });

  it("does not block an AI edit that leaves the program incomplete", {
    timeout: 60000,
  }, () => {
    const file = write("grow.kumiki", "");
    const added = runCli(["add", file, "slot", "count", "Int", "=", "0"]);
    expect(added.code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("slot count");
    expect(runCli(["check", file]).code).toBe(1);
  });

  it("catches an app that a cascading remove deleted", { timeout: 60000 }, () => {
    const file = join(dir, "counter.kumiki");
    writeFileSync(file, readFileSync(COUNTER_PATH, "utf8"));
    const removed = runCli(["remove", file, "slot.count", "--cascade"]);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("cascaded app.Counter");
    expect(removed.stdout).toMatch(/\(op_/);
    const { stderr, code } = runCli(["check", file]);
    expect(code).toBe(1);
    expect(stderr).toContain("E0003 missing-app");
  });

  describe("E0004 duplicate-app", () => {
    const TWO_APPS = `slot n : Int = 0
tile App   = column(text(n.show))
tile Other = column(text("x"))
app First  caps=[] routes={"/" -> App,    "/404" -> App}   init=[]
app Second caps=[] routes={"/x" -> Other, "/404" -> Other} init=[]
`;

    it("fails check, naming the app past the first", { timeout: 30000 }, () => {
      const file = write("two.kumiki", TWO_APPS);
      const { stdout, stderr, code } = runCli(["check", file]);
      expect(code).toBe(1);
      expect(stderr).toContain("E0004 duplicate-app at 5:1");
      expect(stderr).toContain("Second");
      expect(stdout.trim()).toBe("");
    });

    it("stops the build that used to drop the second app's routes", {
      timeout: 30000,
    }, () => {
      const file = write("two.kumiki", TWO_APPS);
      const outDir = join(dir, "out-two");
      const { stderr, code } = runCli(["build", file, outDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("E0004 duplicate-app");
      expect(existsSync(join(outDir, "app.js"))).toBe(false);
    });
  });

  it("kumiki fix reports the diagnostics it cannot repair, not just the ones it can", {
    timeout: 30000,
  }, () => {
    const file = write("hide.kumiki", "slot count : Int = 0\ntile App = column(text(cout.show))\n");
    const { stdout, stderr, code } = runCli(["fix", file]);
    expect(code).toBe(1);
    expect(stdout).toContain('fix: replace "cout" with "count"');
    expect(stdout).toContain("(no auto-patch for 1 of 2)");
    // The stable kebab reason rides along — a repair loop branches on it.
    expect(stderr).toContain("E0003 Program has no app definition [no-repair-branch]");
  });
});
