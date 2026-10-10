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
