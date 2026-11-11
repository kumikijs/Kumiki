---
name: kumiki-debug
description: Diagnose and fix Kumiki compiler errors. Use when `kumiki check`/`build` reports a diagnostic (E0001..E08xx, W02xx) or a parse error, or when a built Kumiki app misbehaves in the browser. Covers the error/warning catalog, common root causes, and the auto-fix tool.
---

# Debugging Kumiki

## First: get the diagnostic

```sh
pnpm kumiki check <file>
```

Or `kumiki_check` via `@kumikijs/mcp`. Each diagnostic prints as one line that leads with its severity — `error E0103 undef-ref at 4:30: …` or `warning W0212 … at 2:17: …` — and has a stable `code` documented in `docs/spec/errors.md`. Read that entry first — it states the rule and the fix.

## Error code map (see docs/spec/errors.md for detail)

| code | meaning | usual fix |
|---|---|---|
| `E0001` | `app.routes` missing `/404` (`missing-404`), its `/404` written as a redirect (`404-is-redirect`), or a `sub-routes` entry at `/404` (`404-in-sub-routes`) | route `/404` to a tile in `app.routes`: `"/404" -> NotFound`; remove a `/404` entry from `sub-routes` — the app's `/404` is the only one |
| `E0003` | no `app` definition (an empty file counts) | add the `app` entry point; expected while a program is still being assembled with the editing verbs, which do not enforce it |
| `E0004` | more than one `app` definition — codegen keeps the first and drops the rest | remove or merge the extra; `replace` the app instead of adding a second |
| `E0005` | a tile expands into itself, directly or through other tiles | break the loop — repetition belongs in `for`, alternatives in `when` / `match` |
| `E0006` | a `fn` calls itself, directly or through other functions | rewrite as `fold` / `map` / `filter` over the data |
| `E0007` | two definitions of one layer share a name — only one of them takes effect | delete or rename one |
| `E0008` | a name written twice inside one construct (app/effect/tile clause, record key or field, map key, tile argument or prop, fn/type parameter, `for-all` generator, union tag, route pattern) | delete the later one |
| `E0009` | a `type` resolves to itself — the alias chain returns to a name on it without reaching a record, union, container or primitive | give one name on the chain a body; a recursive type wants a record or union where it names itself |
| `E0010` | `->>` redirects written for static paths send a path back to itself (`"/a" ->> "/b"`, `"/b" ->> "/a"`) — a loop through a `:param` or `*` passes check and is stopped at run time with `[kumiki] redirect loop` on `console.error` | point one redirect on the cycle at a path a route renders |
| `E0102` | undefined reducer in a handler | fix the reducer name; try `kumiki_fix` |
| `E0103` | undefined name / slot — including a `let`, `for` bind, match-arm pattern or `let … in` name read outside the scope that declared it. When the same definition reads it after that scope — a reducer's `if` branch, `for` body or match arm, a `let … in` body, a tile's `for` body, an arm of a `match` expression — the message says which (`— it was declared in a "for" loop, …`) and the diagnostic carries `endedScope` | declare it, or fix the spelling; for a name a scope declared a rename is not the repair — see Auto-fix below |
| `E0104` | undefined effect in `emit`, `app.init`, or an `on=<effect>.ok/.err` selector | declare the effect or fix the name |
| `E0105` | undefined tile (incl. route target) — where a tile is expected, a name that is neither a tile nor a value; a variant tag is not looked up as a value there, so `when(c, Circle)` is E0105 too | declare the tile or fix the name; try `kumiki_fix` |
| `E0108` | `recv.m` where `m` is neither a field nor a member of **that** receiver (`docs/spec/stdlib.md`) — a member of another receiver is not one: `xs.size` on a `List`, `res.filter(…)` on a `Result`, `opt.keys`, `st.map(…)` on a `Set` | use the receiver's own spelling (`List.length`, `Map` / `Set` `.size`), or convert to a receiver that has the member — `res.to-option.filter(…)`, `st.to-list.map(…)`; the message names the receivers that do have it |
| `E0117` | a type name resolves to nothing | fix the spelling, define the type, or add it to the enclosing `type`'s parameter list; try `kumiki_fix` |
| `E0124` | `T.fresh()` / `T.parse(t)` / `T.show(v)` qualified by a type constructor (`List`, `Map`, `Tuple`, a `type Box(T)`) | name the application as a type — `type IntBox = Box(Int)` — and qualify with that: `IntBox.fresh()`. For `parse` the applied type also needs a base with a text reading — a container has none (E0802), so parse the parts and build it in a `fn`. `kumiki_fix` skips it |
| `E0125` | a `->>` target names a `:param` (or `*`) its source does not bind — it would land in the URL as written | name what the source binds (`"/old/:id" ->> "/items/:id"`); a `*` target wants a `/*` source |
| `E0118` | `app.theme` names neither a `theme` definition nor a slot | fix the spelling, or declare the theme; try `kumiki_fix` |
| `E0119` | `$route` in a reducer the runtime does not bind one in (anything but `route.enter` / `route.leave` / `route.error` and a link's prefetch target) | read the `route` slot instead; try `kumiki_fix` |
| `E0120` | `route` or `$route` in an `app.init` argument — those are evaluated while the app object is built, before any mount installs a route | move the read into a `route.enter` reducer; reading the `route` slot does **not** help here |
| `E0128` | a value where a tile is expected: a non-value builtin's positional argument (`column(n)`), a `when` / `if` / `for` / `match` arm, a tile body or a tile-test's `expect` (`when(c, total)`, `for x in xs x`), or a builtin tile's name without its call as a child (`column(divider)`) | show the value with a tile — `text(total.show)`; call the builtin — `divider()`. Not a rename: `kumiki_fix` skips it |
| `E0201` | a value does not have the type its position requires (slot init, assignment, `fn` argument / return, tile `in=`, operator operand, and a comparison's **pair** — `Operator "==" cannot compare PostId with UserId`) | correct the value, or widen the declared type. Two `nominal` types over one base are distinct for assignment **and** for `==` / `!=` / `<` / `<=` / `>` / `>=`, so a deliberate conversion goes through the **base**: `fn toUser(p: PostId) -> UserId = p + ""`, never `= p`, which is this same error — and compare through that `fn` too. A nominal against its own base (`cents == 0`, `postId == ""`) is fine. `T.fresh()` is a `T` and `T.parse(t)` an `Option(T)`, so a mistyped qualifier at the mint (`postId := UserId.fresh()`) is this error too |
| `E0202` | an `emit` argument does not match the effect's `in=` | pass a value of the declared type |
| `E0211` | a reducer's `ui.*` selector or `tile.mount` / `tile.unmount` names an undeclared tile | declare the tile or fix the name; try `kumiki_fix` |
| `E0213` | wrong argument count: `fn` call, `emit`, user-tile call, or variant payload | pass the declared number |
| `E0214` | a record literal is missing a declared field | supply it — Kumiki records have no optional fields |
| `E0215` | a record literal / `.copy(f=v)` names a field the type does not have, or a `map-request` writes a field its capability's request does not have (http.md: `headrs` on `http.get`) | fix the name, or declare it on the type; in a `map-request`, use a field the message lists — `timeout` / `credentials` go in `app.http`, and a field a host provider reads belongs on a custom capability |
| `E0216` | a variant constructor names a tag the union does not have | use a declared tag; try `kumiki_fix` |
| `E0217` | an `Int` literal outside ±(2^53-1) would be rounded | use a value in range, or carry it as `Text` |
| `E0218` | a `for` iterates something whose decided type is not a `List` — a `Map`, a `Set`, an `Option` / `Result` not yet unwrapped, a `Text`, an `Int`, a record | `m.keys` / `s.to-list` (`kumiki fix` appends it); unwrap an `Option` / `Result` of a List with `.get-or([])`, any other with a `match`; `t.split(sep)`; otherwise iterate the List you meant |
| `E0219` | `strict` on a bind control kind — `input`, `textarea`, `select`, `slider`, `check`, `switch`, `radio`, `editable` — with or without `bind=` (`input(bind=s, strict=false)`) — a prop an earlier forms spec described and nothing implemented | remove it; a refused bind is always refused, and `error(field=s)` beside the control shows why |
| `E0220` | an `error-boundary` fallback declares an `in=` `PanicInfo` does not fit, or reads `$1` with no `in=` | declare `in=PanicInfo` on the fallback and read `$1.message` etc.; a fallback that never reads `$1` may keep no `in=` (and so stay a route target) |
| `E0225` | a `radio` has `bind=` but no `value=` — it would write `undefined` into the slot when chosen | give it the value it stands for, one radio per value the slot holds |
| `E0226` | an `input` binds a type its field kind does not go with — a `Time` in a `type="time"` / `month` / `week` / untyped field, an `Int` / `Float` outside `type="number"`, or a `Bool` / record / whole `Option` | `Int`/`Float` → `type="number"`, `Time` → `type="date"` / `"datetime-local"`; bind an `Option`'s payload with `.get` |
| `E0227` | a `match` used as a value has no arm for some value of its scrutinee's type — the message names each one as a pattern (`Blue`, `None`, `(Some(_), Green)`) | add an arm for each value listed, or end the `match` with `_ -> …`. A `match` statement in a reducer and a tile `match` are not held to it |
| `E0228` | a `route.enter` / `route.leave` / `route.error` pattern is not the key of an entry that renders a tile (`->`, not `->>`), in `app.routes` or a `sub-routes` map — a typo, `"/*"` written as "every route", or a `->>` redirect key | write the declared key exactly as the route table spells it; the message lists them. A sub-route key fires on entering that child, beside its parent's |
| `E0229` | a `bind=` target's root is not a slot where it is written — a `for` variable (`for t in todos input(bind=t.text)`), a tile's `$1`, a `match` binding, a literal (`bind="title"`), `route`, or a computed value. It checks, builds and mounts, but the field's edits reach no slot the page reads | bind the slot or a path into it (`bind=title`, `bind=form.email`, `bind=rows[i].title`); inside a `match` on an Option, bind the slot's path (`\| Some(_) -> input(bind=draft.get.title)`), not the arm's name. To edit a row, bind it through the slot — a Map entry by its key (`for k in m.keys input(bind=m[k].text)`), a List element by an index the page holds (`bind=rows[i].text`) — or show it with `value=`, carry its key in props, and write the list from a reducer on the row's event. Move the route with `link(to=…)` or `emit navigate(…)` |
| `E0230` | `error` names no slot or path into one — a literal (`field="email"`), a local (`for` variable, `$1`), a member (`.length`), a step into a `Tuple` or union, a call, an expression, an index with a computed key (`rows[i]`), an index into something not a `List`, `Map` or `Set` (`form[0]`), or no `field=` at all, which a `{field: …}` in a tile-test's `expect` is | name the slot (`error(field=form)`, any failure in it) or a path into it (`error(field=form.email)`, `error(field=rows[0].email)`) |
| `E0231` | a `type` is declared under a name that already means a type in every program: a primitive (`Text`, `Int`, `Float`, `Bool`, `Unit`, `Bytes`, `Time`, `File`, `EffectId`), a built-in type constructor (`List`, `Option`, `Map`, `Set`, `Result`, `Tuple`), or a name the runtime or the standard library supplies values of (`PanicInfo`, `RouteErrorInfo`, `Route`, `HttpError`, `HttpStatus`, `Duration`, `FormValue`). Uses of the name keep the built-in type, so the program's definition is never what they mean | rename the program's type (`type AppPanic = {…}`, `type Box(T) = {v: T}`) along with every use that meant it; a declaration that meant the built-in type itself is not needed: delete it |
| `E0232` | an index read into a `Set` — `s[x]` in a tile, a `fn`, a condition, a right-hand side, a `bind=` target or an `error(field=…)` path, however the Set is reached; a Set has members, not places | read membership with `s.has(x)` (a `Bool`); show it in a `check` with `value=s.has(x)` and toggle it with `s := s.toggle(x)`; for a value stored under a key, declare a `Map(K, V)`; in `error(field=…)`, name the Set slot itself (`error(field=s)`) |
| `E0233` | a `latest-per-key` key's type is, or holds, a `Float`, a `File` or a `Set` — a Float or File key would make two values `==` calls different one key, so one request would abort the other, and a Set's `==` depends on how it was built | key on a field that identifies the request (`$1.id`), a Float's `.show`, a File's `{name: $1.name, size: $1.size}`, or a record of such fields |
| `E0234` | an `effect` is declared under a standard effect's name — `navigate`, `navigate-replace`, `navigate-back`, `scroll-to`, `toast`, `confirm`, `log`. The runtime registers the built-in under that name at mount, so the declaration would never run | rename it with every `emit` and `.ok` / `.err` that meant it (`kumiki rename <file> effect.log logRequest`); an `emit` written for the built-in keeps an `E0202` after that rename, which is then refused, so rename by hand and leave that `emit` alone. A declaration that only restates the standard effect is deleted: delete its line directly (not `kumiki remove`, which counts the emits as references) and emit the standard effect undeclared |
| `W0213` | a handler prop sits on a tile whose renderer never calls it — a builtin (`row(onClick=r)`: "a row fires "click", and its renderer never calls onClick"), or a user tile whose render tree has no kind that calls it (`Inner(onClick=r)` where `Inner = box(...)`: "renders nothing that calls it: … (observed in body: …)"; "renders nothing that fires it" where the event is one its kinds do not fire), or `onFocus` / `onBlur` on a `check` / `radio` / `switch` / `details`, or on a user tile whose root is one, whose focus does not bubble to the wrapper the handler is on ("the runtime listens for "focus" on a check's <label>, and the "focus" its <input> fires does not bubble to the <label>") | move it onto the button / input — inside the user tile, so its root is the firing one — or subscribe with `on=ui.<ev>(<Tile>)`. For `onFocus` / `onBlur` on a wrapped control, `ui.focus` / `ui.blur` on that same tile is W0212: subscribe on a tile that takes focus itself (an `input`) |
| `W0216` | `value` on a `check` / `switch` / `slider`, or `selected` on a `radio`, beside a `bind`, each as a named argument or in the `{…}` block — not read; the bound value decides the selection | remove it, or drop the `bind` and keep `value` with a reducer |
| `E0301` | effect needs a capability not in `app.caps` — including a standard effect (`navigate`, `toast`, `log`, …), which is gated on the cap it is registered behind | add the cap to `caps = [...]` |
| `E0304` | a slot's initial value reads a slot (its own or another's, or `route` — directly or through a `fn`) | give it a standalone value and derive the rest in a `fn`; for `route`, fill the slot from a `route.enter` reducer |
| `E0305` | a `fn` reads a slot | pass the value as an argument |
| `E0306` | a storage / session / indexed effect declares `out=Result(T, E)` with `E` not `Text` — its failure arrives as the message, a `Text` | declare `out=Result(T, Text)` and read `$e` as the message (not `$e.message`) |
| `E0601` | a slot path-shape is written twice in one reducer | chain the writes into one assignment |
| `E0701`–`E0703` | a11y: button/image/link missing text/alt/aria | add visible text or `aria-label`/`alt` |
| `E0801` | `obj.method(...)` calls a method the runtime doesn't implement (typo, or unimplemented/wrong-type method like `Option.to-result`) | fix the name or rewrite with an implemented op (`match`, `fold`, …); see `KNOWN_METHODS` / docs/spec/stdlib.md |
| `E0804` | a `where` refinement cannot build a check that passes anything — a text bound on `between`, a fractional or negative length, `len-lt(0)`, a `regex` pattern that does not compile, an empty `one-of` or one whose literals are not values of its base (`Text where one-of(1)`), or a predicate over a base it does not test (`Text where positive`, `Int where nonempty`, a generic applied as `NonEmpty(Int)`) | write the arguments the predicate takes, over the base it tests; the tables are in docs/spec/language.md (refinements) and errors.md E0804 |
| `E0000` | parse error (from the lexer/parser) | check the position; look for a missing `)` / wrong keyword |
| `W0212` | `ui.<ev>(Tile)` reducer subscribes to a tile where `<ev>` never reaches it — no descendant fires it, a check / radio / switch / details takes focus inside a wrapper that never runs the reducer (`focus` / `blur` do not bubble to it, and a `<details>` gets no `key` listener because it would hear its panel too), or the renderer never calls the handler (a `text` fires `click`, and its renderer never calls `onClick`); the message says which — silent no-op | re-target the selector at a tile in the event's row of the allowed-kinds table in docs/spec/errors.md (an `input` for `focus` / `blur`, a `button` for `click`). `onFocus=` written on a check does not run either, and W0213 reports it. A key on a details's summary reaches `details(…, onKeyDown=r)`. |

## Auto-fix

For name-resolution errors, the compiler can suggest the closest existing name. `E0104` (effects + the standard effects), `E0106` (timer names), `E0116` (fn + built-in calls; variant tags for `undef-variant`; tags, types and namespaces for `undef-qualifier`), `E0117` (type names), `E0118` (theme + slot names), `E0209` / `E0216` (variant tags) are scoped to their own namespace, so a slot is never proposed where a type belongs; `E0102`, `E0103`, `E0105`, `E0107` and `E0211` search all top-level definitions. An `E0103` whose message says the name `was declared in` an `if` branch, a `for` loop or a match arm, a tile's `for` or an arm of a `match` expression, or `by a "let … in"` (the diagnostic's `endedScope` is set) is a read after that scope ended, not a misspelling, and `fix` proposes no rename for it: a renamed read can type-check, and the regression gate then counts it as resolved. A dry run with other patches to show lists it under `(no auto-patch for …)` as `[e0103-read-after-scope-ended]`; otherwise `fix` prints `(no auto-patches available)`. Not every out-of-scope name is hinted, and `fix` still proposes a rename for the rest: a read before the scope that declares the name, unless an earlier scope in the same definition already ended that name (the hint then names that scope); a read in another definition than the one that declares it; an assignment (`:=`, `undef-slot`) to a name a body declared; a fragment's `$1` / `$2` read after the fragment. So do not apply a rename `fix` proposes for an `E0103` until you know the name is misspelled rather than out of scope — it would read a different value and can still type-check. Repair an out-of-scope read by what declared the name:

- a `for` bind, or a `let` in a loop body: a name carries no value out of a loop, and a bind cannot move before its loop — move the read into the body, or write the value to a slot there;
- a `let` in an `if` branch or match arm, or an arm's pattern: declare it once before the statement with an `if` / match expression (`let n = if c then … else …`; a `let n = 0` there is only shadowed by the body's own `n`), or move the read into the branch or arm that declares it;
- a `let … in` name: move the read into the expression after `in`, or bind the value once where both reads see it — with a `let` statement in a reducer; with one `let … in` around both reads in a `fn` or a slot initializer; in a tile, by moving both reads into a tile that declares `in=` and passing it the value. The entries of `app.init` share no expression, so there only the move works;
- a tile's `for` variable, or a `match` expression arm's pattern: move the read into the loop's body or into that arm, or for a read in a later arm of the same `match` expression, into the arm that declares it;
- a read before the body that declares the name: move the read into that body, after the declaration.

When two or more names are equally close (`count` beside `countA` and `countB`), `fix` proposes none — picking one would be a guess — and leaves the error for you to resolve: its skip reason is `close-names-tied`, with the tied names in the skip's `candidates`. A name the program declares does outrank a built-in one at the same distance (`Filtre` → the declared `Filter`, not the built-in `File`).

```sh
pnpm kumiki fix <file>          # show planned fixes
pnpm kumiki fix <file> --apply  # apply them
```

Both forms exit `1` while the file still has errors, so the first one exits `1`
whenever it has anything to propose — that is the proposal succeeding, not
failing. Read the output, not the code, until `--apply` reports the file clean.

Or `kumiki_fix` via `@kumikijs/mcp`.

## Warnings (W-codes)

Warnings — the lines that start with `warning` — are non-fatal: `kumiki check` exits 0 and prints `ok (N warning(s))`. They still indicate real bugs: `W0212` and `W0213` flag a subscription or handler that never fires, so its reducer never runs. If `smoke` reports "interaction did nothing," scan the warning lines first.

## "It checks but misbehaves at runtime"

`check`/`build` prove parse + typecheck + codegen; they do NOT prove the app runs. First reach for the runtime smoke test, which mounts the app in a headless DOM and drives its UI:

```sh
pnpm kumiki smoke <file>
```

Or `kumiki_smoke` via `@kumikijs/mcp`. It reports the failing phase and the interaction that triggered it (e.g. `[interaction] (...).to_result is not a function (on input input[0])`) — catching throws, empty renders, and unhandled rejections that compilation misses.

There are three verification layers; each catches what the previous cannot:

1. **`check` / `build`** — syntax, types, codegen.
2. **`smoke`** — *does it run?* mount + auto-exercise; catches runtime throws / empty render. Generic, no per-app knowledge.
3. **scenarios** (`kumiki run <file> <scenario.json>`, and `<name>.scenario.json` beside an example) — *is the result correct?* the only layer that catches wrong-but-non-throwing behavior (e.g. a select that always yields the last option). Smoke cannot judge correctness, only liveness.

When you find a runtime bug: add a minimal reproducing `packages/examples/features/*.kumiki` with a `.scenario.json` that pins the correct behavior (CI compiles, smokes and runs every example), then fix. Most runtime bugs are a wrong method dispatch (List vs Map vs Option), a method the runtime doesn't implement, a missing `key=` on a `for`-rendered tile, or a bind-path issue. Runtime fixes live in `packages/runtime/src/`; codegen fixes in `packages/compiler/src/codegen/`. Keep `pnpm exec turbo run typecheck test build && pnpm lint` green.
