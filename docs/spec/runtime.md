# Runtime Implementation Guide

For runtime implementers, this defines the compilation pipeline and the execution model.

## 10.1 Compilation Pipeline

```
[CRDT graph store]
    ↓ project (selector)
[kumiki source (text view)]
    ↓ parse
[AST]
    ↓ name resolution
[resolved AST] ←─── error: undef-ref, dangling
    ↓ type check
[typed AST]   ←─── error: type-mismatch, refinement
    ↓ effect analysis
[effect-annotated AST] ←── error: cap-missing, direct-call
    ↓ purity check
[verified AST] ←── error: reducer-side-effect, tile-mutation
    ↓ lower
[IR (Kumiki Intermediate Representation)]
    ↓ codegen
[runtime artifacts]:
    • signal graph (JS or WASM)
    • effect dispatcher table
    • episode logger
    • dev-tool trace UI
```

Each phase performs an independent check. Errors are returned as the structured errors of [AI Editing](./ai-edit.md).

---

## 10.2 IR

The intermediate representation is a **Typed Dataflow Graph**. A node is one of the following:

| Node kind | Role |
|---|---|
| `slot-read` | read from a slot |
| `slot-write` | write to a slot (reducer only) |
| `field-access`, `index` | record/collection element access |
| `op`, `call` | operation / function call (including `fn`-defined functions) |
| `fn-body` | the body of the `fn` layer (pure computation, depends only on arguments) |
| `match` | union branching |
| `if`, `when`, `for` | control |
| `emit` | effect emission |
| `event-source` | the entry point of an event |
| `dom-node` | DOM output node |
| `dom-bind` | slot binding to a DOM node |

Edges are dependencies (dataflow).

### 10.2.1 IR Serialization Format

Debuggable as JSON; in production, CBOR (binary):

```json
{
  "version": "0.1",
  "slots": [
    {"name": "todos", "type": "...", "init": "...", "hash": "..."},
    {"name": "draft", "type": "Text", "init": {"text": ""}, "hash": "..."}
  ],
  "effects": [
    {"name": "persist", "cap": "storage.write", "in": "...", "out": "Unit", "policy": "debounce:300"}
  ],
  "reducers": [
    {
      "name": "addTodo",
      "on": {"kind": "ui.submit", "selector": {"tile": "NewTodoForm"}},
      "do": [
        {"op": "let", "name": "id", "value": {"op": "call", "fn": "TodoId.fresh"}},
        {"op": "slot-write", "lhs": {"slot": "todos", "key": {"var": "id"}}, "rhs": "..."},
        {"op": "slot-write", "lhs": {"slot": "draft"}, "rhs": {"text": ""}},
        {"op": "emit", "name": "persist", "args": [{"slot-read": "todos"}]}
      ]
    }
  ],
  "tiles": [
    {
      "name": "App",
      "body": {"kind": "page", "children": [...]},
      "deps": ["slot:todos", "slot:draft", "tile:TodoList", "fn:matchFilter"]
    }
  ],
  "fns": [
    {
      "name": "matchFilter",
      "params": [{"name": "t", "type": "Todo"}, {"name": "f", "type": "Filter"}],
      "ret": "Bool",
      "body": {"op": "match", ...},
      "hash": "..."
    }
  ],
  "app": {
    "name": "TodoApp",
    "caps": ["storage.read", "storage.write"],
    "routes": {"/": "App", "/404": "NotFound"},
    "init": [{"emit": "loadTodos", "args": []}],
    "theme": "DefaultTheme"
  }
}
```

---

## 10.3 Signal Graph

The runtime generates a **static signal graph** from the IR. It is Solid-style fine-grained reactivity, but in Kumiki the **graph structure is fully determined at compile time** (no signal tracking at runtime).

### 10.3.1 Node Kinds

| Node | Input | Output |
|---|---|---|
| `SlotNode` | – | slot value |
| `ComputeNode` | values of upstream nodes | derived value |
| `BindNode` | values of upstream nodes | DOM operation |
| `EventNode` | DOM event | reducer call |

### 10.3.2 Update Algorithm

```
on reducer execution:
    collect modified slots into Set<SlotId>
    for each modified slot:
        for each downstream ComputeNode/BindNode (precomputed):
            mark dirty
    process dirty queue in topological order:
        recompute ComputeNode
        apply BindNode → DOM mutation
```

Because dependencies are statically analyzed at compile time, the runtime tracking cost is 0.

### 10.3.3 batching

All slot changes within a single reducer execution are treated as **one batch**. Successive changes inside a `for` loop are also the same batch. After the batch is finalized, the signal graph is updated only once.

#### A batch commits all-or-nothing

**Every write** is checked against the target slot's refinement ([Registered Refinement Predicates](./language.md#_1-3-3-registered-refinement-predicates)) — not just the value the slot ends the batch on. If **any** write is rejected, the whole reducer application is discarded: no slot is written, no `emit` is dispatched, no `stop-timer` runs, and no re-render is triggered.

Per-write rather than per-batch, because a batch is a map and only remembers the last value assigned to each slot. A `for` loop that leaves the slot's range and comes back would end on a legal value, and the illegal one it passed through — readable by every later statement, as below — would never be seen:

```kumiki
reducer drift on=ui.click(Btn)
    do= for d in [1, 1, 1, 1, -1, -1, -1, -1] { count  := count + d    ; reaches 4
                                                mirror := mirror + count }
```

This is **not** a panic — the app stays interactive, slots are untouched, and `app.error` does not fire — but it is never silent. The runtime reports

```
[kumiki] reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3)). No slot was written and no effect was emitted.
```

via `console.error`, the same channel and contract as an unhandled effect error ([Standard Capabilities](./stdlib.md#_2-5-standard-capabilities)), so the verification tiers (`smoke` / `runScenario` / e2e) all flag it.

The rule exists because the alternative — skipping only the rejected slot and writing the rest — half-applies the reducer, and lets a value the slot never took escape into a sibling slot, since statements later in the body read the batch under construction:

```kumiki
type Small = nominal Int where between(0, 3)
slot count : Small = 0
slot mirror : Int  = 0

reducer bump on=ui.click(Btn)
    do= count  := count + 1      ; at the ceiling, this value is rejected
        mirror := count          ; ...and must not be readable here
```

A reachable bound is the program's business, not the runtime's. Write the guard:

```kumiki
reducer bump on=ui.click(Btn)
    do= if count < 3 then count := count + 1
```

Two things a refinement does **not** gate:

- **The declared default.** `slot email : Text where email = ""` starts out holding a value its own refinement rejects — that is what makes `error(field=email)` show a message on a pristine form ([Error Display](./forms.md#_5-7-1-refinement-violation-of-an-individual-field)).
- **Two-way `bind`.** Input rejection is per field and never reports ([Handling of refinement](./forms.md#_5-1-2-handling-of-refinement)) — a half-typed value is expected, not a defect. By default the slot keeps its previous value; under `strict=false` it takes the new one and the form's `valid` flag goes false instead.

**The two combine into a trap.** A slot whose declared default violates its own refinement cannot be *reset* to that default from a reducer: `name := ""` on a `Text where nonempty` slot is a write like any other, so it discards the batch. Either widen the slot's type and refine at the boundary, or model the empty case with `Option`:

```kumiki
slot name : Text where nonempty = ""    ; starts invalid — allowed
reducer clear on=ui.click(Btn) do= name := ""    ; rejected — not allowed
```

### 10.3.4 Invariants of DOM Rendering

- **null/undefined child nodes are skipped**. A false branch like `when(false, X)` passes `null` as a child, but `renderTile` ignores it and renders only the siblings
- **`column` / `row` / `card` / `box` / `panel` / `stack` / `region` / `scroll` / `fieldset`** are all `<div>`-based containers. `stack` is equivalent to `column` (vertical stack)
- **`grid`** is `display: grid` + a `cols` prop yielding `grid-template-columns: repeat(N, 1fr)` (numeric) or a direct CSS value (string)
- **`divider`** is a standalone `<hr>` element (no children)
- **timer reducer** fires via `setInterval`, and stops via `clearInterval` on the app's `dispose`

### 10.3.5 The bind path of input/textarea/select

You can bind to a **nested lvalue path** like `bind=draft.title`. The runtime:
- Display: follows `_live[root][...path]` to read the initial value
- Change: on an input event, uses `_setPath` to immutably update the root slot
- Focus restoration: identifies it by putting the full path string (`"draft.title"`) in the `data-kumiki-bind` attribute

### 10.3.6 Dynamic theme switching

You can **specify the theme by slot name**, like `app theme = themeName`. The runtime:
- If `app.themeName` does not exist in `app.themes`, reads `_live[app.themeName]` to resolve the theme name
- Re-runs `applyThemeDefaults` at the beginning of each `render()` → changes to the slot value are reflected in the body style

```kumiki
slot themeName : Text = "Light"
theme Light = { colors: {bg: "#fff", fg: "#222"}, ... }
theme Dark  = { colors: {bg: "#222", fg: "#eee"}, ... }
reducer toggle on=ui.click(ThemeBtn) do= themeName := if themeName == "Light" then "Dark" else "Light"
app App ... theme = themeName    ; ← pass the slot name
```

### 10.3.7 polymorphic collection methods

`.filter` / `.map` / `.get-or`, etc., are type-dispatched at runtime:
- `.filter(pred)`: `Array.prototype.filter` for an Array, `mapFilter` for an Object
- `.map(fn)`: element map for an Array; for Option/Result, map over the contents of Some/Ok (`mapOver`)
- `.flat-map(fn)`: passes the Some/Ok of Option/Result to f, while None/Err passes through (`flatMapOption`)
- `.get-or(default)` (Option) / `.get-or(key, default)` (Map): distinguished by the argument count
- `m.entries` returns `[[k, v], ...]`, and the lambda of a subsequent list op is automatically destructured to `$1=k, $2=v`

### 10.3.8 Value Matching of select

`select(value=v, options=[...])` decides the selected state of an option by a **structural key**:
- A variant is keyed by recursively serializing `_tag` + payload. `Some(Backlog)` and `Some(InProgress)` become different keys (with a flat `_tag` comparison both would collide as `"Some"`, so including the payload is essential)
- You can use a "variant wrapped in a variant" such as `Option(Status)` as an option value

### 10.3.9 Focus Restoration

Since #190 (identity-preserving reconciliation, §10.3.11) the runtime patches every
same-kind tile in place instead of tearing it down on a data-prop change, so the
still-mounted `<input>` / `<textarea>` / `<select>` retains browser focus naturally.
The snapshot/restore layer described below is retained as a **fallback for the
wholesale-swap paths** — reconcile bailout, panic recovery, and a keyed reorder
that moves the focused element itself — where element identity is either lost or
the element is physically moved and blurred by the browser. A focused child that
a reorder leaves in place does not reach the fallback at all: the keyed pass
places only the children that have to move (§10.3.10), so the cursor never
leaves.

It maintains the focus and cursor position of an input/textarea being edited even after re-rendering:
- Elements with `bind=`: re-identified by the `data-kumiki-bind` attribute (a nested path is a full path string)
- Elements with `id=`: re-identified by id
- Neither (e.g. a search box with only `value=`): re-identified positionally by a **DOM child-index path**
- `<select>` is included in the snapshot set so the reorder / bailout paths can restore focus on the picker (its native open-dropdown state is unrecoverable here — that guarantee comes from the patch path in §10.3.11)

### 10.3.10 Stable tile identity

The compiler↔runtime tile-tree contract carries an optional per-tile identity
field for keyed reconcile (introduced in #187 as the diff kernel, wired end to
end in #188):

```ts
type TileNode = (/* … kind variants … */) & { readonly key?: string };
```

**Contract.**

- The field is **additive and optional**. A tile without `key` is a legal
  `TileNode`; old compiled output (no keys anywhere) still mounts on a new
  runtime, and a new compiler's keyed output still mounts on the old runtime
  (which simply ignores the field).
- The reconciler uses **all-or-nothing keyed matching per parent**: when every
  child at a given level carries a `key`, the runtime pairs children across
  renders by key (survives reorder, insert, and remove without rebuilding the
  parent's subtree). When any child is missing a `key`, the reconciler falls
  back to the pre-#188 structural walk (position + `kind` + data-prop
  equality; length change → rebuild).
- **The structural walk is all-or-nothing per parent too.** Its two remaining
  give-up conditions — a hole in the child list, and an old child with no
  element mapping — are decided for the whole list *before* any of it is
  applied. So a parent either reconciles every child or rebuilds without
  having touched one, and never leaves half a pass behind for the rebuild to
  discard. What this buys is truthful reporting: `binds-updated` (§10.3.11)
  and the diagnostics (§10.3.12) describe the render that happened, and no
  `newMap` entry is written for a subtree that was abandoned.
- **The keyed pass answers the mapping question with a panic, not a
  diagnostic.** An old child with no element mapping stops that pass too, and
  the same way for every child in the list: each old child's element is resolved
  before anything is reconciled, mounted, or removed, and a missing one throws —
  recorded as a `location: "reconcile"` panic and rebuilt wholesale, which is
  audible to a host that never opted into `onDiagnostic`. The measured placement
  check below deliberately steps over an unmapped child rather than declining on
  it (an unmapped child is a broken invariant, not a placement style), so this
  panic is the only thing that reports it — which is why it is raised the moment
  that measurement comes back clean, ahead of the declared-placement check that
  could otherwise decline first and carry the invariant, unheard, into the
  structural walk. What a child was about to be — reused or removed — does not
  decide whether it is heard either.
- **A child list that is empty on exactly one side of a render is decided
  before keys are consulted at all.** With nothing on the old side there is no
  pairing to attempt — every new child is a fresh mount, every old child
  departs — so keys have nothing to match and the rule above has nothing to
  say. What is left is *where* the new children go, which only the parent's
  renderer knows, so the runtime re-enters that renderer for a fresh interior
  and moves it into the mounted element. The parent keeps its own element (and
  the browser-owned state on it) and neither `child-count-change` nor
  `wrapped-children` is reported, for a keyed and an unkeyed list alike. Two
  consequences worth knowing: a wrapping renderer stays correct here, because
  the renderer itself did the placing; and the renderer's non-child interior
  (a `details`' `<summary>`, a surface's content wrapper and title) is rebuilt
  along with the children.
  This is the "empty state → first item" transition — an empty todo list, a
  result set before the first query, an empty cart — and it only reaches this
  path when the container's children are **only** the loop. A `for` sharing a
  parent with static siblings never empties that parent's child list.
- Keyed matching additionally requires that the parent's renderer **place its
  children directly under its own element**. Matching by key is only half the
  work: the reconciler then moves survivors, drops departures, and mounts
  newcomers by addressing the parent element, which it can only do for slots
  the parent element holds. Two independent checks answer that, because they
  answer different questions:
  - **Where the mounted children are** is measured from the DOM. A child
    mounted below a renderer-owned wrapper puts the pass out of reach; the
    reconciler declines and reports `wrapped-children` (§10.3.12).
  - **Where a newcomer would go** is read from the renderer's declared
    placement, because nothing can measure a slot that does not exist yet.
    `overlay` places its first child directly and wraps the rest, so a
    one-layer overlay measures as fully placeable right up until it grows —
    and the keyed pass would then append the second layer bare. When a keyed
    list under such a parent gains a member the reconciler declines and
    reports `unplaceable-insert` (§10.3.12). A same-membership render has
    nothing to place and still takes the keyed path.

  Of the current built-ins, `overlay` wraps every child after the first in a
  positioning layer, and `modal` / `drawer` / `popover` wrap all of theirs in a
  content div. A host renderer opts out the same way by appending children to
  anything other than the element it returns; the declared set covers built-ins
  only, so a host renderer is taken at its word and must place its children
  directly. Put a reorderable or growing keyed list under a plain container
  (`column` / `row` / `list`), and keep host renderers' children directly under
  their root element.
- The diagnostics can both fire for one parent in the same render: a wrapping
  parent whose keyed child list also changed length reports the placement
  decline (`wrapped-children` or `unplaceable-insert` — the keys went unused)
  and then `child-count-change` (the structural walk rebuilt it anyway). They
  name different facts, and fixing the first is what makes the second stop
  mattering.
- **A keyed reorder moves the minimum.** Matching by key says which old element
  belongs to which new child; it does not by itself say how many of them have to
  be touched to produce the new sequence. The reconciler leaves the survivors
  whose old positions already ascend exactly where they are — the longest such
  run, so the fewest children are left over — and inserts everything else
  against its successor. Concretely: a render that does not change the order
  performs **no DOM placement at all**, a single item moving costs **one**, and
  the worst case (no two children keeping their relative order) costs N−1.
  This is a correctness guarantee, not only a throughput one. Re-attaching a
  node blurs it, so a child that is moved for no reason loses focus, the caret,
  an open `<select>` dropdown and an in-flight IME composition — the state keyed
  matching exists to keep. A focused child that a reorder leaves alone therefore
  keeps it natively, without the snapshot/restore fallback of §10.3.9.
  Every placement is made *before* an existing node: the child that follows it
  in the new order, or — for the last child, which has no successor — the
  sibling that follows the whole mounted child list (the end of the parent when
  there is none). So a renderer that keeps content of its own after its children
  keeps it there.

**What the compiler emits.**

1. **Author-supplied `{key: <expr>}`** on a tile-call's props block is lifted
   to the emitted `TileNode`'s top-level `key` field. The value is coerced to
   a string via `_s.show(...)`. It does **not** also flow into `props.el`.
2. **Inside `for` iteration**, tile calls that do not declare their own
   `{key: ...}` receive an implicit key derived from the loop variable —
   `_s.show(<loopVar>)`. Explicit keys always win. Nested `for` loops
   overwrite the enclosing implicit key with the inner loop's binding, so a
   tile call under `for i in inner` gets `_s.show(i)` regardless of any
   outer `for o in outer`.
3. **User-tile boundaries** do not propagate the enclosing implicit key into
   the tile's body — the `_wk` wrap sits on the outer boundary node, and the
   body composes its own identity if it iterates internally.
4. **`TileWhen` / `TileIf` / `TileMatch`** are transparent: the implicit key
   flows through the branch that emits the tile.

**Runtime consumption.** The reconciler in `packages/runtime/src/core.ts`
reads `oldNode.key` and `newNode.key` at the child-list level. `key` is
included in `TILE_SKIP_TOP` so a key change alone does not trigger
`replaceWithFreshTile` on the parent — key drives which old child pairs with
which new child, not whether the tile itself is rebuilt.

**Migration.** Runtime and compiler ship the key contract as a matched pair
(both in the same minor version bump). Each side degrades gracefully alone,
but the reorder-stable-reuse guarantees (survives `<select>` value, `<input>`
focus and caret, and event listeners across insert/remove/reorder) require
both.

### 10.3.11 Identity-preserving reconciliation (#190)

Keyed diff (§10.3.10) preserves DOM identity for tiles whose data props did
**not** change. #190 extends the guarantee to tiles whose data props **did**
change but which the runtime can update in place, so browser-owned state
(`<select>` open dropdown, `<video>` playback position, `<details>` open,
`contenteditable` caret and IME composition) survives a re-render mid-
interaction.

**Contract.** Every tile-renderer module exports two maps: `TileRenderers`
(create) and `TilePatchers` (update):

```ts
export type TilePatcher<K> = (
  el: HTMLElement,
  oldNode: TileNode & { kind: K },
  newNode: TileNode & { kind: K },
  ctx: TileCtx,
) => void;
```

When reconcile sees `oldNode.kind === newNode.kind` and any own data prop
differs, it looks up a patcher for the kind. If one is registered, the mounted
element is mutated in place and the reconcile then walks the children as
usual (a container tile may have both attribute and child changes in the same
render). Without a patcher, reconcile falls back to the pre-#190 subtree
rebuild — patchers remain **incrementally adoptable**, not an all-or-nothing
runtime rewrite.

**Handler-slot pattern.** Reused elements must not multiply-register
listeners (the runtime uses `addEventListener` and holds no listener refs),
and a listener registered at create time closes over the create-time node.
For controls whose `bind` / `onChange` / `onClose` / `to` may change between
renders, each renderer stores the current handlers in a per-element
`WeakMap<HTMLElement, Handlers>` slot. Native listeners registered by
`create` dispatch through the slot; `patch` overwrites the slot with the new
node's handlers. This applies to `input`, `textarea`, `select`, `check`,
`radio`, `switch`, `slider`, `editable`, `form`, `button`, `link`, `modal`,
`drawer`, and `popover`. `details` is intentionally excluded: it carries no
Kumiki-level dynamic handler and browser-native `toggle` semantics do not
need re-routing. The universal handlers `applyUiEventHandlers` lifts on every
tile (`onKeyDown` / `onMouseEnter` / `onFocus` / `onBlur`) share a single
`UI_HANDLER_STATE` slot that the reconcile refreshes on every patch, so a
closure change reaches the next event regardless of tile kind.

**Value-write guards.** Text inputs (`input`, `textarea`, `editable`) skip
the `.value` / `.textContent` assignment when it already matches
`newNode.value` / `newNode.text` (so typing does not reset the caret) and
skip it entirely while an IME composition is in flight (`compositionstart`
→ `compositionend`) so the browser's JP/CN/KR candidate window is not
dismissed mid-glyph. Slider skips when `activeElement === el` (mid-drag
guard). The reducer-driven "clear the field" case is picked up by the
outer snapshot layer (§10.3.9), which captures selection ranges before the
patch runs.

**Consequences for `binds-updated` (episode log).** The patch path pushes
`tileTouchedId(newNode)` onto the reconcile-touched set exactly like a
subtree rebuild does, so the causal chain "slot `X` changed → tiles/binds
`A`, `B` patched" continues to land on `signal-update.binds-updated` (#189)
regardless of whether reconcile ended up rebuilding or patching.

**Only what survived the render is named.** A render that gave up on a parent
and rebuilt it lists that parent and nothing under it — the walk decides the
parent's fate before applying any of its children (§10.3.10), so there is no
partly-applied pass whose identifiers could outlive the work they describe.

### 10.3.12 Reconcile diagnostics

Keyed diff (§10.3.10) and in-place patching (§10.3.11) both **degrade
silently**: when the reconciler cannot preserve a subtree's identity it
rebuilds it, or drops to a weaker matching strategy — always correct, never
throws. An app can therefore be re-mounting its whole tree on every render and
look perfectly healthy from the outside. `MountOptions.onDiagnostic` opts into
seeing those decisions.

```ts
mount(app, root, { onDiagnostic: (d) => console.warn(d) });
```

**Contract.** Omitting the sink is the default and costs one optional call per
fallback; nothing is computed and nothing is emitted. There is no build-time
flag — a production mount is silent because it does not opt in, not because a
bundler stripped anything.

**Observing never changes what is observed.** A sink that throws is swallowed,
and so is the scan that feeds it: reading a host tile's fields runs
`Object.keys`, property getters and `Object.getPrototypeOf` against values the
host owns, and the equality kernel short-circuits at the first difference, so a
`Proxy` trap or an accessor may throw where the kernel never reached. All of
this happens inside the reconcile bailout, so an escaping throw would be
recorded as a `location: "reconcile"` panic and rebuild the whole tree — the
exact identity loss this channel reports, caused by the reporting. A tile whose
scan throws is left undiagnosed and rendered as it would have been without a
sink; the sink's own failures are the host's to notice.

**Reported fallbacks.**

Every diagnostic names the tile that lost its identity guarantee (`tileKind`,
the authored `tile` name when there is one, and the same `id` the episode log
uses). Each reason additionally carries the evidence only it has, so a report is
actionable without re-deriving it from the source:

| reason | evidence | what was lost |
|---|---|---|
| `no-patcher` | — | The tile's data props changed and no patcher is registered for its kind, so the subtree was rebuilt — discarding focus, caret, `<select>` open state, `<video>` playback on that element. |
| `child-count-change` | `oldCount`, `newCount` | An unkeyed sibling list changed length, so the parent was rebuilt. Giving every child a `key` (§10.3.10) lifts this: the keyed matcher then survives insert / remove / reorder without touching the untouched siblings. Never fires when one side of the change is empty — that boundary keeps the parent regardless of keys (§10.3.10). |
| `child-hole` | `index` | A children array had an empty slot. Kumiki codegen flattens nils away, so this only reaches the walker from a host-built tile tree. Reported before any sibling is applied (§10.3.10), so the parent's rebuild is the only thing this render did. |
| `child-unmapped` | `index`, `childKind` | An old child had no entry in the node → element map, meaning its parent's renderer built it without going through `ctx.render`. The walker cannot reuse what it cannot find, so that parent rebuilds on every render. Reported before any sibling is applied, same as `child-hole`. |
| `wrapped-children` | `index`, `childKind` | Every child carried a `key`, but the parent's renderer wraps its children instead of placing them directly (§10.3.10), so the keyed matcher stood down and the positional walk ran. Rebuilds nothing on its own: what is lost is reorder-stable element identity, not the subtree. |
| `unplaceable-insert` | `index`, `childKind` | Every child carried a `key` and every mounted one sits directly under the parent — but the new child at `index` is a newcomer under a renderer that does not place every child directly (§10.3.10), so there is no slot the keyed matcher may mount it into. A short list measures as placeable right up until it grows, which is why this is read from the renderer rather than from the DOM. Rebuilds nothing on its own; the positional walk that follows reports `child-count-change` if the length changed. |

Two rebuild paths are deliberately **not** reported. A `kind` change means a
different thing occupies that position, so there is no identity to preserve.
And a patcher that declines in place via `PatchRequiresRebuild` (§10.3.11) is a
normal, expected outcome that the sentinel exists to keep out of the log.

**A rebuilt parent reports for itself alone.** The four reasons that rebuild a
parent — `no-patcher`, `child-count-change`, `child-hole`, `child-unmapped` —
are all decided before any of its children are reconciled (§10.3.10), so
nothing below it is examined and nothing below it is reported: no
`reconcile-fallback` and no `never-equal-prop` from that subtree, on that
render. Same rule `binds-updated` follows (§10.3.11) —
what the render discarded is not described. (`wrapped-children` and
`unplaceable-insert` rebuild nothing, so the walk that follows them reports
normally.)

Know the cost. A `no-patcher` is a *configuration* fact — that kind has no
patcher registered, and will not on the next render either — so a child sitting
under a parent that rebuilds every render stays invisible for as long as that
lasts. The parent's own reason is the one to read first: fix the rebuild, and
the subtree's diagnostics start arriving.

**Handlers compare by identity.** The kernel once treated any two functions
as equal, because codegen minted a fresh closure every render and comparing
them by identity would have marked every tile as changed forever. That was only
safe while both closures dispatched to the same reducer: a conditional swapping
two inline tiles that differ *only* in their handler compared equal, was reused
untouched, and kept dispatching to the reducer it was created with — silently.

Codegen therefore memoises one closure per reducer list, per app instance
(§10.3.13), and the kernel compares functions like any other value. An
unchanged handler is the same reference and still takes the reuse path; a
changed one is a difference, so the patcher runs and refreshes the per-element
handler slots of §10.3.11.

A host renderer that still mints a handler inline on every render never
compares equal to itself. That is reported — see `function-identity` below —
rather than silently reused.

**Props that can never compare equal.** A tile whose data props compare unequal on *every* render, with a patcher registered
for its kind, is the identity-preserving happy path as far as the walker is
concerned: the patcher runs, the element survives, nothing degraded — so no
fallback is reported and the app looks perfectly healthy while re-applying the
same attributes forever. Unequal decisions are read for a value that could
not have compared equal however identical the two renders were, and reported as
`never-equal-prop`:

| `cause` | the rule it runs into |
|---|---|
| `non-plain-object` | A `Date`, `Map`, `Set`, `RegExp`, DOM node, class instance, or a cross-realm object. Their state lives outside their own enumerable keys, so only `===` can make two of them equal (§10.3.13) — which a value rebuilt each render never is. |
| `nan` | `NaN`, which is not equal to itself by definition (§10.3.13). |
| `function-identity` | A function whose identity changed. The scan keeps no history, so this fires on any two distinct closures — including the one-off swap a conditional makes between two memoised handlers. What it always means is that the pair could not compare equal; whether it repeats depends on whether the host rebuilds the handler per render, which is the case worth fixing by memoising it. |

The scope comes from `MountOptions.hostTileKinds`, which the package-entry
`mount` derives from the `tiles` override map — including overrides of built-in
kinds, since a host renderer put in a built-in's place brings the host's own
prop conventions with it. A host calling `mountCore` with its own renderers
passes the set directly. The scan reads the node's own fields and one level into `props`, the
convention every built-in renderer follows (`props.onClick`, `props.onChange`);
a host tile that buries its handlers deeper (`props.handlers.onClick`) is not
inspected. No cause can come out of codegen, so a report always names a
host-built tree. It fires whether or not a
patcher is registered: with one it is the only signal that the tile churns,
without one the rebuild is already reported as `no-patcher` and this names the
field that reason cannot. Both are emitted, cause before consequence.

A value only reports once both sides are of the same never-equal shape — a
plain bag that becomes a `Date`, or a number that becomes `NaN`, is an ordinary
change on the render it happens and is reported on the next one. The same
instance handed over twice compares equal through `===` and is never reported.

The two diagnostic kinds carry different cost, not different correctness. A
`reconcile-fallback` costs performance and browser-owned element state; a
`never-equal-prop` costs a diff and a patch on every render. `kumiki dev`
routes both to `console.warn`.

**Relationship to the episode log.** An episode is the author-facing causal
record of what the app did, and already reports *that* a subtree was
re-rendered through `signal-update.binds-updated` (§10.3.11). A diagnostic
reports *why* the runtime chose to rebuild rather than reuse — framework
internals, useful when tuning an app or a host integration, noise inside a
behavioural trace. They are complementary channels, which is why this is not a
new episode step kind.

**Consumers.** `smoke()` collects them into a non-fatal `SmokeReport.diagnostics`,
each wrapped with the same phase / trigger a `SmokeIssue` carries so the
provoking interaction is identifiable (rebuilding more than necessary is not a
failure; `SmokeOptions.diagnosticsAsIssues` — `kumiki smoke --diagnostics-as-issues`
— opts into treating it as one). `runScenario` attaches them to the step whose
action triggered the re-render, and `kumiki run` prints them under that step.
`kumiki smoke` prints a per-reason summary.

### 10.3.13 Data-prop equality

§10.3.10 and §10.3.11 both turn on "the tile's data props did not change".
This is the rule that decides it. It is the runtime's single reuse predicate:
a false positive keeps a stale element mounted with no symptom, a false
negative rebuilds a subtree that did not change.

**Scope.** The comparison walks a `TileNode`'s own fields *except* `kind`,
`children`, and `key`. `kind` is the discriminant and is settled before the
predicate runs (§10.3.12). `children` is the walker's own business — each
child is reconciled on its own, so a changed grandchild must not rebuild every
ancestor. `key` is identity metadata consumed by the keyed child matcher
(§10.3.10); by the time a pair reaches the predicate they have already been
established as the same instance.

**Values.** Two values are equal when:

- they are the same value (`===`), or
- both are arrays of the same length whose elements are pairwise equal, or
- both are **plain data bags** — prototype `Object.prototype` or `null` — whose
  union of own keys maps to pairwise-equal values.

Consequences worth stating outright:

- **An absent key and an explicit `undefined` are equal.** `{a: 1}` and
  `{a: 1, b: undefined}` are the same tile; codegen omits optional fields, and
  a conditional spread produces either form for the same authored tile.
- **`null` is not `undefined`, `0` is not `false`, `""` is not `0`.**
  Comparison is `===`-based, never `==`.
- **`NaN` is not equal to `NaN`.** A tile carrying one rebuilds on every
  render. `NaN` in a prop means a computation already failed; rebuilding is the
  safe side, and the churn is a visible symptom rather than a frozen tile — and
  on a host tile the `never-equal-prop` diagnostic in §10.3.12 names the field,
  since with a patcher registered the churn is otherwise invisible.
- **A non-plain object is never equal to anything but itself.** `Date`, `Map`,
  `Set`, `RegExp`, DOM nodes, and class instances hold their state outside
  their own enumerable keys, so key-wise comparison would report a changed
  value as unchanged. Kumiki codegen emits only plain data, so this is
  unreachable from a `.kumiki` source; a host renderer handed one gets a
  rebuild rather than silent reuse. The same instance passed twice still
  compares equal through `===`. "Plain" is decided by prototype identity, which
  is realm-local: an object built in another realm (an `<iframe>`, a `vm`
  context) is treated as exotic and rebuilds — the safe direction, and the
  reason this is not relaxed into a `toString`-tag check. A host handing one to
  the same tile every render pays for a diff it can never win; that is what
  `never-equal-prop` (§10.3.12) reports.

- **A function is equal only to itself.** Handlers are values like any other
  here. Codegen emits every handler through a per-instance memo keyed by the
  reducer list it dispatches, so the same wiring yields the same reference on
  every render and an unchanged tile still takes the reuse path — while a
  handler that genuinely changed, as when a conditional swaps two inline tiles
  that differ only in `onClick`, is a difference the walker acts on. A host
  renderer that mints a handler inline on every render never compares equal to
  itself; it pays a patch (or, with no patcher, a rebuild) every render, which
  `never-equal-prop` (§10.3.12) reports as `function-identity`.

Cycles are outside the contract. Two structurally cyclic but distinct bags
recurse until the stack runs out; the throw lands in the reconcile bailout,
which rebuilds the tree wholesale and records a `location: "reconcile"` panic.
Unsupported, but contained and visible — codegen cannot produce a cycle, and a
visited set would cost every render to defend against one.

---

## 10.4 Effect Dispatcher

Responsible for executing the effects emitted from a reducer.

### 10.4.1 Acceptance

When a reducer completes, the set of emitted effects is passed to the dispatcher:

```
[{name: "persist", args: {...}, key: <derived>, policy: "debounce:300"}, ...]
```

### 10.4.2 capability check

Checks whether each effect's `cap` is included in `app.caps`. A violation is not executed and is notified to `app.error`.

### 10.4.3 policy Handling

| policy | Implementation |
|---|---|
| parallel (default) | immediate dispatch |
| `latest` | cancel the running effect of the same name, start a new one |
| `latest-per-key(k)` | the same, per (effect-name, key) |
| `queue` | execute sequentially in FIFO |
| `debounce(d)` | wait d ms on calls of the same name and execute only the last |
| `throttle(d)` | discard additional calls of the same name within d ms |
| `once` | discard calls with the same in |

### 10.4.4 retry

When `retry=...` is specified, retry on an `Err` result that is a 5xx/network error. Exponential backoff adds ±20% jitter.

### 10.4.5 Delivery of Results

On effect completion, the result is notified to the runtime as an `<effect-name>.ok($value, $key)` / `<effect-name>.err($error, $key)` event. The matching reducer is executed.

### 10.4.6 Implementation of Standard Capabilities

| capability | Implementation |
|---|---|
| `http.*` | `fetch()` |
| `storage.*` | `window.localStorage` |
| `session.*` | `window.sessionStorage` |
| `indexed.*` | IndexedDB API |
| `nav.*` | History API |
| `clipboard.*` | Clipboard API |
| `notification.show` | built-in tile (toast/confirm/modal) |
| `analytics.*` | hook (implementation injected via `app.analytics` at app startup) |
| `log.*` | `console.*` + optional hook |
| `crypto.*` | Web Crypto API |
| `media.*` | MediaDevices API |
| `geo.*` | Geolocation API |
| `socket.*` | WebSocket |

---

## 10.5 Episode Loop

The causal sequence derived from a single trigger is recorded as one **episode**.

### 10.5.1 Structure of an episode

```json
{
  "id": "ep_01JC...",
  "trigger": {"kind": "ui.click", "target": "AddBtn", "payload": {...}, "ts": ...},
  "steps": [
    {"kind": "reducer", "name": "addTodo", "slot-diffs": [...], "emits": ["persist"], "ts": ...},
    {"kind": "effect-start", "name": "persist", "args": {...}, "ts": ...},
    {"kind": "effect-end", "name": "persist", "result": "ok", "value": "()", "ts": ...},
    {"kind": "signal-update", "dirty-slots": ["todos"], "binds-updated": ["TodoList.row.0", ...], "ts": ...},
    {
      "kind": "panic",
      "message": "boom",
      "location": "reducer \"addTodo\"",
      "stack": "Error: boom\n    at ...",
      "cause": [{"message": "root", "stack": "..."}],
      "category": "reducer",
      "ts": ...
    }
  ],
  "status": "completed" | "panic" | "cancelled" | "ongoing"
}
```

A `panic` step additionally carries:

- `stack`: the `Error.stack` of the caught throw, when available.
- `cause`: the flattened `Error.cause` chain, **nearest cause first, root-most last**, each link `{message, stack?}`. Capped at 8 links; self-cycles are broken.
- `category`: one of `reducer` / `effect` / `capability` / `tile-render` / `hydrate` / `unknown` — where in the runtime the throw was caught. Emitted by the reducer / tile-render / hydrate catch sites today; `effect` / `capability` / `unknown` are reserved values so consumers can exhaustive-switch as future callsites are wired in — a capability provider throw currently surfaces as an `effect-end` with `result: "err"`, NOT as a `panic` step.

`stack`, `cause`, and `category` are **optional** for forward compatibility: episode logs written by older runtimes carry only `message` / `location`, and MUST continue to parse and replay unchanged. Readers that don't recognise a field MUST ignore it. `stack` / `cause` are dev-tooling — the runtime never splats them into user reducer `$event` payloads; only `message`, `location`, and `category` reach `app.error` / `route.error(<pattern>)`.

Reserved `trigger.kind` values: `ui.click`, `ui.submit`, `ui.change`, `ui.input`, `lifecycle`, `route.enter`, `timer`, `effect.ok`, `effect.err`, `init`, and **`ssr.hydrate`** (the SSR bootstrap, see §10.6.2). `ssr.hydrate` is asymmetric: the server constructs it during `renderToString`, ships it to the client as JSON, and the client logger ingests it directly — the client MUST NOT open an `ssr.hydrate` episode itself via the usual `beginTrigger` path.

**Deferred-policy effect attribution.** Effects emitted under `policy=debounce(d)` complete their `setTimeout` AFTER the triggering reducer's episode has nominally ended. The dispatcher therefore claims the `effect-start` step (and its episode-token) at *dispatch* time, not at the eventual `launch`, so the deferred `effect-end` and its `.ok` / `.err` reducer chain stay on the originating episode — the causal chain stays whole. A `debounce` timer that is replaced before it fires records an `effect-cancel` step (with `targetId = <effect-name>`) on its originating episode, which then commits as `status="completed"` with no `effect-end`. `policy=throttle(d)` launches synchronously on the leading edge (so the standard sync path attaches `effect-start`); subsequent dispatches within the window are silently suppressed — the originating reducer's `emits` list shows the suppressed effect name, but no `effect-start` follows.

#### 10.5.1.1 Bootstrap episode (SSR hydration)

The server-side `renderToString` pass collapses the entire `app.init` causal chain into a single bootstrap episode and ships it inside the SSR snapshot (§10.6.1). Its shape is just an Episode (above) with two additional contracts:

- `trigger.kind = "ssr.hydrate"`, `trigger.target = <initial-route-path>`.
- `steps` mirror the real server-side execution: each `app.init` emit produces a paired `effect-start` / `effect-end`, the matching `{effect, outcome}` reducer adds a `reducer` step (with `volatile`-filtered `slot-diffs`), and a final `signal-update` lists the non-`volatile` slots that changed. There is no synthesised `ssr.bootstrap` step — the chain stays in the canonical episode grammar so replay tooling works unchanged.

Example:

```json
{
  "id": "ep_01JC...",
  "trigger": {"kind": "ssr.hydrate", "target": "/", "ts": 1717900000000},
  "steps": [
    {"kind": "effect-start", "name": "loadUser", "args": {"url": "/api/me"}, "ts": 1717900000001},
    {"kind": "effect-end", "name": "loadUser", "result": "ok", "value": {"id": "u_1"}, "ts": 1717900000045},
    {"kind": "reducer", "name": "loadUser.ok", "slot-diffs": [{"name": "user", "before": null, "after": {"id": "u_1"}}], "emits": [], "ts": 1717900000046},
    {"kind": "signal-update", "dirty-slots": ["user"], "binds-updated": [], "ts": 1717900000047}
  ],
  "status": "completed"
}
```

### 10.5.2 episode store

- The most recent N in memory (default 100)
- The most recent M in localStorage (default 20, size limit 5MB)
- During development, write to a file with `--episode-log /path/to/log.jsonl`

The bootstrap episode (`trigger.kind = "ssr.hydrate"`) is stored on the same path as any other episode: appended to the in-memory ring and (when localStorage mirroring is enabled) persisted on the same eviction policy. No special pinning — once enough later episodes accrue, the bootstrap eventually falls off the tail like any FIFO entry. Hydration runs `persistLocalStorage()` as part of the ingest so the mirror reflects the bootstrap immediately (an AC for §10.6.2 verification).

### 10.5.3 replay

```bash
kumiki replay <input.kumiki> --from-log <log.jsonl>           # replay every episode in the log
kumiki replay <input.kumiki> --from-log <log> <episode-id>    # replay one episode by id
kumiki replay <input.kumiki> --from-log <log> \               # repeatable; each entry follows
  --mock 'loadUser: from-log' --mock 'persist: ignore'        # §8.6's mock grammar
kumiki replay <input.kumiki> --from-log <log> --until-step 5  # stop after the 5th observed step
```

- `--from-log` is currently required. The bare `kumiki replay <episode-id>` form (against the runtime's in-memory store, §10.5.2) needs a long-lived dev-server context and is out of scope for the CLI verb.
- `--mock '<effect>: <spec>'` is repeatable. `<spec>` follows the same grammar as `episode-test.mocks` (§8.6): `from-log` | `ignore` | `ok(<json>)` | `err(<json>)`. The payload is parsed as JSON, so `ok({"id":"u1"})` works on the command line as-is.
- An effect with no `--mock` entry is dropped (matches `episode-test`'s default).
- `--until-step N` counts each observed step (reducer / effect-start / effect-end / signal-update / panic) as one, globally across all replayed episodes, 1-indexed. The slots at the moment of interruption are printed.
- Replay synthesises a `signal-update` event per episode from the slots a reducer actually changed; recorded `signal-update` entries in the input log are not re-played verbatim (they're advisory provenance, not driving input).
- A `panic` step (§10.5.1) is rendered as a multi-line block: header `[panic:<category>] <message>  <location>` followed by indented `.stack` lines and, for each `cause` link, a `Caused by: <message>` line with the link's own indented stack. The replay executor derives `category` for every observed panic (an older episode log missing the field still gets a category assigned when its reducer re-throws during replay), so the multi-line form is what the CLI normally shows. The formatter also accepts a minimal `{kind, message}` panic event and prints it as the single-line `[panic] <message>` fallback — this only surfaces if a caller feeds `formatEvent` a hand-authored event outside the normal replay pipeline.
- Exit code is `0` on a clean run, `1` if any episode panicked or surfaced an unhandled effect error.

---

## 10.6 SSR / Edge / Client Split

### 10.6.1 SSR

- HTML generation renders the tile of the initial route once on the **server-side** via `renderToString(app, options)` from `@kumikijs/runtime`.
- The slot initial values may include the results of the effects emitted in `app.init` (not re-executed at hydration).
- **The served HTML carries the same inline style the client would paint**: a tile's element, its kind's own layout (a `column`'s flex axis, a `card`'s box metrics, a `grid`'s tracks), and the declarations its props map to (`gap` / `align` / `justify` / `pad` / `max-w` / `bg` / `radius` / `style`, and a text tile's `color` / `size` / `weight` / `strike`). Without them the first paint lays every container out as a block and the page reflows the moment hydration finishes, which is the shift SSR exists to remove.
  - A **responsive** value (`{base, sm, md, …}`) collapses to its `base`: a breakpoint is a question about the viewport and the server has none.
  - What is **not** served is what an inline declaration cannot carry: `transition`, the `hover:` / `focus:` / `active:` blocks and the `motion` layer are classes backed by injected CSS, and the client adds them on hydration. Nor are event handlers, focus state, or the resolved `icon` SVG — the placeholder is the same element the renderer writes, under the same attribute, but it is empty and unsized until the client resolves the path, so the icon's arrival does move what follows it. Nor, for the same reason, is anything the theme stylesheet paints: a `card`'s surface, border and shadow, and the `button` / `input` / `link` rings, are rules the client injects at mount, and the server serves the box without them.
- Response bundle composition:
  - HTML (the result of initial tile rendering)
  - JSON (the snapshot envelope, structured as below)
  - JS (signal graph + effect dispatcher)

The snapshot envelope is versioned and self-describing:

```json
{
  "kumiki": 1,
  "route": "/posts/abc",
  "slots": { "<slot-name>": <value>, ... },
  "bootstrap": { /* Episode (§10.5.1), trigger.kind = "ssr.hydrate" */ },
  "renderedAt": 1717900000000
}
```

- `kumiki` is the snapshot schema version (current = `1`). A client whose runtime expects a different version MUST discard the snapshot and fall back to a full CSR boot — this keeps server / client out-of-sync deploys safe.
- `slots` excludes every slot whose declaration carries the `volatile` modifier (§5 modifiers table): the runtime treats SSR snapshotting as the same serialisation boundary as persistence, so `volatile` slots are never written to the wire.
- `bootstrap.steps[].slot-diffs` use the same `volatile` filter, so a volatile slot never appears in either the `slots` map or the bootstrap diff.
- `bootstrap.steps[0..]` carry the real `app.init` causal chain (effect-start / effect-end / reducer / signal-update). `before` values inside `slot-diffs` are the slot's declared default at the start of the SSR pass; `after` is the post-init value mirrored in `slots`.

### 10.6.2 Hydration

Hydration runs in a strict, synchronous order. If any step throws, the client discards the snapshot and falls back to a full CSR boot:

1. **Snapshot load + version check.** Parse the snapshot envelope (e.g. from a `<script type="application/json" id="kumiki-state">` block). If `kumiki !== 1`, skip steps 2–4 and run a cold CSR boot.
2. **Slot overlay.** Write each entry of `snapshot.slots` into `app.live` BEFORE wiring routing, effects, or `app.start`. Volatile slots stay at their declared default — they were never in the snapshot.
3. **Bootstrap ingest.** Inject `snapshot.bootstrap` into the episode logger via the dedicated `ingestBootstrap` path. This is the only legal way for a client to surface an `ssr.hydrate` episode; `beginTrigger` is forbidden for that kind. After this step, `app.episodes()[0]` is the SSR causal chain.
4. **Event handler attach.** Attach the runtime's event delegation to the SSR HTML so user input starts dispatching client-side reducers.
5. **`app.start` fires.** The lifecycle reducer fires normally (it never ran on the server). `app.init` does NOT re-fire — the snapshot already carries its results. `route.enter` for the current pattern fires after `app.start`, exactly as in a CSR boot.

The observed order on the client is therefore `app.episodes() = [bootstrap, app.start episode, route.enter episode?, user-driven episodes...]`. The hydration boundary preserves episode continuity — no `ssr.hydrate`-to-`app.start` gap and no duplicate init effects.

### 10.6.3 Edge

SSR on Cloudflare Workers / Vercel Edge, etc.:

- Part of the effect dispatcher (`http.*`, `storage.kv.*`) runs on the edge side
- The rest is deferred to the client
- Bundle size budget: runtime 30KB + app code (target)

---

## 10.7 Development Server

```bash
kumiki dev                          # start the development server
kumiki dev --port 5173
kumiki dev --episode-log ./eps.log
kumiki dev --strict-a11y
```

Features:

- Hot reload (on code change, slots are retained)
- error overlay (detailed display on panic)
- episode timeline panel (visualizes recent episodes)
- inspector (slot values, tile tree, dependency graph)

---

## 10.8 Build

```bash
kumiki build                        # production build
kumiki build --target=spa           # SPA only
kumiki build --target=ssr           # Node.js SSR
kumiki build --target=edge          # Edge runtime
kumiki build --target=static        # static site
kumiki build --analyze              # bundle analysis
```

Output composition:

```
dist/
├── index.html
├── assets/
│   ├── app-<hash>.js
│   ├── app-<hash>.css         ← reset + theme token expansion only
│   └── icons-<hash>.svg
├── server/                    ← only for SSR/Edge
│   └── entry.js
└── manifest.json
```

### 10.8.1 Vite plugin (`@kumikijs/vite`)

The **build-integration ecosystem seam**: drop Kumiki into an existing Vite project (and therefore Next/Astro/SvelteKit/etc.) and `import` `.kumiki` files like any module. Each source compiles to an ESM module that **default-exports the compiled `AppShape`** (via codegen's `exportApp` — no auto-mount; the importer owns mounting through `mount` or `defineKumikiElement`).

```ts
// vite.config.ts
import { kumiki } from "@kumikijs/vite";
export default { plugins: [kumiki()] };
```

```ts
import App from "./app.kumiki";
import { mount } from "@kumikijs/runtime";
mount(App, document.getElementById("root"));
```

The module also exports a `createApp()` factory — `import App, { createApp } from "./app.kumiki"` — for spinning up multiple independent instances (each `createApp()` returns an `AppShape` with its own state).

- **The runtime is shared, not copied** — the compiled module keeps its `import "@kumikijs/runtime"` and the bundler ships one copy, which the example above depends on: `mount` comes from the same package. `bundle: true` inlines the runtime into the module instead, for a module that must stand alone; anything else importing the runtime then gets a second copy (129 kB against 82 kB for the counter, and one more copy per further `.kumiki` import) and the copies do not share the runtime's module-level state. The plugin resolves the specifier from the project when the project can, and from its own dependency otherwise, so a project that installed only `@kumikijs/vite` still builds — with one copy either way.
- **Options** — `bundle` (default `false`, above). `types` (default `false`: emit a sibling `<name>.kumiki.gen.ts` of typed `KumikiSlots` / `KumikiProviders` helpers for type-safe provider authoring; written only when its contents change — the names are prefixed so they cannot collide with a program's own `Slots` or `Providers` type).
- **Capabilities** — `kumiki.caps.json` is resolved automatically (same as the CLI): from the source file's directory up to the project root, which for the plugin is Vite's `root`. See [Registering custom capabilities](./stdlib.md#_2-5-standard-capabilities).
- **Failures are located** — a type error, a parse error and a lex error all reach Vite's overlay as a diagnostic carrying file, line and column, so the overlay can jump to the offending line.
- **Typing the import** — reference the shipped ambient types once so `import App from "./x.kumiki"` is typed as `AppShape`:

  ```ts
  /// <reference types="@kumikijs/vite/client" />
  ```

Verified by `packages/vite/test/plugin.test.ts` (compilation), `runtime-dedupe.test.ts` (one runtime in a real `vite build`) and `diagnostics.test.ts` (located failures, manifest lookup); the typed-helper generator (`generateDts`) by `packages/compiler/test/dts.test.ts` and `dts-compiles.test.ts`.

---

## 10.9 Runtime API (for Embedding)

When embedding a Kumiki app from a host app:

```javascript
import { mount } from "kumiki/runtime"

const app = mount({
  target: document.getElementById("app"),
  bundle: "/assets/app.js",
  initialSlots: { /* ... */ },
  effectHandlers: {
    "analytics.send": (event, props) => myAnalytics.track(event, props)
  }
})

app.dispatch({ kind: "ui.click", target: "AddBtn", payload: {} })
app.slots.todos                       // read-only
app.episodes                          // recent episodes
app.unmount()
```

### 10.9.1 Web Component embedding (`defineKumikiElement`)

The **outbound ecosystem seam**: wrap a compiled app as a standard custom element so it drops into any host page or framework (React/Vue/Svelte/plain HTML) without a Kumiki-specific integration. It bridges the host both ways and owns the mount lifecycle (mount on connect, dispose on disconnect).

```ts
import { defineKumikiElement } from "@kumikijs/runtime";
import { App } from "./my-compiled-app.js"; // the bundle's exported AppShape

defineKumikiElement("my-widget", App, {
  // inbound (host → app): host implementations for custom capabilities
  providers: { "payments.charge": async (input) => /* … */ },
  // outbound (app → host): custom-cap effects surface as DOM CustomEvents
  events: ["telemetry.track"],
  // declarative props: an observed attribute mapped to a slot
  attributeSlots: { "data-count": { slot: "count", parse: Number } },
});
```

```html
<my-widget data-count="3"></my-widget>
<script>
  document.querySelector("my-widget")
    .addEventListener("telemetry.track", (e) => console.log(e.detail));
</script>
```

- **Inbound** — `providers` are forwarded to `mount` (same custom-capability seam as [Standard Capabilities](./stdlib.md#_2-5-standard-capabilities)); `attributeSlots` map observed attributes to slots (applied on connect and on change); imperative `el.setSlot(name, v)` / `el.setSlots({…})` write live slots (refinements enforced) and `el.getSlot(name)` / `el.slots` read them.
- **Outbound** — each capability in `events` gets a passthrough that dispatches `CustomEvent(cap, { detail: input, bubbles, composed })` and resolves ok; a `providers[cap]` entry **overrides** the passthrough for that capability.
- **Style isolation** — by default it renders into the element's **light DOM** (the runtime's document-level theme/motion styles apply, matching a standalone page). Pass `shadow: true` to render into an **open shadow root**: the app's motion / theme / state `<style>` nodes are injected into the shadow root (via `mount`'s `styleRoot`), and theme background/foreground/font are applied to an in-shadow container — so host-page CSS does not bleed in and Kumiki's CSS does not leak out.
- Registration is idempotent. For **multiple independent instances** of the same component, pass the compiled module's `createApp` factory instead of its default export — each element then builds its own state: `defineKumikiElement("my-widget", createApp)`. Passing the default `AppShape` shares one instance across all elements of that tag.
- **What a shared instance means.** One `AppShape` is one app, however many hosts it is mounted into — through `defineKumikiElement` or by calling `mount` twice. Every host is a *view*: they show the same slots, a click in one re-renders all of them, and an imperative `setSlot` on any element is a write to the one state. What the app owns **once** belongs to the first mount — `app.init`, `app.start`, the timers, the router, the effect dispatcher — so mounting a second view does not re-run initialization or double a timer's ticks. Each view keeps its own reconcile state, so identity-preserving diffing works per host.
- **Teardown is per view.** Disposing one view empties and un-registers its host and leaves every other view interactive; the app itself is torn down when the **last** view goes, after which mounting the shape again starts it over — `app.init`, `app.start`, the timers and the router run again. Its *state* is not reset: `app.live` is the shape's, and a slot the app had written keeps that value into the next mount. `createApp()` is what returns a shape at its declared defaults. A view cannot be added with `hydrate` — a server snapshot overlays a *fresh* state, and this app's is already live.

Verified by `packages/runtime/test/element.test.ts`; the shared-instance semantics by `packages/runtime/test/shared-mount.test.ts` and T8 in `packages/runtime/test/multi-mount.test.ts`.

---

## 10.10 Implementation Responsibilities of the Standard Library

For the built-ins enumerated in [Standard Library](./stdlib.md), the runtime implementation guarantees the following behavior:

| Feature | Guarantee |
|---|---|
| `Map`, `Set`, `List` | pure (no in-place mutation) |
| `Option`, `Result` | exhaustiveness check for pattern matching |
| `Time.now`, `math.random` | callable only inside a reducer, recorded in the episode log |
| `*.fresh()` | generates UUIDv7 |
| `panic()` | puts the episode into the `panic` state and rolls back slots |

---

## 10.11 Performance Budget

| Item | Budget |
|---|---|
| runtime core | ~30KB gzip |
| 1 reducer execution time | < 1ms (typical) |
| signal graph update | < 16ms (60fps) |
| effect dispatch overhead | < 0.1ms |
| episode log write | < 0.5ms (memory) |

To meet these, the runtime is Rust → WASM (optional) or hand-written JS (default).

---

## 10.12 Record of Design Decisions

| Decision | Reason |
|---|---|
| signal graph is static | eliminates runtime dependency tracking; performance and predictability |
| batch updates | so that successive changes do not exceed 60fps |
| effects go via the dispatcher | guarantees capability guards and logging structurally |
| episode = per trigger | integrates debugging, testing, and audit into a single unit |
| SSR and CSR consume the same IR | the target difference is only the dispatcher implementation difference |
| runtime 30KB target | practicality on mobile / Edge |

---

## 10.13 Next

- Complete examples → [examples/](https://github.com/kumikijs/Kumiki/tree/main/packages/examples)
