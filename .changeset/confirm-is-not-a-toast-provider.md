---
"@kumikijs/runtime": patch
---

`confirm` shows its own dialog beside a `notification.show` provider, and a navigation while a leave guard's dialog is open is no longer ignored

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
§3.5.2): the held move is dropped and its dialog closes unanswered. To another
page, the leave guard runs again, for the new destination. Back to the page
still shown, as browser Back does while the dialog is open, only withdraws
the move: the page was never left, so `route.enter` does not run again and
the edits stay. Before, that navigation was swallowed (the URL changed and
the page did not), and a later Yes completed the old move instead. A
navigation the answer's own reducer emits replaces the move the same way, so
the answer no longer completes the move it answered, and a leave guard that
navigates as well as asking lands where its navigation went.

Only a dialog the leave guards opened settles the move they hold; a `confirm`
another reducer opens meanwhile no longer does. With two guards each asking,
the first answer settles the move and closes the other dialog. Unmounting
the app closes a held move's dialogs too, where before they outlived it.
