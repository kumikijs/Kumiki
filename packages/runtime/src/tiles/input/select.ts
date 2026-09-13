// The `select` tile (#71): its own shipping unit, so an app that renders one
// does not download the nine other input controls.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import {
  applyControlState,
  bindDataset,
  clearBindDataset,
  INPUT_STATE,
  inputHandlers,
  liveApp,
  reconcileId,
  setHandlers,
  tileId,
  valueKey,
  writeBind,
} from "./_shared.ts";

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
  const hasPlaceholder = firstOption?.disabled === true && firstOption.value === "";
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

export const selectTile: TileRenderer<"select"> = (node) => {
  const sel = document.createElement("select");
  sel.dataset.kumikiTile = "select";
  // §10.3.5 names `select` alongside `input` / `textarea` as a tile whose
  // bind path goes on the element, and §10.3.9 re-identifies a focused
  // `<select>` by that marker after a wholesale swap. Only the server pass
  // wrote it, so a picker restored its focus positionally on the client and
  // hydration met an attribute the client would not have produced.
  if (node.bind) bindDataset(sel, node.bind, node.bindPath);
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
  applyControlState(sel, node.props);
  return sel;
};

export const selectPatcher: TilePatcher<"select"> = (el, _oldNode, newNode) => {
  const sel = el as HTMLSelectElement;
  reconcileId(sel, newNode);
  if (newNode.bind) bindDataset(sel, newNode.bind, newNode.bindPath);
  else clearBindDataset(sel);
  const options = (newNode.options ?? []) as Array<{ label: unknown; value: unknown }>;
  reconcileSelectOptions(sel, newNode.placeholder, options, newNode.value);
  setHandlers(sel, { ...inputHandlers(newNode), selectOptions: options });
  applyControlState(el, (newNode as { props?: TileProps }).props);
};
