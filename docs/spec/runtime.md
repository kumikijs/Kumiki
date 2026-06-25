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

It maintains the focus and cursor position of an input/textarea being edited even after re-rendering:
- Elements with `bind=`: re-identified by the `data-kumiki-bind` attribute (a nested path is a full path string)
- Elements with `id=`: re-identified by id
- Neither (e.g. a search box with only `value=`): re-identified positionally by a **DOM child-index path**

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
    {"kind": "signal-update", "dirty-slots": ["todos"], "binds-updated": ["TodoList.row.0", ...], "ts": ...}
  ],
  "status": "completed" | "panic" | "cancelled" | "ongoing"
}
```

### 10.5.2 episode store

- The most recent N in memory (default 100)
- The most recent M in localStorage (default 20, size limit 5MB)
- During development, write to a file with `--episode-log /path/to/log.jsonl`

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
- Exit code is `0` on a clean run, `1` if any episode panicked or surfaced an unhandled effect error.

---

## 10.6 SSR / Edge / Client Split

### 10.6.1 SSR

- HTML generation renders the tile of the initial route once on the **server-side**
- The slot initial values may include the results of the effects emitted in `app.init` (not re-executed at hydration)
- Response bundle composition:
  - HTML (the result of initial tile rendering)
  - JSON (the initial slot snapshot)
  - JS (signal graph + effect dispatcher)

### 10.6.2 Hydration

- The client JS starts
- Loads the initial slot snapshot and reflects it in the signal graph
- Attaches event handlers to the DOM
- Fires the `app.start` reducer (note: not executed during SSR, only after hydration)

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

- **Options** — `bundle` (default `true`: inline the runtime so each module is self-contained; `false` leaves an `import "@kumikijs/runtime"` for the bundler to dedupe). `types` (default `false`: emit a sibling `<name>.kumiki.gen.ts` of typed `Slots` / `Providers` helpers for type-safe provider authoring; written only when its contents change).
- **Capabilities** — a sibling `kumiki.caps.json` is resolved automatically (same as the CLI), so custom-capability apps compile unchanged.
- **Typing the import** — reference the shipped ambient types once so `import App from "./x.kumiki"` is typed as `AppShape`:

  ```ts
  /// <reference types="@kumikijs/vite/client" />
  ```

Verified by `packages/vite/test/plugin.test.ts`; the typed-helper generator (`generateDts`) by `packages/compiler/test/dts.test.ts`.

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

Verified by `packages/runtime/test/element.test.ts`.

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

- Complete examples → [examples/](https://github.com/kage1020/Kumiki/tree/main/packages/examples)
