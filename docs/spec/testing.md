# Testing

Kumiki testing comes in **three kinds**:

1. **reducer test** — since reducers are pure functions, verify with inputs and expected outputs
2. **effect mock** — mock at the capability guard boundary to verify dispatcher behavior
3. **episode replay** — replay a production trace with mock effects to detect regressions

All are written within the Kumiki language (no external test framework required).

## 8.1 The Test Definition Layer

```
test-def ::= 'test' identifier '=' test-expr
test-expr ::= reducer-test | tile-test | episode-test | property-test
```

A `test` definition is **the sixth layer**. It is stored in the CRDT graph and run with `kumiki test`. It is not included in the production build.

> **Implementation status.** Implemented: `reducer-test`, `tile-test`, `property-test` ([Property Tests](#_8-3-property-tests)), and `episode-test` ([Episode replay](#_8-6-episode-replay)) backed by the runtime [Episode Loop](./runtime.md#_10-5-episode-loop); the `kumiki test` runner with name / `prefix*` filtering, per-test **timings** (`(1ms)` / `(100 cases, 23ms)`), `--coverage`, and `--watch`; `kumiki fix --auto-patch <test-name>` ([Fixing from a failing test](#_8-7-2-fixing-from-a-failing-test)); `expect` **wildcards** (`<any-id>` / `<slots.X>`, [Wildcards](#_8-2-2-wildcards)); and **effect-result mocks** inside `reducer-test` (`given.mocks`, [Effect mock](#_8-5-effect-mock)). The runner prints `PASS` / `FAIL` lines plus `expected` / `actual` / `diff at <path>` and — when it can isolate a scalar leaf — the value arrow (`"a" -> "b"`) on failure.

## 8.2 Reducer Tests

```kumiki
test addTodo-basic =
    reducer-test addTodo
        given = {
            slots: {todos: {}, draft: "Hello"},
            event: {type: ui.submit, target: NewTodoForm}
        }
        expect = {
            slots: {todos: {<any-id>: {text: "Hello", done: false}}, draft: ""},
            effects: [persist(<slots.todos>)]
        }
```

### 8.2.1 Syntax

```
reducer-test ::= 'reducer-test' identifier
                 'given'  '=' '{' 'slots' ':' record-lit ',' 'event' ':' event-lit '}'
                 'expect' '=' '{' 'slots' ':' record-lit ',' 'effects' ':' effect-list '}'

event-lit ::= '{' 'type' ':' event-pattern (',' kv)* '}'
effect-list ::= '[' (effect-call (',' effect-call)*)? ']'
```

### 8.2.2 Wildcards

`<any-id>` means "any generated ID," and `<slots.todos>` means "a reference to the slot value after execution."

A wildcard is legal only inside a `reducer-test` `expect` (anywhere else is **E0109**). Matching is otherwise **exact**: records are compared by their full key set, with wildcards filling the holes a deterministic test cannot predict. As a **value**, `<any-id>` matches any present value (e.g. a freshly generated id) and `<slots.X>` matches slot `X`'s post-execution value. As a **map key**, `<any-id>` pairs with exactly one otherwise-unmatched entry — zero or more than one is a failure. Use a value wildcard to blank out other non-deterministic fields (e.g. `createdAt: <any-id>`) rather than relying on partial-record matching.

### 8.2.3 Expecting a panic

```kumiki
test addTodo-empty =
    reducer-test addTodo
        given = {slots: {todos: {}, draft: ""}, event: {type: ui.submit, target: NewTodoForm}}
        expect = {panic: "draft cannot be empty"}
```

## 8.3 Property Tests

```kumiki
test toggle-is-involution =
    property-test
        for-all = {todoId: TodoId, todos: Map(TodoId, Todo)}
        given = {slots: {todos: todos}, event: {type: ui.click, target: TodoRow, el: {todoId: todoId}}}
        invariant = run-reducer(toggle).run-reducer(toggle).slots.todos == todos
```

### 8.3.1 Syntax

```
property-test ::= 'property-test'
                  'for-all'    '=' record-lit       ; variables to generate
                  'given'      '=' record-lit
                  'invariant'  '=' expr
                  ('count'     '=' int)?            ; number of trials (default 100)
                  ('shrink'    '=' bool)?           ; minimize on failure (default true)
```

### 8.3.2 Generators

Each type has an automatic generator:

| Type | Default generation |
|---|---|
| `Int` | -1000 ~ 1000 |
| `Float` | -1000.0 ~ 1000.0 |
| `Text` | 0~50 characters, ASCII |
| `Bool` | true/false |
| `List(T)` | 0~10 elements |
| `Map(K, V)` | 0~10 elements |
| `Set(T)` | 0~10 elements |
| `Option(T)` | 50% None / 50% Some |
| `Result(T, E)` | 50% Ok / 50% Err |
| `nominal T` | T's generator |
| `refinement T where p` | generate T constrained by p |
| record `{…}` | each field generated recursively |
| union | a random variant, payloads generated recursively |

Custom generators:

```kumiki
test foo =
    property-test
        for-all = {x: Int where between(0, 100)}
        ...
```

> **Implementation note.** A refinement folds into its base generator as a bound rather than reject-sampling: `between(a, b)` constrains the numeric range, `nonempty` / `len-*` the string length, `positive` the lower bound. Refinements with no generator constraint (`uuid` / `email` / `url`) generate the unconstrained base type (the runtime does not enforce them either, so the value is an opaque token). Generation is **seeded** (default: a hash of the test name), so a failing case reproduces exactly across runs; on failure the counterexample is **shrunk** (unless `shrink = false`) toward a minimal value (numbers → 0, strings → "", collections → fewer elements). `run-reducer(name)` inside `invariant` applies a reducer to the current `{slots}` state using the `given` event and returns the next state, so steps chain (`run-reducer(toggle).run-reducer(toggle).slots.todos`).

## 8.4 Tile snapshot Tests

Compare a tile's structure against an expected value:

```kumiki
test counter-display =
    tile-test App
        given = {slots: {count: 5}, in: ()}
        expect = column(
                   heading("Count: 5"),
                   row(DecBtn, ResetBtn, IncBtn))
```

The snapshot is a deep structural comparison. Class names and styles are out of scope for comparison (only those explicitly specified).

## 8.5 Effect mock

Replace an effect's return value:

```kumiki
test loadUser-success =
    reducer-test fetchUser-flow
        given = {
            slots: {users: {}},
            event: {type: ui.click, target: LoadBtn, el: {userId: "u1"}},
            mocks: {
                loadUser: ok({id: "u1", name: "Alice", email: "a@x.com"})
            }
        }
        expect = {
            slots: {users: {"u1": Loaded({id: "u1", name: "Alice", email: "a@x.com"})}},
            effects: []
        }
```

With `mocks: {effect-name: ok(value) | err(error) | delay(ms, ok(value))}`, you can replace the result of any effect.

The runner dispatches the triggering event, then drives the emit → result → reducer loop headlessly: an emitted effect **with** a `mocks` entry is delivered to its `.ok` / `.err` reducer (the mock's `value` arrives as the reducer's first bind), and the loop continues until quiescent. An emitted effect **without** a mock is *residual* — recorded and asserted via `expect.effects`, with no result delivered (so a mocked effect is "consumed" and does not appear in `expect.effects`, which is why `loadUser` above leaves `effects: []`). `delay(ms, …)` resolves immediately — time is virtualized (no real wait), results process in emit order. A mock's key must name a declared effect (else **E0104**), and a mocked `err` that no `.err` reducer consumes fails the test (the [Standard Capabilities](./stdlib.md#_2-5-standard-capabilities) no-silent-failure contract), rather than passing silently.

## 8.6 Episode replay

Replay an episode log recorded in production and verify the result:

```kumiki
test bug-2026-05-21 =
    episode-test
        load    = "fixtures/episode-2026-05-21.log"
        mocks   = {
            loadUser: from-log,        ; return the result recorded in the log as-is
            persist:  ignore
        }
        expect  = {
            slots-equal: from-log,     ; final slots match the log's record
            no-panics: true
        }
```

### 8.6.1 The Format of the episode log

→ Detailed in [Runtime](./runtime.md).

### 8.6.2 Use Cases

- Turn an episode log attached to a bug report into a fixture and make it a regression test
- Confirm that the same input produces the same result even after changing a model / algorithm
- Verify that an old log can be migrated when the schema changes

## 8.7 The Runner

```bash
kumiki test                    # run all tests
kumiki test reducer-test       # reducer-test only
kumiki test addTodo-*          # wildcard filter
kumiki test --watch            # re-run on change
kumiki test --coverage         # coverage (per reducer/effect/tile)
```

### 8.7.1 Output

```
PASS  addTodo-basic        (1ms)
PASS  toggle-is-involution (100 cases, 23ms)
FAIL  counter-display
  expected: column(heading("Count: 5"), row(...))
  actual:   column(heading("Count: 0"), row(...))
  diff at:  [0].text  "Count: 5" -> "Count: 0"
```

### 8.7.2 Fixing from a failing test

`kumiki fix <file> --auto-patch <test-name>` runs the named test and **proposes a patch** from the failure; add `--apply` to write it and re-run (reporting whether the test now passes and whether any other test regressed). It repairs only what it can prove deterministically:

- If the file does not compile, the test can't run — it reuses the [`fix`](./ai-edit.md) typecheck repairs (did-you-mean name fixes, missing `/404`) so the test can run.
- If a tile-test or reducer-test fails on a **string leaf** whose actual value is a *unique* source literal, it replaces that literal with the expected value (the [Output](#_8-7-1-output) snapshot case).

Non-literal divergences (numeric slots, wrong operators, effect-list mismatches) are reported as a diff rather than guessed.

## 8.8 Integration Tests (browser-driven)

E2E is implemented outside the runtime. Use existing tools such as Playwright / Cypress. From the Kumiki side:

- A **`test-id` prop** can be attached to every tile
- The **`data-kumiki-tile`** attribute is automatically applied by the runtime
- The **`window.__KUMIKI__`** exposes internal slots read-only (test-time only)

```javascript
// Playwright example
await page.locator('[data-kumiki-test=add-btn]').click()
const todos = await page.evaluate(() => window.__KUMIKI__.slots.todos)
expect(Object.keys(todos)).toHaveLength(1)
```

## 8.9 Design Decision Record

| Decision | Rationale |
|---|---|
| Write tests within the language | A separate language increases what the AI must learn |
| Input/output comparison suffices since reducers are pure | No mock needed, deterministic |
| Make property tests first-class | Verify reducer invariants structurally |
| Make episode replay first-class | Production bugs can be turned into tests automatically |
| E2E is an external tool | Out of Kumiki's scope; respect existing tools |

## 8.10 The Three Layers of Tooling Verification

Separate from the `test` definitions above (in-language tests), the toolchain provides staged verification. Each layer catches what the previous layer cannot. The important point is that **`check`/`build` passing is not proof of "working."**

| Layer | Command | What it catches | What it doesn't catch |
|---|---|---|---|
| 1. Compile | `kumiki check` / `kumiki build` | syntax, types, reference resolution, codegen | runtime behavior |
| 2. Runtime smoke | `kumiki smoke` | mount exceptions, empty rendering, unhandled rejection (mounts to a headless DOM and operates all button/input/select) | correctness of results |
| 3. Behavior assertions | `test` definitions / example-specific tests | "whether the result is correct" (e.g., non-exception bugs such as a select always ending up at the last option) | — |

### smoke (layer 2)

`kumiki smoke <file>` mounts a compiled app to a headless DOM (happy-dom), fires events at all operable elements after the initial render, and at each step monitors for runtime exceptions, console errors, unhandled rejections, and empty rendering. It automatically detects the class of bugs previously verified by a human in the browser, such as "the type passes, but it calls a method that doesn't exist in the runtime and crashes on operation" or "it doesn't render." It is general-purpose and has no app-specific knowledge.

Real rendering in a browser (CSS layout, real focus, etc.) cannot be fully reproduced by a headless DOM. The **real-browser tier** for that is `@kumikijs/e2e` (Chromium / Playwright), which runs in the **same scenario format** as the headless-DOM tier. The state oracle is likewise `window.__kumikiApp.live`, and displayed text is `innerText` (visible only). In addition, it has browser-only assertions:

- `focused`: that the specified selector is actually focused (detects focus-stealing bugs on re-render)
- `visible` / `hidden`: that it is really visible/invisible per computed style (`display:none`, etc.)

Because it is heavy (browser binaries), it is not included in the default CI tests; it is an opt-in layer used for verifying focus, layout, and real rendering, and for final verification. The **correctness** of results cannot be judged by smoke; the layer-3 assertions handle that.

**Fixture shape (`.browser.json`).** A `.browser.json` is the same JSON as a `scenario.json` — `{ "steps": [{ "label"?, "do"?, "expect"? }, ...] }` — with two intentional differences from the scenario tier:

- `expect` may additionally use the browser-only assertions `focused` / `visible` / `hidden` / `animating` described above.
- `effects: { ... }` (the capability-boundary mock) and `router: "memory" | "hash" | ...` (both accepted by the scenario tier's `runScenario`) are **not supported** here. The browser tier deliberately drives a real Chromium against the real DOM/CSS — mocking effects would defeat what tier 3 is for, and routing runs off the `setContent` document rather than a URL, so the memory router applies uniformly.

Drop a fixture at `packages/examples/features/<name>.browser.json` (paired with the sibling `<name>.kumiki`) or `packages/examples/apps/<app>/app.browser.json` (paired with `app.kumiki` in the same directory) and `pnpm test:e2e` picks it up automatically — one Playwright test per fixture. `kumiki-e2e <file> <scenario.json> [--headed]` remains the single-fixture CLI wrapper (same runner, own Chromium).

`@kumikijs/mcp` provides an equivalent `kumiki_smoke`, allowing an AI agent to self-verify after editing.

### Example-corpus guard: runtime truth, not just compilation

The example corpus (`packages/tests`) is the standing guarantee that **"a broken example must never merge."** Asserting only that every example *compiles* is not enough: a value argument that is dropped during lowering compiles cleanly and even mounts, yet renders an empty-but-present node — it is "compiles but is actually broken," invisible to both layer 1 and the layer-2 "not empty / no throw" bar (this is exactly how the `03-union-and-match` heading bug, lowered to `_s.show(undefined)`, shipped green). The corpus guard therefore also asserts **runtime truth** for the dropped-expression class:

- **Static codegen scan.** Every value-bearing display tile (`heading` / `text` / `button` / `label` / `link` / `markdown` / `image` / `icon` / `input`+`textarea` value) lowers its value through `show(...)`. A dropped expression in any of those positions surfaces as the exact token `show(undefined)`. Because Kumiki source has no `undefined` literal, that token can only originate from a dropped expression — a zero-false-positive sentinel (distinct from the pervasive, benign `undefined` in reducer read-back and selector-less reducers). The corpus fails if any example's generated JS contains it.
- **Rendered-DOM scan.** Every example is mounted in a headless DOM (happy-dom) and asserted to render no text node that is literally `"undefined"`, catching a raw `undefined` that reaches the DOM by a path the sentinel does not cover.

These run in default CI (no browser binaries), so a re-introduced dropped-expression bug fails the build rather than shipping green.

### Scenario Execution (the bridge from layer 2 to 3) and the Autonomous Loop

`kumiki run <file> <scenario.json>` (MCP: `kumiki_run_scenario`) drives the app with a **scenario** and returns a structured trace for each step. This becomes the foundation for a "generate → execute → observe → fix loop without a human in the loop."

- **Action**: `{dispatch, payload?}` (fire a reducer by name) / `{clickText}` / `{click}` / `{focus}` / `{blur}` / `{fill, value}` / `{choose, value}` / `{navigate}`. `{focus}` and `{blur}` dispatch a real DOM `FocusEvent` on a selector match, so the scenario tier alone verifies the `addEventListener` wiring that feeds `ui.focus` / `ui.blur` reducers.
- **Observation**: after each step, record `state` (a slot snapshot), `domText`, `errors`, and `emits` (the fired effects).
- **Assertion (expect)**: `{ noErrors?, state?, domIncludes?, domExcludes? }`. `state` is a **partial match against slot state** (dot-separated paths allowed). Because you can verify state rather than DOM text, it can mechanically detect **non-exception behavior bugs** (the class a human notices by clicking), such as "a select always ending up at the last option." This is equivalent to making the acceptance criteria (AC) of TDD executable.
- **effect script**: `effects: { <name>: [{outcome, value}, ...] }` replaces HTTP / Storage results in order, keeping the loop deterministic and network-independent.

Why this works cleanly in Kumiki: because state is explicit (slots), the oracle is trustworthy; because events are declarative (reducer names), it can be driven precisely; and because effects can be mocked at the capability boundary, it is reproducible. The agent generates "app + scenario (AC)" from requirements and self-corrects by reading the trace, so the human only needs to state the requirements once. The loop procedure is described in `.claude/skills/kumiki-iterate`.

## 8.11 Next

- AI editing and automatic fixing → [AI Editing](./ai-edit.md)
- Runtime internals → [Runtime](./runtime.md)
