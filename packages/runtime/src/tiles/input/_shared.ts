// Helpers every input control shares (#71).
//
// Each `input` tile ships as its own module, so what several of them need has
// to live somewhere both can import: the per-element handler slot the native
// listeners dispatch through (`INPUT_STATE`, registered once at create so a
// patch can swap handlers without listener churn), the `bind=` write-back
// path, and the small attribute reconcilers. A single-use helper stays with
// its tile instead — `reconcileSelectOptions` is 70 lines only `select` runs.

import type { BindSegment, EventHandler, MountedApp, TileProps } from "../../core.ts";
import {
  _setPathHelper,
  attrValue,
  bindLabel,
  resolveApp,
  warnUnresolvedEvent,
} from "../../core.ts";

/** The app owning the mount tree `el` sits in; warns once when there is none. */
export function liveApp(el: Element): MountedApp | undefined {
  const app = resolveApp(el);
  if (!app) warnUnresolvedEvent(el, "bind write-back");
  return app;
}

export function writeBind(
  app: MountedApp,
  slotName: string,
  bindPath: BindSegment[] | undefined,
  value: unknown,
): void {
  if (bindPath && bindPath.length > 0) {
    const current = app.live[slotName] ?? {};
    app._setSlot(slotName, _setPathHelper(current, bindPath, value));
  } else {
    app._setSlot(slotName, value);
  }
}

export function bindDataset(
  el: HTMLElement,
  bind: string,
  bindPath: BindSegment[] | undefined,
): void {
  el.dataset.kumikiBind = bindLabel(bind, bindPath);
}

/** Clear a bind marker set by a previous render whose new node dropped `bind`. */
export function clearBindDataset(el: HTMLElement): void {
  if (el.dataset.kumikiBind !== undefined) delete el.dataset.kumikiBind;
}

// §1.6.2 — `{id: "..."}` on any tile maps to the element's native HTML `id`.
// Read from both `node.id` (top-level field; populated for tiles that lift
// `id` from positional args, e.g. `input(id="..")`) and `node.props.id`
// (block-style `{id: "..."}` for any tile kind). Used only by tile rendering;
// the `el.id` payload that feeds selector matching is built separately in
// codegen's `propsFor` so the two paths stay decoupled.
export function tileId(node: { id?: unknown; props?: unknown }): string | undefined {
  const fromProps = (node.props as { id?: unknown } | undefined)?.id;
  const raw = node.id ?? fromProps;
  return raw == null ? undefined : String(raw);
}

// Serialize a value to a stable option key for `<select>`. Recurses into
// variant `_tag` payloads so `Some(A)` vs. `Some(B)` don't collapse to the
// same key. Shared by both `create` and `patch` so option-slot lookups stay
// consistent across renders.
export function valueKey(v: unknown): string {
  if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
    const t = v as Record<string, unknown>;
    const parts: string[] = [String(t._tag)];
    for (let i = 0; `_${i}` in t; i++) parts.push(valueKey(t[`_${i}`]));
    return parts.join("|");
  }
  return JSON.stringify(v);
}

// Per-element handler slot (#190). `create` registers native listeners ONCE;
// they dispatch through the current slot value. `patch` overwrites the slot
// so the new node's `bind` / `onChange` / `el` reach subsequent events
// without add/remove-listener churn (which would either multiply-register or
// require holding a listener reference on the element).
export type InputHandlers = {
  bind?: string;
  bindPath?: BindSegment[];
  onInput?: EventHandler;
  onChange?: EventHandler;
  onClick?: EventHandler;
  /** form-specific — the shared slot type so `form` does not need its own local intersection. */
  onSubmit?: EventHandler;
  el?: Record<string, unknown>;
  // Select-specific — decoded via valueKey lookup on `change`.
  selectOptions?: Array<{ label: unknown; value: unknown }>;
  // Slider-specific — write `Number(inp.value)` back rather than the string.
  isSlider?: boolean;
};

export const INPUT_STATE = new WeakMap<HTMLElement, InputHandlers>();

/**
 * Per-element IME composition flag (#190). Set between `compositionstart` and
 * `compositionend` so patchers on `input` / `textarea` / `editable` can skip
 * `.value` / `.textContent` overwrites that would otherwise destroy an in-
 * flight IME candidate window (JP/CN/KR users typing kana → kanji, pinyin →
 * hanzi, jamo → hangul). Divergence is REMEMBERED via a pending flag on the
 * slot: the next `compositionend` triggers a bind writeback so state stays in
 * sync with what the user actually committed.
 */
export const IME_COMPOSING = new WeakSet<HTMLElement>();

/** Attach `compositionstart` / `compositionend` listeners once at create time. */
export function installCompositionGuard(el: HTMLElement): void {
  el.addEventListener("compositionstart", () => {
    IME_COMPOSING.add(el);
  });
  el.addEventListener("compositionend", () => {
    IME_COMPOSING.delete(el);
  });
}

export function setHandlers(el: HTMLElement, next: InputHandlers): void {
  INPUT_STATE.set(el, next);
}

export function inputHandlers(node: {
  bind?: string;
  bindPath?: BindSegment[];
  props?: TileProps;
}): InputHandlers {
  // Build only with defined fields — `exactOptionalPropertyTypes: true` in
  // the repo tsconfig would otherwise widen every optional to `T | undefined`
  // at the assignment site.
  const h: InputHandlers = {};
  if (node.bind !== undefined) h.bind = node.bind;
  if (node.bindPath !== undefined) h.bindPath = node.bindPath;
  if (node.props?.onInput) h.onInput = node.props.onInput;
  if (node.props?.onChange) h.onChange = node.props.onChange;
  if (node.props?.onClick) h.onClick = node.props.onClick;
  if (node.props?.el !== undefined) h.el = node.props.el;
  return h;
}

/**
 * Update an element's `id` attribute to match `node`'s current id (or clear
 * it if the id was removed). Kept as a helper so every patcher handles the
 * `id` field consistently — otherwise a tile that dropped its `id` would
 * still carry the previous render's DOM `id`, breaking `#foo` selectors.
 */
export function reconcileId(el: HTMLElement, node: { id?: unknown; props?: unknown }): void {
  const id = tileId(node);
  if (id) {
    if (el.id !== id) el.id = id;
  } else if (el.id) {
    el.removeAttribute("id");
  }
}

/** Update an input attribute only when it actually changed (avoids caret churn on happy-dom). */
export function setStringAttr(inp: HTMLElement, name: string, value: string | undefined): void {
  const current = inp.getAttribute(name);
  const next = value == null ? null : value;
  if (current === next) return;
  if (next === null) inp.removeAttribute(name);
  else inp.setAttribute(name, next);
}

/**
 * `disabled`, `readonly` and `auto-complete` on a control (forms.md §5.3, the
 * common props for input elements). All three were documented and read by
 * nothing.
 *
 * Which of them an element takes is decided by the element: a `<select>` has no
 * `readOnly`, a `<div contenteditable>` has no `disabled`. Asking it is what
 * keeps this one function instead of a per-kind list that would fall behind the
 * next kind. Shared by create and patch, so a `disabled` bound to a slot
 * follows it.
 */
export function applyControlState(el: HTMLElement, props?: TileProps): void {
  // A contenteditable div has neither property, and the way to take input away
  // from one is to stop it being editable.
  if (el.isContentEditable || el.getAttribute("contenteditable") !== null) {
    el.setAttribute(
      "contenteditable",
      props?.disabled === true || props?.readonly === true ? "false" : "true",
    );
  }
  if ("disabled" in el) {
    (el as HTMLElement & { disabled: boolean }).disabled = props?.disabled === true;
  }
  if ("readOnly" in el) {
    (el as HTMLElement & { readOnly: boolean }).readOnly = props?.readonly === true;
  }
  const auto = attrValue(props?.auto_complete);
  if (auto !== undefined) el.setAttribute("autocomplete", String(auto));
  else el.removeAttribute("autocomplete");
}
