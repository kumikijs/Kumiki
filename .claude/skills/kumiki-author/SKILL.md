---
name: kumiki-author
description: Author Kumiki programs (.kumiki files). Use when writing or extending a Kumiki app — the 7-layer model, idioms for state/effects/UI, and how to verify with the compiler. Kumiki is the declarative app language in this repo (packages/compiler, packages/runtime).
---

# Authoring Kumiki

Kumiki is a declarative front-end app language. A program is a set of definitions across **7 layers** plus an optional theme. There are no files-as-modules; each definition is independent.

## The 7 layers

| layer | role | example |
|---|---|---|
| `type` | domain types: nominal, union, record, refinement | `type Filter = All \| Active \| Done` |
| `slot` | mutable state | `slot count : Int = 0` |
| `effect` | side effects (http/storage), with capability + policy | `effect save cap=storage.write ...` |
| `reducer` | `on=<event>` → `do=<state update>` | `reducer inc on=ui.click(Btn) do= count := count + 1` |
| `tile` | UI components | `tile App = column(heading("Hi"), Btn)` |
| `fn` | pure helpers (must NOT read slots) | `fn double(n: Int) -> Int = n * 2` |
| `app` | the root: caps, routes, init, theme | see below |

```
app MyApp
    caps   = [storage.read, storage.write]
    routes = {"/" -> App, "/404" -> NotFound}
    init   = []
    theme  = DefaultTheme
```

`routes` must include a `/404` entry (error E0001). Use `->>` for redirects: `"/old" ->> "/"`.

## Workflow (always verify)

1. Read the relevant spec under `docs/spec/` (language, stdlib, routing, style, forms, http, lifecycle).
2. Find the closest example in `packages/examples/features/` (one feature each) or `packages/examples/apps/` (size-ordered full apps). Copy its shape.
3. Write the program.
4. **Verify before claiming done** — three layers, run all of them:
   ```sh
   pnpm --filter @kumiki/cli exec tsx src/kumiki.ts check <file>        # parse + typecheck
   pnpm --filter @kumiki/cli exec tsx src/kumiki.ts build <file> ./out  # codegen
   pnpm --filter @kumiki/cli exec tsx src/kumiki.ts smoke <file>        # mount + exercise (headless DOM)
   ```
   Or via the `@kumiki/mcp` tools `kumiki_check` / `kumiki_build` / `kumiki_smoke`.

   **`check` and `build` do NOT prove it runs.** A program can typecheck and
   codegen yet throw or render nothing when actually used (e.g. calling a method
   the runtime doesn't implement). `kumiki smoke` mounts the app and drives every
   button / input / select, catching that class of bug without a human in a
   browser. Always smoke before claiming an app works.

## Idioms that trip people up

- **Duration literals** like `1h` only work inside effect policy (`debounce(300ms)`). In expressions use constructors: `now.plus(Duration.h(1))`.
- **Immutable record update**: `profile.copy(age = profile.age + 1)`.
- **Two `nominal` types over one base are two types** (E0201): `postId := userId` is refused even when both are `nominal Text where uuid`. The base still flows in and out — `slot c : Cents = 1` and `c := c + 1` need no cast — so a deliberate conversion is a `fn` whose return type is the target *and whose body reaches the base*: `fn toUser(p: PostId) -> UserId = p + ""`. The identity body (`= p`) is the same E0201.
- **One write per path-shape per reducer** (E0601): chain instead of writing the same slot twice — `tasks := tasks.remove(id).filter(pred)`. Note `tasks[id].status` and `tasks[id].updatedAt` are *different* shapes and may coexist.
- **Map/Set/Option/List methods are polymorphic**: `.filter`, `.map`, `.get-or`, `.has`, `.toggle`, `.remove`, `.keys`, `.size`.
- **Variant payloads in match**: `match opt with | None -> ... | Some(x) -> ...`.
- **Lambdas** use `$1`, `$2` positional binders (`$2` is the value in Map iteration).
- **Events** expose `$el` (element data), `$event`, and in route reducers `$route`.
- **`fn` purity**: a `fn` reading a slot is error E0305 — pass the value as an argument instead.

See `docs/spec/errors.md` for the full diagnostic catalog. When you hit an error you can't resolve, switch to the `kumiki-debug` skill.
