---
"@kumikijs/runtime": minor
"@kumikijs/cli": minor
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
after the fields inside them — so a form written without a submit button, the
shape the spec's own example uses, reaches its `ui.submit` reducer at all.

The scenario runner refuses what it cannot evaluate. The `expect` keys, the
action kinds and the document itself are closed sets, the browser tier's names
fail with a message saying so, and a scenario is checked before the app is
mounted. Two actions join: `wait`, so a debounce window or a retry backoff is
one step, and `submit`, whose selector may name the form or anything inside it.
The first paint is now a step of its own when it reports anything, so an
`app.init` effect that fails with no `.err` reducer fails the run instead of
being dropped.

The `Action` union gains `submit` and `wait` at both tiers; `@kumikijs/cli`
newly exports the test doubles (`installTestDoubles`, `useHttpFixture`,
`readHttpFixture`, `httpRequests`) and its app loader. A scenario that carried a
key nobody evaluated used to pass and now fails, which is the point.
