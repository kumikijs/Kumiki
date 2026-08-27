# @kumikijs/runtime

## 0.13.0

### Minor Changes

- 85a792b: fix(runtime): a conditional branch that _adds_ `onFocus` / `onBlur` /
  `onKeyDown` / `onMouseEnter` now reaches the DOM.

  Those four are lifted onto every tile kind by the runtime rather than by a
  per-kind renderer, and they dispatch through one shared per-element slot. The
  native listeners that read the slot were registered only when the tile carried
  a handler at create time — so a branch introducing one on a later render had
  nowhere to land: the element is reused, the slot is refreshed with the new
  handler, and no listener was ever registered to read it. Nothing threw, and no
  diagnostic fired; the handler simply never ran.

  Registration now happens on the render that first fills the slot, at create
  time or on a patch. A tile that never carries one of the four still registers
  nothing, so the saving on the tiles that will never need them is kept.

  `onClick` was unaffected throughout — its listener is registered
  unconditionally by the button renderer.

- 301b09a: chore: require Node 24.

  Node 20 reached end of life, so every package's `engines.node` moves from
  `>=20` (`>=20.6` for `@kumikijs/vite`, which needs the synchronous
  `import.meta.resolve` that landed there) to `>=24`. CI builds and tests on 24
  as well, matching the release workflow, which was already there.

  **Breaking for anyone installing on Node 20 or 22**: the packages declare the
  new floor, so `npm i` warns and an `engine-strict` install fails. Nothing in
  the published code depends on a Node 24 API today — the bump states the
  version the toolchain is actually tested on, rather than one that no longer
  receives security fixes.

- 080f358: feat(runtime): the scenario tier can fire keydown and mouseenter.

  `ui.key` and `ui.hover` lift to `onKeyDown` / `onMouseEnter`, which the runtime
  wires through the same per-element slot as `onFocus` / `onBlur`. `focus` and
  `blur` exist as scenario actions precisely so that `addEventListener →
applyUiEventHandlers → reducer` path could be asserted; the other two had no
  action, no example driving them and no reach from `smoke`, which dispatches only
  click, input, change and submit. The runtime's own tests fire all four directly,
  so a wiring regression was not invisible — but nothing in the example corpus
  could reach these two, so a program that renders and then ignores a key press
  passed check, build, smoke and every scenario.

  `{"key": "<selector>", "value": "<key>"}` dispatches a `KeyboardEvent` carrying
  that key, and `{"hover": "<selector>"}` dispatches a `mouseenter`. Both are
  dispatched on the element the selector matches, which is where the runtime
  attaches its listener. `keydown` bubbles from there — that is what lets
  `ui.key(Container)` be driven from a focusable descendant — while `mouseenter`
  does not, since a browser fires a separate one on each ancestor rather than
  propagating a single event.

  A `ui.key` reducer's payload carries `key` and `code`; only `key` is set from
  this tier, because a `code` names a physical key that a scenario asking for
  `"Enter"` has not chosen. `value` is required and must be non-empty: the event's
  `key` defaults to the empty string and the listener never reads it, so a step
  pressing nothing would fire the reducer and report success.

  The browser tier does not run these two yet, and now says so by name rather
  than reporting them as unknown actions.

- d398cbc: fix: make the spec's own examples compile, and give each code one meaning.

  **Every ` ```kumiki ` block in `docs/` is now checked.** Fewer than half of
  them parsed: 27 blocks used `;` as a comment while `language.md` §1.2 defines
  `#` as the comment and `;` as the statement separator — which the corpus uses
  it as, so the conversion is per occurrence rather than wholesale. A block now
  declares what it is (a complete program, a `fragment` of definitions, a
  `snippet` of less than a definition, or a deliberately `invalid` example) and
  each mark is falsifiable in both directions, so a wrong mark fails as loudly as
  a wrong block. English and Japanese must mark the same block the same way.

  **`ai-edit.md` defined a second table of diagnostic codes**, disagreeing with
  `errors.md` on eleven of them — `E0302` meant "direct effect call" in one and
  "unknown capability" in the other, in a document that calls a code a permanent
  contract. The section now points at `errors.md`, and the spec-drift guard reads
  every file that assigns a code (`typecheck.ts`, `cli/src/fix.ts`,
  `mcp/src/index.ts`), not the checker alone. `E0000` — which those two tools
  synthesize so a parse failure can appear in a list of diagnostics — is
  documented rather than deleted; `--refs` no longer claims a band (`E05xx`) that
  no code has ever belonged to.

  Two implementation-side corrections came out of the same pass:

  - **`Route` gains `pattern` and `hash`.** The router builds all five fields and
    `routing.md` §3.2 documents all five; the compiler's standard-library table
    had three, so a generated provider signature typed `route.pattern` as
    `unknown`.
  - **`toast` honours `duration` and carries its `kind`.** `lifecycle.md` §7.7
    has always shown `duration: Option(Duration)` and the example corpus emits
    it; the runtime ignored it and every `kind`, hardcoding three seconds. The
    kind lands as `data-kumiki-toast-kind` with no built-in appearance (the call
    `variant` makes on a button), and the toast is the `aria-live` region
    `lifecycle.md` §7.8 lists as a runtime guarantee.

- 79b221e: fix(runtime): serve the style the client paints, and make one `AppShape`
  mounted twice mean two views of one app.

  **SSR carried no styling at all.** `ssr-render.ts` did not contain the word
  `props`, so a served page laid every flex container out as a block and reflowed
  the moment hydration finished — the layout shift SSR exists to remove. The
  prop-to-style mapping is now data (`containerStyleDecls` / `textStyleDecls`),
  applied to an element by the renderers and serialised into a `style` attribute
  by the server. A kind's own base layout stays with the per-kind switch on each
  side, because the renderers are the per-app DCE unit; a test that renders one
  node per kind both ways and compares the element, its attributes and its
  CSSOM-normalised style is what keeps the two copies honest. It also found that
  the icon placeholder used a different attribute than the renderer writes, the
  spinner was a `div` where the client makes a labelled `span`, the skeleton had
  none of its frame, and a `label` dropped its `for`.

  A responsive value collapses to its base on the server — a breakpoint is a
  question about a viewport it does not have. Class-backed layers (`transition`,
  the `hover:` / `focus:` / `active:` blocks, motion) stay client-only.

  **Mounting one shape twice froze the earlier mount.** Each mount overwrote the
  shape's imperative seams, so the last one captured every event that resolved
  through the shape: the first host's own buttons re-rendered the second, and
  `el.setSlot` on the first element landed on the second. The spec says passing
  the compiled default export rather than the `createApp` factory "shares one
  instance across all elements of that tag", which is only worth saying if every
  element stays live.

  A shape carries the app's state, so a second mount is a second _view_. Where the
  app is painted is now per view (the mounted element, the tree behind it, the map
  the next reconcile diffs against) and what it says is shared, because the state
  is. What the app owns once belongs to the first mount — `app.init`, `app.start`,
  the timers, the router, the effect dispatcher — so a second view does not re-run
  initialization or double a timer's ticks. Disposing a view leaves the others
  interactive; the app is torn down with the last one, after which the shape starts
  over — initialization, timers and router run again, while `app.live` keeps
  whatever the app had written. Adding a view with `hydrate` throws rather than overlaying a server
  snapshot onto a state that is already live.

  Apps built with `createApp()` per instance are unaffected, and the multi-mount
  isolation guarantees are unchanged.

- b8bd5d9: fix: make the documented tile props reach the DOM.

  **A prop's name had two spellings.** The compiler lowers a Kumiki name to a
  JS-safe key (`test-id` → `test_id`, `max-w` → `max_w`), while `TileProps` is an
  open record — so a runtime that read `props["max-w"]` type-checked, rendered,
  and did nothing. Every app in the corpus set a page width that never applied.
  The lowered name is now the only spelling the runtime reads, and the guard is a
  table that starts from `.kumiki` source and ends at an attribute or a CSS
  declaration, on both rendering paths: a hand-built `TileNode` can agree with the
  runtime about a spelling the compiler never emits, which is how this survived a
  suite that compared the two paths to each other.

  **A named argument was dropped unless its kind lifted it.** The spec writes
  `button(text="Log in", loading=pending)` a few lines from `{variant: "ghost"}`,
  so the two forms have to arrive alike; instead, `image(alt="A cat")` satisfied
  the a11y check and rendered no `alt`. Every named argument now folds into the
  props — the generalization of the `id` fold that already existed for selector
  matching — so it reaches the renderers and the `$el` payload from either form.

  Now applied to **every kind**, client and server alike, because the mapping
  moved out of the per-kind renderers and into the one pass that sees every
  element: `class` (added to the runtime's own classes, not over them), `aria` and
  a bare `aria-*`, `test-id` as `data-kumiki-test`, `role`, `id`, the style
  shorthands (`bg`, `color`, `pad`, `pad-x` / `pad-y`, `gap-x` / `gap-y`,
  `radius`, `shadow`, `size`, `weight`) and the sizing props (`w`, `h`, `min-w`,
  `min-h`, `max-w`, `max-h`, `aspect`, `wrap`) — so a `max-w` on an `image` and a
  `bg` on a `button`, both of which the spec's own examples write, now land. A
  kind that maps a prop itself keeps it: a `spinner`'s and an `icon`'s `size`, a
  `skeleton`'s `h`. `radius` and `shadow` read the theme sections of those names
  rather than the spacing scale, and the SSR pass resolves the theme at all,
  which it did not: a themed page was served with the unthemed defaults.

  Per tile: a `button`'s `loading` (disabled, `aria-busy`, a spinner in front of
  the label), `disabled` and `variant`; an `image`'s `width` / `height` /
  `loading`; a `link`'s `external`; a `divider`'s `orientation`; and the input
  family's `disabled` / `readonly` / `auto-complete`, which forms.md §5.3 calls
  their common props. All of it is diffed on the reconcile's patch path, so a
  `class` bound to a slot swaps rather than accumulates and a `max-w` that goes
  away leaves.

  **New diagnostic `E0705` (`a11y-label-for`)**, under `--strict-a11y`: a
  `label {for: "x"}` whose literal target matches no `id="x"` anywhere in the
  program. Two of the example apps had five such labels between them.

  `style.md` §4.4.7 drops `"sm"` from `w`: there is no width scale in the theme,
  so it was a token name with nothing behind it. `testing.md` §8.8 now names the
  global that exists (`window.__kumikiApp.live`) instead of one that never did.

- 4de2473: Close the blind spots that let a broken example stay green.

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

## 0.12.0

### Minor Changes

- 5fb6fb6: feat(runtime,compiler): identity-preserving reconciliation for changed-but-reused tiles (#190).

  Follow-up to #187 keyed diff and #188 stable tile identity. Extends the reconcile
  kernel so a same-kind tile whose data props diverge is mutated in place instead
  of torn down + rebuilt — browser-owned state (`<select>` open dropdown / value,
  `<video>` playback position, `<details>` open, contenteditable caret / IME
  composition) now survives a reducer-triggered re-render mid-interaction.

  - **Runtime** — every `tiles-*.ts` module exports a companion `{X}Patchers:
TilePatchers` alongside `{X}Tiles`. `reconcileNode` routes same-kind
    data-prop divergences through the per-kind patcher; kinds without a patcher
    fall back to the pre-#190 subtree rebuild. A per-element `WeakMap` handler
    slot on input / textarea / select / check / radio / switch / slider /
    editable / form / button / link / modal / drawer / popover reroutes
    `bind` / `onChange` / `onClose` / `to` closure changes without add/remove-
    listener churn. The `<select>` patcher does a keyed `<option>` diff by
    serialized value key so the dropdown / selection state stays intact when
    the options list shifts. Focus / caret snapshot layer is retained as the
    fallback for wholesale-swap paths (reconcile bailout, panic recovery,
    keyed reorder that moves a focused element between DOM positions), with
    `<select>` added to its tag-name filter.

  - **Compiler + runtime** — two new built-in tile kinds:

    - `details(summary=..., open=...)` — native `<details>` disclosure.
    - `editable(bind=..., text=...)` — `<div contenteditable="true">` with
      plain-text `textContent` write-back on `input`. The patcher skips text
      overwrites when the DOM already matches the target text (the common
      case during typing, where the bind loop keeps slot and DOM in sync)
      and skips them entirely while an IME composition is in flight so the
      candidate window is not dismissed mid-glyph.
    - `input`, `textarea`, and `editable` all install
      `compositionstart` / `compositionend` listeners at create time so
      JP/CN/KR IME users are not disrupted by a re-render mid-composition.

  - **Spec** — `docs/spec/runtime.md` gains §10.3.11 documenting the patch
    contract, handler-slot pattern, value-write guards, and the demoted role
    of §10.3.9's snapshot layer. `docs/spec/stdlib.md` §2.3 catalog lists
    `details` and `editable`.

  - **Verification** — new e2e fixtures under
    `packages/examples/features/{54,55,56,57}-*.browser.json` prove all four
    acceptance elements (`<select>` / `<video>` / `<details>` /
    `contenteditable`) survive a re-render mid-interaction under Chromium.
    `packages/runtime/test/reconcile.test.ts` adds per-kind
    identity-preserving unit coverage.

  - **Benchmarks** — `packages/benchmarks/reactivity/reactivity-cost.mjs`
    now reports `nodesCreatedPerUpdate: 0` for a leaf-only text change
    across every tile-count sample (down from the #187 baseline of 1 element
    per update): the mounted `<h1>` gets `.textContent = ...` in place.

  Compiler + runtime ship together — the new `details` / `editable` tiles
  require the matched runtime, and the runtime's `TilePatchers` registry is
  consumed by any built bundle.

- 353cd5c: fix(runtime): a keyed child with no element mapping now reaches the same panic
  whether it stays, leaves, or sits under a parent the keyed pass was about to
  decline for another reason.

  The keyed child pass treated one broken invariant three ways. A surviving child
  with no entry in the node → element map threw, and the reconcile bailout
  recorded a `location: "reconcile"` panic — loud without a diagnostic sink. A
  departing one hit `if (oldChildEl && …)` in the removal loop, where the failed
  lookup read as "nothing to remove": nothing thrown, nothing reported, and the
  element the renderer had hand-built left mounted for as long as the app runs.
  And under a parent whose renderer does not place every child directly, the
  `unplaceable-insert` decline came first, so the pass that would have thrown was
  never entered at all.

  That silence undercut the placement gate's stated reason for letting an unmapped
  child through. The gate declines the keyed pass for a child mounted below a
  renderer-owned wrapper, but steps over an unmapped one on the grounds that the
  pass throws on it — an invariant break, not a placement style. For a departure
  and for a later decline it did not, so the one arrangement the gate was
  reasoning about reached neither the panic nor `child-unmapped`. A renderer that
  builds a child outside `ctx.render` was invisible for exactly as long as that
  child was on its way out.

  The mapping is now resolved the moment the measured placement check comes back
  clean — ahead of the declared-placement check, and before anything is
  reconciled, mounted, or removed — and a missing one throws there. Neither what a
  child was about to be nor which reason the parent might have had to decline
  decides whether its broken invariant is heard, and the throw leaves the pass
  having applied nothing: the rule §10.3.10 already stated for the structural
  walk, now stated for this one. The panic's full rebuild is also what clears the
  stranded element, which the silent skip never did.

  Two guards went with it. The removal loop's `parentNode === parentEl` could not
  be false once the gate had passed, and nothing the pass itself does can undo
  that, so both it and the anchor scan's copy are gone and what guarantees them is
  named where they were. Should host code running in between ever move a departure
  out, `removeChild` surfaces it as a panic on the same path rather than as a
  skipped removal.

  No example accompanies this. It is reachable only from a host renderer that
  places a child without going through `ctx.render`, which is not something a
  `.kumiki` program can express at any tier the repo has — the same position as
  the keyed-placement fixes before it. The runtime unit tier covers all three
  arrangements.

- 46bee64: feat(runtime): reconcile the new tile tree against the mounted one instead of
  tearing the whole tree down on every state change (#187).

  Every slot write used to rebuild the entire tile tree and hand it to
  `target.replaceChild`, so a leaf-only change re-created every Element on the
  page. The walker now diffs the new `TileNode` tree against the mounted one and
  rebuilds only the subtrees that actually changed; an unchanged tile keeps its
  live DOM node, and with it focus, caret, `<select>` open state, and its event
  listeners. Identity is structural here — position plus `kind` — with explicit
  keys arriving in #188.

  Measured on the reactivity benchmark (`measure:reactivity`, happy-dom floor),
  waste ratio and median render for a single leaf change:

  | tiles | before          | after         |
  | ----- | --------------- | ------------- |
  | 10    | 13× / ~0.12 ms  | 1× / ~0.03 ms |
  | 50    | 53× / ~0.43 ms  | 1× / ~0.05 ms |
  | 200   | 203× / ~1.40 ms | 1× / ~0.14 ms |
  | 500   | 503× / ~3.88 ms | 1× / ~0.22 ms |

  Render time decouples from total tile count: one Element created per update,
  which is the semantic minimum. The focus/scroll snapshot layer stays as the
  fallback for tiles that did rebuild.

  Design: `docs/design/reactivity-v2.md` §2 Decision 1(a).

- 027a8af: fix(runtime): a keyed reorder now places only the children that have to move,
  so a focused child the reorder leaves alone keeps its cursor natively.

  The reorder phase of the keyed child pass replayed the whole target sequence
  with `appendChild`. That produces the right order for any permutation and is one
  line, but it detaches and re-attaches **every** child on every render that
  reaches the keyed path — including the ones already in their final position, and
  including renders where nothing moved at all.

  Re-attaching a node blurs it. Focus, the caret in a text field, an open
  `<select>` dropdown and an in-flight IME composition are exactly the state keyed
  matching exists to preserve, and the sweep spent it on children that had no
  reason to move. That was papered over by the render pass's focus restore
  (§10.3.9), which is a snapshot/restore fallback — the guarantee §10.3.11 makes
  is that the patch path does not need it. Underneath the correctness cost sat a
  throughput one: N DOM moves per render for a list that is stable, which is the
  common case.

  **The fix.** The survivors whose old positions already ascend stay untouched,
  taken as the longest such run so the fewest children are left over; everything
  else is inserted against its successor, right to left, so each anchor is final
  by the time it is used. Fresh mounts and removals slot into the same pass. A
  render that does not change the order performs no DOM placement at all, one item
  moving costs one, and the worst case — no two children keeping their relative
  order — costs N−1.

  Placement also stopped going through `appendChild`. The pass now inserts against
  the node the mounted child list ends on, read before any rebuild or removal can
  invalidate it, so a renderer that keeps content of its own after its children
  keeps it there. The sweep walked the children past it.

  **What is not covered, and why.** No example accompanies this. The difference is
  not observable from a `.kumiki` program at any tier the repo has: element
  identity was preserved before and after (a move is not a rebuild), and for the
  element kinds a browser fixture can inspect — `<input>`, `<textarea>`,
  `<select>` — the focus-restore layer puts focus and the selection range back,
  which is what made the bug survivable in the first place. What is observable is
  the DOM operations, and those are asserted in the runtime unit tier: the count
  per transition, and that a focused child which did not move is never passed to
  the container's `insertBefore` / `appendChild`. The accompanying `blur` listener
  states the consequence a user feels but does not enforce it there — happy-dom
  does not model a moved element losing focus.

  `measure:keyed-moves` reports the counts against both the hand-derived minimum
  and the sweep. At 500 rows the sweep moved 500 children for unchanged, one-item,
  insert and remove alike; the measured counts are now 0 / 1 / 0 / 0, and 499 for
  a full reversal.

- 3d89383: feat(runtime,compiler): replace the `__kumikiApp` global with a WeakMap mount-root registry for safe multi-mount.

  Several Kumiki apps on one page (multiple Web Components, micro-frontends, Storybook previews) previously shared one `window.__kumikiApp` reference — the last mount captured every other app's bind write-back, link navigation, icon lookup, and generated event dispatch (last-write-wins).

  **BREAKING (runtime)**

  - `mount` / `mountCore` no longer write `window.__kumikiApp`. App resolution is keyed off the mount target: each mount stamps its target element with `data-kumiki-root` and registers in a WeakMap; the new public `resolveApp(el)` walks up to the nearest mount root (hopping shadow boundaries) to find the owning app. Compiled bundles still assign `globalThis.__kumikiApp = App` at module evaluation — that assignment is now a tooling-only state oracle (smoke / scenario / e2e / benchmarks) and nothing in the runtime reads it.
  - `currentTheme()` returns the theme of the app whose render/mount pass is currently running, and `null` outside one (previously: the most-recently-mounted app's theme, at any time). Hosts that called `currentTheme()` outside a render pass must resolve the app themselves (e.g. via `resolveApp`).
  - Events fired on elements detached from any mount (e.g. a node replaced by a re-render) are now a no-op instead of being delivered to the most-recently-mounted app. The runtime emits a once-per-element `console.warn` so the drop is observable (the smoke tier watches console output); a `link` click outside any mount degrades to the browser's native `href` navigation instead of dying silently.

  **BREAKING (compiler)**

  - Generated event handlers call `App._dispatch(...)` (the enclosing `createApp()` instance) instead of `globalThis.__kumikiApp._dispatch(...)`. Public API is unchanged; tools that string-match the generated JS must follow.

  **New**

  - runtime: `resolveApp(el)` public export, returning the new `MountedApp` type (an `AppShape` whose imperative seams — `_dispatch` / `_setSlot` / `_navigate` / `_prefetch` — are attached by the mount).
  - `defineKumikiElement` instances are now DOM-event-safe under multi-mount for both `shadow: true` and `shadow: false`.
  - e2e: `runMultiOnPage(page, sources, scenario)` co-mounts several compiled apps on one page with a per-app-index state oracle (`"0.count"`).

  Out of scope: theme `<style>` node contention when several _themed_ apps share one style root (document head) — shadow DOM remains the isolation answer there.

- cad3f0c: feat(runtime): report a tile whose data props can never compare equal, closing
  the one way to burn a render budget that the diagnostics channel could not see
  (#219).

  **The gap.** `onDiagnostic` reported every decision where the walker _loses_
  identity — `no-patcher`, `child-count-change`, `child-hole`, `child-unmapped`,
  `wrapped-children`, `unplaceable-insert`. All of them fire on a rebuild path.
  A tile whose data props compare unequal on every render while a patcher is
  registered for its kind is the identity-preserving happy path as far as the
  walker is concerned: the patcher runs, the element survives, nothing degraded,
  so nothing was reported. The app is correct and looks healthy; it is just
  re-applying the same attributes forever.

  **`never-equal-prop`** is the mirror image of `stale-closure-risk` on the other
  side of the equality fork. It reads the unequal decision for a value that could
  not have compared equal however identical the two renders were, and names the
  field: a non-plain object (`Date`, `Map`, `Set`, `RegExp`, a DOM node, a class
  instance, or a cross-realm object — only `===` can make two of those equal) or
  `NaN`. Same `hostTileKinds` scope and the same one-level-into-`props` bound as
  the stale-closure scan, so a built-in never produces one and the walk stays
  bounded on the render path. Neither cause can come out of codegen; the whole
  class is reachable only through `MountOptions.tiles` or a host-built tree, which
  is exactly the audience this channel exists for.

  Both host-tile scans are now guarded as a whole rather than only at the sink.
  Reading a host node's fields runs `Object.keys`, property getters and
  `Object.getPrototypeOf` against values the host owns, and the equality kernel
  short-circuits at the first difference — so a Proxy trap or an accessor can
  throw where the kernel never reached. That throw would have landed in the
  reconcile bailout as a panic and rebuilt the whole tree, which is the identity
  loss the channel exists to report. The scan is abandoned instead.

  - Fires whether or not a patcher is registered. With one it is the only signal
    that the tile churns; without one the rebuild is already reported as
    `no-patcher` and this names the field that reason cannot. Both are emitted,
    cause before consequence.
  - A value reports only once both sides are of the same never-equal shape — a
    plain bag becoming a `Date` is an ordinary change on the render it happens and
    reports on the next one. The same instance handed over twice compares equal
    through `===` and is never reported.
  - A mount without `onDiagnostic` runs the pre-existing code path plus one `?.`
    check, unchanged.

  **Consumers.** `describeDiagnostic` gains wording per cause, with the same
  `never`-typed exhaustiveness tripwire `describeFallback` carries. `kumiki dev`
  warns rather than errors — the running code is correct, only wasteful.
  `kumiki smoke`'s per-reason summary now labels every non-fallback diagnostic by
  its kind instead of assuming any non-fallback is a stale closure, so a future
  kind cannot be silently counted as an existing one.

  **Spec** — `docs/spec/runtime.md` §10.3.12 documents the kind and its two
  causes, and §10.3.13's non-plain-object and `NaN` rules link to it. The JA
  mirror gains both, including §10.3.13 itself, which had never been translated.

- 46bee64: feat(runtime,cli): a recorded panic keeps its stack, its `Error.cause` chain,
  and where it was caught (#162).

  A caught throw was reduced to its message, so the episode log said _that_
  something panicked and nothing about _where_. Every catch site now routes
  through `panicInfo(e, category)`, which captures `.stack`, walks `Error.cause`
  into a JSON-safe chain (depth-capped at 8, cycle-safe), and tags the origin —
  `reducer` / `effect` / `capability` / `tile-render` / `hydrate` / `unknown`.

  The fields ride along as optional keys on the episode log's panic step, so logs
  written before this still parse and the reserved categories can be wired to new
  catch sites without a schema break. SSR's reducer path and the replay executor
  carry the same fields as the live path, and `kumiki replay` renders a panic as a
  `[panic:<category>]` header with indented stack and `Caused by:` blocks, falling
  back to the single-line form for older logs. `reportPanic`'s
  `[kumiki] panic in …` header is unchanged, so smoke/scenario greps still match.

  Spec: `docs/spec/runtime.md` §10.5.1, `docs/spec/lifecycle.md` §7.2.3 — including
  the forward-compat contract that stack and cause stay in the episode log and
  never reach a reducer's `$event` payload.

- 4a58f8f: runtime: populate episode `signal-update` step's `binds-updated` field from the tiles/binds the keyed diff (#187) actually patched (#189, follow-up to #159 Decision 3).

  Turns "slots X, Y changed" in the episode log into "slots X, Y changed → tiles A, B / bind `todo.title` were re-rendered" — a causal chain that makes "slot changed but tile did not update" bugs directly visible in `kumiki run --episode-log` traces and the MCP episode reader. Identifier priority per patched subtree root: `bind` (joined with `bindPath`, matching `data-kumiki-bind`) → `TileNode.key` → `kind`.

  No schema change: the field was already declared on `EpisodeStep` and always emitted as `[]`; consumers that ignored it continue to work. SSR bootstrap episodes still emit `binds-updated: []` (no diff runs there).

- 32dd683: fix(runtime): the unkeyed child walk now decides the parent's fate before
  applying any of it, so a render that rebuilds a parent no longer reports the
  children it threw away.

  The structural child walk reconciled children one at a time, and two of its
  give-up conditions — a hole in the child list, and an old child with no element
  mapping — were discovered mid-list. By the time index `i` failed, children
  `0..i-1` had already been patched in place or had their subtrees rebuilt, and
  each had pushed an identifier onto the reconcile-touched set. The parent was
  then thrown away and rebuilt, discarding that work. The identifiers stayed.

  That set becomes the episode log's `signal-update.binds-updated` (§10.3.11).
  An episode is the author-facing causal record — "slot `X` changed → tiles `A`,
  `B` updated" is a claim the runtime makes about what happened, and here `A` and
  `B` did not survive the render. The same partial pass could emit a diagnostic
  (§10.3.12) for a subtree the very next line discarded: a `no-patcher` naming a
  rebuild that was undone before the render finished.

  Underneath sat an unstated assumption. The `newMap` entries those children
  wrote self-healed only incidentally — the parent's rebuild walks the same child
  nodes through `ctx.render`, which overwrites them. True of every renderer that
  goes through `ctx.render`, but a coincidence of the current codegen rather than
  a rule, and never something a host renderer was asked to honour.

  Both bail conditions are now resolved for the whole child list before the walk
  starts, so the pass either runs to the end or never begins. A bail leaves no
  trace of the subtree: no DOM change, no touched identifier, no `newMap` entry —
  and nothing left for the rebuild to overwrite, so the assumption is gone rather
  than restated. The evidence a bail carries is unchanged: the scan asks the same
  questions in the same order, and still reports the same `reason`, `index` and
  `childKind`.

  One consequence is worth stating rather than discovering: the diagnostics the
  abandoned siblings would have raised are no longer raised either — neither a
  `reconcile-fallback` nor a `stale-closure-risk` from a subtree the render threw
  away. That is the same rule `binds-updated` follows, and it has a cost. A
  `no-patcher` is a configuration fact, not a per-render one, so a child under a
  parent that rebuilds every render stays unreported for as long as that lasts;
  the parent's own reason is the one to fix first. §10.3.12 now says so.

  Reachable only from a host-built tile tree — Kumiki codegen flattens nils away
  and routes every child through `ctx.render` — so no authored app changes
  behaviour. What changes is that the log an author reads is true for the ones
  that do reach it.

- 687ae40: feat(runtime): dev-mode observability for the reconcile diff, and a fix for the
  patcher registry that never reached built apps (#206).

  **Fix, and the reason the rest of this exists.** The per-app DCE path in
  codegen assembled the tile renderer registry (`_tiles`) but never the companion
  patcher registry, so every `kumiki build` artifact mounted with
  `tilePatchers` defaulting to `{}`. With no patcher for a kind the reconcile
  rebuilds the whole subtree on any data-prop change, which discards exactly the
  browser-owned state the in-place patch exists to keep: input focus and caret,
  `<select>` open dropdown, `<video>` playback position, `<details>` open,
  contenteditable caret. Nothing caught it because the verified corpus and the
  reconcile suite all mount through the monolith entry, which merges the full
  patcher set itself. The guard now drives a real build artifact and asserts
  element identity survives a data change.

  **`MountOptions.onDiagnostic`** opts into seeing the reconcile's
  identity-losing decisions. Same shape as `episodeLogger`: absent by default, so
  a production mount pays one optional call per fallback and never runs the
  stale-closure scan. There is no build-time flag — a production mount is silent
  because it did not opt in.

  - Reported: `no-patcher`, `child-count-change` (with the old/new counts),
    `child-hole` (with the index), `child-unmapped` (with the index and the
    child's kind). Each also names the tile — kind, authored `tile` name, and
    the same `id` the episode log uses.
  - Deliberately not reported: a `kind` change (a different thing occupies that
    position, so there is no identity to preserve) and a patcher declining via
    `PatchRequiresRebuild` (a normal outcome that sentinel exists to keep out of
    the log).
  - `stale-closure-risk` fires on the _reuse_ decision for host-registered tile
    kinds, where the prop-equality kernel's "any two functions are equal" rule
    can leave a captured handler firing forever. Built-ins route handlers through
    per-element slots and are exempt. A host sink that throws is swallowed: a
    diagnostic must never be able to change the render it observes.

  **Consumers.** `SmokeReport.diagnostics` (new, non-fatal — each entry carries
  the phase and trigger that provoked it) plus `SmokeOptions.diagnosticsAsIssues`
  and `kumiki smoke --diagnostics-as-issues` for the strict reading.
  `StepResult.diagnostics` (new) attributes churn to the scenario step that
  caused it, and `kumiki run` prints it under that step. `kumiki dev` warns on
  fallbacks and errors on stale closures — they are different severities.

  **Spec** — `docs/spec/runtime.md` §10.3.12 with a JA mirror, and
  `packages/examples/features/58-unkeyed-conditional-rebuild.kumiki` showing the
  unkeyed shape that pays for a rebuild next to the keyed one that does not.

- 92ca76d: fix(runtime): a child list crossing the empty boundary keeps its parent, and a
  keyed newcomer is no longer appended bare under a wrapping renderer.

  **Two bugs, one root.** The keyed child pass may only run when the parent
  element actually holds its children's slots, and until now the walker answered
  that by measuring where the mounted children sit. A measurement can only speak
  for slots that already exist, so it is unsound for any old list too short to
  have exercised the renderer's wrapping rule — and `overlay`, which places its
  first child in normal flow and wraps the rest, is exactly that renderer at both
  of the short lengths.

  - **At zero.** `allChildrenKeyed` returned `false` for an empty array, so a
    parent whose old child list was empty could never take the keyed path.
    `[] → [keyed…]` and `[keyed…] → []` both fell to the structural walk, which
    saw a length change, reported `child-count-change`, and rebuilt the parent
    subtree — discarding the container's element and whatever browser-owned state
    it held. That is the "empty state → first item" transition: an empty todo
    list, a result set before the first query, an empty cart. It is precisely
    where the author has already given every child a key, and the runtime
    declined to use it.
  - **At one.** With exactly one mounted child, `overlay` measures as placing its
    children directly — truthfully. Growing to two then took the keyed path and
    appended the newcomer straight onto the overlay, with no positioning layer
    around it and no diagnostic. Silent DOM damage.

  **The fix.** A child list that is empty on exactly one side is now decided
  before keys are consulted at all: there is nothing to pair, so the only question
  left is where the new children go, and the runtime asks the one component that
  knows — it re-enters the parent's renderer for a fresh interior and moves that
  into the mounted element. The parent keeps its element, the interior is what a
  full render would have produced (so a wrapping renderer stays correct), and
  neither `child-count-change` nor `wrapped-children` is reported. The decision is
  key-agnostic because keys had nothing to match, which also picks up the
  commonest unkeyed shape in real Kumiki, `column(when(open, X))`.

  Whether a _newcomer_ can be placed is now read from the renderer's declared
  placement instead of from the DOM, since nothing can measure a slot that does
  not exist yet. The declaration covers the built-ins that wrap — `overlay`, and
  `modal` / `drawer` / `popover`, which wrap all of theirs in a content div (§10.3.10
  previously named only `overlay`). It bites only when there is something to
  place, so a same-membership render of a one-child overlay still takes the keyed
  path. A decline is reported through `onDiagnostic` as a new `ReconcileFallback`
  reason, `unplaceable-insert` (with `index` and `childKind` of the newcomer).
  Host renderers are absent from the declaration on purpose: the spec asks them to
  place their children directly under the element they return, so an unknown kind
  is taken at its word.

  **Known limitation.** Re-entering the renderer rebuilds its non-child interior
  too — a `details`' `<summary>`, a surface's content wrapper and title. That is
  strictly less than the whole-parent rebuild it replaces, but not nothing; the
  complete answer is a `ctx` seam letting a renderer refill its own child slots.

  A test mounts every container kind and compares the DOM its renderer produced
  against the declared set, so the two cannot drift.

- 9ae4327: fix(runtime): the keyed diff no longer tears children out of a wrapping
  renderer, and the walker's placement contract is written down.

  **The bug.** The keyed child pass matches children by `key` and then moves the
  survivors with `parentEl.appendChild` and drops the departures with
  `parentEl.removeChild`. Both only address elements the parent element holds
  directly — and `overlay` does not: it wraps every child after the first in an
  absolutely-positioned layer, so those children's elements are mounted a level
  below the overlay. An overlay whose layers all carried a key (an
  `overlay(for l in layers Layer(l))`, where the `for` binding supplies an
  implicit key) therefore lost its stacking on the first reorder: children were
  appended straight onto the overlay and the emptied layer divs were left behind,
  one more per render. Nothing threw and nothing was reported. Host renderers hit
  the same shape by appending children to anything other than the element they
  return.

  **The fix.** Keyed matching now additionally requires that every child's mounted
  element be a direct child of the parent's element. When it is not, the walker
  declines the keyed pass and runs the structural walk, which never repositions
  anything and stays correct under a wrapping renderer. The decline is reported
  through `onDiagnostic` as a new `ReconcileFallback` reason,
  `wrapped-children` (with `index` and `childKind`) — the one reason that rebuilds
  nothing, since what it costs is reorder-stable element identity rather than a
  subtree. When the wrapped list also changed length, the structural walk reports
  `child-count-change` on top: two diagnostics naming two different facts.

  A child with no entry in the element map is deliberately left alone. That is a
  broken invariant rather than a placement style, and the keyed pass throws on it
  so the reconcile bailout records a panic — visible without a diagnostic sink.

  **Why the contract needed saying.** `reconcileNode` returns the element now
  occupying a node's slot, and who may place that element was implicit: a rebuilt
  subtree is spliced in by `replaceWithFreshTile`, anchored on the OLD element's
  own parent, precisely because the parent tile's _renderer_ decides where a child
  sits. A caller may only place the returned element itself once it has
  established that it owns the slots — which is now stated on `reconcileNode`,
  enforced by the gate above, and spelled out at the one call site that discards
  the return value on purpose.

  Documented in spec §10.3.10 (keyed matching's placement precondition) and
  §10.3.12 (the new reason), with a runnable example at
  `packages/examples/features/59-overlay-keyed-layers.kumiki`.

- 49cafdb: feat(reactivity): stable tile identity — `TileNode.key` end-to-end (#188).

  Finishes the coordinated release started in #187. `TileNode` gains an optional `key?: string`, the compiler emits it, and the reconciler consumes it — so keyed children survive insert/remove/reorder without rebuilding the parent subtree, and `<select>` value, `<input>` focus and caret, and event listeners are preserved natively across those mutations.

  - **runtime** (`packages/runtime/src/core.ts`): `TileNode` type extended additively via intersection with `{ readonly key?: string }`. `TILE_SKIP_TOP` now includes `"key"` so a key change alone does not trigger `replaceWithFreshTile`. `reconcileNode` gains an all-or-nothing keyed child-list path: when every child on both sides carries a key, `reconcileKeyedChildren` matches by key, recurses on paired children, mounts fresh children for new keys, drops the unmatched old children from the DOM, and reorders in place via `appendChild` moves. When any child is missing a key, the pre-#188 structural walk (position + `kind` + data-prop equality, rebuild-on-length-change) is preserved verbatim.
  - **compiler** (`packages/compiler/src/codegen/`): `selector.keyFor` extracts an author-supplied `{key: <expr>}` from a tile call's props block (kept out of both `props.el` and top-level props). `emit-tile.tileExprJs` threads an `implicitKeyExpr` through `TileFor` / `TileWhen` / `TileIf` / `TileMatch`; `TileFor` sets it to `_s.show(<loopVar>)`, and user-tile boundaries reset it. `tileCallJs` wraps every emitted node with a new `_wk(node, key)` runtime helper when either an explicit or implicit key is available. Nested `for` correctly rebinds to the inner loop variable; non-iterated tiles emit no wrap.
  - **spec**: new §10.3.10 in `docs/spec/runtime.md` (and JA mirror) documents the additive `TileNode.key` field, the all-or-nothing per-parent matching rule, compiler-emission rules, and the matched-pair migration story.

  Old bundles (no keys) still mount cleanly on the new runtime — they just fall back to the structural walk. New compiler output still mounts on an old runtime — the field is ignored. Both packages must be upgraded together to get the reorder-stable-reuse guarantee.

### Patch Changes

- 6f3f3e3: fix(runtime): the reconcile prop-equality kernel no longer reuses a tile across
  two different `Date` / `Map` / class instances, and its rules are written down.

  **The bug.** `tileValueEqual` ends in a key-wise object comparison, which is
  complete only for values whose entire state IS their own enumerable properties.
  `Object.keys(new Date())` is `[]` — so two different `Date`s (and `Map`, `Set`,
  `RegExp`, DOM nodes, class instances) compared _equal_, and a tile carrying one
  kept its mounted element when the value behind it had changed. Nothing threw and
  nothing was reported: the element simply stayed stale. The code comment already
  claimed these were conservatively treated as unequal; now they actually are.
  Kumiki codegen emits only plain data, so this was unreachable from a `.kumiki`
  source — it protects renderers supplied through `MountOptions.tiles`. The same
  instance passed twice still compares equal through `===`.

  **The rules, now normative.** Spec §10.3.13 states what "the tile's data props
  did not change" means, which §10.3.10 and §10.3.11 both hang on: which fields
  are compared (own fields except `kind`, `children`, `key`), that an absent key
  and an explicit `undefined` are equal, that comparison is `===`-based so `null`
  / `""` / `0` / `false` never collapse into each other, that two functions are
  always equal (closure identity is ignored on purpose — see the
  `stale-closure-risk` diagnostic), that `NaN` is not equal to itself, and that a
  non-plain object is never equal to anything but itself. It also states the two
  edges that stay outside the contract: "plain" is decided by realm-local
  prototype identity, so a cross-realm object rebuilds; and a cyclic value
  recurses until the stack runs out, landing in the reconcile bailout as a
  recorded panic plus a wholesale rebuild — unsupported, but contained.

  Pinned by `packages/runtime/test/reconcile-equality.test.ts`, which drives the
  real walker — `mountCore` with spy renderers and an empty patcher registry,
  where "props compared equal" and "the element survived the re-render" are the
  same fact — rather than exporting the predicate for tests.

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
