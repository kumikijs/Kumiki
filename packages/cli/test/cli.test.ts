import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER_PATH = resolve(here, "../../examples/apps/01-counter/app.kumiki");
const ROUTING_PATH = resolve(here, "../../examples/features/18-routing.kumiki");
const STORAGE_PATH = resolve(here, "../../examples/features/20-effect-storage.kumiki");
const CLI_PATH = resolve(here, "../src/kumiki.ts");

describe("kumiki build CLI (per-app DCE, #71)", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "kumiki-cli-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function build(input: string): void {
    execFileSync("npx", ["tsx", CLI_PATH, "build", input, outDir], {
      stdio: "pipe",
      shell: true,
    });
  }

  it("counter ships index.html, app.js, and ONLY its runtime modules", { timeout: 30000 }, () => {
    build(COUNTER_PATH);
    expect(existsSync(join(outDir, "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "app.js"))).toBe(true);
    // The monolithic runtime.js is gone — replaced by the pruned module set.
    expect(existsSync(join(outDir, "runtime.js"))).toBe(false);
    const expected = ["core.js", "stdlib.js", "tiles-layout.js", "tiles-text.js", "tiles-input.js"];
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
    expect(app).toContain('__kumikiApp._dispatch("inc"');

    // Size acceptance (#71): the counter runtime payload is well below the
    // full minified bundle (~50KB raw / 15.2KB gzip shipped before this).
    const total = expected
      .map((f) => readFileSync(join(outDir, "runtime", f)).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(35_000);
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
      // app.js auto-mounts into #root and imports "./runtime/*.js" relatively,
      // so this exercises the exact artifact set `kumiki build` ships.
      await import(pathToFileURL(join(outDir, "app.js")).href);
      expect(root.textContent).toContain("Count: 0");
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
    // The history router reads the ambient location; force the memory router so
    // the test is independent of the happy-dom URL.
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

// Regression (PR #15 review): `smoke`/`run` go through their own loadApp in
// src/smoke.ts, which must also thread the kumiki.caps.json capabilities.
// Otherwise a file using a manifest capability passes `check`/`build` but fails
// with E0302 before smoke/scenario can run.
describe("kumiki smoke with a manifest-registered capability", () => {
  const CUSTOM_CAP = resolve(here, "../../examples/features/27-custom-capability.kumiki");

  it("smokes a file whose capability is declared in kumiki.caps.json", { timeout: 30000 }, () => {
    const out = execFileSync("npx", ["tsx", CLI_PATH, "smoke", CUSTOM_CAP], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    expect(out).toContain("ok");
  });
});

describe("kumiki test (in-language test runner)", () => {
  const TESTS = resolve(here, "../../examples/features/28-tests.kumiki");

  it("runs reducer-test + tile-test definitions and reports pass", { timeout: 30000 }, () => {
    const out = execFileSync("npx", ["tsx", CLI_PATH, "test", TESTS], {
      stdio: "pipe",
      shell: true,
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

  it("filters by a name prefix", { timeout: 30000 }, () => {
    const out = execFileSync("npx", ["tsx", CLI_PATH, "test", TESTS, "inc-i*"], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    expect(out).toContain("PASS  inc-increments");
    expect(out).toContain("1/1 passed");
    expect(out).not.toContain("dec-decrements");
  });

  it("reports per-test timings and a property case count", { timeout: 30000 }, () => {
    const out = execFileSync("npx", ["tsx", CLI_PATH, "test", TESTS], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    expect(out).toMatch(/PASS {2}inc-increments \(\d+ms\)/);
    expect(out).toMatch(/PASS {2}inc-dec-roundtrips \(100 cases, \d+ms\)/);
  });

  it("--coverage reports reducer / effect / tile coverage", { timeout: 30000 }, () => {
    const out = execFileSync("npx", ["tsx", CLI_PATH, "test", TESTS, "--coverage"], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    expect(out).toContain("coverage");
    expect(out).toMatch(/reducers {2}4\/4/);
    expect(out).toMatch(/tiles {5}2\/5/);
    expect(out).toContain("uncovered:");
  });
});

// M4b: `kumiki fix --auto-patch <test-name>`. These exercise the real CLI wiring
// (subprocess) so the in-process DOM of the test runner stays isolated.
describe("kumiki fix --auto-patch (fix from a failing test)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-fixtest-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run the CLI, capturing stdout+stderr and the exit code without throwing. */
  function runCli(args: string[]): { out: string; code: number } {
    try {
      const out = execFileSync("npx", ["tsx", CLI_PATH, ...args], {
        stdio: "pipe",
        shell: true,
        encoding: "utf8",
      });
      return { out, code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
    }
  }

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
    expect(code).toBe(0);
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

  it("reports 'no auto-patch available' for a non-literal mismatch (AC1)", {
    timeout: 30000,
  }, () => {
    const file = join(dir, "no-patch.kumiki");
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
    const { out, code } = runCli(["fix", file, "--auto-patch", "dec-should-add", "--apply"]);
    expect(code).toBe(1);
    expect(out).toContain("no auto-patch available");
    // File untouched — no guessing.
    expect(readFileSync(file, "utf8")).toBe(source);
  });

  // Regression (PR #18 review, Codex P2): when the failing text comes from the
  // test's own `given` data, the literal lives only in the `test` body. Patching
  // it would fake a PASS without fixing any production definition — so test
  // bodies are excluded from the literal search and no patch is offered.
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
