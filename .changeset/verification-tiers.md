---
"@kumikijs/runtime": patch
"@kumikijs/cli": patch
---

Close the blind spots that let a broken example stay green.

`kumiki smoke` and the test suite were two implementations of one pipeline and
disagreed about the same example: six examples reached real hosts, and whether
the DNS failure landed inside the settle window decided the outcome. They share
one loader now, and both install the same doubles — a `fetch` answered by the
example's own `<source>.http.json`, and an `IntersectionObserver` that actually
notifies, since happy-dom's `observe()` is a no-op and the runtime's prefetch
path was unreachable from either headless tier.

`smoke` also answers for two things it used to wave through: a render of nothing
but empty containers is now reported as not rendered, and forms are submitted —
after the fields inside them — so a `ui.submit` reducer is reached at all.

The scenario runner refuses what it cannot evaluate. Both the `expect` keys and
the action kinds are closed sets, the browser tier's names fail with a message
saying so, and a document is checked before the app is mounted. Two actions
join: `wait`, so a debounce window or a retry backoff is one step, and `submit`,
whose selector may name the form or anything inside it.
