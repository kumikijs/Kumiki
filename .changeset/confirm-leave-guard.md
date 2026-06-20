---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(lifecycle): `confirm` effect + `route.leave` guard callbacks (#82).

Lifecycle §7.6 ships the built-in `confirm` effect as a real in-app modal (not `window.confirm`) that dispatches the supplied `onYes` / `onNo` reducer by name. Routing §3.5.2 ties this into navigation: when a `route.leave(pattern)` reducer emits `confirm`, the runtime holds the transition — the old route's tile stays visible underneath the modal; Yes commits the held route and fires `route.enter`, No reverts the router to the old path.

- runtime: new `effects-confirm` module + installer, wired into the classic `mount` and exposed for the granular `mountCore` path.
- runtime: `route.leave` reducers now run **before** the slot/route commit and before `route.enter`. Their emits are observed: if any is `confirm`, `pendingLeave` gates the transition until `_resolveLeave` fires.
- compiler: `emit confirm({onYes: ref, onNo: ref})` encodes the reducer refs as string literals; usage analysis ships `effects-confirm` only when the app actually emits confirm; typecheck verifies the refs resolve to defined reducers.
- scenario: `click` selector falls back to `document` so the modal (on `<body>`) is reachable by the scenario tier.
- example + smoke + scenario + runtime integration tests cover the Yes / No / no-guard paths end-to-end.
