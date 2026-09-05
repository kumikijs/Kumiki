// Scenario runner: drive a mounted Kumiki app through a sequence of actions and
// capture a structured trace (state snapshot, DOM text, errors, emitted effects)
// after each step, plus state/DOM assertions. This is the deterministic,
// introspectable substrate that lets an agent run a generate → run → observe →
// fix loop with NO human operating the app.
//
// Kumiki makes this clean: state is explicit (slots), events are named
// (reducers), and effects are mocked at the capability boundary — so the oracle
// is reliable app state, not scraped pixels, and runs are reproducible.

import type { EpisodeLogger } from "./episode.ts";
import type { AppShape, RuntimeDiagnostic } from "./index.ts";
import { mount } from "./index.ts";

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
  /**
   * Substrings that must each appear in some error the *app* reported since the
   * previous step. The counterpart to `noErrors`: a contract whose whole point
   * is that the runtime *reports* something (a rejected reducer batch, a
   * dropped effect error) is otherwise unassertable at this tier, and an
   * example demonstrating one would have to settle for "no error was raised
   * about it".
   *
   * A step whose action could not run is not one of those: it is a fault in the
   * scenario, reported on `StepResult.actionError`, and deliberately out of
   * reach here. Otherwise
   * `{do: {key: "#typo", value: "Enter"}, expect: {errorIncludes: ["no element"]}}`
   * passed, having pressed nothing — a fixture asserting that its own mistake
   * happened.
   */
  errorIncludes?: string[];
  /** Partial match against the slot state (slot name → expected value). */
  state?: Record<string, unknown>;
  /** Substrings that must appear in the rendered text. */
  domIncludes?: string[];
  /** Substrings that must NOT appear in the rendered text. */
  domExcludes?: string[];
};

export type ScenarioStep = { label?: string; do?: Action; expect?: Expect };

/**
 * The closed sets this runner answers for. A scenario naming anything outside
 * them is rejected rather than skipped: `evaluateExpect` used to iterate the
 * keys it knew and ignore the rest, so a document whose every assertion was
 * browser-tier passed having checked nothing.
 *
 * The browser lists are named, not merely absent, so the failure says which
 * tier owns the key instead of calling a real assertion a typo. They mirror
 * `@kumikijs/e2e`'s `Expect` / `Action`; a key added there and not here reads
 * as "unknown", which is the safe direction.
 */
const HEADLESS_EXPECT_KEYS = [
  "noErrors",
  "errorIncludes",
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

/**
 * The lists above are pinned to the types in both directions, at no runtime
 * cost. `satisfies` rejects a listed key the type no longer has; the two
 * assertions below reject a key the type has and the list forgot — which is
 * the direction that matters, because a forgotten key is silently skipped.
 */
type ActionKind = Action extends infer A ? (A extends unknown ? keyof A : never) : never;
type Covers<Whole extends Part, Part> = Whole;
type _ExpectKeysCovered = Covers<keyof Expect, (typeof HEADLESS_EXPECT_KEYS)[number]>;
type _ActionKindsCovered = Covers<
  Exclude<ActionKind, (typeof ACTION_MODIFIERS)[number]>,
  (typeof HEADLESS_ACTION_KEYS)[number]
>;

/** Fields that accompany an action kind rather than naming one. */
const ACTION_MODIFIERS = ["payload", "value", "property"] as const;

/** The whole document is a closed set too — see `validateScenario`. */
const SCENARIO_KEYS = ["steps", "effects", "defaultEffect"] as const;

const BROWSER_TIER = "a browser-tier assertion; run this fixture with @kumikijs/e2e";

/**
 * A minute is longer than any window a step should need to observe, and short
 * enough that a fixture holding the suite open is a failure rather than a
 * mystery. The finiteness check is not pedantry: `setTimeout(Infinity)` does not
 * fit a 32-bit delay and clamps to 1ms, so "wait forever" would have run as "do
 * not wait" — and passed.
 */
const MAX_WAIT_MS = 60_000;

const isWaitable = (ms: unknown): boolean =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_WAIT_MS;

/**
 * Every problem in a scenario document, described in the order they appear.
 * Empty for a document this runner can execute.
 */
function validateScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  // The document first. A misspelled `steps` is the same failure as a
  // misspelled `expect` key one level up — every assertion under it is skipped
  // — and it used to reach the loop below and throw `steps is not iterable`
  // after the mount, which is what validating first exists to prevent.
  for (const key of Object.keys(scenario as Record<string, unknown>)) {
    if ((SCENARIO_KEYS as readonly string[]).includes(key)) continue;
    problems.push(`unknown scenario key "${key}" (${SCENARIO_KEYS.join(", ")})`);
  }
  if (!Array.isArray(scenario.steps)) {
    problems.push('a scenario needs a "steps" array');
    return problems;
  }
  // Running an empty document reported `ok: true` for a scenario that asserted
  // nothing, which is the one answer this runner must never give.
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
  // `key` needs its own branch rather than joining the two above: `""` is
  // meaningful for `fill` (clear the field) and `choose` (an option with an
  // empty value), and is the one thing `key` cannot be. `KeyboardEventInit.key`
  // defaults to `""`, and the listener never reads it, so a step pressing
  // nothing would fire the reducer and pass.
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

/** A scripted effect outcome, returned in order each time the effect fires. */
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
  /**
   * Whether this step passed: no unexpected error, no failed assertion, and an
   * action that ran. A field rather than a predicate every consumer rebuilds —
   * the run's `ok`, three reporters and the corpus gates all answer this same
   * question, and each copy is a place a new channel can be forgotten (adding
   * `actionError` did exactly that to two of them).
   */
  ok: boolean;
  /**
   * Errors reported during this step that no `errorIncludes` claimed. These are
   * what fail the run — an error the step asked for moves to `expectedErrors`.
   */
  errors: string[];
  /**
   * Errors this step's `errorIncludes` matched. Kept in the trace (the run is
   * about what the app did, and hiding a reported error would defeat that) but
   * out of `errors`, so a scenario can assert a report without also asserting
   * that the run failed.
   */
  expectedErrors: string[];
  /**
   * Why the step's action could not run — a selector matching nothing, a `fill`
   * aimed at an element that holds no text. Absent in the healthy case, and a
   * channel of its own rather than an entry in `errors`: nothing was observed
   * about the app, so `noErrors` and `errorIncludes` must not see it. It fails
   * the step all the same.
   */
  actionError?: string;
  emits: { effect: string; args: unknown[] }[];
  state: Record<string, unknown>;
  domText: string;
  failures: string[];
  /**
   * Reconcile observations this step's re-render produced — a subtree the
   * runtime rebuilt rather than reused, or a reuse that kept a changed closure.
   * Never a failure (`ok` ignores it): the point is to attribute the churn to
   * the action that caused it. Empty in the healthy case; always present, so a
   * consumer can iterate it without a nil check (matching `errors` / `emits`
   * rather than the presentational `label` / `action`).
   */
  diagnostics: RuntimeDiagnostic[];
};

export type ScenarioReport = { ok: boolean; steps: StepResult[] };

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Dispatchable = AppShape & {
  _dispatch?: (name: string, el: Record<string, unknown>) => void;
  _navigate?: (path: string, replace?: boolean) => void;
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

  // --- error capture ---
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

  // --- effect mocking: record emits, return scripted/synthetic results ---
  const emitBuf: { effect: string; args: unknown[] }[] = [];
  const scripts = scenario.effects ?? {};
  const cursors: Record<string, number> = {};
  const def = scenario.defaultEffect ?? { outcome: "ok" as const, value: null };
  for (const [name, eff] of Object.entries(app.effects)) {
    eff.invoke = async (input) => {
      emitBuf.push({ effect: name, args: [input] });
      const queue = scripts[name];
      if (queue && queue.length > 0) {
        const idx = cursors[name] ?? 0;
        const scripted = queue[Math.min(idx, queue.length - 1)] ?? def;
        cursors[name] = idx + 1;
        return { kind: scripted.outcome, value: scripted.value ?? null };
      }
      return { kind: def.outcome, value: def.value ?? null };
    };
  }

  const dispatchable = app as Dispatchable;

  // Reconcile churn, buffered per step exactly like `errorBuf` / `emitBuf` so
  // the trace attributes it to the action that triggered the re-render. The
  // initial mount is a full render, so nothing lands here before the loop.
  //
  // Always installed, unlike a production mount: this runner exists to observe,
  // and an agent reading the trace should not have to know to ask for the one
  // signal that explains why a subtree churned.
  const diagBuf: RuntimeDiagnostic[] = [];

  // Torn down in the `finally` below. Without it the mount outlives the run:
  // every `timer` reducer keeps its interval and renders into a document the
  // host may already have torn down, and the shape stays registered as mounted,
  // so the next run becomes another view of this one instead of its own mount.
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
    // Before the mount, and all of them at once: a document this runner cannot
    // execute is a mistake in the document, and running it half way would
    // report a missing selector instead of the key that is wrong.
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

    // The first paint is a step like any other. Without this, everything
    // reported between `mount` and the first scripted action was dropped on the
    // next line's `errorBuf = []` — so an `app.init` effect that failed with no
    // `.err` reducer, or a first render that panicked, was reported by the
    // runtime and then thrown away, and the run said `ok: true`.
    //
    // Only when it has something to say: a step is pushed here in the failing
    // case alone, so a passing report still has one entry per scripted step and
    // a caller reading `steps[0]` sees what it always saw.
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
      // Kept out of `errorBuf`, which is what the app reported. An action that
      // could not run is the scenario's fault, and folding the two together let
      // `errorIncludes` claim it — see `StepResult.actionError`.
      let actionError: string | undefined;
      if (step.do) {
        try {
          performAction(step.do, root, dispatchable);
        } catch (e) {
          actionError = errStr(e);
        }
        // `wait` is the whole action: it adds its duration to the settle this
        // step would have had anyway, so a debounce window or a retry backoff
        // is one step rather than dozens of empty ones.
        await settle(settleMs + ("wait" in step.do ? step.do.wait : 0));
      }
      const expected = errorBuf.filter((e) =>
        (step.expect?.errorIncludes ?? []).some((s) => e.includes(s)),
      );
      const unexpected = errorBuf.filter((e) => !expected.includes(e));
      const result = mkStep(
        step.label,
        actionDesc,
        unexpected,
        [...emitBuf],
        app,
        root,
        evaluateExpect(step.expect, { all: errorBuf, unexpected }, app, root),
        [...diagBuf],
        expected,
        actionError,
      );
      steps.push(result);
    }
    return finish();
  } finally {
    try {
      dispose?.();
    } catch {
      // The report is already built. A fault on the way out is worth less than
      // the run it would replace, and the same choice `runSmoke` makes.
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
  return step;
}

/**
 * The two walks below are exhaustive by construction, which the type system
 * only half enforces on its own: `Covers<>` catches an `Action` member missing
 * from `HEADLESS_ACTION_KEYS`, so a new action cannot be silently unvalidated —
 * but a member with no branch here used to fall through to the `choose` tail
 * and fail as `no select matching selector undefined`, with everything green.
 */
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

function performAction(a: Action, root: HTMLElement, app: Dispatchable): void {
  // The waiting is the caller's: this step's settle is longer by `wait`.
  if ("wait" in a) return;
  if ("submit" in a) {
    // Dispatched on the form itself, which is what the `form` tile listens for.
    // A `form` tile usually has no submit button to click, and where it has
    // one, whether a synthetic click submits is activation behaviour that
    // differs per DOM — dispatching on the form means the same thing in all of
    // them.
    //
    // The selector may also name something inside the form: a page with two
    // forms on it has no way to tell them apart otherwise, since a `form` tile
    // carries no id of its own unless its author gave it one, and its fields
    // usually do.
    const el = root.querySelector<HTMLElement>(a.submit);
    const form = el?.closest("form");
    if (!form) throw new Error(`no form at or above selector ${a.submit}`);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return;
  }
  if ("dispatch" in a) {
    app._dispatch?.(a.dispatch, a.payload ?? {});
    return;
  }
  if ("navigate" in a) {
    app._navigate?.(a.navigate);
    return;
  }
  if ("clickText" in a) {
    const els = Array.from(root.querySelectorAll<HTMLElement>("button, a, [role='button']"));
    const target = els.find((e) => (e.textContent ?? "").includes(a.clickText));
    if (!target) throw new Error(`no clickable element with text "${a.clickText}"`);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return;
  }
  if ("click" in a) {
    // Some built-in effects (confirm modal, toast) render to <body>, not under
    // the mount root. Fall back to a document-wide lookup so the scenario tier
    // can drive those overlays.
    const el =
      root.querySelector<HTMLElement>(a.click) ?? document.querySelector<HTMLElement>(a.click);
    if (!el) throw new Error(`no element matching selector ${a.click}`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return;
  }
  if ("focus" in a) {
    // Verify the DOM-wiring path: addEventListener("focus") →
    // `installUiEventListeners` (core.ts, reached from the create path or from
    // the first patch that fills the handler slot) → reducer. focus/blur do not
    // bubble per DOM spec, but the runtime
    // attaches the listener directly on the tile element so a non-bubbling
    // dispatch reaches it. Scope the query to `root`: focus/blur targets render
    // inside the mount tree (unlike confirm/toast overlays that justify `click`'s
    // document fallback), and a document-wide lookup would silently hit a leaked
    // element from a prior test.
    const el = root.querySelector<HTMLElement>(a.focus);
    if (!el) throw new Error(`no element matching selector ${a.focus}`);
    el.dispatchEvent(new FocusEvent("focus"));
    return;
  }
  if ("blur" in a) {
    const el = root.querySelector<HTMLElement>(a.blur);
    if (!el) throw new Error(`no element matching selector ${a.blur}`);
    el.dispatchEvent(new FocusEvent("blur"));
    return;
  }
  if ("key" in a) {
    // `keydown` bubbles, and the language relies on it: `ui.key(Container)`
    // reaches a container from a focusable descendant, which is what makes the
    // selector useful on anything but the input itself. Dispatching without it
    // would make this tier answer "the handler did not fire" for a program a
    // browser runs correctly.
    //
    // The reducer's payload carries `key` and `code`. Only `key` is set here —
    // a `code` is a physical key on a keyboard layout, which a scenario naming
    // "Enter" has not told us. A reducer reading `$el.code` sees the empty
    // string from this tier; the browser tier is where a real one comes from.
    //
    // Scoped to `root` like focus/blur: these targets render inside the mount
    // tree, and a document-wide lookup could hit a leaked element from a prior
    // test.
    const el = root.querySelector<HTMLElement>(a.key);
    if (!el) throw new Error(`no element matching selector ${a.key}`);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: a.value, bubbles: true }));
    return;
  }
  if ("hover" in a) {
    // `mouseenter` does not bubble, by DOM spec — it is the non-bubbling
    // counterpart of `mouseover`, and a browser fires a separate one on each
    // ancestor rather than propagating a single event. So it is dispatched on
    // the element, where the runtime puts its listener; making it bubble would
    // not reproduce the browser's behaviour, it would invent a different one.
    const el = root.querySelector<HTMLElement>(a.hover);
    if (!el) throw new Error(`no element matching selector ${a.hover}`);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    return;
  }
  if ("fill" in a) {
    const el = root.querySelector<HTMLElement>(a.fill);
    if (!el) throw new Error(`no input matching selector ${a.fill}`);
    // An `editable` holds its text in `textContent`, which is what its
    // renderer reads back — a `value` write leaves it untouched, so the
    // `input` the step dispatches carries the text the control held before it.
    // The attribute rather than `isContentEditable`: a disabled or readonly
    // editable carries `contenteditable="false"`, and routing that one to the
    // `value` branch would put the stale-text bug straight back. The step
    // fills it all the same — `fill` does not respect `disabled` on an
    // `<input>` either. No `change` follows: the platform defines none for a
    // contenteditable.
    if (el.getAttribute("contenteditable") !== null) {
      el.textContent = a.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // Every other action throws on a target it cannot drive. Without this the
    // cast below is a claim rather than a narrowing: a selector matching a
    // `div` would take an expando `value`, dispatch two events nothing hears,
    // and report the step green.
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
  // One object rather than two adjacent `string[]`s: swapping them would still
  // compile and would quietly invert what `noErrors` and `errorIncludes` mean.
  reported: { all: string[]; unexpected: string[] },
  app: AppShape,
  root: HTMLElement,
): string[] {
  if (!expect) return [];
  const failures: string[] = [];
  // `noErrors` means "nothing the app reported that this step did not ask for",
  // so it composes with `errorIncludes`: a step can require one report and
  // forbid every other. An action that could not run is neither — it is on
  // `actionError`, and fails the step whatever this block decides.
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
