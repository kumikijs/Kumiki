---
"@kumikijs/runtime": patch
---

A `notification.show` provider replaces the toast only, and a held leave never blocks navigation

A host that registered a provider for `notification.show` to replace the toast
UI also received every `confirm`, and had no way to answer it: a provider
returns an `EffectResult`, which cannot dispatch `onYes` / `onNo`. No dialog
was rendered and neither reducer ran. When the confirm came from a
`route.leave` guard, the held move was never settled, and every later
navigation was ignored while it waited, so the app stayed on that page:

```
provider got: [{"title":"Discard changes?","message":"You have unsaved edits.","onYes":"continueLeave","onNo":"stayHere"}]
modal in DOM: false
page after clicking Back home: Editor…
page after a second navigation to /: Editor…
```

`confirm` now always renders the runtime's own dialog (stdlib.md §2.5,
§2.6.5), and a `notification.show` provider is handed `toast` alone. The
guard's dialog appears, its answer runs `onYes` / `onNo`, and Yes completes
the move.

A navigation that arrives while a move is held now replaces it (routing.md
§3.5.2): the held move is dropped, its dialog closes unanswered, and the new
navigation leaves the page still shown, so the leave guard asks again about
the new destination. Before, that navigation was swallowed (the URL changed
and the page did not), and a later Yes completed the old move instead. This
covers a navigation the answer's own reducer emits too: it now lands where
that reducer sent it.

Only the dialog a guard opened settles the move it holds; a `confirm` another
reducer opens meanwhile no longer does.
