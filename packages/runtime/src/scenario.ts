import {
  type ControlVerb,
  controlFault,
  judgeRefusal,
  readControl,
  StepRefusal,
} from "./control-check.ts";
import { dispatchFault } from "./dispatch-check.ts";
import type { EpisodeLogger } from "./episode.ts";
import type { AppShape, EffectResult, RuntimeDiagnostic } from "./index.ts";
import { mount } from "./index.ts";
import { submitFault } from "./submit-check.ts";
import { standInValue } from "./testkit.ts";

/** One thing to do to the app. Exactly one field should be set. */
export type Action =
  | { dispatch: string; payload?: Record<string, unknown> }
  | { clickText: string }
  | { click: string }
  | { focus: string }
  | { blur: string }
  /** Press a key on the element the selector matches — what a `ui.key` reducer listens for. */
  | { key: string; value: string }
  /** Enter the element the selector matches — what a `ui.hover` reducer listens for. */
  | { hover: string }
  | { fill: string; value: string }
  | { choose: string; value: string }
  | { navigate: string }
  | { submit: string }
  /** Settle for this many milliseconds — a debounce window, a retry backoff, a timer. */
  | { wait: number };

/** Assertions evaluated against the snapshot taken after a step. */
export type Expect = {
  /** No runtime errors since the previous step. */
  noErrors?: boolean;
  errorIncludes?: string[];
  actionErrorIncludes?: string[];
  /** Partial match against the slot state (slot name → expected value). */
  state?: Record<string, unknown>;
  /** Substrings that must appear in the rendered text. */
  domIncludes?: string[];
  /** Substrings that must NOT appear in the rendered text. */
  domExcludes?: string[];
};

export type ScenarioStep = { label?: string; do?: Action; expect?: Expect };

export const HEADLESS_EXPECT_KEYS = [
  "noErrors",
  "errorIncludes",
  "actionErrorIncludes",
  "state",
  "domIncludes",
  "domExcludes",
] as const satisfies readonly (keyof Expect)[];
const BROWSER_EXPECT_KEYS = ["focused", "visible", "hidden", "animating", "elementState"] as const;

export const HEADLESS_ACTION_KEYS = [
  "dispatch",
  "clickText",
  "click",
  "focus",
  "blur",
  "key",
  "hover",
  "fill",
  "choose",
  "navigate",
  "submit",
  "wait",
] as const satisfies readonly ActionKind[];
const BROWSER_ACTION_KEYS = ["setProperty"] as const;

type ActionKind = Action extends infer A ? (A extends unknown ? keyof A : never) : never;

/** Fields that accompany an action kind rather than naming one. */
const ACTION_MODIFIERS = ["payload", "value", "property"] as const;

/** The whole document is a closed set too — see `validateScenario`. */
const SCENARIO_KEYS = ["steps", "effects", "defaultEffect"] as const;

const BROWSER_TIER = "a browser-tier assertion; run this fixture with @kumikijs/e2e";

const MAX_WAIT_MS = 60_000;

const isWaitable = (ms: unknown): boolean =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_WAIT_MS;

function validateScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(scenario as Record<string, unknown>)) {
    if ((SCENARIO_KEYS as readonly string[]).includes(key)) continue;
    problems.push(`unknown scenario key "${key}" (${SCENARIO_KEYS.join(", ")})`);
  }
  if (!Array.isArray(scenario.steps)) {
    problems.push('a scenario needs a "steps" array');
    return problems;
  }
  if (scenario.steps.length === 0) {
    problems.push("a scenario with no steps asserts nothing");
  }
  const steps = scenario.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const where = `steps[${i}]${step.label ? ` (${step.label})` : ""}`;
    if (step.do !== undefined) problems.push(...validateAction(step.do, where));
    if (step.expect !== undefined) problems.push(...validateExpect(step.expect, where));
  }
  return problems;
}

function validateAction(action: Action, where: string): string[] {
  const keys = Object.keys(action as Record<string, unknown>);
  const kinds = keys.filter((k) => !(ACTION_MODIFIERS as readonly string[]).includes(k));
  const browser = kinds.filter((k) => (BROWSER_ACTION_KEYS as readonly string[]).includes(k));
  if (browser.length > 0) {
    return [`${where}: "${browser[0]}" is ${BROWSER_TIER}`];
  }
  const known = kinds.filter((k) => (HEADLESS_ACTION_KEYS as readonly string[]).includes(k));
  const unknown = kinds.filter((k) => !(HEADLESS_ACTION_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return [`${where}: unknown action "${unknown[0]}" (${HEADLESS_ACTION_KEYS.join(", ")})`];
  }
  if (known.length === 0) {
    return [`${where}: "do" names no action (${HEADLESS_ACTION_KEYS.join(", ")})`];
  }
  if (known.length > 1) {
    return [`${where}: "do" names ${known.join(" and ")}; a step does exactly one thing`];
  }
  const kind = known[0];
  const a = action as Record<string, unknown>;
  if ((kind === "fill" || kind === "choose") && typeof a.value !== "string") {
    return [`${where}: "${kind}" needs a string "value"`];
  }
  if (kind === "key" && (typeof a.value !== "string" || a.value.length === 0)) {
    return [`${where}: "key" needs a non-empty string "value" (the key to press)`];
  }
  if (kind === "wait" && !isWaitable(a.wait)) {
    return [`${where}: "wait" needs a duration in milliseconds, 0 to ${MAX_WAIT_MS}`];
  }
  return [];
}

function validateExpect(expect: Expect, where: string): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(expect as Record<string, unknown>)) {
    if ((HEADLESS_EXPECT_KEYS as readonly string[]).includes(key)) continue;
    if ((BROWSER_EXPECT_KEYS as readonly string[]).includes(key)) {
      problems.push(`${where}: "${key}" is ${BROWSER_TIER}`);
      continue;
    }
    problems.push(`${where}: unknown expect key "${key}" (${HEADLESS_EXPECT_KEYS.join(", ")})`);
  }
  return problems;
}

export type EffectScript = { outcome: "ok" | "err"; value?: unknown };

export type Scenario = {
  steps: ScenarioStep[];
  /** Per-effect queues of scripted results (keeps the loop hermetic). */
  effects?: Record<string, EffectScript[]>;
  /** Default result for effects with no script. Default: { outcome: "ok", value: null }. */
  defaultEffect?: EffectScript;
};

export type StepResult = {
  label?: string;
  action?: string;
  ok: boolean;
  errors: string[];
  expectedErrors: string[];
  actionError?: string;
  expectedActionError?: string;
  emits: { effect: string; args: unknown[] }[];
  state: Record<string, unknown>;
  domText: string;
  failures: string[];
  diagnostics: RuntimeDiagnostic[];
};

export type ScenarioReport = { ok: boolean; steps: StepResult[] };

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Dispatchable = AppShape & {
  _dispatch?: (name: string, el: Record<string, unknown>) => void;
  _navigate?: (path: string, replace?: boolean) => void;
  _submitHeldBy?: (e: Event) => readonly string[] | undefined;
};

export async function runScenario(
  app: AppShape,
  root: HTMLElement,
  scenario: Scenario,
  opts: {
    settleMs?: number;
    router?: "history" | "memory";
    initialPath?: string;
    episodeLogger?: EpisodeLogger | null;
  } = {},
): Promise<ScenarioReport> {
  const settleMs = opts.settleMs ?? 25;
  const steps: StepResult[] = [];

  let errorBuf: string[] = [];
  const onError = (ev: ErrorEvent): void => {
    errorBuf.push(ev.message || String(ev.error));
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    errorBuf.push(`unhandled rejection: ${String(ev.reason)}`);
  };
  const origConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    errorBuf.push(args.map(String).join(" "));
  };
  const w = globalThis as unknown as {
    addEventListener?: (t: string, h: unknown) => void;
    removeEventListener?: (t: string, h: unknown) => void;
  };
  w.addEventListener?.("error", onError);
  w.addEventListener?.("unhandledrejection", onRejection);

  const emitBuf: { effect: string; args: unknown[] }[] = [];
  const scripts = scenario.effects ?? {};
  const cursors: Record<string, number> = {};
  const def = scenario.defaultEffect ?? { outcome: "ok" as const, value: null };
  for (const [name, eff] of Object.entries(app.effects)) {
    const result = (s: EffectScript): EffectResult => ({
      kind: s.outcome,
      value: standInValue(eff, s.outcome, s.value),
    });
    eff.invoke = async (input) => {
      emitBuf.push({ effect: name, args: [input] });
      const queue = scripts[name];
      if (queue && queue.length > 0) {
        const idx = cursors[name] ?? 0;
        const scripted = queue[Math.min(idx, queue.length - 1)] ?? def;
        cursors[name] = idx + 1;
        return result(scripted);
      }
      return result(def);
    };
  }

  const dispatchable = app as Dispatchable;

  const diagBuf: RuntimeDiagnostic[] = [];

  let dispose: (() => void) | undefined;

  const mountOpts: {
    router?: "history" | "memory";
    initialPath?: string;
    episodeLogger?: EpisodeLogger | null;
    onDiagnostic: (d: RuntimeDiagnostic) => void;
  } = { onDiagnostic: (d) => diagBuf.push(d) };
  if (opts.router) mountOpts.router = opts.router;
  if (opts.initialPath !== undefined) mountOpts.initialPath = opts.initialPath;
  if (opts.episodeLogger) mountOpts.episodeLogger = opts.episodeLogger;

  try {
    const problems = validateScenario(scenario);
    if (problems.length > 0) {
      steps.push(mkStep("scenario document", undefined, [], [], app, root, problems));
      return finish();
    }
    try {
      dispose = mount(app, root, mountOpts).dispose;
    } catch (e) {
      steps.push(mkStep(undefined, "mount", [`mount threw: ${errStr(e)}`], [], app, root, []));
      return finish();
    }
    await settle(settleMs);

    if (errorBuf.length > 0) {
      steps.push(
        mkStep("mount", undefined, [...errorBuf], [...emitBuf], app, root, [], [...diagBuf]),
      );
    }

    for (const step of scenario.steps) {
      errorBuf = [];
      emitBuf.length = 0;
      diagBuf.length = 0;
      const actionDesc = step.do ? describeAction(step.do) : undefined;
      let fault: { message: string; refusal?: StepRefusal } | undefined;
      if (step.do) {
        try {
          performAction(step.do, root, dispatchable);
        } catch (e) {
          fault =
            e instanceof StepRefusal ? { message: e.message, refusal: e } : { message: errStr(e) };
        }
        await settle(settleMs + ("wait" in step.do ? step.do.wait : 0));
      }
      const expected = errorBuf.filter((e) =>
        (step.expect?.errorIncludes ?? []).some((s) => e.includes(s)),
      );
      const unexpected = errorBuf.filter((e) => !expected.includes(e));
      const verdict = judgeRefusal(step.expect?.actionErrorIncludes ?? [], fault);
      const result = mkStep(
        step.label,
        actionDesc,
        unexpected,
        [...emitBuf],
        app,
        root,
        [
          ...verdict.failures,
          ...evaluateExpect(step.expect, { all: errorBuf, unexpected }, app, root),
        ],
        [...diagBuf],
        expected,
        verdict.claimed === undefined ? fault?.message : undefined,
        verdict.claimed,
      );
      steps.push(result);
    }
    return finish();
  } finally {
    try {
      dispose?.();
    } catch {
      // The report is already built. A fault on the way out is worth less than the run it would replace, and the same choice `runSmoke` makes.
    }
    console.error = origConsoleError;
    w.removeEventListener?.("error", onError);
    w.removeEventListener?.("unhandledrejection", onRejection);
  }

  function finish(): ScenarioReport {
    return { ok: steps.every((s) => s.ok), steps };
  }
}

function mkStep(
  label: string | undefined,
  action: string | undefined,
  errors: string[],
  emits: { effect: string; args: unknown[] }[],
  app: AppShape,
  root: HTMLElement,
  failures: string[],
  diagnostics: RuntimeDiagnostic[] = [],
  expectedErrors: string[] = [],
  actionError?: string,
  expectedActionError?: string,
): StepResult {
  const step: StepResult = {
    ok: errors.length === 0 && failures.length === 0 && actionError === undefined,
    errors,
    expectedErrors,
    emits,
    state: snapshotState(app),
    domText: (root.textContent ?? "").replace(/\s+/g, " ").trim(),
    failures,
    diagnostics,
  };
  if (label !== undefined) step.label = label;
  if (action !== undefined) step.action = action;
  if (actionError !== undefined) step.actionError = actionError;
  if (expectedActionError !== undefined) step.expectedActionError = expectedActionError;
  return step;
}

function unhandledAction(a: never): never {
  throw new Error(`unhandled action: ${JSON.stringify(a)}`);
}

function describeAction(a: Action): string {
  if ("dispatch" in a) return `dispatch ${a.dispatch}`;
  if ("clickText" in a) return `clickText "${a.clickText}"`;
  if ("click" in a) return `click ${a.click}`;
  if ("focus" in a) return `focus ${a.focus}`;
  if ("blur" in a) return `blur ${a.blur}`;
  if ("key" in a) return `key ${a.key} "${a.value}"`;
  if ("hover" in a) return `hover ${a.hover}`;
  if ("fill" in a) return `fill ${a.fill}="${a.value}"`;
  if ("choose" in a) return `choose ${a.choose}="${a.value}"`;
  if ("submit" in a) return `submit ${a.submit}`;
  if ("wait" in a) return `wait ${a.wait}ms`;
  if ("navigate" in a) return `navigate ${a.navigate}`;
  return unhandledAction(a);
}

function requireSeam<K extends keyof typeof WITHOUT_SEAM>(
  app: Dispatchable,
  seam: K,
  action: string,
): NonNullable<Dispatchable[K]> {
  const fn = app[seam];
  if (!fn) {
    throw new Error(
      `${action}: this app shape carries no \`${seam}\` seam, so ${WITHOUT_SEAM[seam]}`,
    );
  }
  return fn as NonNullable<Dispatchable[K]>;
}

/** What a step cannot do without each seam: two are driven, one is asked. */
const WITHOUT_SEAM = {
  _dispatch: "there is nothing to drive",
  _navigate: "there is nothing to drive",
  _submitHeldBy: "nothing can say whether the form held the submit back",
} as const satisfies Record<"_dispatch" | "_navigate" | "_submitHeldBy", string>;

function performAction(a: Action, root: HTMLElement, app: Dispatchable): void {
  const refuse = (verb: ControlVerb, el: Element): void => {
    const fault = controlFault(verb, describeAction(a), readControl(el));
    if (fault) throw fault;
  };
  // The waiting is the caller's: this step's settle is longer by `wait`.
  if ("wait" in a) return;
  if ("submit" in a) {
    const el = root.querySelector<HTMLElement>(a.submit);
    const form = el?.closest("form");
    if (!form) throw new Error(`no form at or above selector ${a.submit}`);
    const heldBy = requireSeam(app, "_submitHeldBy", describeAction(a));
    const submitted = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submitted);
    const fault = submitFault(describeAction(a), heldBy(submitted));
    if (fault) throw fault;
    return;
  }
  if ("dispatch" in a) {
    const dispatch = requireSeam(app, "_dispatch", describeAction(a));
    const payload = a.payload ?? {};
    const fault = dispatchFault(
      a.dispatch,
      payload,
      app.reducers.map((r) => ({ name: r.name, id: r.selector?.id ?? null })),
    );
    if (fault) throw new Error(fault);
    dispatch(a.dispatch, payload);
    return;
  }
  if ("navigate" in a) {
    requireSeam(app, "_navigate", describeAction(a))(a.navigate);
    return;
  }
  if ("clickText" in a) {
    const els = Array.from(root.querySelectorAll<HTMLElement>("button, a, [role='button']"));
    const target = els.find((e) => (e.textContent ?? "").includes(a.clickText));
    if (!target) throw new Error(`no clickable element with text "${a.clickText}"`);
    refuse("clickText", target);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return;
  }
  if ("click" in a) {
    const el =
      root.querySelector<HTMLElement>(a.click) ?? document.querySelector<HTMLElement>(a.click);
    if (!el) throw new Error(`no element matching selector ${a.click}`);
    refuse("click", el);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return;
  }
  if ("focus" in a) {
    const el = root.querySelector<HTMLElement>(a.focus);
    if (!el) throw new Error(`no element matching selector ${a.focus}`);
    refuse("focus", el);
    el.dispatchEvent(new FocusEvent("focus"));
    return;
  }
  if ("blur" in a) {
    const el = root.querySelector<HTMLElement>(a.blur);
    if (!el) throw new Error(`no element matching selector ${a.blur}`);
    refuse("blur", el);
    el.dispatchEvent(new FocusEvent("blur"));
    return;
  }
  if ("key" in a) {
    const el = root.querySelector<HTMLElement>(a.key);
    if (!el) throw new Error(`no element matching selector ${a.key}`);
    refuse("key", el);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: a.value, bubbles: true }));
    return;
  }
  if ("hover" in a) {
    const el = root.querySelector<HTMLElement>(a.hover);
    if (!el) throw new Error(`no element matching selector ${a.hover}`);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    return;
  }
  if ("fill" in a) {
    const el = root.querySelector<HTMLElement>(a.fill);
    if (!el) throw new Error(`no input matching selector ${a.fill}`);
    refuse("fill", el);
    if (el.getAttribute("contenteditable") !== null) {
      el.textContent = a.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      throw new Error(
        `${a.fill} matched <${el.tagName.toLowerCase()}>, which holds no text to fill — ` +
          "fill targets input / textarea / editable",
      );
    }
    el.value = a.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if ("choose" in a) {
    const sel = root.querySelector<HTMLSelectElement>(a.choose);
    if (!sel) throw new Error(`no select matching selector ${a.choose}`);
    refuse("choose", sel);
    const opt = Array.from(sel.options).find(
      (o) => o.value === a.value || (o.textContent ?? "").trim() === a.value,
    );
    if (!opt) throw new Error(`no option "${a.value}" in select ${a.choose}`);
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  unhandledAction(a);
}

function evaluateExpect(
  expect: Expect | undefined,
  // One object rather than two adjacent `string[]`s: swapping them would still compile and would quietly invert what `noErrors` and `errorIncludes` mean.
  reported: { all: string[]; unexpected: string[] },
  app: AppShape,
  root: HTMLElement,
): string[] {
  if (!expect) return [];
  const failures: string[] = [];
  if (expect.noErrors && reported.unexpected.length > 0) {
    failures.push(`expected no errors but got: ${reported.unexpected.join("; ")}`);
  }
  for (const s of expect.errorIncludes ?? []) {
    if (!reported.all.some((e) => e.includes(s))) {
      failures.push(
        `expected an error including "${s}" but got: ${
          reported.all.length > 0 ? reported.all.join("; ") : "none"
        }`,
      );
    }
  }
  if (expect.state) {
    const state = snapshotState(app);
    for (const [key, want] of Object.entries(expect.state)) {
      const got = readPath(state, key);
      if (!matches(want, got)) {
        failures.push(`state ${key}: expected ${j(want)}, got ${j(got)}`);
      }
    }
  }
  const text = root.textContent ?? "";
  for (const s of expect.domIncludes ?? []) {
    if (!text.includes(s)) failures.push(`DOM should include "${s}"`);
  }
  for (const s of expect.domExcludes ?? []) {
    if (text.includes(s)) failures.push(`DOM should NOT include "${s}"`);
  }
  return failures;
}

function snapshotState(app: AppShape): Record<string, unknown> {
  const live = app.live ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(live)) {
    if (k === "route") continue;
    out[k] = sanitize(v);
  }
  return out;
}

function sanitize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return typeof v === "function" ? "[fn]" : v;
  if (Array.isArray(v)) return v.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "function") continue;
    out[k] = sanitize(val);
  }
  return out;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Partial structural match: every key/element in `want` must be present in `got`. */
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

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
