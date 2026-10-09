import { type AppShape, mount } from "@kumikijs/runtime";

type MountOptions = NonNullable<Parameters<typeof mount>[2]>;
type MountHandle = ReturnType<typeof mount>;

/** A container attached to the document and left there for the rest of the file. */
export function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

export async function withRoot<T>(run: (root: HTMLElement) => Promise<T>): Promise<T> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    return await run(root);
  } finally {
    root.remove();
  }
}

/** Mount `app` into a fresh root. */
export function mountApp(
  app: AppShape,
  options: MountOptions = {},
): { root: HTMLElement; handle: MountHandle } {
  const root = freshRoot();
  return { root, handle: mount(app, root, options) };
}

/** Mount `app` at `path` under a memory router, read the page text, and unmount. */
export function textAt(app: AppShape, path: string): string {
  const root = freshRoot();
  const handle = mount(app, root, { router: "memory", initialPath: path });
  const text = root.textContent ?? "";
  handle.dispose();
  root.remove();
  return text;
}

export const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `done` every `pollMs` until it holds; throw once `timeoutMs` has passed. */
export async function waitUntil(
  done: () => boolean,
  { timeoutMs = 2000, pollMs = 5 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await tick(pollMs);
  }
}

/** The button whose whole text is `text`. */
export function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!found) throw new Error(`button "${text}" not found`);
  return found;
}

/** Click the button whose whole text is `text`, as `HTMLElement.click()` does. */
export function click(root: ParentNode, text: string): void {
  button(root, text).click();
}

/** Dispatch a bubbling click on the first button whose text contains `text`. */
export function clickContaining(root: ParentNode, text: string): void {
  const found = Array.from(root.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`button "${text}" not found`);
  found.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The first element matching `selector`, typed as `T`. */
export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`${selector} not found`);
  return found as T;
}

/** Set a field's value and fire the `input` event a keystroke would. */
export function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** `typeInto` the field matching `selector`. */
export function fill(root: ParentNode, selector: string, value: string): void {
  typeInto(find<HTMLInputElement>(root, selector), value);
}

/** Move the mounted app to `path` the way a link does, and let the render settle. */
export async function navigate(app: AppShape, path: string): Promise<void> {
  (app as AppShape & { _navigate: (p: string, replace?: boolean) => void })._navigate(path, false);
  await tick(0);
}
