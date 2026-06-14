// Scenario runner: drive a mounted Kumiki app through a sequence of actions and
// capture a structured trace (state snapshot, DOM text, errors, emitted effects)
// after each step, plus state/DOM assertions. This is the deterministic,
// introspectable substrate that lets an agent run a generate → run → observe →
// fix loop with NO human operating the app.
//
// Kumiki makes this clean: state is explicit (slots), events are named
// (reducers), and effects are mocked at the capability boundary — so the oracle
// is reliable app state, not scraped pixels, and runs are reproducible.

import type { AppShape } from "./index.ts";
import { mount } from "./index.ts";

/** One thing to do to the app. Exactly one field should be set. */
export type Action =
  | { dispatch: string; payload?: Record<string, unknown> }
  | { clickText: string }
  | { click: string }
  | { fill: string; value: string }
  | { choose: string; value: string }
  | { navigate: string };

/** Assertions evaluated against the snapshot taken after a step. */
export type Expect = {
  /** No runtime errors since the previous step. */
  noErrors?: boolean;
  /** Partial match against the slot state (slot name → expected value). */
  state?: Record<string, unknown>;
  /** Substrings that must appear in the rendered text. */
  domIncludes?: string[];
  /** Substrings that must NOT appear in the rendered text. */
  domExcludes?: string[];
};

export type ScenarioStep = { label?: string; do?: Action; expect?: Expect };

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
  errors: string[];
  emits: { effect: string; args: unknown[] }[];
  state: Record<string, unknown>;
  domText: string;
  failures: string[];
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
  opts: { settleMs?: number; router?: "history" | "memory"; initialPath?: string } = {},
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

  const mountOpts: { router?: "history" | "memory"; initialPath?: string } = {};
  if (opts.router) mountOpts.router = opts.router;
  if (opts.initialPath !== undefined) mountOpts.initialPath = opts.initialPath;

  try {
    try {
      mount(app, root, mountOpts);
    } catch (e) {
      steps.push(mkStep(undefined, "mount", [`mount threw: ${errStr(e)}`], [], app, root, []));
      return finish();
    }
    await settle(settleMs);

    for (const step of scenario.steps) {
      errorBuf = [];
      emitBuf.length = 0;
      const actionDesc = step.do ? describeAction(step.do) : undefined;
      if (step.do) {
        try {
          performAction(step.do, root, dispatchable);
        } catch (e) {
          errorBuf.push(`action threw: ${errStr(e)}`);
        }
        await settle(settleMs);
      }
      const result = mkStep(
        step.label,
        actionDesc,
        [...errorBuf],
        [...emitBuf],
        app,
        root,
        evaluateExpect(step.expect, errorBuf, app, root),
      );
      steps.push(result);
    }
    return finish();
  } finally {
    console.error = origConsoleError;
    w.removeEventListener?.("error", onError);
    w.removeEventListener?.("unhandledrejection", onRejection);
  }

  function finish(): ScenarioReport {
    const ok = steps.every((s) => s.errors.length === 0 && s.failures.length === 0);
    return { ok, steps };
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
): StepResult {
  const step: StepResult = {
    errors,
    emits,
    state: snapshotState(app),
    domText: (root.textContent ?? "").replace(/\s+/g, " ").trim(),
    failures,
  };
  if (label !== undefined) step.label = label;
  if (action !== undefined) step.action = action;
  return step;
}

function describeAction(a: Action): string {
  if ("dispatch" in a) return `dispatch ${a.dispatch}`;
  if ("clickText" in a) return `clickText "${a.clickText}"`;
  if ("click" in a) return `click ${a.click}`;
  if ("fill" in a) return `fill ${a.fill}="${a.value}"`;
  if ("choose" in a) return `choose ${a.choose}="${a.value}"`;
  return `navigate ${a.navigate}`;
}

function performAction(a: Action, root: HTMLElement, app: Dispatchable): void {
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
  if ("fill" in a) {
    const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(a.fill);
    if (!el) throw new Error(`no input matching selector ${a.fill}`);
    el.value = a.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  // choose
  const sel = root.querySelector<HTMLSelectElement>(a.choose);
  if (!sel) throw new Error(`no select matching selector ${a.choose}`);
  const opt = Array.from(sel.options).find(
    (o) => o.value === a.value || (o.textContent ?? "").trim() === a.value,
  );
  if (!opt) throw new Error(`no option "${a.value}" in select ${a.choose}`);
  sel.value = opt.value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

function evaluateExpect(
  expect: Expect | undefined,
  errors: string[],
  app: AppShape,
  root: HTMLElement,
): string[] {
  if (!expect) return [];
  const failures: string[] = [];
  if (expect.noErrors && errors.length > 0) {
    failures.push(`expected no errors but got: ${errors.join("; ")}`);
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
