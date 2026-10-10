import { type ControlVerb, readControl, refusesControl } from "./control-check.ts";
import type { AppShape, NeverEqualCause, ReconcileFallback, RuntimeDiagnostic } from "./index.ts";
import { mount } from "./index.ts";

export type SmokePhase = "mount" | "initial-render" | "interaction" | "async";

export type SmokeIssue = {
  phase: SmokePhase;
  message: string;
  trigger?: string | undefined;
};

export type SmokeDiagnostic = {
  phase: SmokePhase;
  trigger?: string | undefined;
  diagnostic: RuntimeDiagnostic;
};

export type SmokeReport = {
  ok: boolean;
  mounted: boolean;
  rendered: boolean;
  interactions: number;
  issues: SmokeIssue[];
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
   * Also record each reconcile diagnostic as an issue, so any identity-losing rebuild fails the run.
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
      // The report is already built; a fault on the way out does not change it.
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

export function describeDiagnostic(d: RuntimeDiagnostic): string {
  const where = d.tile ? `${d.tile} (${d.tileKind})` : d.tileKind;
  if (d.kind === "never-equal-prop") {
    return `${where}'s ${d.field} ${describeNeverEqualCause(d.cause)} — this tile re-applies its props on every render`;
  }
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
      return ((r: never) => String(r))(f);
  }
}

export const SMOKE_CONTENT_SELECTORS = [
  "img",
  "svg",
  "video",
  "input",
  "textarea",
  "select",
  "button",
  "progress",
  "hr",
  "[contenteditable='true']",
  "[role='status']",
  "[aria-busy='true']",
] as const;

const CONTENT_ELEMENTS = SMOKE_CONTENT_SELECTORS.join(", ");

function hasContent(root: HTMLElement): boolean {
  if ((root.textContent ?? "").trim().length > 0) return true;
  return root.querySelector(CONTENT_ELEMENTS) !== null;
}

function pickNext(root: HTMLElement, fired: Set<string>): [HTMLElement, string] | null {
  const unfired = (els: HTMLElement[]): [HTMLElement, string] | undefined =>
    els
      .map((el, i): [HTMLElement, string] => [el, signature(el, i)])
      .find(([, sig]) => !fired.has(sig));
  return unfired(collectInteractive(root)) ?? unfired(collectForms(root)) ?? null;
}

function collectForms(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("form"));
}

function collectInteractive(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("button, input, textarea, select, [data-kumiki-bind]"),
  ).filter((el) => {
    if (el.tagName.toLowerCase() === "input" && (el as HTMLInputElement).type === "file") {
      return false;
    }
    return !refusesControl(smokeVerbFor(el), readControl(el));
  });
}

function smokeVerbFor(el: HTMLElement): ControlVerb {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return "choose";
  if (tag === "textarea") return "fill";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    // `fire` clicks these rather than typing into them.
    return type === "checkbox" || type === "radio" ? "click" : "fill";
  }
  return "click";
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
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    } else {
      inp.value = "smoke";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function errStr(e: unknown): string {
  if (e instanceof Error)
    return e.stack ? `${e.message}\n${e.stack.split("\n")[1]?.trim() ?? ""}` : e.message;
  return String(e);
}
