# Authoring Kumiki

Kumiki is a declarative front-end app language. A program is a set of independent definitions across
**7 layers**, plus an optional theme. Definitions refer to each other by name; there are no imports.

## The 7 layers

| layer | role | example |
|---|---|---|
| `type` | domain types: nominal, union, record, refinement | `type Filter = All \| Active \| Done` |
| `slot` | mutable state | `slot count : Int = 0` |
| `effect` | side effects (http, storage, …), with a capability and a policy | `effect save cap=storage.write …` |
| `reducer` | `on=<event>` → `do=<state update>` | `reducer inc on=ui.click(Btn) do= count := count + 1` |
| `tile` | UI | `tile App = column(heading("Hi"), Btn)` |
| `fn` | pure helpers — a `fn` never reads a slot | `fn double(n: Int) -> Int = n * 2` |
| `app` | the root: capabilities, routes, startup effects, theme | below |

```
app MyApp
    caps   = [storage.read, storage.write]
    routes = {"/" -> App, "/404" -> NotFound}
    init   = []
```

## Workflow

1. Read the spec for what you are about to write. `kumiki guide language` is the one document to
   read first; `kumiki guide` lists the rest (stdlib, routing, style, forms, http, lifecycle, …).
2. Write the program.
3. Verify it. All three, every time:

   ```sh
   kumiki check app.kumiki        # parse + typecheck
   kumiki build app.kumiki ./out  # codegen
   kumiki smoke app.kumiki        # mount it in a headless DOM and click through it
   ```

   `check` and `build` do not prove the app runs. A program can typecheck and build, then throw
   or render nothing when used. `smoke` catches that; a scenario (`kumiki guide iterate`) catches
   wrong behavior. Do not call an app done before both.
4. On a diagnostic, `kumiki guide debug`.

The MCP server `@kumikijs/mcp` offers the same verbs as tools (`kumiki_check`, `kumiki_build`,
`kumiki_smoke`, `kumiki_guide`, …).

## Idioms that trip people up

Each of these is a diagnostic when you get it wrong; `kumiki guide <code>` explains it in full.

- **Two `nominal` types over one base are two types** (`E0201`). `postId := userId` is refused,
  and so is `postId == userId`. Convert through a `fn` whose body reaches the base:
  `fn toUser(p: PostId) -> UserId = p + ""` (the identity body `= p` is the same error).
- **One write per path shape per reducer** (`E0601`). Chain instead of writing a slot twice:
  `tasks := tasks.remove(id).filter(pred)`. `tasks[id].status` and `tasks[id].updatedAt` are
  different shapes and may both be written.
- **A member belongs to the receivers the stdlib lists it for** (`E0108`): a `List` has
  `.length`, a `Map` / `Set` has `.size`; `.toggle` is on `Set` only. Convert first
  (`st.to-list.map(…)`).
- **A `fn` reads no slot** (`E0305`); pass the value in as an argument.
- **Records are updated by copy**: `profile.copy(age = profile.age + 1)`.
- **Duration literals** (`300ms`, `1h`) belong to effect policies; in an expression, use
  `Duration.h(1)`.
- **Lambdas** use positional binders: `$1`, `$2` (`$2` is the value when iterating a `Map`).
- **Events** carry `$el` (the element's data), `$event`, and in route reducers `$route`.
- **Form validation lives in the type.** Put the rule on the slot or record field
  (`Text where nonempty`, `Int where between(13, 120)`), bind the input, and show
  `error(field=…)` beside it; the form's `ui.submit` reducer runs only when every bound field
  passes.

