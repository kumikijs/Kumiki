import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import {
  type BrowserAction,
  type BrowserExpect,
  type ControlVerb,
  chooseOption,
  constraintFault,
  controlFault,
  type DispatchTarget,
  describeAction,
  dispatchFault,
  judgeRefusal,
  partialMatch,
  type ScenarioStep as RuntimeScenarioStep,
  readControl,
  readInvalidControls,
  type ScenarioReport,
  type StepOutcome,
  StepRefusal,
  showValue,
  stateMismatches,
  submitFault,
  textMismatches,
  validateScenario as validateScenarioFor,
} from "@kumikijs/runtime";
import { type ConsoleMessage, chromium, type Locator, type Page, type Route } from "playwright";

export type Action = BrowserAction;
export type Expect = BrowserExpect;
export type ScenarioStep = RuntimeScenarioStep<Action, Expect>;
export type Scenario = { steps: ScenarioStep[] };

export function validateScenario(scenario: Scenario): string[] {
  return validateScenarioFor(scenario, "browser");
}

export type StepResult = StepOutcome & { visibleText: string };

export type BrowserReport = ScenarioReport<StepResult>;

export type BrowserOptions = { headed?: boolean; settleMs?: number };

const escapeScript = (js: string): string => js.replace(/<\/script/gi, "<\\/script");

const moduleScript = (js: string): string => `<script type="module">${escapeScript(js)}</script>`;

function htmlPage(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}</style></head>
<body>${body}</body></html>`;
}

const buildHtml = (js: string): string => htmlPage(`<div id="root"></div>${moduleScript(js)}`);

/** Root `i` is `#kumiki-root-<i>`; inline module scripts execute in document order. */
const buildHtmlMulti = (bundles: string[]): string =>
  htmlPage(
    bundles.map((js, i) => `<div id="kumiki-root-${i}"></div>${moduleScript(js)}`).join("\n"),
  );

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
    steps: [
      { ok: false, action, errors, state: {}, visibleText: "", failures: ["did not compile"] },
    ],
  };
}

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
  const onRoute = (route: Route): Promise<void> => {
    if (route.request().url() === KUMIKI_DOC_URL) {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    }
    return route.abort();
  };

  const problems = validateScenario(scenario);
  if (problems.length > 0) {
    return {
      ok: false,
      steps: [
        {
          ok: false,
          label: "scenario document",
          errors: [],
          state: {},
          visibleText: "",
          failures: problems,
        },
      ],
    };
  }

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  await page.route(KUMIKI_ROUTE_GLOB, onRoute);
  try {
    await page.goto(KUMIKI_DOC_URL, { waitUntil: "load" });
    await page.waitForFunction(readyExpr, null, { timeout: 5000 });
    await page.waitForTimeout(settleMs);

    for (const step of scenario.steps) {
      errorBuf = [];
      const actionDesc = step.do ? describeAction(step.do) : undefined;
      let fault: { message: string; refusal?: StepRefusal } | undefined;
      if (step.do) {
        try {
          await performAction(page, step.do);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          fault = e instanceof StepRefusal ? { message, refusal: e } : { message };
        }
        await page.waitForTimeout(settleMs);
      }
      const state = (await page.evaluate(stateFn).catch(() => ({}))) as Record<string, unknown>;
      const visibleText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const verdict = judgeRefusal(step.expect?.actionErrorIncludes ?? [], fault);
      const failures = [
        ...verdict.failures,
        ...(await evaluateExpect(page, step.expect, errorBuf, state, visibleText)),
      ];
      const actionError = verdict.claimed === undefined ? fault?.message : undefined;
      const r: StepResult = {
        ok: errorBuf.length === 0 && failures.length === 0 && actionError === undefined,
        errors: [...errorBuf],
        state,
        visibleText,
        failures,
      };
      if (actionError !== undefined) r.actionError = actionError;
      if (verdict.claimed !== undefined) r.expectedActionError = verdict.claimed;
      if (step.label !== undefined) r.label = step.label;
      if (actionDesc !== undefined) r.action = actionDesc;
      steps.push(r);
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    await page.unroute(KUMIKI_ROUTE_GLOB, onRoute);
  }

  return { ok: steps.every((s) => s.ok), steps };
}

// Evaluated in the page: copies an app's slots without functions, cycles or the route.
const sanitizeLiveSrc = `
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
  const slotsOf = (app) => {
    const live = (app && app.live) || {};
    const o = {};
    for (const k of Object.keys(live)) { if (k !== "route") o[k] = san(live[k]); }
    return o;
  };`;

const snapshotStateFn = `(() => {${sanitizeLiveSrc}
  return slotsOf(window.__kumikiApp);
})()`;

const snapshotMultiStateFn = `(() => {${sanitizeLiveSrc}
  const out = {};
  (window.__kumikiApps || []).forEach((app, i) => { out[String(i)] = slotsOf(app); });
  return out;
})()`;

async function refuse(loc: Locator, verb: ControlVerb, where: string): Promise<void> {
  const state = await loc.evaluate(readControl, undefined, { timeout: 3000 });
  const fault = controlFault(verb, where, state);
  if (fault) throw fault;
}

export async function performAction(page: Page, a: Action): Promise<void> {
  if ("wait" in a) {
    await page.waitForTimeout(a.wait);
    return;
  }
  if ("submit" in a) {
    const where = describeAction(a);
    const target = page.locator(a.submit).first();
    const outcome = await target.evaluate(
      (el: Element) => {
        const form = el instanceof HTMLFormElement ? el : el.closest("form");
        if (!form) return { kind: "no form" as const };
        const root = form.closest("#root, [id^='kumiki-root-']");
        const multi = window.__kumikiApps;
        const owner =
          root === null
            ? undefined
            : root.id === "root"
              ? multi
                ? undefined
                : window.__kumikiApp
              : multi?.[Number(root.id.slice("kumiki-root-".length))];
        if (!owner) return { kind: "no owner" as const };
        const asker = owner._submitHeldBy;
        if (typeof asker !== "function") return { kind: "no seam" as const };
        let fired = false;
        let held: readonly string[] | undefined;
        const ask = (e: Event): void => {
          fired = true;
          held = asker(e);
        };
        form.addEventListener("submit", ask);
        try {
          form.requestSubmit();
        } finally {
          form.removeEventListener("submit", ask);
        }
        return { kind: "asked" as const, fired, held: held ? [...held] : [] };
      },
      undefined,
      { timeout: 3000 },
    );
    if (outcome.kind === "no form") throw new Error(`no form at or above selector ${a.submit}`);
    if (outcome.kind === "no owner") {
      throw new Error(`${where}: the form sits in no app root this page mounted`);
    }
    if (outcome.kind === "no seam") {
      throw new Error(
        `${where}: the app that owns the form carries no \`_submitHeldBy\` seam, so nothing can say whether the form held the submit back`,
      );
    }
    if (!outcome.fired) {
      const invalid = await target.evaluate(readInvalidControls, undefined, { timeout: 3000 });
      const stopped = constraintFault(where, invalid);
      if (stopped) throw stopped;
      throw new Error(
        `${where}: requestSubmit() fired no submit event, and no control in the form reports a failed constraint`,
      );
    }
    const fault = submitFault(where, outcome.held);
    if (fault) throw fault;
    return;
  }
  if ("dispatch" in a) {
    const payload = (a.payload ?? {}) as Record<string, unknown>;
    const targets = await page.evaluate(
      () =>
        window.__kumikiApp?.reducers?.map((r) => ({ name: r.name, id: r.selector?.id ?? null })) ??
        null,
    );
    if (targets === null) throw new Error("dispatch: the page exposes no reducers to drive");
    const fault = dispatchFault(a.dispatch, payload, targets as DispatchTarget[]);
    if (fault) throw new Error(fault);
    const drove = await page.evaluate(
      (arg: { n: string; p: Record<string, unknown> }) => {
        if (typeof window.__kumikiApp?._dispatch !== "function") return false;
        window.__kumikiApp._dispatch(arg.n, arg.p);
        return true;
      },
      { n: a.dispatch, p: payload },
    );
    if (!drove) throw new Error("dispatch: the page carries no `_dispatch` seam to drive");
    return;
  }
  if ("navigate" in a) {
    const navigated = await page.evaluate((path: string) => {
      if (typeof window.__kumikiApp?._navigate !== "function") return false;
      window.__kumikiApp._navigate(path);
      return true;
    }, a.navigate);
    if (!navigated) throw new Error("navigate: the page carries no `_navigate` seam to drive");
    return;
  }
  if ("clickText" in a) {
    const target = page
      .locator("button, a, [role=button]")
      .filter({ hasText: a.clickText })
      .first();
    await refuse(target, "clickText", describeAction(a));
    await target.click({ timeout: 3000 });
    return;
  }
  if ("click" in a) {
    const target = page.locator(a.click).first();
    await refuse(target, "click", describeAction(a));
    await target.click({ timeout: 3000 });
    return;
  }
  if ("focus" in a) {
    const target = page.locator(a.focus).first();
    await refuse(target, "focus", describeAction(a));
    await target.focus({ timeout: 3000 });
    return;
  }
  if ("blur" in a) {
    const target = page.locator(a.blur).first();
    await refuse(target, "blur", describeAction(a));
    await target.blur({ timeout: 3000 });
    return;
  }
  if ("fill" in a) {
    const target = page.locator(a.fill).first();
    await refuse(target, "fill", describeAction(a));
    const found = await target.evaluate(
      (el: Element) => ({
        tag: el.tagName.toLowerCase(),
        fillable:
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el.getAttribute("contenteditable") !== null,
      }),
      undefined,
      { timeout: 3000 },
    );
    if (!found.fillable) {
      throw new Error(
        `${a.fill} matched <${found.tag}>, which holds no text to fill — ` +
          "fill targets input / textarea / editable",
      );
    }
    await target.fill(a.value, { timeout: 3000 });
    return;
  }
  if ("setProperty" in a) {
    // Through a locator, as every other verb finds its element: a render gets the same 3s to
    // attach it, and a selector matching nothing fails the step in the same words.
    await page
      .locator(a.setProperty)
      .first()
      .evaluate(
        (el: Element, arg: { prop: string; val: unknown }) => {
          const segs = arg.prop.split(".");
          let host: Record<string, unknown> = el as unknown as Record<string, unknown>;
          for (let i = 0; i < segs.length - 1; i++) {
            const nextRaw = host[segs[i] as string];
            if (nextRaw == null || typeof nextRaw !== "object") return;
            host = nextRaw as Record<string, unknown>;
          }
          host[segs[segs.length - 1] as string] = arg.val;
        },
        { prop: a.property, val: a.value },
        { timeout: 3000 },
      );
    return;
  }
  const loc = page.locator(a.choose).first();
  await refuse(loc, "choose", describeAction(a));
  // The scenario tier's rule, asked in the page; Playwright gets the index, so a missing option
  // fails in the same words at both tiers rather than in a timeout that never names the value.
  const choice = await loc.evaluate(
    chooseOption,
    { selector: a.choose, value: a.value },
    { timeout: 3000 },
  );
  if ("fault" in choice) throw new Error(choice.fault);
  await loc.selectOption({ index: choice.index }, { timeout: 3000 });
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
  failures.push(...stateMismatches(expect.state ?? {}, state));
  failures.push(...textMismatches(expect, visibleText, "visible text"));
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
      if (!partialMatch(want, got[prop])) {
        failures.push(
          `elementState ${sel}.${prop}: expected ${showValue(want)}, got ${showValue(got[prop])}`,
        );
      }
    }
  }
  return failures;
}

declare global {
  interface Window {
    __kumikiApp?: {
      live?: Record<string, unknown>;
      /** Only what a `{dispatch}` precondition reads; the real shape carries far more. */
      reducers?: Array<{ name: string; selector?: { tile: string; id?: string } }>;
      _dispatch?: (n: string, p: Record<string, unknown>) => void;
      _navigate?: (path: string) => void;
      _submitHeldBy?: (e: Event) => readonly string[] | undefined;
    };
    /** Co-mounted instances, in document order (multi-mount runner). */
    __kumikiApps?: Array<{
      live?: Record<string, unknown>;
      _submitHeldBy?: (e: Event) => readonly string[] | undefined;
    }>;
  }
}
