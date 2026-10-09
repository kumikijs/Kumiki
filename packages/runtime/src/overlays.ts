// The DOM the runtime renders outside the mount root.
//
// Two built-in effects append to `document.body` rather than rendering under
// the root an app is mounted in: `toast` its banner and `confirm` its dialog.
// A scenario's `domIncludes` / `domExcludes` read them alongside the root
// (testing.md §8.10), at the scenario tier and the browser tier alike, so the
// list lives here once and both tiers read it.
//
// The effects write their markers themselves rather than importing them from
// here: `kumiki build` ships each effect module per app, and a module both of
// them imported would become a shared chunk the build cannot name. Instead
// `test/overlays.test.ts` fires each effect and checks its element against its
// entry here.

/**
 * One selector per runtime overlay, each matching the element its effect
 * appends to `<body>` — the toast banner (stdlib.md §2.6.2) and the confirm
 * dialog (lifecycle.md §7.6). Selectors rather than a reader, because the
 * browser tier asks them inside the page, across `page.evaluate`.
 */
export const RUNTIME_OVERLAY_SELECTORS = ["[data-kumiki-toast]", "[data-kumiki-confirm]"] as const;
