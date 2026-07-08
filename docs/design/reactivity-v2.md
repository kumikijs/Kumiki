# Reactivity v2 — fine-grained re-render / signal-graph model

> Status: **design decision** (issue #159). This document decides the direction; it does not implement it. Follow-up implementation issues are listed in §6, targeting v0.13–v0.14.
>
> Scope: the runtime's re-render granularity and the compiler↔runtime contract needed to support it. Non-goals: the implementation itself, and any redesign of SSR / hydrate (tracked separately).

## 1. Current model

Kumiki's runtime is, today, a **full teardown & replace** renderer. Every state change — a reducer, a `bind` input write, a route change, a timer, or a lifecycle event — funnels into an unconditional `render()`:

- `applyReducer` in `packages/runtime/src/core.ts` calls `render()` on every reducer application; `_setSlot` and `syncRouteFromLocation` do the same.
- `render()` rebuilds from scratch: `pickRootTile(app, slotValues)` produces a **brand-new `TileNode` tree from root to leaves**, `tileCtx.render()` converts **the entire tree into new `HTMLElement`s**, and `target.replaceChild(dom, currentRoot)` swaps **the whole app in a single `replaceChild`**. There is no DOM diff, no node reuse, and no keyed reconcile.
- `computeSlotDiffs()` does compute which slots changed (`dirty`), but its **only consumer is `episode?.recordSignalUpdate(dirty)`** at the tail of `applyReducer` — an observation log. `dirty` never narrows the render.
- There is **no signal graph**. `app.live` is a plain `Record<string, unknown>` (initialised in `mountCore`); no proxy, no getters, no dependency collection. UI never records which slot it read.

Because the whole DOM is discarded on every update, browser/DOM state that lives on the nodes is lost and must be reconstructed artificially:

- Input focus + caret: snapshot → restore via `data-kumiki-bind` / `id` / `domPath` (the snapshot/restore block inside `render()`).
- Scroll position: `scrollSaved` map, saved/restored per root.
- Mount/unmount lifecycle: not a DOM diff — a set-difference over tile names (`collectMountedTiles`).

`<select>` (open state), `<details>` (open), `contenteditable`, and `<video>` (playback position, buffering) hold internal state the snapshot layer **cannot** capture, so they break under any re-render triggered while the user is interacting.

### 1.1 Baseline cost

`packages/benchmarks/reactivity/reactivity-cost.mjs` mounts generated apps of increasing size in happy-dom and times single-slot updates (each update changes exactly one text node — the semantic minimum). happy-dom is far cheaper than a real browser, so these are a **floor**:

| tiles | nodes recreated / update | nodes changed | waste | median render |
|------:|-------------------------:|--------------:|------:|--------------:|
|    10 |                       13 |             1 |   13× |      ~0.12 ms |
|    50 |                       53 |             1 |   53× |      ~0.43 ms |
|   200 |                      203 |             1 |  203× |      ~1.40 ms |
|   500 |                      503 |             1 | 503× |      ~3.88 ms |

The headline is not the absolute time — it is the **linear O(tree-size) cost per update regardless of how little changed**. At 200+ tiles a single keystroke or click already rebuilds 200+ nodes; on a real browser DOM (layout, style recalc, event-listener reattach) the constant is far larger. This is the pressure issue #159 anticipates.

## 2. Design decision 1 — granularity: **(c) Hybrid**

Three options were on the table:

| Option | What it is | Fine-grain ceiling | New machinery | Learning cost |
|---|---|---|---|---|
| (a) tile-level diff | Compare old/new `TileNode` per tile; rebuild only changed subtrees | tile boundary | keyed reconcile | none (invisible) |
| (b) signal graph | Subscribe slots → dependent tile attributes (Solid-style) | attribute | proxy `live`, dep-collection on render, patch path | opt-in surface, but pervasive internals |
| **(c) Hybrid** | tile-level diff as the default; reserve an explicit `slot`→derived-signal API as opt-in | tile by default, attribute on opt-in | keyed reconcile now; derived-signal API later | none by default |

**Decision: (c) Hybrid.**

- **Default = tile-level keyed diff.** On a state change, produce the new `TileNode` tree (unchanged from today) and reconcile it against the previously mounted tree tile-by-tile: unchanged tiles keep their DOM node (and thus their focus/scroll/internal state); changed tiles rebuild only their own subtree; reordered lists reuse nodes by key. This removes the O(tree-size) waste for the common case (one tile's text changed → one subtree rebuilt) while keeping the authoring model identical.
- **Opt-in = explicit derived signals (reserved, not implemented here).** For hot paths where even a subtree rebuild is too coarse, a future `slot`→derived-signal API can bind a single attribute/text node to a slot expression. This is the (b) ceiling, available where it pays for itself, without making every app pay the dependency-tracking tax.

Why Hybrid over the alternatives:

- **AI-first / learning-cost thesis.** Kumiki optimizes for LLMs authoring and reasoning about programs; the v0.10 benchmarks already show the learning-cost win. (b) as the *default* would leak a reactivity mental model (signals, dependency edges, batching) into every program and erode that win. (a)/(c) keep the surface declarative — the author still writes "the App tile is a column of these tiles" and never reasons about subscriptions.
- **Incremental migration.** (c) reaches (a)'s behavior first with the smallest step from today, then layers the (b) ceiling only where opted in. No flag day.
- **Minimal contract change.** The `root(): () => TileNode` factory is preserved; the diff is a pure runtime addition plus a small, additive identity hint (§3).

## 3. Design decision 2 — `AppShape` contract change

**Question:** may the `AppShape` type in `packages/runtime/src/core.ts` contract change, given that would force a coordinated compiler+runtime release?

**Decision: allow it, but keep it additive, and ship compiler + runtime together.**

Under Hybrid the core contract is preserved: the `AppShape.root?: () => TileNode` factory still returns a fresh plain-data tree each call, and `live` / `_rerender` are unchanged. The one thing keyed diff needs that the tree does not yet carry is **stable tile identity** — the key that says "this tile in the new tree is the same instance as that tile in the old tree", so its DOM node (and focus/scroll/`<select>` state) is reused rather than rebuilt.

Two ways to supply identity:

1. **Explicit key on `TileNode`.** The compiler emits a stable `key` per tile instance (and per collection item, from the item's identity expression). Deterministic, survives reorder, and makes list diffing correct by construction. Cost: an additive `TileNode` field and codegen change → a coordinated release.
2. **Structural derivation in the renderer.** The runtime derives identity from position + `kind` + existing `data-kumiki-tile` / `data-kumiki-bind` markers, with no compiler change. Zero contract change, but positional identity is fragile precisely where it matters — inserting/removing/reordering list items shifts every downstream node's identity and defeats reuse.

**Decision: option 1 (explicit key), additive.** `TileNode` gains an optional `key?: string`. Old compiled output (no `key`) falls back to structural identity (option 2) so a new runtime still mounts old bundles — but the keyed-diff guarantees (stable reuse across reorder, `<select>`/`<details>` preservation) require the new compiler. Hence the migration is: land the runtime with the fallback first, then the compiler that emits keys; the two must be released as a matched pair for the guarantees, but neither hard-breaks the other in isolation. See §5.

## 4. Design decision 3 — episode granularity

**Question:** how fine should `episode.recordSignalUpdate` get — more debug signal vs. more learning cost?

Today `recordSignalUpdate` records **one step per reducer application**, carrying only the dirty slot names (called from `applyReducer` in `core.ts` and from the SSR dispatch in `ssr.ts`). The `EpisodeStep` `signal-update` variant in `packages/runtime/src/episode.ts` already declares a `binds-updated: string[]` field, but **no call site ever populates it** — it is always `[]`.

**Decision: populate `binds-updated` with the tiles/binds the diff actually patched; do not add new episode step kinds.**

- Keyed diff already computes exactly which tiles it rebuilt and which bound nodes it touched. Feeding that set into the existing `binds-updated` field turns "slots X, Y changed" into "slots X, Y changed → tiles A, B and bind `todo.title` were re-rendered" — a causal chain that makes runtime bugs (a slot changed but the expected tile did not update) directly visible in the episode log.
- **No schema growth.** We fill an existing, already-typed field. Episode consumers, the `kumiki run` trace, and the log reader are unchanged → backward compatible.
- **Learning-cost guard:** granularity stays at "one `signal-update` step per render", not per-node events. That keeps the episode readable (the debugging surface an author reasons about) while raising information density. Going finer (a step per patched node) was rejected as noise that would bloat the log without helping the author.

## 5. Design decision 4 — browser-internal element state

**Question:** does changing granularity fix `<select>` / `<details>` / `contenteditable` / `<video>`, or is a separate identity-preserving hydration design needed?

**Decision: granularity fixes the majority; the residual is a separate issue.**

- The root cause today is that **every** re-render discards **every** node, so any element with internal state loses it and the snapshot layer can only restore what it can serialize (focus + caret; not `<select>` open state, not `<video>` playback). Keyed diff keeps the DOM node for any tile that did not change, so the internal state simply **stays on the live node** — no snapshot/restore needed for the untouched case. This dissolves the common failures (interacting with element A no longer resets element B).
- The residual case: a tile *does* change and must be reused across that change while preserving its internal state (e.g. a `<select>` whose options changed but whose open/selection state should persist). That requires identity-preserving reconciliation guarantees at the element level — an **identity-preserving hydration** design that is out of scope for #159 (Non-goal) and is split into its own follow-up issue (§6). The focus/scroll snapshot layer inside `render()` is retained as a fallback during migration and revisited there.

## 6. `AppShape` migration plan

For the coordinated release (Decision 2):

1. **Runtime first, backward-compatible.** Land keyed diff in `core.ts` reading an optional `TileNode.key`. When absent (old bundles), fall back to structural identity. A new runtime mounts old compiled output with no crash; it just doesn't get reorder-stable reuse.
2. **Compiler next, emits keys.** Codegen assigns a stable `key` per tile instance and derives collection-item keys from the item identity expression. Add the field to the `TileNode` type and to `AppShape` docs in `docs/spec/runtime.md` (§10, the compiler↔runtime contract) in the same PR.
3. **Release as a matched pair.** Changesets bump `@kumikijs/runtime` and `@kumikijs/compiler` together; the keyed-diff guarantees are only claimed once both ship. Because each side degrades gracefully against the other, a partial rollout is safe, just not fully optimized.
4. **No hard break to existing apps.** Examples in `packages/examples/` recompile unchanged; `@kumikijs/tests` (every example must parse + typecheck + build + smoke) is the regression gate.

## 7. Follow-up implementation issues (v0.13–v0.14)

Filed against #159:

- **#187 — runtime: tile-level keyed diff** (v0.13). Core of Decision 1(a). Reconcile new vs. mounted `TileNode` tree; reuse unchanged tiles' DOM; rebuild only changed subtrees; retire the whole-tree `replaceChild`. Baseline to beat: §1.1.
- **#188 — compiler,runtime: stable tile identity/key in `AppShape`** (v0.13, coordinated release). Decision 2 + §6. Additive `TileNode.key`, codegen emission, runtime fallback, matched-pair release.
- **#189 — runtime: populate episode `binds-updated` from actually-patched tiles** (v0.13). Decision 3. Fill the existing field from the diff's touched set; no schema change.
- **#190 — runtime: preserve browser-internal element state across tile reuse** (`<select>` / `<details>` / `contenteditable` / `<video>`, v0.14). Decision 4 residual. Identity-preserving reconciliation for changed-but-reused tiles; revisit the focus/scroll snapshot fallback.
- **(reserved, v0.14+) runtime: explicit `slot`→derived-signal opt-in API.** Decision 1(c) ceiling; specced when a hot path demands sub-tile granularity. Not filed yet.
