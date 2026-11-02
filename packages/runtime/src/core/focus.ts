/** Where focus and the caret were inside a view before a pass that may rebuild its controls. */
export type FocusSnapshot = {
  el: Element;
  bind: string | undefined;
  id: string | undefined;
  path: number[];
  selStart: number | null;
  selEnd: number | null;
  hasSelection: boolean;
};

const holdsFocusState = (el: Element): boolean =>
  el.tagName === "INPUT" ||
  el.tagName === "TEXTAREA" ||
  el.tagName === "SELECT" ||
  (el as HTMLElement).isContentEditable === true;

export function snapshotFocus(view: HTMLElement): FocusSnapshot | null {
  const active = document.activeElement;
  if (!active || !holdsFocusState(active) || !view.contains(active)) return null;
  const el = active as HTMLInputElement;
  const hasSelection = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  return {
    el,
    bind: el.dataset.kumikiBind ?? undefined,
    id: el.id || undefined,
    path: domPath(el, view),
    selStart: hasSelection ? el.selectionStart : null,
    selEnd: hasSelection ? el.selectionEnd : null,
    hasSelection,
  };
}

/**
 * Refocus the control the snapshot names: by bind, then by id, then the focused element itself while the pass kept it in the view, and only then by its position.
 * The position is the last resort because an element that is not a tile, such as a fieldset's `<legend>`, can come and go in front of the control.
 */
export function restoreFocus(snap: FocusSnapshot, view: HTMLElement): void {
  // A marker can hold a quoted index key (`notes["a"]`), so it is compared as a
  // string rather than spliced into a selector.
  const byBind = snap.bind
    ? [...view.querySelectorAll<HTMLElement>("[data-kumiki-bind]")].filter(
        (e) => e.dataset.kumikiBind === snap.bind,
      )
    : null;
  let found: Element | null =
    byBind?.length === 1
      ? (byBind[0] ?? null)
      : snap.id
        ? view.querySelector(`#${CSS.escape(snap.id)}`)
        : null;
  found ??= view.contains(snap.el) ? snap.el : elementAtPath(snap.path, view);
  if (!found || !holdsFocusState(found)) return;
  const el = found as HTMLElement;
  el.focus();
  if (!snap.hasSelection || snap.selStart === null || snap.selEnd === null) return;
  try {
    (el as HTMLInputElement).setSelectionRange(snap.selStart, snap.selEnd);
  } catch {
    // Some input types reject setSelectionRange; focus has already landed.
  }
}

function domPath(el: Element, root: Element): number[] {
  const path: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  return path;
}

function elementAtPath(path: number[], root: Element): Element | null {
  let cur: Element | null = root;
  for (const idx of path) {
    if (!cur) return null;
    cur = cur.children[idx] ?? null;
  }
  return cur;
}
