// Input tile renderers (#71): interactive controls (button, input, textarea,
// check, radio, select, slider, switch, form, editable). `bind=` controls
// write back to their slot through the owning mount's `_setSlot`, resolved
// from the control element via the multi-mount app registry (`resolveApp` in
// core) so several apps on one page never cross-wire.
//
// Every renderer is paired with a patcher (#190) that mutates the mounted
// element in place on a data-prop change, preserving browser-internal state
// (`<select>` open dropdown, `<input>` focus / caret, `contenteditable`
// caret / IME composition). To keep patching correct across `bind` /
// `onChange` closure changes without add/remove-listener churn, native
// listeners are registered ONCE by `create` and dispatch through a
// per-element handler slot held in `INPUT_STATE` — patchers just overwrite
// that slot with the new node's handlers.

import type {
  EventHandler,
  MountedApp,
  TileCtx,
  TileNode,
  TilePatchers,
  TileProps,
  TileRenderers,
} from "./core.ts";
import { _setPathHelper, resolveApp, warnUnresolvedEvent } from "./core.ts";

/** The app owning the mount tree `el` sits in; warns once when there is none. */
function liveApp(el: Element): MountedApp | undefined {
  const app = resolveApp(el);
  if (!app) warnUnresolvedEvent(el, "bind write-back");
  return app;
}

function writeBind(
  app: MountedApp,
  slotName: string,
  bindPath: string[] | undefined,
  value: unknown,
): void {
  if (bindPath && bindPath.length > 0) {
    const current = app.live[slotName] ?? {};
    app._setSlot(slotName, _setPathHelper(current, bindPath, value));
  } else {
    app._setSlot(slotName, value);
  }
}

function bindDataset(el: HTMLElement, bind: string, bindPath: string[] | undefined): void {
  const fullPath = bindPath && bindPath.length > 0 ? `${bind}.${bindPath.join(".")}` : bind;
  el.dataset.kumikiBind = fullPath;
}

/** Clear a bind marker set by a previous render whose new node dropped `bind`. */
function clearBindDataset(el: HTMLElement): void {
  if (el.dataset.kumikiBind !== undefined) delete el.dataset.kumikiBind;
}

// §1.6.2 — `{id: "..."}` on any tile maps to the element's native HTML `id`.
// Read from both `node.id` (top-level field; populated for tiles that lift
// `id` from positional args, e.g. `input(id="..")`) and `node.props.id`
// (block-style `{id: "..."}` for any tile kind). Used only by tile rendering;
// the `el.id` payload that feeds selector matching is built separately in
// codegen's `propsFor` so the two paths stay decoupled.
function tileId(node: { id?: unknown; props?: unknown }): string | undefined {
  const fromProps = (node.props as { id?: unknown } | undefined)?.id;
  const raw = node.id ?? fromProps;
  return raw == null ? undefined : String(raw);
}

// Per-element handler slot (#190). `create` registers native listeners ONCE;
// they dispatch through the current slot value. `patch` overwrites the slot
// so the new node's `bind` / `onChange` / `el` reach subsequent events
// without add/remove-listener churn (which would either multiply-register or
// require holding a listener reference on the element).
type InputHandlers = {
  bind?: string;
  bindPath?: string[];
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
const INPUT_STATE = new WeakMap<HTMLElement, InputHandlers>();

/**
 * Per-element IME composition flag (#190). Set between `compositionstart` and
 * `compositionend` so patchers on `input` / `textarea` / `editable` can skip
 * `.value` / `.textContent` overwrites that would otherwise destroy an in-
 * flight IME candidate window (JP/CN/KR users typing kana → kanji, pinyin →
 * hanzi, jamo → hangul). Divergence is REMEMBERED via a pending flag on the
 * slot: the next `compositionend` triggers a bind writeback so state stays in
 * sync with what the user actually committed.
 */
const IME_COMPOSING = new WeakSet<HTMLElement>();

/** Attach `compositionstart` / `compositionend` listeners once at create time. */
function installCompositionGuard(el: HTMLElement): void {
  el.addEventListener("compositionstart", () => {
    IME_COMPOSING.add(el);
  });
  el.addEventListener("compositionend", () => {
    IME_COMPOSING.delete(el);
  });
}

function setHandlers(el: HTMLElement, next: InputHandlers): void {
  INPUT_STATE.set(el, next);
}

function inputHandlers(node: {
  bind?: string;
  bindPath?: string[];
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

// Serialize a value to a stable option key for `<select>`. Recurses into
// variant `_tag` payloads so `Some(A)` vs. `Some(B)` don't collapse to the
// same key. Shared by both `create` and `patch` so option-slot lookups stay
// consistent across renders.
function valueKey(v: unknown): string {
  if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
    const t = v as Record<string, unknown>;
    const parts: string[] = [String(t._tag)];
    for (let i = 0; `_${i}` in t; i++) parts.push(valueKey(t[`_${i}`]));
    return parts.join("|");
  }
  return JSON.stringify(v);
}

/**
 * Reconcile a `<select>`'s `<option>` children in place. Options are NOT tile
 * children — they're generated inside this renderer from `node.options[]` —
 * so the outer reconcile walk never touches them. The patcher does the
 * per-option diff here to keep dropdown/selection state intact when the
 * options list shifts (add / remove / relabel / reorder / value change).
 *
 * Strategy: key each existing `<option>` (excluding the placeholder) by its
 * `.value` (already the serialized key). For each target option, either
 * mutate the existing one at the target index or splice in a fresh one; drop
 * any option not in the target key set. Placeholder is kept as the first
 * child when `node.placeholder` is set (or removed if it went away).
 */
function reconcileSelectOptions(
  sel: HTMLSelectElement,
  placeholder: string | undefined,
  options: Array<{ label: unknown; value: unknown }>,
  currentValue: unknown,
): void {
  const currentKey = valueKey(currentValue);
  const existing: HTMLOptionElement[] = Array.from(sel.options);
  const firstOption = existing[0];
  const hasPlaceholder =
    firstOption !== undefined && firstOption.disabled && firstOption.value === "";
  if (placeholder != null) {
    if (hasPlaceholder && firstOption !== undefined) {
      firstOption.textContent = String(placeholder);
      firstOption.selected = currentValue == null;
    } else {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = String(placeholder);
      ph.disabled = true;
      ph.selected = currentValue == null;
      sel.insertBefore(ph, sel.firstChild);
    }
  } else if (hasPlaceholder && firstOption !== undefined) {
    sel.removeChild(firstOption);
  }
  // After the placeholder is settled, index 0 (or 1 if placeholder) is the
  // first real option. Walk target options against existing real options.
  const offset = placeholder != null ? 1 : 0;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt) continue;
    const k = valueKey(opt.value);
    const existingAt = sel.options[i + offset];
    if (existingAt && existingAt.value === k) {
      // Same key at this slot: only update label + selection.
      if (existingAt.textContent !== String(opt.label)) {
        existingAt.textContent = String(opt.label);
      }
      existingAt.selected = k === currentKey;
      continue;
    }
    // Reorder / insert path. Try to find the target option later in the list;
    // if it's there, move it into place. Otherwise create a fresh option.
    let found: HTMLOptionElement | undefined;
    for (let j = i + offset + 1; j < sel.options.length; j++) {
      const cand = sel.options[j];
      if (cand && cand.value === k) {
        found = cand;
        break;
      }
    }
    if (found) {
      if (found.textContent !== String(opt.label)) found.textContent = String(opt.label);
      found.selected = k === currentKey;
      sel.insertBefore(found, sel.options[i + offset] ?? null);
    } else {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = String(opt.label);
      o.selected = k === currentKey;
      sel.insertBefore(o, sel.options[i + offset] ?? null);
    }
  }
  // Drop any trailing options that are no longer in the target list.
  while (sel.options.length > options.length + offset) {
    const last = sel.options[sel.options.length - 1];
    if (!last) break;
    sel.removeChild(last);
  }
}

/**
 * Update an element's `id` attribute to match `node`'s current id (or clear
 * it if the id was removed). Kept as a helper so every patcher handles the
 * `id` field consistently — otherwise a tile that dropped its `id` would
 * still carry the previous render's DOM `id`, breaking `#foo` selectors.
 */
function reconcileId(el: HTMLElement, node: { id?: unknown; props?: unknown }): void {
  const id = tileId(node);
  if (id) {
    if (el.id !== id) el.id = id;
  } else if (el.id) {
    el.removeAttribute("id");
  }
}

/** Update an input attribute only when it actually changed (avoids caret churn on happy-dom). */
function setStringAttr(inp: HTMLElement, name: string, value: string | undefined): void {
  const current = inp.getAttribute(name);
  const next = value == null ? null : value;
  if (current === next) return;
  if (next === null) inp.removeAttribute(name);
  else inp.setAttribute(name, next);
}

function setBooleanAttr(inp: HTMLElement, name: string, on: boolean): void {
  if (on) {
    if (!inp.hasAttribute(name)) inp.setAttribute(name, "");
  } else if (inp.hasAttribute(name)) {
    inp.removeAttribute(name);
  }
}

export const inputTiles: TileRenderers = {
  button(node) {
    const b = document.createElement("button");
    b.dataset.kumikiTile = "button";
    b.textContent = node.text;
    // Only when the tile said so: a `<button>` with no type submits the form it
    // is in, and that default is the one forms.md §5.2.2 describes. Writing
    // `type="button"` here for every button would silently un-submit every
    // form that relies on it.
    if (node.type) b.type = node.type;
    if (node.disabled) b.disabled = true;
    const id = tileId(node);
    if (id) b.id = id;
    setHandlers(b, inputHandlers(node));
    b.addEventListener("click", (e) => {
      const state = INPUT_STATE.get(b);
      if (state?.onClick) {
        e.preventDefault();
        state.onClick(state.el ?? {});
      }
    });
    return b;
  },
  input(node) {
    const inp = document.createElement("input");
    inp.dataset.kumikiTile = "input";
    inp.type = node.type ?? "text";
    if (node.placeholder) inp.placeholder = node.placeholder;
    if (node.required) inp.required = true;
    if (node.autoFocus) inp.autofocus = true;
    const id = tileId(node);
    if (id) inp.id = id;
    if (node.accept) inp.accept = String(node.accept);
    if (node.multiple) inp.multiple = true;
    const isFile = inp.type === "file";
    // File inputs reject programmatic `.value` assignment (security) and have no
    // text representation worth pre-populating; the picked-file state lives in
    // the slot, not in the DOM. bind= is undefined for files (spec §5.1.1 table).
    if (!isFile) {
      if (node.bind) bindDataset(inp, node.bind, node.bindPath);
      inp.value = node.value ?? "";
      installCompositionGuard(inp);
    }
    setHandlers(inp, inputHandlers(node));
    inp.addEventListener("input", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.bind && inp.type !== "file") {
        const app = liveApp(inp);
        if (app) writeBind(app, state.bind, state.bindPath, inp.value);
      }
      if (state?.onInput) state.onInput({ ...(state.el ?? {}), value: inp.value });
    });
    inp.addEventListener("change", () => {
      const state = INPUT_STATE.get(inp);
      if (!state?.onChange) return;
      if (inp.type === "file") {
        // FileList → plain records the Kumiki layer can read: name / size /
        // type are visible to Kumiki expressions; `_file` keeps the original
        // DOM File so `file-url()` can hand it to URL.createObjectURL and a
        // future http effect can wrap it in Multipart.
        const list = inp.files;
        const files: Array<{ name: string; size: number; type: string; _file: File }> = [];
        if (list) {
          for (let i = 0; i < list.length; i++) {
            const f = list[i];
            if (f) files.push({ name: f.name, size: f.size, type: f.type, _file: f });
          }
        }
        state.onChange({ ...(state.el ?? {}), files });
      } else {
        state.onChange({ ...(state.el ?? {}), value: inp.value });
      }
    });
    return inp;
  },
  textarea(node) {
    const ta = document.createElement("textarea");
    ta.dataset.kumikiTile = "textarea";
    if (node.rows) ta.rows = node.rows;
    if (node.placeholder) ta.placeholder = node.placeholder;
    const id = tileId(node);
    if (id) ta.id = id;
    if (node.bind) bindDataset(ta, node.bind, node.bindPath);
    ta.value = node.value ?? "";
    installCompositionGuard(ta);
    setHandlers(ta, inputHandlers(node));
    ta.addEventListener("input", () => {
      const state = INPUT_STATE.get(ta);
      if (state?.bind) {
        const app = liveApp(ta);
        if (app) writeBind(app, state.bind, state.bindPath, ta.value);
      }
      if (state?.onInput) state.onInput({ ...(state.el ?? {}), value: ta.value });
    });
    ta.addEventListener("change", () => {
      const state = INPUT_STATE.get(ta);
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), value: ta.value });
    });
    return ta;
  },
  check(node) {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = "check";
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = node.checked;
    setHandlers(inp, inputHandlers(node));
    inp.addEventListener("change", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.onClick) state.onClick(state.el ?? {});
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
    });
    wrap.appendChild(inp);
    return wrap;
  },
  radio(node) {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = "radio";
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "radio";
    if (node.group) inp.name = String(node.group);
    inp.checked = !!node.selected;
    const labelText = (node.props?.label as string | undefined) ?? "";
    wrap.appendChild(inp);
    if (labelText) {
      const span = document.createElement("span");
      span.textContent = labelText;
      wrap.appendChild(span);
    }
    setHandlers(inp, inputHandlers(node));
    inp.addEventListener("change", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.onClick) state.onClick(state.el ?? {});
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
    });
    return wrap;
  },
  select(node) {
    const sel = document.createElement("select");
    sel.dataset.kumikiTile = "select";
    const id = tileId(node);
    if (id) sel.id = id;
    const options = (node.options ?? []) as Array<{ label: unknown; value: unknown }>;
    reconcileSelectOptions(sel, node.placeholder, options, node.value);
    setHandlers(sel, { ...inputHandlers(node), selectOptions: options });
    sel.addEventListener("change", () => {
      const state = INPUT_STATE.get(sel);
      const opts = state?.selectOptions ?? [];
      const k = sel.value;
      const matched = opts.find((o) => valueKey(o.value) === k);
      if (matched === undefined) return;
      if (state?.bind) {
        const app = liveApp(sel);
        if (app) writeBind(app, state.bind, state.bindPath, matched.value);
      }
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), value: matched.value });
    });
    return sel;
  },
  slider(node) {
    const inp = document.createElement("input");
    inp.dataset.kumikiTile = "slider";
    inp.type = "range";
    const id = tileId(node);
    if (id) inp.id = id;
    if (typeof node.min === "number") inp.min = String(node.min);
    if (typeof node.max === "number") inp.max = String(node.max);
    if (typeof node.step === "number") inp.step = String(node.step);
    if (node.bind) bindDataset(inp, node.bind, node.bindPath);
    if (node.value != null) inp.value = String(node.value);
    setHandlers(inp, { ...inputHandlers(node), isSlider: true });
    inp.addEventListener("input", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.bind) {
        const app = liveApp(inp);
        if (app) writeBind(app, state.bind, state.bindPath, Number(inp.value));
      }
    });
    inp.addEventListener("change", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), value: Number(inp.value) });
    });
    return inp;
  },
  switch(node) {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = "switch";
    wrap.setAttribute("role", "switch");
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = node.checked;
    setHandlers(inp, inputHandlers(node));
    inp.addEventListener("change", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.onClick) state.onClick(state.el ?? {});
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
    });
    wrap.appendChild(inp);
    return wrap;
  },
  form(node, ctx: TileCtx) {
    const form = document.createElement("form");
    form.dataset.kumikiTile = "form";
    const id = tileId(node);
    if (id) form.id = id;
    setHandlers(form, formHandlers(node));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const state = INPUT_STATE.get(form);
      if (state?.onSubmit) state.onSubmit(state.el ?? {});
    });
    for (const child of node.children as TileNode[]) {
      if (child != null) form.appendChild(ctx.render(child));
    }
    return form;
  },
  editable(node) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "editable";
    div.contentEditable = "true";
    const id = tileId(node);
    if (id) div.id = id;
    if (node.bind) bindDataset(div, node.bind, node.bindPath);
    div.textContent = node.text ?? "";
    installCompositionGuard(div);
    setHandlers(div, inputHandlers(node));
    div.addEventListener("input", () => {
      const state = INPUT_STATE.get(div);
      const value = div.textContent ?? "";
      if (state?.bind) {
        const app = liveApp(div);
        if (app) writeBind(app, state.bind, state.bindPath, value);
      }
      if (state?.onInput) state.onInput({ ...(state.el ?? {}), value });
    });
    return div;
  },
};

// form.onSubmit lives directly on props (not through a change-shaped event),
// so store it in the handler slot alongside the shared fields. Both `create`
// and `patch` route through this so the mounted `<form>`'s submit listener
// dispatches to the *current* render's onSubmit closure.
function formHandlers(node: {
  bind?: string;
  bindPath?: string[];
  props?: TileProps;
}): InputHandlers {
  const h: InputHandlers = inputHandlers(node);
  if (node.props?.onSubmit) h.onSubmit = node.props.onSubmit;
  return h;
}

export const inputPatchers: TilePatchers = {
  button(el, _oldNode, newNode) {
    const b = el as HTMLButtonElement;
    if (b.textContent !== newNode.text) b.textContent = newNode.text;
    // A conditional can swap one button for another with a different `type`,
    // so this is reconciled like every other attribute. Back to the browser's
    // own default when the new node does not say.
    const nextType = newNode.type ?? "submit";
    if (b.type !== nextType) b.type = nextType;
    b.disabled = !!newNode.disabled;
    reconcileId(b, newNode);
    setHandlers(b, inputHandlers(newNode));
  },
  input(el, _oldNode, newNode) {
    const inp = el as HTMLInputElement;
    const nextType = newNode.type ?? "text";
    if (inp.type !== nextType) inp.type = nextType;
    setStringAttr(inp, "placeholder", newNode.placeholder);
    setBooleanAttr(inp, "required", !!newNode.required);
    reconcileId(inp, newNode);
    setStringAttr(inp, "accept", newNode.accept == null ? undefined : String(newNode.accept));
    setBooleanAttr(inp, "multiple", !!newNode.multiple);
    const isFile = inp.type === "file";
    if (!isFile) {
      if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
      else clearBindDataset(inp);
      // Write when the DOM diverges from what the tile intends. Typing "Bud"
      // → bind writes slot="Bud" → rerender computes value=`_s.show(slot)`
      // ="Bud"; the DOM already reads "Bud", so this skips the assignment and
      // the caret stays put. A reducer that clears / rewrites the slot ("Buy
      // milk" → "" on Enter) DOES diverge and must land — caret restoration
      // is picked up by the outer `renderPass` snapshot layer, which captures
      // selectionStart/End BEFORE this write.
      //
      // IME guard: skip the write while the user is composing (JP/CN/KR IME
      // candidate window open). Overwriting `.value` mid-composition would
      // dismiss the candidate window and destroy the in-flight glyph. When
      // `compositionend` fires, the browser dispatches a normal `input` event
      // that syncs the slot to the committed text, and the next render's
      // divergence is genuine.
      const nextValue = newNode.value ?? "";
      if (inp.value !== nextValue && !IME_COMPOSING.has(inp)) inp.value = nextValue;
    }
    setHandlers(inp, inputHandlers(newNode));
  },
  textarea(el, _oldNode, newNode) {
    const ta = el as HTMLTextAreaElement;
    if (typeof newNode.rows === "number" && ta.rows !== newNode.rows) ta.rows = newNode.rows;
    setStringAttr(ta, "placeholder", newNode.placeholder);
    reconcileId(ta, newNode);
    if (newNode.bind) bindDataset(ta, newNode.bind, newNode.bindPath);
    else clearBindDataset(ta);
    const nextValue = newNode.value ?? "";
    // See `input` patcher — write on divergence, caret restore is upstream.
    // IME guard as above: don't dismiss the IME candidate window mid-compose.
    if (ta.value !== nextValue && !IME_COMPOSING.has(ta)) ta.value = nextValue;
    setHandlers(ta, inputHandlers(newNode));
  },
  check(el, _oldNode, newNode) {
    const wrap = el as HTMLLabelElement;
    reconcileId(wrap, newNode);
    // check / radio / switch: create wraps a single `<input>` as the first
    // child (radio also appends a trailing `<span>` label; check / switch do
    // not). Use the direct child instead of `querySelector("input")` to avoid
    // matching a nested input if a future container tile ever wraps another
    // input beneath the same label.
    const inp = wrap.firstElementChild as HTMLInputElement | null;
    if (inp) {
      if (inp.checked !== newNode.checked) inp.checked = newNode.checked;
      setHandlers(inp, inputHandlers(newNode));
    }
  },
  radio(el, _oldNode, newNode) {
    const wrap = el as HTMLLabelElement;
    reconcileId(wrap, newNode);
    // check / radio / switch: create wraps a single `<input>` as the first
    // child (radio also appends a trailing `<span>` label; check / switch do
    // not). Use the direct child instead of `querySelector("input")` to avoid
    // matching a nested input if a future container tile ever wraps another
    // input beneath the same label.
    const inp = wrap.firstElementChild as HTMLInputElement | null;
    if (inp) {
      const nextName = newNode.group ? String(newNode.group) : "";
      if (inp.name !== nextName) inp.name = nextName;
      const nextChecked = !!newNode.selected;
      if (inp.checked !== nextChecked) inp.checked = nextChecked;
      setHandlers(inp, inputHandlers(newNode));
    }
    // Reconcile the trailing label span if the label text changed.
    const nextLabel = (newNode.props?.label as string | undefined) ?? "";
    const span = wrap.querySelector("span");
    if (nextLabel) {
      if (span) {
        if (span.textContent !== nextLabel) span.textContent = nextLabel;
      } else {
        const s = document.createElement("span");
        s.textContent = nextLabel;
        wrap.appendChild(s);
      }
    } else if (span) {
      wrap.removeChild(span);
    }
  },
  select(el, _oldNode, newNode) {
    const sel = el as HTMLSelectElement;
    reconcileId(sel, newNode);
    const options = (newNode.options ?? []) as Array<{ label: unknown; value: unknown }>;
    reconcileSelectOptions(sel, newNode.placeholder, options, newNode.value);
    setHandlers(sel, { ...inputHandlers(newNode), selectOptions: options });
  },
  slider(el, _oldNode, newNode) {
    const inp = el as HTMLInputElement;
    reconcileId(inp, newNode);
    if (typeof newNode.min === "number") setStringAttr(inp, "min", String(newNode.min));
    if (typeof newNode.max === "number") setStringAttr(inp, "max", String(newNode.max));
    if (typeof newNode.step === "number") setStringAttr(inp, "step", String(newNode.step));
    if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
    else clearBindDataset(inp);
    if (newNode.value != null) {
      const nextValue = String(newNode.value);
      // Range inputs have no caret; a `.value` write mid-drag would jump the
      // thumb, so guard on active-drag by checking pointer-focus via focus.
      if (inp.value !== nextValue && document.activeElement !== inp) inp.value = nextValue;
    }
    setHandlers(inp, { ...inputHandlers(newNode), isSlider: true });
  },
  switch(el, _oldNode, newNode) {
    const wrap = el as HTMLLabelElement;
    reconcileId(wrap, newNode);
    // check / radio / switch: create wraps a single `<input>` as the first
    // child (radio also appends a trailing `<span>` label; check / switch do
    // not). Use the direct child instead of `querySelector("input")` to avoid
    // matching a nested input if a future container tile ever wraps another
    // input beneath the same label.
    const inp = wrap.firstElementChild as HTMLInputElement | null;
    if (inp) {
      if (inp.checked !== newNode.checked) inp.checked = newNode.checked;
      setHandlers(inp, inputHandlers(newNode));
    }
  },
  form(el, _oldNode, newNode) {
    const form = el as HTMLFormElement;
    reconcileId(form, newNode);
    setHandlers(form, formHandlers(newNode));
  },
  editable(el, _oldNode, newNode) {
    const div = el as HTMLDivElement;
    reconcileId(div, newNode);
    if (newNode.bind) bindDataset(div, newNode.bind, newNode.bindPath);
    else clearBindDataset(div);
    // Text write on divergence only. During typing the bind loop keeps the
    // slot in sync with the DOM (`slot = textContent`), so `newNode.text ===
    // div.textContent` and this skips the assignment — caret / IME composition
    // survive. IME guard skips the write while a compositionstart..end is in
    // flight (JP/CN/KR candidate window), matching the `input` / `textarea`
    // patcher behaviour. A reducer that explicitly rewrites the slot outside
    // of composition DOES land here and will jump the caret; contenteditable
    // has no snapshot equivalent to INPUT's `setSelectionRange`, and
    // restoring a text-node offset across an arbitrary rewrite is out of
    // scope for #190 (native focus is still preserved via patch identity).
    const nextText = newNode.text ?? "";
    if ((div.textContent ?? "") !== nextText && !IME_COMPOSING.has(div)) {
      div.textContent = nextText;
    }
    setHandlers(div, inputHandlers(newNode));
  },
};
