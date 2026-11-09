---
"@kumikijs/runtime": patch
---

Unmounting an app closes any `confirm` dialog it left open, unanswered

Before, a dialog no leave guard held stayed in the document after `dispose`,
with its Escape handler still on the document. Its answer dispatched `onYes` or
`onNo` into whichever mount of the same app came next: a scenario run that left
a dialog open had the next run's Escape answer it. Now the dialog closes when
the app is disposed, and neither reducer runs.
