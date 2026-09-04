---
"@kumikijs/runtime": patch
---

Leave an off-origin link to the browser instead of throwing

`link(to="https://example.com/docs")` without `external: true` was intercepted
like any other link: the click handler called `preventDefault()` and handed the
target to `history.pushState`, which refuses an off-origin URL.

```
SecurityError: Failed to execute 'pushState' on 'History': A history state object
with URL 'https://example.com/docs' cannot be created in a document with origin
'http://localhost:3000'
```

The navigation was cancelled *and* did not happen, so the link was dead, and the
console named the History API rather than the link.

The handler now decides whether the target is one this app's router can serve —
before `preventDefault()`, so the browser still owns the click — and falls back
to native navigation when it is not, the same fallback it already takes for a
link outside any live mount. A one-line `console.warn` naming the link and its
target goes with it. Same-origin targets are unaffected: a relative path, an
absolute URL to this origin and a protocol-relative one all still route.

`external: true` remains the way a link says it leaves the app, and is still
what opens it in a new browsing context — it is no longer what decides whether
an off-origin link works at all.
