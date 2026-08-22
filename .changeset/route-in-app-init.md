---
"@kumikijs/compiler": minor
---

Reject an `app.init` argument that reads the route, and check init arguments in the scope they are lowered in.

`route` and `$route` in an init argument now report `E0120 route-in-app-init`. Those arguments are evaluated once, while the app object is built; the runtime installs the route during the mount that follows, so the read captured `undefined` and the app threw at mount with `check` and `build` both clean.

The checker walked init arguments in a reducer scope while codegen lowered them in the plain one. It now uses the same scope, which makes an `emit` expression there the purity error it always was (`E0305`) instead of a `_emits.push(…)` in the app object literal — a `ReferenceError` at import, so nothing mounted at all.
