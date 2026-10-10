import { _setPathHelper, type BindSegment, bindPathStartsWith, type PathSegment } from "./path.ts";
import { slotAccepts } from "./refinement.ts";
import type { AppShape, BindReader } from "./types.ts";

type RefusedBind = {
  slot: string;
  path: readonly BindSegment[];
  value: unknown;
  shown: string;
  unread: BindReader["as"] | undefined;
};

const refusedBinds = new WeakMap<object, Map<HTMLElement, RefusedBind>>();

/** What a bound control shows: a box's tick, its value, or an editable's text. */
function shownValue(el: HTMLElement): string {
  const inp = el as HTMLInputElement;
  if (inp.type === "checkbox" || inp.type === "radio") return String(inp.checked);
  return "value" in el ? String(inp.value) : (el.textContent ?? "");
}

export function noteBindWrite(
  app: object,
  el: HTMLElement,
  slot: string,
  value: unknown,
  accepted: boolean,
  path: readonly BindSegment[] = [],
  unread?: BindReader["as"],
): void {
  let byEl = refusedBinds.get(app);
  if (byEl) {
    for (const other of byEl.keys()) if (!other.isConnected) byEl.delete(other);
  }
  if (accepted) {
    byEl?.delete(el);
    return;
  }
  if (!byEl) {
    byEl = new Map();
    refusedBinds.set(app, byEl);
  }
  byEl.set(el, { slot, path, value, shown: shownValue(el), unread });
}

/** Where a refused value counts as shown: a view's root, or any set of controls. */
export type BindView = Pick<Node, "contains">;

export function refusedBindShown(
  app: object,
  slot: string,
  view: BindView | undefined,
  held?: unknown,
  at: readonly PathSegment[] = [],
): Pick<RefusedBind, "value" | "unread"> | undefined {
  const byEl = refusedBinds.get(app);
  if (!byEl) return undefined;
  const shown: RefusedBind[] = [];
  for (const [el, r] of byEl) {
    if (r.slot !== slot) continue;
    if (!el.isConnected || shownValue(el) !== r.shown) {
      byEl.delete(el);
      continue;
    }
    if (view?.contains(el)) shown.push(r);
  }
  if (shown.length === 0) return undefined;
  shown.sort((a, b) => a.path.length - b.path.length);
  const laid = new Set<string>();
  let value = held;
  let unread: BindReader["as"] | undefined;
  for (const r of shown) {
    const where = JSON.stringify(r.path);
    if (laid.has(where)) continue;
    laid.add(where);
    value = r.path.length > 0 ? _setPathHelper(value ?? {}, r.path, r.value) : r.value;
    // Text another field cannot read is that field's to say, not a sibling's.
    if (bindPathStartsWith(r.path, at)) unread ??= r.unread;
  }
  return { value, unread };
}

/** A field as it shows, judged: valid, or why not (see `judgeShownField`). */
export type ShownField =
  | { valid: true }
  | { valid: false; unread: BindReader["as"] }
  | { valid: false; unread?: undefined; value: unknown };

export function judgeShownField(
  app: AppShape,
  slot: string,
  view: BindView | undefined,
  at: readonly PathSegment[] = [],
): ShownField {
  const meta = app.slots?.[slot];
  const held = app.live?.[slot] ?? meta?.value;
  const refused = refusedBindShown(app, slot, view, held, at);
  if (refused?.unread) return { valid: false, unread: refused.unread };
  const value = refused ? refused.value : held;
  return slotAccepts(meta, value, at) ? { valid: true } : { valid: false, value };
}

const heldSubmits = new WeakMap<Event, readonly string[]>();

/** Record that a form's gate held `e` back, and which bound slots did it. */
export function noteHeldSubmit(e: Event, slots: readonly string[]): void {
  heldSubmits.set(e, slots);
}

export function submitHeldBy(e: Event): readonly string[] | undefined {
  return heldSubmits.get(e);
}

/** The controls a refused bind is remembered against, for `app`. */
export function refusedBindControls(app: object): HTMLElement[] {
  return [...(refusedBinds.get(app)?.keys() ?? [])];
}

/** Drop the refused values remembered for controls inside `view`, which a full repaint is about to rebuild. */
export function forgetRefusedBindsWithin(app: object, view: Node): void {
  const byEl = refusedBinds.get(app);
  if (!byEl) return;
  for (const el of byEl.keys()) if (view.contains(el)) byEl.delete(el);
}
