# @kumikijs/runtime

## 0.11.0

### Minor Changes

- 07e9c6b: feat(runtime): keep debounce-deferred effects on their originating episode (#120).

  Previously, a debounced effect that fired long after its originating reducer would open a **new** episode, breaking the causal chain in the episode log. The dispatcher now retains the originating episode id across the debounce window so the deferred effect lands under the same episode as the reducer that scheduled it. `http.cancel` / missing-capability / dispose paths also drain their debounce timers and notify `onPolicyCancel` correctly, closing the previously observed leaks.

  - runtime: `packages/runtime/src/core.ts` dispatcher preserves episode id through `debounce` / `throttle` / `latest` / `latest-per-key`.
  - runtime: `packages/runtime/src/episode.ts` records the cancel notification with the originating episode context.
  - spec: `docs/spec/runtime.md` §policy expanded with the continuity guarantee.

- 07e9c6b: feat(runtime,compiler,cli): episode logger (§10.5) + `episode-test` (§8.6) (#90).

  - runtime: new `createEpisodeLogger` (in-memory ring buffer + opt-in localStorage mirror) plus `MountOptions.episodeLogger` hooked into every reducer / effect-start / effect-end / signal-update / panic seam. Mounted apps expose `app.episodes()` (§10.7). Volatile slots are excluded from `slot-diffs` per language.md §175.
  - runtime/testkit: new `_stdlibTest.runEpisodeTest` — replays the logged trigger → reducer chain, resolves effects via `from-log` / `ignore` / `ok(v)` / `err(e)` mocks, and asserts `slots-equal: from-log` / `no-panics` / `no-errors`.
  - compiler: `episode-test` added to AST / parser / typecheck / codegen. The log fixture is read at compile time via the injected `readEpisodeLog` (Node helper `nodeEpisodeLogReader`) so the runtime never touches the filesystem.
  - cli: `kumiki run --episode-log <file>` now emits real per-trigger §10.5.1 episodes instead of the placeholder one-scenario-step records. `kumiki test` wires `readEpisodeLog` automatically when an `episode-test` is present.
  - examples: new `packages/examples/features/44-episode-test.kumiki` + fixture.

- 07e9c6b: feat(compiler,runtime): close three language-core gaps in language.md (#91).

  - compiler: `ui.key` and `ui.hover` (§1.6.1) are now accepted by parser/AST/codegen; codegen lifts them to `onKeyDown` (input/textarea/button) and `onMouseEnter` (any tile) on the enclosing tile.
  - compiler: tuple patterns `(p1, p2, …)` (§1.9) are now parsed, typechecked, and lowered. The match-arm separator heuristic was extended so `| (p, q) -> …` is recognised as an arm boundary rather than a bool-OR expression.
  - compiler: literal patterns (`| "foo" -> …` / numeric / bool) are removed from the implementation to match §1.9.1's prohibition — they were already an error in the docs but the AST node and codegen path quietly accepted them. `parser` now fails with `Expected pattern`, matching `spec-gaps.test.ts` Gap 1.
  - runtime: `TileProps` gains `onKeyDown` / `onMouseEnter`; the universal render hook wires `keydown` (passing `el.key` / `el.code`) and `mouseenter` once for every tile so no per-renderer plumbing is needed.
  - examples: new `packages/examples/features/45-ui-key-hover-tuple.kumiki` + scenario covers all three.

- 07e9c6b: feat(routing): nested routes — `sub-routes` declaration on tiles + `route-outlet` child rendering (#85).

  `docs/spec/routing.md` §3.6 has described nested routes from day one, but the parser was discarding the `sub-routes` block and `route-outlet()` rendered as an empty `<div>`. Both halves are now wired end-to-end so a layout tile can host a `/parent/*` wildcard, declare its own child route map, and select which child renders inside its `route-outlet`.

  - **compiler**: `TileDef.subRoutes` is a real AST field; the parser stores the parsed route map and codegen emits a nested `subRoutes:` array on the parent's route entry. Typecheck validates child tile existence (E0105), wildcard-parent integrity (E0110), orphan sub-routes (E0111), and duplicate sub-route paths (E0112).
  - **runtime**: `parseLocation` re-matches the path inside the matched parent's `subRoutes`. `pickRootTile` injects the matched child into the first `route-outlet` of the parent's render tree, and the `route-outlet` renderer now mounts whatever children it has been given. If no sub-route matches under a wildcard parent, the runtime falls through to the global `/404` per §3.6.3.
  - **examples**: `packages/examples/features/40-nested-routes.kumiki` + scenario (`/settings/*` with three sub-routes, including the default and the `/404` fallthrough).

- 07e9c6b: feat(cli,runtime): `kumiki replay` — interactive episode replay (§10.5.3) (#117).

  - cli: new `replay` verb. `kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]` replays a recorded episode log against a compiled app and streams the per-step trace (reducer / effect-start / effect-end / signal-update). `--mock` is repeatable; values follow §8.6's `from-log | ignore | ok(<json>) | err(<json>)` grammar. `--until-step` halts after the Nth observed step (1-indexed, global across episodes) and prints the slots at that moment.
  - runtime/testkit: extracted the per-episode executor that already powered `runEpisodeTest` into a shared `executeEpisode` and exposed it through a new `replayEpisodes` export. Both the assert-based test runner and the CLI trace formatter call the same engine — `from-log` cursor, refine ward, and unhandled-error accounting can no longer drift between them.
  - compiler: `parseEpisodeLogText` is now exported from `@kumikijs/compiler/node` so CLI tooling can consume `kumiki run --episode-log` output without going through codegen.

- 07e9c6b: feat(runtime,compiler): SSR + hydration with bootstrap episode (#119).

  Kumiki apps can now be pre-rendered on the server and hydrated on the client without losing the reactive graph or replaying the initial reducers. The hydration path opens a **bootstrap episode** so any HTTP / storage prefetch performed during SSR shows up in the client-side episode log as the first coherent step, rather than as untracked side-effects before the app "starts".

  - runtime: `mountCore` gains a hydrate path that adopts the server-rendered DOM as the initial tile tree (v1 shape: `replaceChildren` overwrite — identity-preserving hydration tracked separately). Per-request `app.live` initialisation prevents cross-request signal leakage.
  - runtime: SSR version check bails **non-silently** if the runtime version embedded in the SSR payload disagrees with the client bundle.
  - compiler: codegen threads the bootstrap-episode shape through so SSR-side effects land in the hydrated log.
  - examples: new `packages/examples/apps/10-ssr-hydration`.
  - spec: `docs/spec/runtime.md` §SSR expanded to cover the bootstrap-episode contract.

- 07e9c6b: feat(compiler,runtime): wire static `TileName#id` selector end-to-end (#131).

  The `TileName#id` selector in `reducer r on=ui.click(NewBtn#save)` is now honoured all the way from parse to dispatch. The compiler emits the id filter into the generated handler, and the runtime `_dispatch` skips reducers whose `selector.id` does not match the dispatched element's `el.id` — a defence-in-depth layer that keeps working even when the tile's `{id}` is computed at runtime.

  - compiler: `packages/compiler/src/codegen.ts` threads `selector.id` through the tile dispatcher.
  - runtime: `_dispatch` (`packages/runtime/src/core.ts`) filters by `el.id` before invoking the reducer.
  - spec: `docs/spec/language.md` §1.6.2 formalises the selector shape; `docs/spec/errors.md` adds `E0211 undef-tile-in-selector`.

- 07e9c6b: feat(compiler,runtime): wire `ui.focus` / `ui.blur` (§1.6.1).

  The parser and AST already accepted these two `ui-kind`s alongside `ui.key` / `ui.hover`, but the codegen never lifted them and the runtime had no DOM listeners — so `reducer r on=ui.focus(InputX) do= …` silently did nothing.

  - compiler: `propsFor` now lifts `ui.focus(EnclosingTile)` / `ui.blur(EnclosingTile)` into `onFocus` / `onBlur` on focusable tiles (`input` / `textarea` / `button` / `select`). Non-focusable tiles are deliberately skipped so the runtime never installs a listener the DOM cannot fire. The explicit-prop passthrough lists (`{onFocus: someReducer}` etc.) also gain `onFocus` / `onBlur`.
  - runtime: `TileProps` gains `onFocus` / `onBlur`; the same universal render hook that handles `onKeyDown` / `onMouseEnter` now wires `focus` / `blur` on every tile, passing the tile's `el` payload.
  - examples: new `packages/examples/features/49-ui-focus-blur.kumiki` + scenario covers both events.

### Patch Changes

- 07e9c6b: feat(runtime): scenario DOM focus / blur primitives (#142).

  The scenario testkit now exposes `focus` and `blur` primitives that drive real DOM focus events end-to-end, so a scenario can verify that `addEventListener("focus", …)` wiring actually reaches the reducer — not just that the compiler emitted the handler. This closes the "compiles but never fires" gap for `ui.focus` / `ui.blur`.

  - runtime: `packages/runtime/src/scenario.ts` gains `focus(selector)` and `blur(selector)` steps.
  - e2e: `packages/e2e/src/browser.ts` mirrors the primitives for Playwright fixtures.
  - examples: `packages/examples/features/49-ui-focus-blur.scenario.json` exercises both.

- 07e9c6b: feat(compiler): `W0212 ui-event-subscription-mismatch` — warn on `ui-event` subscriptions that cannot fire (#143).

  When a reducer subscribes to a `ui-event` on a tile that cannot emit it (e.g. `ui.submit(DivTile)` or `ui.focus(NonFocusableTile)`), the compiler now emits `W0212` instead of silently generating a handler the DOM will never invoke. The rule consults the ui-event implicit-lift table (single source of truth in `packages/compiler/src/ui-lifts.ts`) to decide whether the subscription is admissible.

  - compiler: `checkReducer` cross-references the target tile's kind against the ui-event's admissible tile set.
  - runtime / cli / vite: no behavioural change; the diagnostic surfaces through the standard `check` gate and Vite overlay.
  - spec: `docs/spec/errors.md` and `docs/spec/stdlib.md` document `W0212`; `docs/spec/language.md` cross-links to the ui-event lift table.

## 0.10.0

### Minor Changes

- 47bc7aa: feat(app.http): wire `app.http = { base-url, headers, on-401/-403/-5xx, timeout, credentials }` end-to-end (#78).

  - compiler: parser captures `app.http` instead of silently discarding it; codegen emits `_http` and threads it through every `httpFetch` call.
  - runtime: `httpFetch` now prepends `base-url`, merges global headers (precedence: auto < global < input), enforces a 30s default timeout via `AbortController`, and passes `credentials` (default `same-origin`).
  - runtime: status-coded HTTP errors (401/403/5xx) automatically dispatch to the reducer named by `on-401` / `on-403` / `on-5xx`, in addition to any per-effect `.err` handler (spec §6.3.2).
  - examples: new `packages/examples/apps/07-app-http`.

- 47bc7aa: feat(indexed-db): wire `app.indexed-db` config + `indexed-read` / `indexed-write` / `indexed-delete` / `indexed-query` effects (#79).

  `indexed.*` capabilities were spec'd but had no runtime; effects compiled but fell through to "no provider". This change ships the full path.

  - compiler: parser/AST capture `app.indexed-db = { name, version, stores: [{ name, key, indexes? }] }`; codegen emits `_idb` and threads it to the `indexed-*` builtins.
  - runtime: `effects-indexed.ts` opens the IndexedDB lazily and dispatches `indexed.read` by input shape (point lookup vs range query). Unavailable backends keep returning a clean `err` (the no-silent-failure contract from #37).
  - examples: new `packages/examples/features/36-effect-indexed-db.kumiki`; parser/codegen/runtime regression tests; check + build + smoke green.

- 47bc7aa: feat(app): wire `app.meta` and `app.analytics` end-to-end (#80).

  Previously the parser accepted these blocks and threw away the value; both now flow from source to runtime.

  - **compiler**: `AppDef.meta` / `AppDef.analytics` are real AST fields with field-level validation. `meta` accepts the closed set `title`, `description`, `og-image`, `favicon` (all string literals). `analytics` takes `provider: "console" | "noop"` plus optional `app-id`. Codegen emits both as plain literals on the App object.
  - **runtime**: at mount, `app.meta` is reflected into `<head>` — `document.title`, `<meta name="description">`, `<meta property="og:image">`, `<link rel="icon">` — upserting existing tags rather than duplicating. `app.analytics` installs a default `analytics.send` provider (console / noop) unless the host registers one, so an app can declare measurement without depending on an SDK. `appId` is merged into every event payload.
  - **examples**: `packages/examples/apps/09-app-meta-analytics`.

- 47bc7aa: feat(lifecycle): `confirm` effect + `route.leave` guard callbacks (#82).

  Lifecycle §7.6 ships the built-in `confirm` effect as a real in-app modal (not `window.confirm`) that dispatches the supplied `onYes` / `onNo` reducer by name. Routing §3.5.2 ties this into navigation: when a `route.leave(pattern)` reducer emits `confirm`, the runtime holds the transition — the old route's tile stays visible underneath the modal; Yes commits the held route and fires `route.enter`, No reverts the router to the old path.

  - runtime: new `effects-confirm` module + installer, wired into the classic `mount` and exposed for the granular `mountCore` path.
  - runtime: `route.leave` reducers now run **before** the slot/route commit and before `route.enter`. Their emits are observed: if any is `confirm`, `pendingLeave` gates the transition until `_resolveLeave` fires.
  - compiler: `emit confirm({onYes: ref, onNo: ref})` encodes the reducer refs as string literals; usage analysis ships `effects-confirm` only when the app actually emits confirm; typecheck verifies the refs resolve to defined reducers.
  - scenario: `click` selector falls back to `document` so the modal (on `<body>`) is reachable by the scenario tier.
  - example + smoke + scenario + runtime integration tests cover the Yes / No / no-guard paths end-to-end.

- 47bc7aa: feat(http): execute `retry=linear(N, ms)` / `retry=exponential(N, ms, factor)` at runtime (#83).

  The compiler already parsed retry clauses; the runtime ignored them. This change wires the policy through:

  - compiler: `genEffect` now emits `retry: { kind, n, ms[, factor] }` on every `EffectSpec`.
  - runtime: `EffectSpec.retry` is read by the dispatcher's launch loop. Only 5xx responses and connection errors (status 0) are retried; 4xx is treated as a final failure (spec §6.5).
  - examples: `packages/examples/apps/08-http-retry`.

- 47bc7aa: feat(lifecycle): wire the remaining lifecycle events (#81).

  Until now only `app.start`, `app.error`, and `route.enter` / `route.leave` made it past the parser; the rest of the catalog from `docs/spec/lifecycle.md` §7.1 was reserved but inert. This change makes the full set behave at runtime.

  - **parser**: closed-set validation for `app.*` (`stop`, `visible`, `hidden`, `online`, `offline`, `http-401`, `http-403`, `http-5xx`), `tile.mount(X)` / `tile.unmount(X)` (the tile name is now preserved as part of the event identity, like `route.enter("/p")`), and `route.error("/p")`. Unknown variants are a parse error.
  - **runtime**: mount installs `beforeunload` → `app.stop`, `visibilitychange` → `app.visible` / `app.hidden`, and `online` / `offline` → `app.online` / `app.offline` listeners — only for the events the app actually subscribes to. All listeners are removed on `dispose`.
  - **runtime**: `tile.mount(X)` / `tile.unmount(X)` fire when a user-defined tile enters or leaves the rendered tree. Codegen marks each user-tile call site with a `_tile` prop; the runtime diffs the marker set across renders so the events only fire on transition. Built-in tiles (`button`, `page`, …) are not tracked.
  - **runtime**: a render panic under a routed tile dispatches `route.error("<pattern>")` with `$event = { message, location, pattern }` before falling back to the top-level panic UI (lifecycle.md §7.5.2).
  - **examples**: `packages/examples/features/37-lifecycle-events.kumiki`.

- 47bc7aa: feat(session): `session-read` / `session-write` effects over `sessionStorage` (#84).

  Spec §6.7.4 says `session-*` shares the same shape as `storage-*`, but the runtime only exported the localStorage handlers, so `cap=session.*` effects compiled but had no provider and fell through to the "no provider" error.

  - runtime: add `sessionRead` / `sessionWrite` next to the localStorage handlers (one helper does the JSON / Option round-trip for both backends), wire them into `builtinEffects`.
  - compiler: dispatch `session.read` / `session.write` to the new handlers in codegen.
  - runtime: unavailable backends keep returning a clean `err` (#37 contract), exercised by a SecurityError test.
  - examples: new `packages/examples/features/39-effect-session.kumiki` models both `.ok` and `.err` branches end-to-end.

## 0.9.0

### Minor Changes

- c40b121: Ship a minified runtime to built apps. `@kumikijs/runtime` now emits two
  artifacts: `./bundle` (unminified — still what codegen inlines for
  smoke/run/test and the playground, where readable traces matter and the
  inliner relies on stable top-level names) and the new `./bundle.min`
  (minified ESM). `kumiki build` writes `bundle.min` as the app's
  `runtime.js`, cutting it from 90KB/24.8KB gzip to 50KB/15.2KB gzip. The
  package also declares `sideEffects: false`, so bundlers consuming
  `@kumikijs/runtime` through `@kumikijs/vite` can tree-shake unused exports.
  A new CLI test mounts the exact built artifact pair in a headless DOM to
  guarantee runtime parity.
- 7e589bc: Per-app dead-code elimination for `kumiki build` (#71). The runtime is now
  composed of granular feature modules — `core` (mount/dispatch/theme/render
  seam), `stdlib`, `testkit` (the reducer/property/tile test harness),
  `router`, `effects-{storage,http,toast}`, and seven `tiles-*` renderer
  families — published as `@kumikijs/runtime/modules/*` (minified ESM).
  Codegen tracks which built-in tiles, effects, and routing features an app
  uses and, in the new `runtimeModulesDir` mode, imports only those modules,
  mounting through the new `mountCore` (the classic `mount`, merged
  `_stdlib`, `builtinEffects`, and the `./bundle` / `./bundle.min` artifacts
  are unchanged). `kumiki build` ships `runtime/` with exactly that pruned
  set instead of a monolithic `runtime.js`: the counter example drops from
  50KB/15.2KB gzip to ~27KB/~9KB gzip and carries no router, table/overlay
  tile, effect-handler, or test-harness code. The router ships only when the
  app can actually navigate (nav caps, `navigate*` emits, `link` /
  `route-outlet`, redirects, or routes beyond the `"/"` + `"/404"`
  boilerplate) — a static single-route app never reads the URL, so a deep
  link to an unknown path renders the root tile rather than the 404 tile.

### Patch Changes

- c4833bd: `spinner` renders an animated, accessible loading ring instead of a static "…" placeholder.

  The previous renderer set `textContent = "…"`, so `Loading` states (e.g. the
  `stdlib §2.3.8` feedback tile used by the HTTP showcase) never showed an actual
  spinner. The tile now renders a rotating `currentColor` ring with
  `role="status"` / `aria-label="Loading"`; the `@keyframes kumiki-spin` rule
  lives in the shared animation stylesheet, so it works in any style root
  (document or shadow) and is disabled under `prefers-reduced-motion`. The `size`
  prop accepts the `sm` / `md` / `lg` / `xl` tokens (spec now states this);
  without it the ring scales with the surrounding text.

## 0.8.0

### Minor Changes

- 3ee1a9a: Implement every documented built-in tile and close three spec gaps (#61, #62).

  **Built-in tiles (#61).** The parser/typechecker accepted the full `stdlib §2.3`
  tile set while codegen implemented only a subset, so documented tiles passed
  `check` but threw `Tile "<name>" not found` at `build`. The registry is now
  single-sourced (`builtins.ts`, shared by parser/typecheck/codegen) and codegen +
  runtime implement every tile: `code`, `video`, `list`/`list-item`,
  `table`/`table-head`/`table-body`/`table-row`/`table-cell`, `modal`, `drawer`,
  `tooltip`, `popover`, `toast`, `progress`, `error`, `route-outlet`, plus `slider`
  and `switch` (previously in-set but unimplemented). `error(field=…)` resolves its
  message from the slot's refinement predicate, honoring `theme.errors` overrides.

  **Spec clarifications (#62).** Three constructs that looked legal from the spec
  are now stated as rules: literal `match` patterns are unsupported (variant /
  `Variant(binds)` / tuple / `_` only); `$1` in a tile requires an `in=` argument
  (E0103 now hints at this); and `()` is the args/children list while `{}` is the
  `key: value` props block. `link` now accepts the canonical `text=` argument
  (consistent with `button`); the existing `{text: …}` prop form still compiles.

## 0.7.0

### Minor Changes

- afe1b15: v0.6 M2 (#50) — effect-result mocks inside `reducer-test` (`spec/testing.md` §8.5). `given.mocks = {effect: ok(v) | err(e) | delay(ms, ok(v))}` drives a multi-step flow headlessly: a mocked effect is delivered to its `.ok`/`.err` reducer and consumed; a non-mocked emit is residual (asserted via `expect.effects`). `delay` is virtualized (immediate). A mock key must name a declared effect (E0104); a mocked `err` with no `.err` reducer fails the test.
- e92f5df: v0.6 M3 (#51) — `property-test` (`spec/testing.md` §8.3). Generative testing of reducer invariants: `property-test for-all={n: T} given={…} invariant=<bool> (count=N)? (shrink=bool)?` generates `count` (default 100) cases per type (primitives, List/Map/Set/Option/Result, records, unions; refinements fold into the generator as bounds), checks the invariant, and shrinks a failing case to a minimal counterexample. `run-reducer(name)` chains apply reducers to the running state. Generation is seeded (reproducible). The runner reports `(N cases)`. `run-reducer` targets must be declared reducers (E0102).
- 33fc749: v0.6 M4 (#52) — `kumiki test` runner polish (`spec/testing.md` §8.7). Per-test timings on every line (`(1ms)`; property-tests add `(100 cases, 23ms)`); `--coverage` reports per reducer/effect/tile what the suite exercises and lists the uncovered (computed statically by codegen into `globalThis.__kumikiCoverage`); `--watch` re-runs the filtered suite on `.kumiki` change (debounced, clean Ctrl-C exit). Completes the v0.6 testing-DSL milestone.

## 0.6.0

### Minor Changes

- cd1e88a: v0.6 M1 (#49) — `reducer-test` `expect` wildcards (`spec/testing.md` §8.2.2). `<any-id>` matches any generated value (and, as a map key, pairs with exactly one otherwise-unmatched entry), and `<slots.X>` matches slot X's post-execution value (e.g. `effects: [persist(<slots.todos>)]`). Matching is otherwise exact — wildcards only blank out non-deterministic holes. A wildcard outside a `reducer-test` `expect` is a compile error (new E0109 `test-wildcard-misuse`).

## 0.5.0

### Minor Changes

- 20c8601: feat: no-silent-failure contract for unhandled effect errors (v0.5 M2, #37)

  An effect `err` result that no `.err` reducer consumes is now surfaced via
  `console.error` (`[kumiki] effect "<name>" returned an error with no .err
reducer: …`) instead of being dropped silently — so the verification tiers
  (`smoke` / `runScenario`, which capture `console.error`) flag it, consistent
  with the v0.3 live-panic model. This fixes the storage-unavailable case (sandbox
  preview / private mode) that previously looked like the app did nothing.

  The default contract is `err` + a surfaced report; a program opts into handling
  (or deliberately ignoring) the error by wiring an `.err` reducer (even an empty
  one). An in-memory storage fallback is explicitly not the silent default.
  Backward-compatible (additive surfacing; defaults unchanged).

- 20c8601: feat: virtual / memory router mode for embedded contexts (v0.5 M3, #36)

  `mount(app, el, { router: "memory", initialPath?: "/" })` resolves the initial
  route from `initialPath` (not the ambient `location`) and routes `navigate` /
  link clicks / `navigate-back` through an in-memory path with no `history.*` —
  so path-based routing works inside the playground `<iframe srcdoc sandbox>` and
  any embedded host (Web Component, embed) that owns the top-level URL, where the
  ambient origin is opaque and `history.pushState` throws.

  `router: "history"` stays the default (apps at a real origin are unaffected).
  The auto-mounting bundle spreads `globalThis.__kumikiMount` into mount options
  (compiler), and `defineKumikiElement(tag, app, { router, initialPath })`
  forwards the option to the Web Component. `runScenario` gained a
  `{ router, initialPath }` option. Backward-compatible (additive; defaults
  unchanged).

## 0.4.0

### Minor Changes

- c51b7b8: feat: host capability providers — the inbound ecosystem seam

  Custom capabilities (registered via `kumiki.caps.json`) can now be backed by a
  host-supplied implementation, so a Kumiki app can use any npm library / SDK
  without language-level FFI.

  - `mount(app, target, { providers })` accepts a `Record<string, CapabilityProvider>`
    keyed by capability name. New runtime exports: `CapabilityProvider`,
    `MountOptions`; `CapabilityRegistry` gains `provider(cap)`.
  - Codegen now lowers a custom-capability effect to a provider lookup at the
    capability boundary (`caps.provider(cap)`) instead of an always-failing
    "not implemented" stub. With no provider registered it resolves to
    `err {message: "Capability <name> has no provider"}`.
  - The auto-mounted bundle threads `globalThis.__kumikiProviders` so an embedding
    host can register providers before the module loads.

  Standard capabilities keep their built-in implementations (not provider-overridable),
  and scenario mocks still override providers at the same boundary. See
  docs/spec/stdlib.md §2.5.

- c51b7b8: feat: multiple independent instances via a `createApp()` factory

  A compiled app previously bound its render closures to one module-level live
  state, so mounting the same app twice (or two Web Component instances) shared
  state. Codegen now wraps the per-instance pieces (slots, live, reducers, routes,
  effects, tiles) in a `createApp()` factory whose closures bind to that call's own
  `live`. Each `createApp()` returns a fully independent `AppShape`; no runtime
  change is needed.

  - Compiled modules expose `createApp` (and `export { createApp }` under
    `exportApp` / the Vite plugin); the default export remains a single shared
    instance for back-compat.
  - `defineKumikiElement(tag, appOrFactory, …)` accepts a factory — pass the
    module's `createApp` so each `<tag>` element gets its own state; passing an
    `AppShape` keeps the shared single-instance behavior.
  - `@kumikijs/vite/client` ambient types now declare the `createApp` export.

- c51b7b8: feat: standard capabilities are now host-provider-overridable

  Every effect invoke (standard and custom) consults `caps.provider(cap)` before
  its built-in implementation. A host can therefore register a provider for a
  _standard_ capability — `http.*`, `storage.*`, `nav.*`, `notification.show`,
  `log.write` — to swap the HTTP transport (axios / ofetch), inject auth headers,
  integrate a framework router, or replace the toast UI, without touching the
  Kumiki source. The provider receives the effect's (already `map-request`-mapped)
  request; with no provider registered the built-in behavior runs unchanged.

  - `codegen` now lowers every effect to the uniform shape _map → provider check →
    built-in fallback_ (custom caps fall back to the existing "no provider" error).
  - The runtime built-ins (navigate / toast / log) defer to a registered provider
    for their capability before running the default behavior.

- c51b7b8: feat: `defineKumikiElement` — embed a compiled app as a Web Component (outbound seam)

  Wrap a compiled Kumiki app as a standard custom element so it drops into any host
  page or framework (React/Vue/Svelte/plain HTML) without a Kumiki-specific
  integration. The element owns the mount lifecycle (mount on connect, dispose on
  disconnect) and bridges the host both ways:

  - **Inbound** — `options.providers` forward to `mount` (the custom-capability
    seam); `options.attributeSlots` map observed attributes to slots; imperative
    `setSlot`/`setSlots`/`getSlot`/`slots` read & write live state (refinements
    enforced).
  - **Outbound** — `options.events` surface custom-capability effects as DOM
    `CustomEvent`s on the element; a `providers[cap]` entry overrides the
    passthrough for that capability.

  New exports: `defineKumikiElement`, `KumikiElementOptions`, `AttributeSlotBinding`.
  Renders into light DOM; single-instance per imported app module. See
  docs/spec/runtime.md §10.9.1.

- c51b7b8: feat: `defineKumikiElement({ shadow: true })` — shadow-DOM style isolation

  The Web Component wrapper can now render into an open shadow root for full style
  encapsulation. The app's motion / theme / state `<style>` nodes are injected into
  the shadow root (not the document head) and theme background/foreground/font are
  applied to an in-shadow container, so host-page CSS does not bleed in and
  Kumiki's CSS does not leak out. Light DOM (the document-level styling that
  matches a standalone page) remains the default.

  `mount` gains `styleRoot?: Document | ShadowRoot` and `styleHost?: HTMLElement`
  options that route every Kumiki `<style>` injection (animations, motion, theme,
  state styles) to the chosen root — the seam the shadow element uses. Style
  injection no longer references the global `Document` constructor, keeping non-DOM
  imports of the runtime safe.

## 0.3.0

### Minor Changes

- be38e20: v0.3 — the type-soundness & robustness milestone. Two soundness gaps the 0.2.1
  code review filed as issues, both closed:

  - **M1 (#24) — clean panic handling on the live path.** A panic on the live
    path (`panic(message)`, `Result.get-err` on `Ok`, or the polymorphic `.get`
    on `None`/`Err`) used to escape the DOM event handler / render uncaught. Now
    there is one model: a tagged `KumikiPanic`, caught around live reducer
    dispatch so the episode is rolled back (no partial slot writes), surfaced to
    the `smoke`/scenario tiers, and routed to the `app.error` reducer with
    `PanicInfo`; a render panic with no enclosing `error-boundary` shows a built-in
    top-level fallback. Fixes two latent bugs: `panic(message)` was unimplemented,
    and `.get` did not panic on the empty case (opposite to `.get-err`).

  - **M2 (#23) — receiver type inference for method-shortcut dispatch.** The
    parenthesis-free shortcut `recv.m` was dispatched by name only, so a record
    field named like a method (`node.head`) was silently shadowed and an unknown
    `recv.bogus` compiled to `undefined`. The checker gained its first
    type-inference pass: `FieldAccess` now dispatches field-vs-shortcut by the
    receiver's inferred type, and an unknown member on a known type is a compile
    error (**new E0108 `undef-member`**) instead of a silent wrong value.

  E0108 is a deliberate tightening (pre-1.0): a program that previously compiled
  `recv.bogus` to `undefined` now fails to compile.

## 0.2.1

### Patch Changes

- c0c1708: Fix issue #7 — implement the argument-less spec stdlib methods (`spec/stdlib.md` §2.2): `head` / `tail` / `last` / `to-list` / `get-err` / `to-option` / `parse-int` / `parse-float` / `abs` / `neg` / `to-float` / `to-int`.

  Previously the parenthesis-free form the spec recommends (`list.head`) compiled clean but evaluated to `undefined` at runtime, and the parenthesized form (`list.head()`) was rejected with E0801. Both shapes now lower to runtime helpers and are recognized in `KNOWN_METHODS`. Follow-up to #5.

  Known limitation (deferred, needs receiver type inference): dispatch is name-only, so the no-paren form shadows a record/map field of the same name (e.g. `node.head` on a record `{head, tail}`).

## 0.2.0

### Minor Changes

- 77938ee: v0.2 — close the five spec-deferred features (M1–M5)

  - **M1 `stop-timer(name)`** — explicit named-timer stop; errors E0002 / E0106.
  - **M2 `overlay` builtin** — z-axis stacking (modals / toasts / dropdowns), `align` prop, composes with `when`.
  - **M3 plugin capability registration** — `kumiki.caps.json` manifest; unlisted caps are now a compile error (E0302).
  - **M4 `test` layer + `kumiki test` runner**, and **`kumiki fix --auto-patch <test-name>`** — in-language reducer-test / tile-test with PASS/FAIL + diff output, plus deterministic repair from a failing test.
  - **M5 `motion` layer** — reusable, closed-grammar, scoped animations referenced from a tile's `motion` prop; honors `prefers-reduced-motion`; errors E0107, E0401–E0403.

  See CHANGELOG.md for the full detail.
