// Runtime smoke test: mount a compiled app into a DOM, drive its interactive
// elements, and surface failures that `check`/`build` cannot — runtime throws,
// empty renders, and unhandled promise rejections.
//
// This catches the "it compiled but errors / renders nothing when you actually
// use it" class of bug that previously required manual browser checking. It does
// NOT verify behavioral correctness (a wrong-but-non-throwing result) — that is
// the job of example-specific assertions.

import type { AppShape, NeverEqualCause, ReconcileFallback, RuntimeDiagnostic } from "./index.ts";
import { mount } from "./index.ts";

export type SmokePhase = "mount" | "initial-render" | "interaction" | "async";

export type SmokeIssue = {
  phase: SmokePhase;
  message: string;
  /** What triggered it, e.g. "click button[0] (\"Create issue\")". */
  trigger?: string | undefined;
};

/**
 * A reconcile diagnostic plus the same "when did this happen" context a
 * `SmokeIssue` carries. Without it a report says the runtime rebuilt a subtree
 * but not which interaction provoked it, which is the first thing anyone asks.
 */
export type SmokeDiagnostic = {
  phase: SmokePhase;
  /** What triggered it, e.g. "click button[0] (\"Create issue\")". */
  trigger?: string | undefined;
  diagnostic: RuntimeDiagnostic;
};

export type SmokeReport = {
  ok: boolean;
  mounted: boolean;
  rendered: boolean;
  interactions: number;
  issues: SmokeIssue[];
  /**
   * Reconcile observations collected while driving the app: subtrees the
   * runtime rebuilt instead of reusing, reuse decisions that ignored a changed
   * closure on a host tile, and host-tile props that can never compare equal
   * however identical two renders are. These are performance and integration
   * signals, not failures, so they do NOT affect `ok` — an app that rebuilds
   * more than it needs to still works. Set `diagnosticsAsIssues` to treat them
   * as failures instead.
   */
  diagnostics: SmokeDiagnostic[];
};

export type SmokeOptions = {
  /** Drive interactive elements after the initial render. Default: true. */
  interact?: boolean;
  /** Max interactive elements to exercise. Default: 40. */
  maxInteractions?: number;
  /** Milliseconds to let async effects/timers settle after each step. Default: 30. */
  settleMs?: number;
  /**
   * Also record each reconcile diagnostic as an issue, so any identity-losing
   * rebuild fails the run. Off by default: an unkeyed sibling list whose length
   * changes is ordinary, correct Kumiki, and failing on it would reject most
   * apps. Turn it on for an app that has committed to keyed lists throughout.
   */
  diagnosticsAsIssues?: boolean;
};

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Position + tag + text signature: stable across re-renders of the same element. */
function signature(el: Element, index: number): string {
  const tag = el.tagName.toLowerCase();
  const label = (el.textContent ?? "").trim().slice(0, 24);
  return label ? `${tag}[${index}] ("${label}")` : `${tag}[${index}]`;
}

/**
 * Mount `app` into `root`, drive its UI, and report runtime failures.
 * Runs in any DOM environment (happy-dom for CI, a real browser for the playground).
 */
export async function smoke(
  app: AppShape,
  root: HTMLElement,
  opts: SmokeOptions = {},
): Promise<SmokeReport> {
  const {
    interact = true,
    maxInteractions = 40,
    settleMs = 30,
    diagnosticsAsIssues = false,
  } = opts;
  const issues: SmokeIssue[] = [];
  const diagnostics: SmokeDiagnostic[] = [];
  let currentTrigger: string | undefined;
  let phase: SmokePhase = "mount";

  const onDiagnostic = (d: RuntimeDiagnostic): void => {
    diagnostics.push({ phase, trigger: currentTrigger, diagnostic: d });
    if (!diagnosticsAsIssues) return;
    issues.push({ phase, message: describeDiagnostic(d), trigger: currentTrigger });
  };

  const onError = (ev: ErrorEvent): void => {
    issues.push({ phase, message: ev.message || String(ev.error), trigger: currentTrigger });
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    issues.push({
      phase: "async",
      message: `unhandled rejection: ${String(ev.reason)}`,
      trigger: currentTrigger,
    });
  };
  const origConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    issues.push({ phase, message: args.map(String).join(" "), trigger: currentTrigger });
  };
  const w = globalThis as unknown as {
    addEventListener?: (t: string, h: unknown) => void;
    removeEventListener?: (t: string, h: unknown) => void;
  };
  w.addEventListener?.("error", onError);
  w.addEventListener?.("unhandledrejection", onRejection);

  let mounted = false;
  let rendered = false;
  let interactions = 0;
  let dispose: (() => void) | undefined;

  try {
    phase = "mount";
    try {
      dispose = mount(app, root, { onDiagnostic }).dispose;
      mounted = true;
    } catch (e) {
      issues.push({ phase: "mount", message: errStr(e) });
      return finish();
    }

    phase = "async";
    await settle(settleMs);

    phase = "initial-render";
    rendered = hasContent(root);
    if (!rendered) {
      issues.push({ phase: "initial-render", message: "root is empty after mount" });
    }

    if (interact && mounted) {
      phase = "interaction";
      // Re-query each round: most apps re-render on input, which replaces the
      // element objects. A position+text signature lets us fire each *logical*
      // element once (so a re-rendered same element is skipped, but new rows that
      // appear after an action still get exercised) without looping forever.
      const fired = new Set<string>();
      for (let round = 0; round < maxInteractions; round++) {
        const next = pickNext(root, fired);
        if (!next) break;
        const [el, sig] = next;
        fired.add(sig);
        currentTrigger = `${actionFor(el)} ${sig}`;
        try {
          fire(el);
        } catch (e) {
          issues.push({ phase: "interaction", message: errStr(e), trigger: currentTrigger });
        }
        interactions++;
        await settle(settleMs);
        if (!hasContent(root)) {
          issues.push({
            phase: "interaction",
            message: "root became empty after interaction",
            trigger: currentTrigger,
          });
          break;
        }
      }
      currentTrigger = undefined;
    }

    return finish();
  } finally {
    try {
      dispose?.();
    } catch {
      // ignore disposal errors
    }
    console.error = origConsoleError;
    w.removeEventListener?.("error", onError);
    w.removeEventListener?.("unhandledrejection", onRejection);
  }

  function finish(): SmokeReport {
    return {
      ok: issues.length === 0 && mounted && rendered,
      mounted,
      rendered,
      interactions,
      issues,
      diagnostics,
    };
  }
}

/**
 * One-line rendering of a diagnostic promoted into `issues`. Exported for the
 * CLI so a diagnostic reads identically wherever it surfaces.
 */
export function describeDiagnostic(d: RuntimeDiagnostic): string {
  const where = d.tile ? `${d.tile} (${d.tileKind})` : d.tileKind;
  if (d.kind === "never-equal-prop") {
    return `${where}'s ${d.field} ${describeNeverEqualCause(d.cause)} — this tile re-applies its props on every render`;
  }
  // The two placement fallbacks rebuild nothing on their own: the keyed matcher
  // stood down and the positional walk took over, so saying "rebuilt" would
  // send the reader looking for churn that is not there. (A length change on
  // the same parent still reports `child-count-change` separately.)
  if (d.reason === "wrapped-children" || d.reason === "unplaceable-insert") {
    return `reconcile could not key-match ${where}'s children: ${describeFallback(d)}`;
  }
  return `reconcile rebuilt ${where} instead of reusing it: ${describeFallback(d)}`;
}

function describeNeverEqualCause(cause: NeverEqualCause): string {
  switch (cause) {
    case "function-identity":
      return "holds a function whose identity changed (a handler rebuilt per render never compares equal; memoising it fixes that)";
    case "non-plain-object":
      return "holds a non-plain object (Date / Map / Set / class instance), which never compares equal to a freshly built one";
    case "nan":
      return "is NaN, which never compares equal to itself";
    default:
      // Exhaustiveness, same as `describeFallback`: a new cause must be given
      // wording here rather than degrade into a sentence that names none.
      return ((c: never) => String(c))(cause);
  }
}

function describeFallback(f: ReconcileFallback): string {
  switch (f.reason) {
    case "no-patcher":
      return "no-patcher (its data props changed and its kind has no patcher registered)";
    case "child-count-change":
      return `child-count-change (${f.oldCount} unkeyed children became ${f.newCount})`;
    case "child-hole":
      return `child-hole (children[${f.index}] was empty)`;
    case "child-unmapped":
      return `child-unmapped (children[${f.index}], a ${f.childKind}, was built outside ctx.render)`;
    case "wrapped-children":
      return `wrapped-children (children[${f.index}], a ${f.childKind}, is wrapped by its parent's renderer instead of sitting directly under it, so reorder fell back to positional matching)`;
    case "unplaceable-insert":
      return `unplaceable-insert (children[${f.index}], a ${f.childKind}, is new, and this parent's renderer does not place every child directly under its own element, so the keyed matcher could not mount it into the slot the renderer would have given it)`;
    default:
      // Exhaustiveness: a new reason must be given wording here, not silently
      // fall through to a message that names none of its evidence.
      return ((r: never) => String(r))(f);
  }
}

/**
 * Elements that are content on their own, with no text in them. Counting *any*
 * element instead would answer "rendered" for `tile App = column()`, which puts
 * one empty `<div>` under the root and shows the user a blank page — the exact
 * failure this tier is named for.
 */
const CONTENT_ELEMENTS = [
  "img",
  "svg",
  "canvas",
  "video",
  "audio",
  "iframe",
  "object",
  "embed",
  "input",
  "textarea",
  "select",
  "button",
  "progress",
  "meter",
  "hr",
  // A spinner or a skeleton is a screen with nothing written on it yet, and an
  // app whose first paint is one is rendering. They announce themselves.
  "[role='status']",
  "[role='progressbar']",
  "[aria-busy='true']",
].join(", ");

function hasContent(root: HTMLElement): boolean {
  if ((root.textContent ?? "").trim().length > 0) return true;
  return root.querySelector(CONTENT_ELEMENTS) !== null;
}

/**
 * The next element to exercise: an unfired field or control, and only once
 * there are none left, an unfired `<form>`.
 *
 * The order is the point. `querySelectorAll` returns document order and a form
 * precedes its own fields, so taking the first match would submit every form
 * against the state the app mounted with — an empty draft against the
 * `nonempty` constraint the reducer is written to expect.
 */
function pickNext(root: HTMLElement, fired: Set<string>): [HTMLElement, string] | null {
  const unfired = (els: HTMLElement[]): [HTMLElement, string] | undefined =>
    els
      .map((el, i): [HTMLElement, string] => [el, signature(el, i)])
      .find(([, sig]) => !fired.has(sig));
  return unfired(collectInteractive(root)) ?? unfired(collectForms(root)) ?? null;
}

/**
 * Forms are driven by dispatching `submit` on the form itself, which is what
 * the runtime listens for. Nothing else reaches it: a synthetic click on a
 * submit button does not submit a form in any DOM, and a form with no submit
 * button has nothing to click in the first place.
 */
function collectForms(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("form"));
}

function collectInteractive(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("button, input, textarea, select, [data-kumiki-bind]"),
  ).filter((el) => {
    // File inputs cannot be exercised without a real `File` (the HTML spec
    // forbids programmatic `.value` writes, and a synthetic empty `change`
    // would mask reducer panics around `$event.files.head.get`). Skip them
    // here so the smoke harness never reports a false PASS for the picker
    // path; the dedicated tests/file-upload.test.ts covers the real-File
    // round-trip.
    if (el.tagName.toLowerCase() === "input" && (el as HTMLInputElement).type === "file") {
      return false;
    }
    return true;
  });
}

function actionFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "form") return "submit";
  if (tag === "select") return "change";
  if (tag === "input" || tag === "textarea") return "input";
  return "click";
}

function fire(el: HTMLElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "form") {
    el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return;
  }
  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    if (sel.options.length > 1) sel.selectedIndex = sel.options.length - 1;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (tag === "textarea") {
    (el as HTMLTextAreaElement).value = "smoke";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (tag === "input") {
    const inp = el as HTMLInputElement;
    if (inp.type === "checkbox" || inp.type === "radio") {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    } else {
      // file inputs are filtered out by collectInteractive — see the comment
      // there. Any input reaching here is text-like and tolerates a value
      // write + input + change dispatch.
      inp.value = "smoke";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function errStr(e: unknown): string {
  if (e instanceof Error)
    return e.stack ? `${e.message}\n${e.stack.split("\n")[1]?.trim() ?? ""}` : e.message;
  return String(e);
}
