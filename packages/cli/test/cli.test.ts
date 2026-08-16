import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER_PATH = resolve(here, "../../examples/apps/01-counter/app.kumiki");
const ROUTING_PATH = resolve(here, "../../examples/features/18-routing.kumiki");
const STORAGE_PATH = resolve(here, "../../examples/features/20-effect-storage.kumiki");
const INPUT_BIND_PATH = resolve(here, "../../examples/features/13-text-input-bind.kumiki");
const CLI_PATH = resolve(here, "../src/kumiki.ts");
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
    expect(app).toContain('_h("inc")');

    // Size acceptance (#71): the counter runtime payload is well below the
    // full minified bundle (~50KB raw / 15.2KB gzip shipped before this).
    // Bumped to 36KB with the §10.5 episode logger seams in core.ts (#90),
    // then to 36.5KB with the Bytes constructors + polymorphic listSort (#92),
    // then to 37.5KB with the icon SVG resolver in tiles-text (#101 — the
    // counter doesn't use icons, but the resolver code rides on tiles-text).
    // Bumped to 38KB with the SSR/hydration seams in core.ts (#119 —
    // `computeSlotDiffs` + `pickRootTile` exports + MountOptions overlay).
    // Bumped to 39KB with the debounce-episode fidelity additions —
    // `cancelPendingEffect`, `TimerEntry` token plumbing, dispose drain.
    // Bumped to 39.5KB with the per-tile onChange wirings on check/radio/
    // switch in tiles-input (#143 — needed so `ui.change(<Toggle>)` reducers
    // fire; the counter rides on tiles-input via `button`).
    // Bumped to 40.5KB with the multi-mount app registry in core.ts
    // (WeakMap root registry + render-pass bracketing replacing the
    // `__kumikiApp` global, so co-mounted apps never cross-wire).
    // Bumped to 41.5KB when panicInfo grew to walk Error.cause into a
    // JSON-safe chain, KumikiPanic gained a `cause` option, and reportPanic
    // started emitting multi-line stack + cause output so devtools see the
    // root cause instead of just the message.
    // Bumped to 44KB with the tile-level keyed diff (#187) landed in core.ts:
    // the reconcile walker + prop equality kernel + per-render mapping ctx
    // replace the pre-existing full-teardown swap. Payoff is measurable in
    // `packages/benchmarks/reactivity/reactivity-cost.mjs` (waste× drops from
    // 503× to 1× on the 500-tile case).
    // Bumped to 55KB with #190 identity-preserving reconciliation: every
    // tile module exports a companion `patch(el, oldNode, newNode)` alongside
    // its create renderer, plus per-element handler slots on tiles-input /
    // tiles-text (link) / tiles-overlay so `bind` / `to` / `onClose` changes
    // reroute the still-mounted element's listener without add/remove churn.
    // Adds the `details` + `editable` tiles too. Payoff: `<select>` open
    // dropdown, `<video>` currentTime, `<details>` open, `contenteditable`
    // caret all survive a reducer-triggered re-render mid-interaction.
    // Bumped to 56KB with the `never-equal-prop` reconcile diagnostic: the
    // scan that names a host-tile prop the equality kernel can never call
    // equal, so a tile patched on every render stops being invisible. Rides in
    // core.ts because the diagnostics channel is opt-in at RUNTIME, not at
    // build time — a production mount is silent because it passed no
    // `onDiagnostic`, which is what keeps the sink a supported seam in a built
    // artifact rather than a dev-only affordance a bundler strips.
    // Bumped to 57KB with all-or-nothing reducer batches (spec/runtime.md
    // §10.3.3): the per-write refinement check, the rejection merge, and the
    // report that names the slot, value and predicate. Ships in production for
    // the same reason the diagnostic above does — a reducer the runtime refuses
    // to commit is invisible from the DOM, so a built artifact that stayed
    // silent about it would be the defect this budget is meant to protect
    // against, not the size.
    // Bumped to 58KB with `policy=queue` (spec/runtime.md §10.4.3) and
    // `Time.format`'s pattern substitution. Both ride in modules every app
    // ships — the dispatcher in core.ts, the formatter in stdlib.js — because
    // per-app pruning is by module, not by function. A counter pays for them;
    // the alternative is a policy that silently runs in parallel and a
    // formatter that silently ignores its pattern.
    // Bumped to 60KB with per-view mounting (spec/runtime.md §10.9.1): the render
    // pass takes a view record instead of closure locals, and a shape already
    // mounted attaches another view rather than starting a second app. A
    // counter mounted once pays for the indirection and the attach path it
    // never calls — the alternative is what this replaced, where a second mount
    // silently froze the first and the docs said the two would share a state.
    // Bumped to 65KB when the documented tile props started reaching the DOM
    // (spec/stdlib.md §2.3.10, style.md §4.3.1 + §4.4.7): the common-prop
    // attributes and their reconcile diff in core.js, the sizing and theme-token
    // mappings, and per-kind props on button / image / link / divider. A counter
    // uses `gap` and nothing else, and still ships the table — the alternative
    // is what this replaced, where an app wrote `max-w` or `class` and the
    // build was the same size because the prop did nothing at all.
    const total = expected
      .map((f) => readFileSync(join(outDir, "runtime", f)).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(65_000);
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

  it("the built counter patches in place — the heading element survives a bump", {
    timeout: 30000,
  }, async () => {
    // Runtime truth for the identity-preserving reconcile in a REAL build
    // artifact. Every test that mounts through the monolith `mount()` gets the
    // full patcher registry merged in for free, so only an artifact produced by
    // `kumiki build` can prove the granular mount options carry it. Without
    // patchers the heading is torn down and replaced on every count change.
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
    // The heading case above proves the patcher registry is wired at all; this
    // one covers the tile kind where it actually matters, and where a rebuild
    // is hardest to notice. Focus and caret are NOT asserted deliberately: the
    // §10.3.9 snapshot layer restores both even when the element was destroyed
    // and replaced (verified — a patcher-less rebuild still ends with the new
    // input focused at the same offset), so they cannot distinguish a patch
    // from a rebuild. Element identity is the only observable that can in a
    // headless DOM; `<select>` open state and `<video>` playback are the
    // browser-tier concerns identity protects.
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

// `kumiki check --strict-icons` opts into the strict-mode E0704 diagnostic:
// literal `icon(name="<x>")` whose name is in neither @kumikijs/icons nor any
// `theme.icons` block in the source.
describe("kumiki check --strict-icons", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-strict-icons-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

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

  // Critical fix: --strict-icons combined with a scope filter must NOT drop
  // E0704 silently — the strict opt-in is an additive axis, not a sub-band.
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

// #149 — `kumiki check --strict-selector-id` opts into the E0212 diagnostic:
// a `ui.<ev>(Tile#id)` selector whose `#id` cannot match any literal `{id}`
// the target tile declares. Default-off because the PR #148 runtime-filter
// regression test intentionally uses a literal mismatch to prove the runtime
// filter fires; a default-on E0212 would break that test at check time.
describe("kumiki check --strict-selector-id", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-strict-selid-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

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

  // `#nw` is a deliberate typo for `#new`. Runtime `_dispatch` drops the event
  // (el.id === "new" !== "nw"), so without E0212 the `add` reducer never fires.
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

  // Critical: --strict-selector-id combined with a scope filter must NOT drop
  // E0212 silently — the strict opt-in is an additive axis, not a sub-band.
  // `--refs` and `--effects` are the cases that actually depend on the
  // strict-code allowlist: E0212 lives in E02, which `--types` selects anyway,
  // so a `--types` case alone passes even with the allowlist emptied.
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

// #143 — `kumiki check` surfaces W0212 ui-event-tile-mismatch as a non-fatal
// warning: the line appears in stderr, the `ok (N warning(s))` summary lands
// on stdout, and the process exits 0 so build pipelines don't break.
describe("kumiki check (W0212 ui-event-tile-mismatch)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-w0212-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
    const res = spawnSync("npx", ["tsx", CLI_PATH, ...args], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    return {
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      code: res.status ?? (res.error ? 1 : 0),
    };
  }

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

// The capability manifest registers names for a *project*, so it is looked for
// from the source file up to the project root — and when a name is still not
// accepted, the diagnostic says which manifest was read, or where one was
// looked for. Before that, a manifest one directory up was ignored in silence.
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
    const res = spawnSync("npx", ["tsx", CLI_PATH, "check", join(root, "src", "app.kumiki")], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    return {
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      code: res.status ?? (res.error ? 1 : 0),
    };
  }

  it("reads a manifest at the project root, not only beside the source", { timeout: 30000 }, () => {
    writeFileSync(
      join(root, "kumiki.caps.json"),
      JSON.stringify({ capabilities: ["telemetry.track"] }),
    );
    const { stdout, code } = check();
    expect(code).toBe(0);
    expect(stdout).toContain("ok");
  });

  it("names the directories it searched when there is no manifest", { timeout: 30000 }, () => {
    const { stderr, code } = check();
    expect(code).toBe(1);
    expect(stderr).toContain("E0302");
    expect(stderr).toContain("no kumiki.caps.json found");
    expect(stderr).toContain(join(root, "src"));
  });

  it("names the manifest it read when that manifest lacks the capability", {
    timeout: 30000,
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

  // The reducer-test tier has to refuse exactly what the running app refuses.
  // It used to merge a reducer's returned slots over the given ones with no
  // refinement check at all, so a batch the app discards passed here — the tier
  // meant to catch the bug would have certified it.
  it("refuses a batch the app's refinement rejects", { timeout: 30000 }, () => {
    const file = resolve(here, "../../examples/features/63-reducer-batch-atomicity.kumiki");
    const res = spawnSync("npx", ["tsx", CLI_PATH, "test", file], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    expect(res.stdout).toContain("PASS  bump-commits-whole");
    expect(res.stdout).toContain("PASS  bump-at-ceiling-changes-nothing");
    expect(res.stdout).toContain("2/2 passed");
    // The `expect` block alone cannot tell "the batch was refused" from "the
    // reducer degenerated into a no-op" — both leave the slots untouched — so
    // pin the report too. The reducer-test tier has no `errorIncludes`
    // equivalent to express this in-language.
    expect(res.stderr).toContain(
      '[kumiki] reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3))',
    );
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
    // Proposing is not repairing: the test still fails when the process ends,
    // which is what the exit code reports.
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
    // Pre-#156 this returned `no auto-patch available`; the expanded literal /
    // arithmetic tier now rewrites the reducer body so the test passes.
    const { code } = runCli(["fix", file, "--auto-patch", "dec-should-add", "--apply"]);
    expect(code).toBe(0);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("count := count + 1");
    expect(after).not.toContain("count := count - 1");
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

// Spec runtime.md §10.5.3 — `kumiki replay` replays a recorded episode log
// against the compiled app: prints the per-step trace, applies effect mocks,
// and (optionally) stops partway with `--until-step N`.
describe("kumiki replay (episode log replay, §10.5.3)", () => {
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
    // `shell: true` (used by `runCli` for parity with the surrounding test
    // file's style) treats `(...)` as a subshell on POSIX, so the `ok(...)`
    // value has to be wrapped in extra double quotes so bash hands the
    // literal through to npx. The follow-up issue #136 tracks moving the
    // whole file to `shell: false`, after which this can shed the quotes.
    const { out, code } = runCli([
      "replay",
      REPLAY_PERSIST,
      "--from-log",
      REPLAY_PERSIST_LOG,
      "--mock",
      '"persist:ok(null)"',
    ]);
    expect(code).toBe(0);
    // The .ok branch fires: status becomes "saved".
    expect(out).toMatch(/"status":\s*"saved"/);
    // And NOT the .err branch's value.
    expect(out).not.toMatch(/"status":\s*"disk full"/);
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

// `check` is the gate: CI, the MCP server and every editing loop ask it whether
// a file is sound. It used to answer `ok` for a file with no `app` definition —
// including a completely empty one — while `build`, `smoke` and `test` all
// failed on it. E0003 makes the gate agree with the stages behind it.
describe("kumiki check (E0003 missing-app)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-e0003-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
    const res = spawnSync("npx", ["tsx", CLI_PATH, ...args], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    return {
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      code: res.status ?? (res.error ? 1 : 0),
    };
  }

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
      // `check` prints its summary and nothing else on stdout, so an empty
      // stdout is the precise statement that it did not call the file ok.
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

  // `--types/--refs/--effects` narrow along one axis. Structural errors are not
  // on that axis, so no scope selects them — and a filter that drops what no
  // scope can ask for turns every narrowing flag back into the hole above.
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
    // The edit lands; the gate is what reports that the program is not yet
    // an application.
    expect(runCli(["check", file]).code).toBe(1);
  });

  it("catches an app that a cascading remove deleted", { timeout: 60000 }, () => {
    const file = join(dir, "counter.kumiki");
    writeFileSync(file, readFileSync(COUNTER_PATH, "utf8"));
    const removed = runCli(["remove", file, "slot.count", "--cascade"]);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("cascaded app.Counter");
    const { stderr, code } = runCli(["check", file]);
    expect(code).toBe(1);
    expect(stderr).toContain("E0003 missing-app");
  });

  // The mirror image: too many entry points reads as `ok` and then builds into
  // whichever one comes first, dropping the other's routes without a word.
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

  // A repair loop reads the dry run to decide what is left to do. Listing only
  // the repairable diagnostics tells it the file is one patch from clean.
  it("kumiki fix reports the diagnostics it cannot repair, not just the ones it can", {
    timeout: 30000,
  }, () => {
    const file = write("hide.kumiki", "slot count : Int = 0\ntile App = column(text(cout.show))\n");
    const { stdout, stderr, code } = runCli(["fix", file]);
    // A dry run proposes; it does not repair. The file still has both errors
    // when the process ends, so the exit code has to say so.
    expect(code).toBe(1);
    expect(stdout).toContain('fix: replace "cout" with "count"');
    expect(stdout).toContain("(no auto-patch for 1 of 2)");
    // The stable kebab reason rides along — a repair loop branches on it.
    expect(stderr).toContain("E0003 Program has no app definition [no-repair-branch]");
  });
});
