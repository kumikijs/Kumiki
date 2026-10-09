---
"@kumikijs/runtime": patch
---

A scenario's `domIncludes` / `domExcludes` read the toast banner and the confirm dialog

The runtime appends the `toast` banner and the `confirm` dialog to `<body>`,
outside the mount root, and the scenario runner read `domIncludes` /
`domExcludes` off the root alone. No scenario could assert what a toast said:

```json
{ "do": { "clickText": "Notify" }, "expect": { "domIncludes": ["notified"] } }
```

failed with `DOM should include "notified"` while the banner was on screen, so
fixtures asserted a counter the reducer bumped beside the `emit` instead.

Both assertions, and the step's `domText`, now read the mount root and the
runtime's overlays, and the step above passes. A run reads only the overlays it
opened: one already in the document when it starts, left by an earlier run or
test, is not read, and the ones it opened are removed when it tears down rather
than staying in a document the next run shares. `RUNTIME_OVERLAY_SELECTORS`,
exported from `@kumikijs/runtime`, lists the overlays.
