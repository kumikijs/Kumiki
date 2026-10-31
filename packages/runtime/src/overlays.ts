// The effects write these markers themselves rather than importing them: `kumiki build` ships each
// effect module per app, and a module both imported would become a shared chunk the build cannot name.

/** Selectors rather than a reader, because the browser tier asks them inside the page. */
export const RUNTIME_OVERLAY_SELECTORS = ["[data-kumiki-toast]", "[data-kumiki-confirm]"] as const;
