let currentStyleRoot: Document | ShadowRoot | null = null;
let currentStyleHost: HTMLElement | null = null;
let stateStylesEl: HTMLStyleElement | null = null;

/** Point every style write at `root` (document head, or a shadow root) and theme writes at `host`. */
export function useStyleRoot(root: Document | ShadowRoot, host: HTMLElement | null): void {
  currentStyleRoot = root;
  currentStyleHost = host;
  stateStylesEl = null;
}

export function findStyleNode(id: string): HTMLStyleElement | null {
  const root = currentStyleRoot ?? document;
  return root.getElementById(id) as HTMLStyleElement | null;
}

export function appendStyleNode(style: HTMLStyleElement): void {
  const root = currentStyleRoot ?? document;
  const head = (root as Document).head;
  if (head) head.appendChild(style);
  else (root as ShadowRoot).appendChild(style);
}

/** The element that carries body-level theme styles (background/fg/font). */
export function styleHostEl(): HTMLElement {
  return currentStyleHost ?? document.body;
}

/** The style node that collects per-element `hover`/`focus`/… rules under the active root. */
export function stateStyleSheet(): HTMLStyleElement {
  if (stateStylesEl) return stateStylesEl;
  stateStylesEl = findStyleNode("kumiki-state-styles");
  if (!stateStylesEl) {
    stateStylesEl = document.createElement("style");
    stateStylesEl.id = "kumiki-state-styles";
    appendStyleNode(stateStylesEl);
  }
  return stateStylesEl;
}
