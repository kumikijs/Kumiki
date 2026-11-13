---
"@kumikijs/runtime": patch
---

Every `toast` can now be dismissed, with its "Dismiss" button or with Escape, and toasts shown together stack at the bottom-right instead of being drawn over one another.

An `error` toast's default duration is 0, "stays until dismissed", but the banner had no close control and no key handler, so it stayed for the rest of the session. Every banner was also fixed at the same `bottom: 24px; right: 24px`, so a later "Saved" was drawn over an earlier "Save failed".

The banners now sit in one `data-kumiki-toast-stack` element fixed to the corner, the newest nearest it, and the others close the gap when one leaves. Each banner carries a dismiss button (`data-kumiki-toast-dismiss`, accessible name "Dismiss"). Escape dismisses the toast whose button has focus and goes no further; Escape anywhere else is left to the page. A banner keeps its `role="status"`, `aria-live="polite"`, `data-level` and text, and one with a positive duration still leaves on its own. A host stylesheet that selected `body > [data-kumiki-toast]` should select `[data-kumiki-toast-stack] > [data-kumiki-toast]` instead.
