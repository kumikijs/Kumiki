/** A new `<div>` appended to `parent`. */
export function freshRoot(parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement("div");
  parent.appendChild(el);
  return el;
}

let tagCounter = 0;

/** A custom-element name no earlier call has returned, since a tag can be defined only once. */
export function freshTag(prefix = "kumiki-test"): string {
  tagCounter += 1;
  return `${prefix}-${tagCounter}`;
}

/** Dispatch a bubbling event of `type` on `el`. */
export function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** The element under `root` that `selector` matches; throws when there is none. */
export function control<E extends Element = HTMLElement>(root: ParentNode, selector: string): E {
  const found = root.querySelector<E>(selector);
  if (!found) throw new Error(`no control matching ${selector}`);
  return found;
}

/** Give `field` the text `value`, as typing does, and fire its `input`. */
export function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  fire(field, "input");
}

/** Tick the box or radio `input` and fire its `change`. */
export function tickBox(input: HTMLInputElement): void {
  input.checked = true;
  fire(input, "change");
}
