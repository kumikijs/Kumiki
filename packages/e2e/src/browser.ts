// Real-browser verification tier. Runs the SAME scenario format as the headless-DOM
// `runScenario`, but in Chromium via Playwright, so it catches what a headless DOM can't:
// CSS layout / visibility, real focus management, and real rendering. State is
// still the oracle — read from `window.__kumikiApp.live` in the page.

import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { type ConsoleMessage, chromium, type Page, type Route } from "playwright";

export type Action =
  | { dispatch: string; payload?: Record<string, unknown> }
  | { clickText: string }
  | { click: string }
  | { focus: string }
  | { blur: string }
  | { fill: string; value: string }
  | { choose: string; value: string }
  | { navigate: string };

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
};

export type ScenarioStep = { label?: string; do?: Action; expect?: Expect };
export type Scenario = { steps: ScenarioStep[] };

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

function buildHtml(js: string): string {
  // Escape any literal `</script` so it can't terminate the inline module.
  const safe = js.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}</style></head>
<body><div id="root"></div><script type="module">${safe}</script></body></html>`;
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
    return {
      ok: false,
      steps: [
        {
          action: "compile",
          errors: compiled.errors.map((e) => `${e.code} ${e.message}`),
          state: {},
          visibleText: "",
          failures: ["did not compile"],
        },
      ],
    };
  }

  const steps: StepResult[] = [];
  let errorBuf: string[] = [];
  const html = buildHtml(compiled.js);
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

  try {
    await page.goto(KUMIKI_DOC_URL, { waitUntil: "load" });
    await page.waitForFunction("window.__kumikiApp !== undefined", null, { timeout: 5000 });
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
      const state = (await page.evaluate(snapshotStateFn).catch(() => ({}))) as Record<
        string,
        unknown
      >;
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

function describeAction(a: Action): string {
  if ("dispatch" in a) return `dispatch ${a.dispatch}`;
  if ("clickText" in a) return `clickText "${a.clickText}"`;
  if ("click" in a) return `click ${a.click}`;
  if ("focus" in a) return `focus ${a.focus}`;
  if ("blur" in a) return `blur ${a.blur}`;
  if ("fill" in a) return `fill ${a.fill}="${a.value}"`;
  if ("choose" in a) return `choose ${a.choose}="${a.value}"`;
  return `navigate ${a.navigate}`;
}

async function performAction(page: Page, a: Action): Promise<void> {
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
  }
}
