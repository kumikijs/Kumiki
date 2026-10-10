/** Where focus and the caret were inside a view before a pass that may rebuild its controls. */
export type FocusSnapshot = {
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
    bind: el.dataset.kumikiBind ?? undefined,
    id: el.id || undefined,
    path: domPath(el, view),
    selStart: hasSelection ? el.selectionStart : null,
    selEnd: hasSelection ? el.selectionEnd : null,
    hasSelection,
  };
}

/** Refocus the control the snapshot names: by bind, then by id, then by its position. */
export function restoreFocus(snap: FocusSnapshot, view: HTMLElement): void {
  const byBind = snap.bind ? view.querySelectorAll(`[data-kumiki-bind="${snap.bind}"]`) : null;
  let found: Element | null =
    byBind?.length === 1
      ? (byBind[0] ?? null)
      : snap.id
        ? view.querySelector(`#${CSS.escape(snap.id)}`)
        : null;
  found ??= elementAtPath(snap.path, view);
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
