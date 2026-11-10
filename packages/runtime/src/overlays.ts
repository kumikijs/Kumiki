// The effects write these markers as literals: importing them would take a runtime entry of its own
// or a re-export through `core`, and `overlays.test.ts` keeps the copies in step.

/** The banner a `toast` appends to `<body>`. */
export const TOAST_SELECTOR = "[data-kumiki-toast]";

/** Selectors rather than a reader, because the browser tier asks them inside the page. */
export const RUNTIME_OVERLAY_SELECTORS = [TOAST_SELECTOR, "[data-kumiki-confirm]"] as const;
