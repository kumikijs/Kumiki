// Real-browser verification tier. Runs the SAME scenario format as the headless-DOM
// `runScenario`, but in Chromium via Playwright, so it catches what a headless DOM can't:
// CSS layout / visibility, real focus management, and real rendering. State is
// still the oracle — read from `window.__kumikiApp.live` in the page.

import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import type { Action as ScenarioAction } from "@kumikijs/runtime";
import { type ConsoleMessage, chromium, type Page, type Route } from "playwright";

export type Action =
  | { dispatch: string; payload?: Record<string, unknown> }
  | { clickText: string }
  | { click: string }
  | { focus: string }
  | { blur: string }
  | { fill: string; value: string }
  | { choose: string; value: string }
  | { navigate: string }
  /**
   * Set a live DOM property on the element matched by `selector`. Seeds
   * browser-owned state a Kumiki reducer has no way to produce (e.g.
   * `<video>.currentTime = 3` before triggering a re-render).
   */
  | { setProperty: string; property: string; value: unknown }
  /** Submit the form at, or above, the element the selector matches. */
  | { submit: string }
  /** Wait this many milliseconds on top of the step's own settle. */
  | { wait: number };

export type Expect = {
  noErrors?: boolean;
  state?: Record<string, unknown>;
  domIncludes?: string[];
  domExcludes?: string[];
  /** Browser-only: a CSS selector that must be the focused element. */
  focused?: string;
  /** Browser-only: text that must be actually visible (computed style, not just present). */
  visible?: string[];
  /** Browser-only: text that must NOT be visible. */
  hidden?: string[];
  /**
   * Browser-only: CSS selectors that must carry a running keyframe animation
   * (`getComputedStyle().animationName !== "none"`). A headless DOM can't observe this —
   * it's the verification tier for the `motion` layer.
   */
  animating?: string[];
  /**
   * Browser-only: assert on live element properties, keyed by CSS selector.
   * Each value is a `{ property: expectedValue }` map read via
   * `document.querySelector(sel)[property]`. Proves that `<select>` open
   * state / `<video>` currentTime / `<details>` open / `contenteditable`
   * textContent survive a re-render mid-interaction — behaviour a state-only
   * oracle cannot see.
   */
  elementState?: Record<string, Record<string, unknown>>;
};

export type ScenarioStep = { label?: string; do?: Action; expect?: Expect };
export type Scenario = { steps: ScenarioStep[] };

/**
 * The closed sets this tier answers for — the headless runner's, plus the
 * browser-only names it adds. Kept as lists rather than derived from the types
 * because the check is what makes a fixture's claim falsifiable: a key nobody
 * evaluates is a fixture that passes having asserted nothing.
 */
const EXPECT_KEYS = [
  "noErrors",
  "state",
  "domIncludes",
  "domExcludes",
  "focused",
  "visible",
  "hidden",
  "animating",
  "elementState",
] as const satisfies readonly (keyof Expect)[];

/**
 * Keys the scenario tier owns. `errorIncludes` asks the runner to *require* an
 * error, and this tier treats every reported error as fatal — a fixture using
 * it cannot pass either way, so it is named rather than accepted. It used to
 * sit in the list above while `evaluateExpect` never read it, which is the
 * exact vacuity the closed set exists to stop.
 */
const SCENARIO_EXPECT_KEYS = ["errorIncludes"] as const;

/**
 * Actions the scenario tier owns. Both are dispatched there as synthetic DOM
 * events on the tile element; here they would have to be a real key press and a
 * real pointer move, which is a different thing to verify and not yet wired.
 * Named rather than left to fall through as "unknown", so a fixture that used
 * them is told which tier runs it instead of being told they do not exist.
 */
const SCENARIO_ACTION_KEYS = ["key", "hover"] as const satisfies readonly ScenarioOnly[];

/**
 * Pinned to the scenario tier's own `Action`, in both directions. `satisfies`
 * above rejects a name that tier does not have; `Covers` below rejects one it
 * has and this list forgot, which would degrade the message back to "unknown
 * action". And the day this tier implements one of them, `Exclude` drops it
 * from `ScenarioOnly` and the `satisfies` fails — without that, the gate keeps
 * short-circuiting and the new implementation is unreachable.
 */
type ScenarioActionKind = ScenarioAction extends infer A
  ? A extends unknown
    ? keyof A
    : never
  : never;
type ScenarioOnly = Exclude<ScenarioActionKind, ActionKind | (typeof ACTION_MODIFIERS)[number]>;
type _ScenarioOnlyCovered = Covers<ScenarioOnly, (typeof SCENARIO_ACTION_KEYS)[number]>;

const ACTION_KEYS = [
  "dispatch",
  "clickText",
  "click",
  "focus",
  "blur",
  "fill",
  "choose",
  "navigate",
  "submit",
  "wait",
  "setProperty",
] as const satisfies readonly ActionKind[];

/** Fields that accompany an action kind rather than naming one. */
const ACTION_MODIFIERS = ["payload", "value", "property"] as const;

/**
 * Both lists are pinned to the types in both directions, at no runtime cost:
 * `satisfies` rejects a listed key the type no longer has, and the assertions
 * below reject a key the type has and the list forgot — the direction that
 * matters, because a forgotten key is silently skipped.
 */
type ActionKind = Action extends infer A ? (A extends unknown ? keyof A : never) : never;
type Covers<Whole extends Part, Part> = Whole;
type _ExpectKeysCovered = Covers<
  keyof Expect,
  (typeof EXPECT_KEYS)[number] | (typeof SCENARIO_EXPECT_KEYS)[number]
>;
type _ActionKindsCovered = Covers<
  Exclude<ActionKind, (typeof ACTION_MODIFIERS)[number]>,
  (typeof ACTION_KEYS)[number]
>;

/** How long a `wait` may ask for — the scenario tier's bound, so a fixture promotes unchanged. */
const MAX_WAIT_MS = 60_000;

/**
 * Every problem in a fixture, in the order they appear. Empty for one this
 * tier can execute.
 */
export function validateScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  // `effects` is the scenario tier's capability-boundary mock, and this tier
  // drives a real browser on purpose. Silently ignoring it would let a fixture
  // believe its HTTP was stubbed while the request went out for real.
  if ((scenario as { effects?: unknown }).effects !== undefined) {
    problems.push('"effects" is not supported by the browser tier: it drives a real browser');
  }
  // A misspelled `steps` reads as absent, so every assertion under it is
  // skipped and the fixture passes having checked nothing — the same failure
  // the key lists below guard against, one level up.
  for (const key of Object.keys(scenario as Record<string, unknown>)) {
    if (key === "steps" || key === "effects") continue;
    problems.push(`unknown scenario key "${key}" (steps)`);
  }
  if (!Array.isArray(scenario.steps)) {
    problems.push('a fixture needs a "steps" array');
    return problems;
  }
  if (scenario.steps.length === 0) {
    problems.push("a fixture with no steps asserts nothing");
  }
  const steps = scenario.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const where = `steps[${i}]${step.label ? ` (${step.label})` : ""}`;
    if (step.do !== undefined) problems.push(...validateAction(step.do, where));
    for (const key of Object.keys((step.expect ?? {}) as Record<string, unknown>)) {
      if ((EXPECT_KEYS as readonly string[]).includes(key)) continue;
      if ((SCENARIO_EXPECT_KEYS as readonly string[]).includes(key)) {
        problems.push(
          `${where}: "${key}" is a scenario-tier assertion; this tier treats every reported error as fatal`,
        );
        continue;
      }
      problems.push(`${where}: unknown expect key "${key}" (${EXPECT_KEYS.join(", ")})`);
    }
  }
  return problems;
}

export type StepResult = {
  label?: string;
  action?: string;
  errors: string[];
  state: Record<string, unknown>;
  visibleText: string;
  failures: string[];
};

export type BrowserReport = { ok: boolean; steps: StepResult[] };

export type BrowserOptions = { headed?: boolean; settleMs?: number };

// Escape any literal `</script` so it can't terminate the inline module.
const escapeScript = (js: string): string => js.replace(/<\/script/gi, "<\\/script");

function buildHtml(js: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}</style></head>
<body><div id="root"></div><script type="module">${escapeScript(js)}</script></body></html>`;
}

/** Root `i` is `#kumiki-root-<i>`; inline module scripts execute in document order. */
function buildHtmlMulti(bundles: string[]): string {
  const body = bundles
    .map(
      (js, i) =>
        `<div id="kumiki-root-${i}"></div><script type="module">${escapeScript(js)}</script>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}</style></head>
<body>${body}</body></html>`;
}

/**
 * Re-target one compiled bundle for co-mounting: auto-mount into its own root
 * div, and register the instance in `window.__kumikiApps` (the single
 * `__kumikiApp` oracle is last-write-wins by construction, so the multi runner
 * reads the array instead). Both replaces are verbatim matches against codegen
 * output; a silent miss would surface as a bewildering mount-into-nothing or a
 * ready-wait timeout, so an unmatched pattern throws instead.
 */
function patchBundleForMulti(js: string, index: number): string {
  const retargeted = replaceOrThrow(
    js,
    'document.getElementById("root")',
    `document.getElementById("kumiki-root-${index}")`,
    "auto-mount root lookup",
  );
  return replaceOrThrow(
    retargeted,
    "globalThis.__kumikiApp = App;",
    "globalThis.__kumikiApp = App;\n(globalThis.__kumikiApps = globalThis.__kumikiApps || []).push(App);",
    "state-oracle assignment",
  );
}

function replaceOrThrow(js: string, search: string, replacement: string, what: string): string {
  const out = js.replace(search, replacement);
  if (out === js) {
    throw new Error(
      `patchBundleForMulti: ${what} (${JSON.stringify(search)}) not found in the compiled bundle — codegen output drifted; update the patch patterns`,
    );
  }
  return out;
}

// A synthetic origin the tier-3 runner serves the built app under. The default
// history-based router uses `history.pushState`, which throws a SecurityError on
// the null origin returned by page.setContent (about:blank) and data: URLs.
// Serving from a real (intercepted) HTTP origin lets `navigate` actions round-
// trip through `pushState` the way a shipped page would.
const KUMIKI_HOST = "http://kumiki.local";
const KUMIKI_DOC_URL = `${KUMIKI_HOST}/`;
const KUMIKI_ROUTE_GLOB = `${KUMIKI_HOST}/**`;

export async function runScenarioInBrowser(
  source: string,
  scenario: Scenario,
  opts: BrowserOptions = {},
): Promise<BrowserReport> {
  const browser = await chromium.launch({ headless: !opts.headed });
  try {
    const page = await browser.newPage();
    return await runOnPage(page, source, scenario, opts);
  } finally {
    await browser.close();
  }
}

/**
 * Drive a scenario against an already-open Playwright `Page`. Console / pageerror
 * listeners and the route interceptor installed here are removed before return,
 * so the same `Page` can be reused for another `runOnPage` call without leaking
 * handlers or having the first invocation's HTML shadow the second.
 */
export async function runOnPage(
  page: Page,
  source: string,
  scenario: Scenario,
  opts: BrowserOptions = {},
): Promise<BrowserReport> {
  const settleMs = opts.settleMs ?? 60;
  const compiled = compile(source, {
    runtimeSpecifier: "",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
  });
  if (compiled.kind !== "ok") {
    return compileFailure(
      "compile",
      compiled.errors.map((e) => `${e.code} ${e.message}`),
    );
  }
  return serveScenario(
    page,
    buildHtml(compiled.js),
    scenario,
    settleMs,
    "window.__kumikiApp !== undefined",
    snapshotStateFn,
  );
}

/**
 * Drive one scenario against SEVERAL compiled apps co-mounted on a single page
 * (the multi-mount isolation tier). App `i` auto-mounts into `#kumiki-root-<i>`
 * and registers in `window.__kumikiApps`; state keys in `expect.state` are
 * namespaced by app index (`"0.count"`, `"1.name"`). Scope DOM actions to a
 * root (`{"click": "#kumiki-root-0 button"}`); `dispatch` / `navigate` go
 * through the single-app `__kumikiApp` oracle (last bundle wins) — avoid them
 * in multi fixtures.
 */
export async function runMultiOnPage(
  page: Page,
  sources: string[],
  scenario: Scenario,
  opts: BrowserOptions = {},
): Promise<BrowserReport> {
  const settleMs = opts.settleMs ?? 60;
  const bundles: string[] = [];
  for (const [i, source] of sources.entries()) {
    const compiled = compile(source, {
      runtimeSpecifier: "",
      bundle: true,
      readRuntimeBundle: nodeRuntimeBundleReader,
    });
    if (compiled.kind !== "ok") {
      return compileFailure(
        `compile app ${i}`,
        compiled.errors.map((e) => `${e.code} ${e.message}`),
      );
    }
    bundles.push(patchBundleForMulti(compiled.js, i));
  }
  return serveScenario(
    page,
    buildHtmlMulti(bundles),
    scenario,
    settleMs,
    `window.__kumikiApps !== undefined && window.__kumikiApps.length === ${sources.length}`,
    snapshotMultiStateFn,
  );
}

function compileFailure(action: string, errors: string[]): BrowserReport {
  return {
    ok: false,
    steps: [{ action, errors, state: {}, visibleText: "", failures: ["did not compile"] }],
  };
}

/**
 * Serve `html` at the synthetic origin and drive the scenario. `readyExpr`
 * gates the first step; `stateFn` is the serialized state-oracle read.
 */
async function serveScenario(
  page: Page,
  html: string,
  scenario: Scenario,
  settleMs: number,
  readyExpr: string,
  stateFn: string,
): Promise<BrowserReport> {
  const steps: StepResult[] = [];
  let errorBuf: string[] = [];
  const onConsole = (m: ConsoleMessage): void => {
    if (m.type() === "error") errorBuf.push(m.text());
  };
  const onPageError = (e: Error): void => {
    errorBuf.push(String(e));
  };
  // Serve only the app document at the synthetic origin. Any other request
  // under that origin (subresources, `fetch("/api/...")` from a capability)
  // must NOT get the HTML shell back — that would surface as a confusing JSON
  // parse error inside the app. Abort them so the app sees a real network
  // failure instead of a silently mislabelled response.
  const onRoute = (route: Route): Promise<void> => {
    if (route.request().url() === KUMIKI_DOC_URL) {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    }
    return route.abort();
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  await page.route(KUMIKI_ROUTE_GLOB, onRoute);

  const problems = validateScenario(scenario);
  if (problems.length > 0) {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    await page.unroute(KUMIKI_ROUTE_GLOB, onRoute);
    return {
      ok: false,
      steps: [
        {
          label: "scenario document",
          errors: [],
          state: {},
          visibleText: "",
          failures: problems,
        },
      ],
    };
  }

  try {
    await page.goto(KUMIKI_DOC_URL, { waitUntil: "load" });
    await page.waitForFunction(readyExpr, null, { timeout: 5000 });
    await page.waitForTimeout(settleMs);

    for (const step of scenario.steps) {
      errorBuf = [];
      const actionDesc = step.do ? describeAction(step.do) : undefined;
      if (step.do) {
        try {
          await performAction(page, step.do);
        } catch (e) {
          errorBuf.push(`action failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        await page.waitForTimeout(settleMs);
      }
      const state = (await page.evaluate(stateFn).catch(() => ({}))) as Record<string, unknown>;
      const visibleText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const failures = await evaluateExpect(page, step.expect, errorBuf, state, visibleText);
      const r: StepResult = { errors: [...errorBuf], state, visibleText, failures };
      if (step.label !== undefined) r.label = step.label;
      if (actionDesc !== undefined) r.action = actionDesc;
      steps.push(r);
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    await page.unroute(KUMIKI_ROUTE_GLOB, onRoute);
  }

  // The browser tier is strict on uncaught errors by design: a JS exception or
  // console error in the app is a real defect that must not slip through as
  // "green with warnings". `expect.noErrors` in a fixture is therefore
  // redundant here — accepted for scenario-format compatibility, but not
  // load-bearing.
  const ok = steps.every((s) => s.errors.length === 0 && s.failures.length === 0);
  return { ok, steps };
}

// Serialized into the page to read sanitized slot state.
const snapshotStateFn = `(() => {
  const live = (window.__kumikiApp && window.__kumikiApp.live) || {};
  const seen = new WeakSet();
  const san = (v) => {
    if (v === null || typeof v !== "object") return typeof v === "function" ? "[fn]" : v;
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(san);
    const o = {};
    for (const k of Object.keys(v)) { if (typeof v[k] !== "function") o[k] = san(v[k]); }
    return o;
  };
  const out = {};
  for (const k of Object.keys(live)) { if (k !== "route") out[k] = san(live[k]); }
  return out;
})()`;

// Multi-mount variant: `{"0": {...app0 slots...}, "1": {...}}` — `readPath`
// then resolves namespaced expect keys like `"0.count"` with no extra glue.
const snapshotMultiStateFn = `(() => {
  const apps = window.__kumikiApps || [];
  const seen = new WeakSet();
  const san = (v) => {
    if (v === null || typeof v !== "object") return typeof v === "function" ? "[fn]" : v;
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(san);
    const o = {};
    for (const k of Object.keys(v)) { if (typeof v[k] !== "function") o[k] = san(v[k]); }
    return o;
  };
  const out = {};
  apps.forEach((app, i) => {
    const live = (app && app.live) || {};
    const o = {};
    for (const k of Object.keys(live)) { if (k !== "route") o[k] = san(live[k]); }
    out[String(i)] = o;
  });
  return out;
})()`;

/**
 * The kinds AND the values, matching the scenario tier. Both files open by
 * promising the same scenario format, and `submit` / `wait` exist so a fixture
 * can be promoted from tier 2 to tier 3 unchanged — a `{"wait": "500"}` that
 * one tier refuses and the other hands to `waitForTimeout` breaks that promise.
 */
function validateAction(action: Action, where: string): string[] {
  const keys = Object.keys(action as Record<string, unknown>);
  const kinds = keys.filter((k) => !(ACTION_MODIFIERS as readonly string[]).includes(k));
  const scenarioOnly = kinds.filter((k) => (SCENARIO_ACTION_KEYS as readonly string[]).includes(k));
  if (scenarioOnly.length > 0) {
    return [
      `${where}: "${scenarioOnly[0]}" is a scenario-tier action; run this fixture with kumiki run`,
    ];
  }
  const unknown = kinds.filter((k) => !(ACTION_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return [`${where}: unknown action "${unknown[0]}" (${ACTION_KEYS.join(", ")})`];
  }
  if (kinds.length === 0) return [`${where}: "do" names no action (${ACTION_KEYS.join(", ")})`];
  if (kinds.length > 1) {
    return [`${where}: "do" names ${kinds.join(" and ")}; a step does exactly one thing`];
  }
  const kind = kinds[0];
  const a = action as Record<string, unknown>;
  if ((kind === "fill" || kind === "choose") && typeof a.value !== "string") {
    return [`${where}: "${kind}" needs a string "value"`];
  }
  if (kind === "setProperty" && typeof a.property !== "string") {
    return [`${where}: "setProperty" needs a "property" name`];
  }
  if (
    kind === "wait" &&
    !(typeof a.wait === "number" && Number.isFinite(a.wait) && a.wait >= 0 && a.wait <= MAX_WAIT_MS)
  ) {
    return [`${where}: "wait" needs a duration in milliseconds, 0 to ${MAX_WAIT_MS}`];
  }
  return [];
}

function describeAction(a: Action): string {
  if ("dispatch" in a) return `dispatch ${a.dispatch}`;
  if ("clickText" in a) return `clickText "${a.clickText}"`;
  if ("click" in a) return `click ${a.click}`;
  if ("focus" in a) return `focus ${a.focus}`;
  if ("blur" in a) return `blur ${a.blur}`;
  if ("fill" in a) return `fill ${a.fill}="${a.value}"`;
  if ("choose" in a) return `choose ${a.choose}="${a.value}"`;
  if ("submit" in a) return `submit ${a.submit}`;
  if ("wait" in a) return `wait ${a.wait}ms`;
  if ("setProperty" in a)
    return `setProperty ${a.setProperty}.${a.property}=${JSON.stringify(a.value)}`;
  return `navigate ${a.navigate}`;
}

async function performAction(page: Page, a: Action): Promise<void> {
  if ("wait" in a) {
    await page.waitForTimeout(a.wait);
    return;
  }
  if ("submit" in a) {
    // `requestSubmit()` rather than a synthetic event: this tier exists to run
    // the real thing, so constraint validation and the browser's own submit
    // sequence are part of what it verifies. The selector may name the form or
    // anything inside it, as at the scenario tier.
    await page
      .locator(a.submit)
      .first()
      .evaluate((el: Element) => {
        const form = el instanceof HTMLFormElement ? el : el.closest("form");
        if (!form) throw new Error("no form at or above the selector");
        form.requestSubmit();
      });
    return;
  }
  if ("dispatch" in a) {
    await page.evaluate(
      (arg: { n: string; p: Record<string, unknown> }) =>
        window.__kumikiApp?._dispatch?.(arg.n, arg.p),
      { n: a.dispatch, p: (a.payload ?? {}) as Record<string, unknown> },
    );
    return;
  }
  if ("navigate" in a) {
    await page.evaluate((path: string) => window.__kumikiApp?._navigate?.(path), a.navigate);
    return;
  }
  if ("clickText" in a) {
    await page
      .locator("button, a, [role=button]")
      .filter({ hasText: a.clickText })
      .first()
      .click({ timeout: 3000 });
    return;
  }
  if ("click" in a) {
    await page.locator(a.click).first().click({ timeout: 3000 });
    return;
  }
  if ("focus" in a) {
    await page.locator(a.focus).first().focus({ timeout: 3000 });
    return;
  }
  if ("blur" in a) {
    await page.locator(a.blur).first().blur({ timeout: 3000 });
    return;
  }
  if ("fill" in a) {
    await page.locator(a.fill).first().fill(a.value, { timeout: 3000 });
    return;
  }
  if ("setProperty" in a) {
    await page.evaluate(
      (arg: { sel: string; prop: string; val: unknown }) => {
        const el = document.querySelector(arg.sel);
        if (!el) return;
        // Dotted paths land on nested holders like `dataset.foo` or
        // `style.color`. Walk everything but the last segment (must exist),
        // then assign the last segment. Non-existent intermediate props are
        // a no-op (a common test-author mistake worth staying silent about).
        const segs = arg.prop.split(".");
        let host: Record<string, unknown> = el as unknown as Record<string, unknown>;
        for (let i = 0; i < segs.length - 1; i++) {
          const nextRaw = host[segs[i] as string];
          if (nextRaw == null || typeof nextRaw !== "object") return;
          host = nextRaw as Record<string, unknown>;
        }
        host[segs[segs.length - 1] as string] = arg.val;
      },
      { sel: a.setProperty, prop: a.property, val: a.value },
    );
    return;
  }
  // choose
  const loc = page.locator(a.choose).first();
  await loc
    .selectOption({ label: a.value }, { timeout: 3000 })
    .catch(() => loc.selectOption(a.value));
}

async function evaluateExpect(
  page: Page,
  expect: Expect | undefined,
  errors: string[],
  state: Record<string, unknown>,
  visibleText: string,
): Promise<string[]> {
  if (!expect) return [];
  const failures: string[] = [];
  if (expect.noErrors && errors.length > 0) {
    failures.push(`expected no errors but got: ${errors.join("; ")}`);
  }
  for (const [key, want] of Object.entries(expect.state ?? {})) {
    const got = readPath(state, key);
    if (!matches(want, got)) failures.push(`state ${key}: expected ${j(want)}, got ${j(got)}`);
  }
  for (const s of expect.domIncludes ?? []) {
    if (!visibleText.includes(s)) failures.push(`visible text should include "${s}"`);
  }
  for (const s of expect.domExcludes ?? []) {
    if (visibleText.includes(s)) failures.push(`visible text should NOT include "${s}"`);
  }
  if (expect.focused) {
    const isFocused = await page
      .evaluate((sel: string) => !!document.activeElement?.matches(sel), expect.focused)
      .catch(() => false);
    if (!isFocused) failures.push(`expected focus on ${expect.focused}`);
  }
  for (const t of expect.visible ?? []) {
    const vis = await page
      .getByText(t, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (!vis) failures.push(`"${t}" should be visible`);
  }
  for (const t of expect.hidden ?? []) {
    const vis = await page
      .getByText(t, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (vis) failures.push(`"${t}" should be hidden`);
  }
  for (const sel of expect.animating ?? []) {
    const isAnimating = await page
      .evaluate((s: string) => {
        const el = document.querySelector(s);
        if (!el) return false;
        const name = getComputedStyle(el).animationName;
        return name !== "" && name !== "none";
      }, sel)
      .catch(() => false);
    if (!isAnimating) failures.push(`"${sel}" should carry a running animation`);
  }
  for (const [sel, props] of Object.entries(expect.elementState ?? {})) {
    const got = await page
      .evaluate(
        (arg: { s: string; ks: string[] }) => {
          const el = document.querySelector(arg.s) as Record<string, unknown> | null;
          if (!el) return null;
          const out: Record<string, unknown> = {};
          for (const k of arg.ks) out[k] = el[k];
          return out;
        },
        { s: sel, ks: Object.keys(props) },
      )
      .catch(() => null);
    if (!got) {
      failures.push(`elementState ${sel}: element not found`);
      continue;
    }
    for (const [prop, want] of Object.entries(props)) {
      if (!matches(want, got[prop])) {
        failures.push(`elementState ${sel}.${prop}: expected ${j(want)}, got ${j(got[prop])}`);
      }
    }
  }
  return failures;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function matches(want: unknown, got: unknown): boolean {
  if (want === null || typeof want !== "object") return want === got;
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return false;
    return want.every((w, i) => matches(w, got[i]));
  }
  if (got === null || typeof got !== "object") return false;
  const g = got as Record<string, unknown>;
  return Object.entries(want as Record<string, unknown>).every(([k, w]) => matches(w, g[k]));
}

function j(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

declare global {
  interface Window {
    __kumikiApp?: {
      live?: Record<string, unknown>;
      _dispatch?: (n: string, p: Record<string, unknown>) => void;
      _navigate?: (path: string) => void;
    };
    /** Co-mounted instances, in document order (multi-mount runner). */
    __kumikiApps?: Array<{ live?: Record<string, unknown> }>;
  }
}
