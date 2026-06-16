// Runtime smoke test: mount a compiled app into a DOM, drive its interactive
// elements, and surface failures that `check`/`build` cannot — runtime throws,
// empty renders, and unhandled promise rejections.
//
// This catches the "it compiled but errors / renders nothing when you actually
// use it" class of bug that previously required manual browser checking. It does
// NOT verify behavioral correctness (a wrong-but-non-throwing result) — that is
// the job of example-specific assertions.

import type { AppShape } from "./index.ts";
import { mount } from "./index.ts";

export type SmokePhase = "mount" | "initial-render" | "interaction" | "async";

export type SmokeIssue = {
  phase: SmokePhase;
  message: string;
  /** What triggered it, e.g. "click button[0] (\"Create issue\")". */
  trigger?: string | undefined;
};

export type SmokeReport = {
  ok: boolean;
  mounted: boolean;
  rendered: boolean;
  interactions: number;
  issues: SmokeIssue[];
};

export type SmokeOptions = {
  /** Drive interactive elements after the initial render. Default: true. */
  interact?: boolean;
  /** Max interactive elements to exercise. Default: 40. */
  maxInteractions?: number;
  /** Milliseconds to let async effects/timers settle after each step. Default: 30. */
  settleMs?: number;
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
  const { interact = true, maxInteractions = 40, settleMs = 30 } = opts;
  const issues: SmokeIssue[] = [];
  let currentTrigger: string | undefined;
  let phase: SmokePhase = "mount";

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
      dispose = mount(app, root).dispose;
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
        const els = collectInteractive(root);
        const next = els
          .map((el, i): [HTMLElement, string] => [el, signature(el, i)])
          .find(([, sig]) => !fired.has(sig));
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
    };
  }
}

function hasContent(root: HTMLElement): boolean {
  return root.childElementCount > 0 || (root.textContent ?? "").trim().length > 0;
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
  if (tag === "select") return "change";
  if (tag === "input" || tag === "textarea") return "input";
  return "click";
}

function fire(el: HTMLElement): void {
  const tag = el.tagName.toLowerCase();
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
