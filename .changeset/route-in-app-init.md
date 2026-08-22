---
"@kumikijs/compiler": minor
---

Reject a direct route read in an `app.init` argument, and check init arguments in the scope they are lowered in.

`route` and `$route` written in an init argument now report `E0120 route-in-app-init`. Those arguments are evaluated once, while the app object is built; the route is installed by the mount that follows, so the read captured `undefined` and the app threw at mount with `check` and `build` both clean. A read reached through a `fn` call is not covered — the check looks at the reference, not at the call graph.

The checker walked init arguments in a reducer scope while codegen lowered them in the plain one. It now uses the same scope, which makes an `emit` expression there the purity error it always was (`E0305`) instead of a `_emits.push(…)` in the app object literal — a `ReferenceError` at import, so nothing mounted at all.

A `let` or pattern binding named `route` or `$route` is that binding, in both the checker and codegen: neither report fires on a shadowed name. `$route` was already being reported that way outside `app.init`, and no longer is.
