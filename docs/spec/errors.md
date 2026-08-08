# Error Code Specification

The diagnostics reported by the Kumiki compiler (`@kumikijs/compiler`) split into two families: **parse errors** and **type-check errors**. This document enumerates both normatively. If a code is added or changed on the implementation side, this document must be updated at the same time.

## The Form of an Error

A type-check error is represented as a `KumikiError`:

```ts
type KumikiError = {
  code: string;     // a stable identifier such as "E0103"
  kind: string;     // a machine-readable classification such as "undef-slot"
  message: string;  // a human-facing message (includes the target name)
  pos: Pos;         // { line, col }
  severity?: "error" | "warning"; // omitted ⇒ "error"
};
```

`code` is a permanent contract; once assigned, its meaning does not change. `kind` is a sub-classification under the same `code`, used to branch diagnostic logic. `severity` defaults to `"error"`: a missing field means the same as `"error"` for backward compatibility with existing diagnostics. The `"warning"` tier is non-fatal — it is surfaced to stderr (CLI) and to Rollup's `this.warn` (Vite) but does not change the exit code or block the build.

A parse error is `throw`n as a `ParseError` (`message` + `pos`). Because the parse stage stops at the first error, no code is assigned.

Coded diagnostics are emitted only by `packages/compiler/src/typecheck.ts`. The lexer throws `LexError` and the parser throws `ParseError` — both carry `message` + `pos` but no `code`, by design (single-shot; no recovery). The mechanized spec-drift guard (`packages/compiler/test/spec-drift.test.ts`) therefore extracts implementation-side codes from `typecheck.ts` only.

## The Code System

| Band | Domain |
|---|---|
| `E00xx` | App structure (such as mandatory routing requirements) |
| `E01xx` | Name resolution (undefined references, reserved names) |
| `E02xx` | Type mismatch |
| `E03xx` | Capabilities and purity |
| `E04xx` | Motion |
| `E06xx` | reducer write rules |
| `E07xx` | Opt-in checks: accessibility (a11y), strict-icons, testing-DSL invariants |
| `E08xx` | Runtime hazards (code that compiles but breaks at runtime) |
| `W02xx` | Non-fatal warnings (build still succeeds) |

## Auto-patch Coverage

`kumiki fix` (and `kumiki fix --apply`) rewrites source deterministically for a
subset of diagnostics. All applied patches pass through a regression gate:
the composed source is re-parsed and re-typechecked before the write commits,
and the write is rolled back whenever the resulting diagnostic set introduces
a new failure OR fails to resolve any pre-existing one (the comparison is by
`code@line:col`, not raw count, so a 1-for-1 swap like `E0301 → E0302 via a
typo` is caught rather than accepted).

| Code | Auto-patch | Strategy |
|---|---|---|
| `E0001` | yes | Inject a `NotFound` tile and add `"/404" -> NotFound` to `app.routes`. |
| `E0102` | yes | Close-name suggestion (Levenshtein ≤ 2 or ≤ 25%) against known reducer names. |
| `E0103` | yes | Close-name suggestion against known slot / binding names. |
| `E0104` | yes | Close-name suggestion against known effect names. |
| `E0105` | yes | Close-name suggestion against known tile names. |
| `E0107` | yes | Close-name suggestion against declared motion names. |
| `E0116` | yes | Close-name suggestion against declared `fn` names plus the built-in calls (scoped — a slot or tile whose name is close is not a candidate). |
| `E0211` | yes | Close-name suggestion against declared tile names for the selector target. |
| `E0301` | yes | Append the required capability to the app's `caps = [...]` array. |
| `E0106` | yes | Close-name suggestion against timer names collected from `on=timer(d, name=N)` triggers (scoped — top-level defs are not candidates). |
| `E0209` | yes | Close-name suggestion against variant tags of the scrutinee union (built-in `Option` / `Result` plus user `TypeDef` bodies, resolved through aliases). |
| `E0117` | yes | Close-name suggestion against type names — the program's own `type` definitions first, then the primitives, the standard library's domain types, and the generic constructors (scoped — a slot or fn whose name is close is not a candidate). |
| `E0216` | yes | Close-name suggestion against variant tags of the declared union, the same resolution E0209 uses on the pattern side. |
| `E0210` | no | Adding type arguments requires synthesizing user-intent — outside static repair. |
| `E0003` | no | Synthesizing an entry point means choosing a root tile, a route table and a capability set — user intent, not static repair. |
| `E0004` | no | Which of the apps is the intended one, and whether the other's routes should be merged in, is user intent. |
| `E0005` | no | Which edge of the loop is the mistaken one, and what the tile should render there instead, is user intent. |
| `E0006` | no | Rewriting recursion as a fold over data is a change of algorithm, not a substitution. |
| `E0304` | no | Where the derived value should be computed — a `fn`, or a reducer that runs once on entry — is user intent. |
| Others | no | Not currently auto-repairable (open an issue if a common shape emerges). |

Behavioral repair from a failing `test` (`kumiki fix --auto-patch <test-name>`)
is a separate tier and works whenever the failing leaf can be traced to a
unique source position:

- Exact literal match on string / number / boolean, with **scope-aware
  disambiguation**: the target tile / reducer's own line range is preferred
  over its dependencies, which are preferred over unrelated code.
- **String prefix/suffix repair**: swap only the divergent middle when
  `actual` and `expected` share a common prefix and suffix.
- **Reducer arithmetic repair**: rewrite `slot := slot ± N` to match the
  expected delta (sign flip and/or operand change) when exactly one reducer
  writes the failing slot.

## E00xx — Structure

### E0001 `missing-404`

An app that declares `app.routes` must include a route for the `/404` pattern. Unmatched paths fall back here.

> `app.routes must include a "/404" entry`

**Fix**: Add a route to a 404 tile, such as `route "/404" -> NotFound`. See [Routing](./routing.md) for details.

### E0002 `duplicate-timer-name`

Two or more `timer(d, name=N)` triggers declare the same timer name `N`. Timer names share one namespace and must be unique across the app, so that `stop-timer(N)` is unambiguous.

> `Timer name "<name>" is declared more than once`

**Fix**: Rename one of the timers so each `name=` is unique. See [timer](./lifecycle.md#_7-1-5-timer).

### E0003 `missing-app`

The program declares no `app` definition, so it has no entry point: there is no route table and no root tile to mount. An empty file is this case too. Reported at `1:1`, because the thing that is missing has no position.

> `Program has no app definition`

Checking is what decides this, not code generation — an unnarrowed `check` that reports `ok` must describe a buildable program. (`--types` / `--refs` / `--effects` narrow the report to one band, so they answer a smaller question; `E00xx` survives them regardless, because no narrowing selects it.) See [Application Entry](./language.md#_1-12-application-entry-app).

The one exception is a program under construction. The [AI-editing](./ai-edit.md) verbs add definitions one at a time, and every edit before the `app` lands would otherwise be rolled back, so they check with the requirement off. `kumiki check` is where an incomplete program is reported.

**Fix**: Add an `app` definition with `caps`, `routes` and `init`.

### E0004 `duplicate-app`

The program declares more than one `app` definition. There is one entry point: code generation reads the first and drops the rest, so a second `app` takes its routes, `caps`, `init` and `theme` out of the artifact without any of them appearing anywhere. Reported once per app past the first, at that definition.

> `Program declares more than one app definition ("<name>")`

Unlike `E0003`, this is not relaxed for a program under construction — one app too few is an unfinished program, one app too many is a wrong one.

**Fix**: Remove or merge the extra definition. To swap an app out, `replace` it, or `remove` the old one before adding the new.

### E0005 `tile-cycle`

A tile expands into itself, directly or through other tiles ([Tile Layer Invariants](./language.md#_1-7-2-invariants), inv. 4). Code generation inlines every child, so a cycle is an infinite tree: without this the build ran out of stack with no position and nothing naming the tiles involved. Reported once per cycle, at the first edge of it — inside the tile the message names.

> `Tile "<name>" expands into itself (<A> → <B> → <A>)`

The edges are the ones code generation follows: nested tile calls, a bare identifier argument standing in for a tile, and the branches of `for` / `when` / `if` / `match`. `sub-routes` and `error-boundary` are not edges — a sub-route is selected by the router through `route-outlet`, and a boundary is applied where a tile is mounted as a route root, so neither is inlined.

**Fix**: Break the loop. Repetition belongs in `for` over a collection, and an alternative rendering in `when` / `match` — neither of which needs a tile to contain itself.

### E0006 `fn-cycle`

A `fn` calls itself, directly or through other functions ([fn Layer Invariants](./language.md#_1-8-3-invariants), inv. 5). Direct recursion is prohibited outright, and mutual recursion is admitted only where the depth can be proven at the type level — which the language has no form for, so every loop in the call graph is reported. Reported once per cycle, at the first call of it.

> `fn "<name>" calls itself (<f> → <g> → <f>)`

**Fix**: Express the repetition over data instead — `fold` / `map` / `filter` over a `List` terminate by construction, which is what the invariant is protecting.

## E01xx — Name Resolution

### E0102 `undef-reducer`

An event handler argument / prop refers to a reducer name that does not exist.

> `Reference to undefined reducer "<name>"`

**Fix**: Check the spelling of the reducer name. `kumiki fix` can suggest a close name (→ [AI Editing](./ai-edit.md)).

### E0103 `undef-ref` / `undef-slot`

- `undef-ref`: An undefined name was referenced in an expression.
  > `Reference to undefined name "<name>"`
- `undef-slot`: An assignment was made to an undefined slot in a reducer body.
  > `Assignment to undefined slot "<name>"`

**Fix**: Confirm that the referenced slot / binding is declared.

### E0104 `undef-effect` / `init-not-effect-call`

The target of an `emit` refers to an undefined effect. An `app.init` entry is validated the same way — the grammar makes it an effect call ([§1.12](./language.md#_1-12-application-entry-app)), so the same capability and argument checks apply, and the built-in effects (`toast`, `navigate`, `log`, …) are equally legal there.

> `Reference to undefined effect "<name>"`

An init entry that is not a call at all takes the `init-not-effect-call` kind. Code generation has nothing to lower it to; before the diagnostic existed it emitted `null` into the init array and the dispatcher read `.effect` off it at mount, so the app died with a raw `TypeError` and no position.

> `app.init entries must be effect calls`

### E0106 `undef-timer`

A `stop-timer(N)` statement refers to a timer name `N` that no `timer(d, name=N)` trigger declares.

> `stop-timer refers to undefined timer name "<name>"`

**Fix**: Check the spelling, or declare the timer with `timer(d, name=N)`. `kumiki fix` can suggest a close name (→ [AI Editing](./ai-edit.md)). See [timer](./lifecycle.md#_7-1-5-timer).

### E0105 `undef-tile`

A tile reference, or the target of a route definition, refers to an undefined tile.

> `Reference to undefined tile "<name>"`
> `Route "<path>" targets undefined tile "<name>"`

### E0107 `undef-motion`

A tile's `motion: "<name>"` prop refers to a motion that no `motion <name> = {…}` definition declares.

> `Reference to undefined motion "<name>"`

**Fix**: Check the spelling, or declare the motion. See [The motion definition](./style.md#_4-9-1-the-motion-definition).

### E0108 `undef-member`

A `recv.member` access where the **inferred type** of `recv` is known, but `member` is neither a field of that type nor a stdlib method/shortcut for it (ADR-002). This catches a typo (`list.frist`) or a member used on the wrong shape (`record.head` where the record has no `head` field). When the receiver type can't be inferred, no error is raised — the name-based shortcut dispatch is used instead.

> `Record type has no field or method ".<member>"` / `Type "<T>" has no member ".<member>"`

**Fix**: Correct the member name, or — if `recv` is a record — use a field that exists. See [List(T)](./stdlib.md#_2-2-3-list-t).

### E0110 `unknown-token-group`

A `@<group>.<name>` theme-token reference ([Style §4.3](./style.md#_4-3-token-references)) names a `<group>` that is not one of the closed theme namespaces (`colors`, `spacing`, `radius`, `shadow`, `typography`, `breakpoints`).

> `Unknown theme token group "@<group>" (allowed: …)`

**Fix**: Use one of the listed groups (e.g. `@colors.surface`, `@spacing.md`), or — if you wanted a plain identifier — drop the `@` prefix.

### E0109 `test-wildcard-misuse`

A test wildcard (`<any-id>` / `<slots.X>`) appears outside a `reducer-test` `expect` — in a reducer/tile/fn/app body, or in a test's `given`. Wildcards are a matching construct for the expected result only ([Wildcards](./testing.md#_8-2-2-wildcards)); they have no meaning as a value to compute or feed in.

> `Test wildcard "<any-id>" is only valid inside a reducer-test \`expect\``

**Fix**: Remove the wildcard, or move it into the `reducer-test` `expect`.

### E0111 `orphan-sub-routes`

A tile declares `sub-routes` but no entry in `app.routes` targets that tile. The nested route table cannot be reached.

> `Tile "<name>" declares sub-routes but is not the target of any route in app.routes`

**Fix**: Add a route in `app.routes` that targets this tile with a `/*` pattern, or remove the `sub-routes` block.

### E0112 `duplicate-sub-route`

The same sub-route path is declared more than once on a single tile. Match order is positional, so duplicates are either dead code or a typo.

> `Sub-route path "<path>" is declared more than once in tile "<name>"`

**Fix**: Remove the duplicate entry, or rename one of the paths.

### E0113 `sub-routes-without-outlet`

A tile declares `sub-routes` but its body never calls `route-outlet`. The matched child route would have nowhere to render — the page would silently miss its child content even though the compile succeeded.

> `Tile "<name>" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render`

**Fix**: Add a `route-outlet()` somewhere in the tile body where the child should appear, or remove the `sub-routes` block.

### E0114 `sub-routes-without-wildcard-parent`

A tile declares `sub-routes` but its parent route in `app.routes` is not a wildcard (`/*`) pattern. Without a wildcard parent the runtime never reaches the nested matcher, so the sub-routes can never apply. See [Nested Routes](./routing.md#_3-6-nested-routes).

> `Tile "<name>" declares sub-routes but its parent route "<path>" is not a wildcard pattern (must end with "/*")`

**Fix**: Change the parent route's pattern to end with `/*` (e.g. `/settings` → `/settings/*`), or remove the `sub-routes` block.

### E0115 `reserved-slot-name`

A `slot` is declared with a name the compiler resolves before it consults the slot table, so nothing can ever read it. The name is `route`, the router-maintained route slot ([Routing](./routing.md#_3-2-the-route-slot)) — every other such name (`now`, `self`, …) is a reserved word the lexer rejects first. Without this diagnostic the declaration compiles and the slot silently renders the route object instead of its own value.

> `Slot "<name>" collides with <what it collides with>; reads of it never see this slot`

**Fix**: Rename the slot.

### E0116 `undef-call`

A call `f(...)` names no function. The candidate set is the program's `fn` definitions plus the built-in calls, which are spread across three documents:

| Callee | Where it is specified |
|---|---|
| `now`, `fmt`, `panic` | [Standard Library §2.4](./stdlib.md#_2-4-built-in-functions) |
| `Duration.*`, `Bytes.*`, `<T>.fresh` / `.parse` / `.show` | [Standard Library §2.2](./stdlib.md#_2-2-collection-methods), §2.4 |
| `Decoder.*`, `EffectId.none` | [HTTP / Storage §6.1.4](./http.md), [Standard Library §2.1.1.1](./stdlib.md#_2-1-1-1-effectid) |
| `file-url` | [Forms §5.10](./forms.md) |
| `prefers-dark` | [Style §4.6.1](./style.md#_4-6-1-following-os-settings) |

`run-reducer` is not in the set: it lowers only inside a generated property-test trial ([Testing §8.3](./testing.md#_8-3-property-tests)), and a property-test invariant is resolved by its own walk rather than through this check. Writing it anywhere else is an E0116.

> `Call to undefined function "<name>"`

Code generation lowers an unrecognised callee to a call on a binding of the same name, so without this check a misspelling compiles, builds, and throws `<name> is not defined` on the first evaluation. The accepted set is exactly the set code generation can lower — a checker looser than the lowering it guards is what produced that failure, and a stricter one would reject programs that run.

`E0801` is the same relationship for `obj.method(...)`, which is a different expression form and resolved separately.

**Fix**: Correct the spelling, or declare the `fn`.

### E0117 `undef-type`

A type name resolves to nothing: it names no `type` definition, no [standard-library type](./stdlib.md#_2-1-built-in-types), and no type parameter of the enclosing `type` definition.

> `Reference to undefined type "<name>"`

An unresolved name is *opaque*, and an opaque type accepts every value — so before this check `slot v : NoSuchType = 1` was accepted, and so was every subsequent use of `v`. One misspelling turned off value checking for everything downstream of it.

Type parameters are in scope inside the body of the definition that declares them, and only there: `type Box(T) = {v: T}` is fine, `type Box(T) = {v: U}` is not. No other declaration site (`slot`, `fn`, `effect`, `tile in=`) has type parameters, so an unresolved name at one of those is always an error.

**Fix**: Correct the spelling, define the type, or add the name to the enclosing definition's parameter list. `kumiki fix` proposes the closest type name.

## E02xx — Types

### E0201 `type-mismatch`

A value does not have the type its position requires.

> `Expected <declared> but got <actual>`
> `Operator "<op>" expects a number but got <type>`
> `Operator "<op>" expects Bool but got <type>`
> `Operator "<op>" cannot compare <type> with <type>`
> `Condition of "<form>" must be Bool but got <type>`
> `Expected <declared> but got variant "<name>"`
> `Tile "<name>" expects a value of type <type> but got a tile`
> `Event handler arg "<name>" must be a reducer name`
> `Event handler prop "<name>" must be a reducer name`
> `link prefetch must be a reducer name`

The positions with a declared type to check against are: a `slot`'s initial value, the right-hand side of an assignment (through `.field` and `[k]` paths), an argument to a declared `fn`, a `fn` body against its `->` return type, an argument to a user tile that declares `in=`, and the operands of every operator. An `emit` argument is checked too, and reports [E0202](#e0202-emit-arg-type-mismatch).

Assignability is structural, with one implicit conversion — `Int` flows into a `Float` position and never the reverse. Aliases and generic instantiations are followed. `nominal` and `where` wrappers are transparent to it: the refinement is a runtime check ([Forms §5.6](./forms.md#_5-6-validation-strategy)), and two nominals over the same base accept each other. That reads against [§1.3.5](./language.md#_1-3-5-type-canonicalization) and is tracked separately.

**The check is one-sided.** It reports what is definitely wrong and stays silent about everything it cannot resolve — an unknown type name, a method whose result depends on its receiver, a `let` binding of an unresolvable expression. A wrong diagnostic rejects a program that runs; a missing one only fails to add a diagnostic that never existed. So a clean `check` is not a proof of type correctness, and [E0801](#e0801-unimplemented-method) / [E0116](#e0116-undef-call) remain the checks that a name exists at all.

**Fix**: Correct the value, or widen the declared type.

### E0202 `emit-arg-type-mismatch`

An `emit` argument does not match the effect's declared `in=` type.

> `Expected <in-type> but got <actual>`
> `Expected <in-type> but got variant "<name>"`
> `emit "<effect>" expects an EffectId argument`

The `EffectId` case keeps its own wording because its fix is different in kind. It is the shape of a mis-wired cancellation: `emit stopSearch(searchId)` where `searchId : EffectId` is correct, `emit stopSearch(42)` or `emit stopSearch("id")` is not. Codegen would pass the non-`EffectId` value through and the cancel path would silently no-op, indistinguishable from a successful cancel.

Argument *count* is [E0213](#e0213-call-arity-mismatch), not this code.

**Fix**: Pass a value of the declared `in=` type — for `EffectId`, the handle an earlier fire-and-track of the same effect returned — or change the effect's `in=`. See [EffectId](./stdlib.md#_2-1-1-1-effectid) and [emit](./lifecycle.md).

### E0204 `effect-id-misuse`

A value of type `EffectId` is used in an operation that is not defined on it. The only operations on `EffectId` are equality (`==`, `!=`), assignment to a slot of type `EffectId`, and being passed to an effect whose `in` type is `EffectId`. Arithmetic, ordering comparisons, and `text(...)` rendering are rejected — `EffectId` is opaque so the runtime can change its representation without breaking apps.

> `Operator "<op>" cannot be applied to EffectId — only "==" / "!=" are defined`
> `text(...) cannot render EffectId — it is an opaque handle`

**Fix**: Use `==` / `!=` to compare against `EffectId.none`, or pass the value to a cancel effect. See [EffectId](./stdlib.md#_2-1-1-1-effectid).

### E0205 `bind-on-file-input`

`input(type="file")` cannot bind a slot via `bind=`. The `bind=` two-way binding table ([Forms §5.1.1](./forms.md#_5-1-1-elements-that-support-bind)) has no acceptable type for files — files are surfaced through the change event payload instead ([Forms §5.10](./forms.md#_5-10-file-upload)).

> `input(type="file") does not support bind="<name>"; receive files via a ui.change reducer with $event.files.head`

**Fix**: Remove `bind=`, and add a reducer that picks the file from the event:

```kumiki
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", accept="image/*")
reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
```

### E0206 `file-only-prop`

The `accept` and `multiple` props on `input` apply only when `type="file"`. They are rendered onto the underlying `<input>` element, where they are valid HTML only for a file picker ([Forms §5.10](./forms.md#_5-10-file-upload)). Used on any other input type — or when `type` is omitted (it defaults to `"text"`) — they are invalid HTML and a latent bug. The diagnostic fires only when the type is statically known to not be `"file"`; a non-literal `type=` expression is left alone.

> `input prop "accept" requires type="file" (got type="text"); accept/multiple are only valid on file inputs`
> `input prop "multiple" requires type="file" (got no type, defaults to "text"); accept/multiple are only valid on file inputs`

**Fix**: Either add `type="file"` to opt into a file picker, or remove the `accept` / `multiple` prop:

```kumiki
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", accept="image/*", multiple=true)
reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
```

### E0207 `pat-arity-mismatch`

A `match` arm pattern's element count does not agree with the scrutinee's static type. Tuple patterns must have the same arity as their `Tuple(...)` scrutinee; variant patterns must have the same bind count as the variant's payload arity. Without this check, codegen would emit a guard that is always false at runtime — the arm would silently never fire ("compiles but the wrong branch runs").

> `Tuple pattern has <m> item(s) but scrutinee type "Tuple(<…>)" has <n>`
> `Variant "<tag>" pattern has <m> bind(s) but the variant carries <n> payload(s)`

**Fix**: Add or drop pattern elements to match the type. For `Tuple(Int, Int)`, write `(a, b)`. For `Some(T)`, write `Some(x)` (one bind) rather than `Some(x, y)`.

### E0208 `pat-type-mismatch`

A `match` arm pattern's shape does not agree with the scrutinee's static type — for example, a tuple pattern `(a, b)` is used against a scrutinee of type `Int`, or a variant pattern `Some(x)` is used against a record type. The pattern can never structurally match, so the arm is dead at compile time.

> `Tuple pattern cannot match scrutinee of type "<T>"`
> `Variant pattern "<tag>" cannot match scrutinee of type "<T>"`

**Fix**: Use a pattern whose shape matches the scrutinee. If the scrutinee really should be a union or a tuple, fix its declared type instead.

### E0209 `pat-unknown-variant`

A `match` arm names a variant tag that is not declared by the scrutinee's union type. Built-in unions (`Option(T)` admits `Some` / `None`; `Result(T, E)` admits `Ok` / `Err`) and user-declared `type X = A | B(…) | …` definitions are both checked.

> `Variant "<tag>" is not a member of scrutinee type "<T>"`

**Fix**: Correct the tag spelling, or add the variant to the union definition. `kumiki fix` can suggest a close name (→ [AI Editing](./ai-edit.md)).

### E0210 `type-arity-mismatch`

A type-level application `T(...)` of a user-declared generic type passes a different number of type arguments than the declaration's parameters. Without this check, downstream type-param substitution would silently produce a short map and leave unresolved `TypeRef`s in payloads, which would then turn pattern checking into a no-op — exactly the silent-failure shape this error band is meant to catch.

> `Type "<name>" expects <m> type argument(s) but got <n>`

**Fix**: Adjust the call site to pass the declared number of type arguments, or change the declaration's parameter list.

### E0211 `undef-tile-in-selector`

A reducer's `ui.*` selector names a tile that has not been declared. Without this check a typo (`ui.click(SaveBtn)` vs `ui.click(SaveBtnn)`) compiles silently and binds nothing — indistinguishable from a deliberately unused reducer.

> `Reducer "<name>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" is not declared`

**Fix**: Add a `tile <Tile> = …` declaration, or correct the selector's tile name to match an existing one. The `_` wildcard (for reducers dispatched indirectly via `emit confirm({onYes: r, …})` callbacks, see [Lifecycle §7](./lifecycle.md)) is accepted and has no tile to resolve.

### E0212 `selector-id-mismatch` (opt-in via `--strict-selector-id`)

A reducer's `ui.<ev>(Tile#id)` selector names an id that the target tile's literal `{id: "..."}` prop cannot produce. E0211 catches typos in the tile name; this catches typos in the `#id` fragment — e.g. `on=ui.submit(NewForm#nw)` against `tile NewForm = form(...) {id: "new"}`. The runtime `_dispatch` filter (spec §1.6.2) silently skips the mismatch, so without this check the reducer never fires and the developer sees no error. Opt in with `kumiki check --strict-selector-id` or `compile({ strictSelectorId: true })`.

> `Reducer "<name>" subscribes to ui.<ev>(<Tile>#<id>) but tile "<Tile>" is declared with id "<actual>" — this selector can never match`

The checker descends into all four control-flow bodies (`for` / `when` / `if` / `match`): `for` / `when` pass through to their single body, `if`'s two branches merge, and every `match` arm contributes to the observed id set. `tile T = if c then button(...) {id: "a"} else button(...) {id: "b"}` produces `"a" | "b"`; a selector `T#c` under `--strict-selector-id` fires E0212. Referenced user tiles are NOT descended — a `Ref` to another tile leaves the id set unknown, so a future per-instance id-override syntax at the use site isn't foreclosed at compile time.

**When E0212 stays silent (runtime filter is authoritative)**:

- The tile has no `{id}` prop at all.
- The tile's `{id}` value is a non-literal expression (a `Ref`, method call, etc.) — its runtime value is not known at check time.
- The selector has no `#id` portion.
- The selector uses the `_` wildcard.
- The target tile is undeclared (E0211 already fires; E0212 is suppressed to surface a single root cause).

**Fix**: Correct the `#id` in the selector to match the tile's declared `{id}`, or correct the tile's `{id}` literal.

### W0212 `ui-event-tile-mismatch` (warning)

A reducer subscribes to `ui.<ev>(<Tile>)` whose target tile has no descendant that fires `<ev>` in the DOM — e.g. `ui.focus(Card)` where `tile Card = box(...)`. Codegen silently drops the handler, so the reducer is dead code. Lifting that into a warning surfaces the silent failure at check time without breaking the build. The checker walks the tile's body (including child tiles), so a cascade pattern like `TodoRow = row(check(...), …)` + `ui.click(TodoRow)` does NOT trigger the warning — codegen routes the handler to the focusable descendant.

> `Reducer "<r>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" has no descendant that fires "<ev>" (DOM-allowed: …; observed in body: …). The handler is silently dropped.`

The allowed root builtins per event are (current toolchain coverage; the implementation-side source of truth is `packages/compiler/src/ui-lifts.ts` — `UI_LIFTS`, which both `codegen.ts`'s handler-emission gate and the W0212 check derive from. Runtime DOM-event surfaces are owned by `packages/runtime/src/tiles-input.ts` and the universal `applyUiEventHandlers` in `core.ts`):

| `ui.<ev>` | allowed root tile kinds |
|---|---|
| `click`  | `button`, `check`, `switch`, `radio` |
| `submit` | `form` |
| `change` | `select`, `input`, `textarea`, `check`, `radio`, `switch`, `slider` |
| `input`  | `input`, `textarea` |
| `key`    | `input`, `textarea`, `button` |
| `focus`  | `input`, `textarea`, `button`, `select` |
| `blur`   | `input`, `textarea`, `button`, `select` |
| `hover`  | any tile |

**Fix**: Re-target the selector at a tile whose root is in the allowed set, or wire the handler explicitly on the focusable element (`input(onFocus=r)`). The wildcard `_` selector and the `ui.hover` event are exempt.

The checker descends into control-flow bodies (`for` / `when` / `if` / `match`) too: both `if`'s `then`/`else` and every `match` arm contribute to the observed kind set. So `tile Dyn = for n in xs box(...)` triggers W0212 (only `box` reachable), while `tile T = if c then input(...) else button(...)` does not (both branches contribute an allowed root). A tile whose body is entirely unresolvable (cycle, or a name no other tile defines) yields an empty observed set and the warning is suppressed — better silent than wrongly accusing.

**Note on `link`**: `link` is intentionally not listed under `click` even though `<a>` fires click natively — the runtime reserves the click event on links for navigation interception and does not invoke user `onClick` reducers. Re-targeting a button or wiring `onClick=` on a parent tile is the current workaround.

### E0213 `call-arity-mismatch`

An application passes a different number of arguments than the thing it applies declares. Kumiki has no partial application and no default parameters, so any mismatch is an error rather than a narrower type.

| Applied form | Declares | Message |
|---|---|---|
| `f(...)` on a `fn` | its parameter list | `Function "<name>" expects <n> argument(s) but got <m>` |
| `emit E(...)` | one argument, or none when `in=Unit` | `Effect "<name>" expects <n> argument(s) but got <m>` |
| `T(...)` on a user tile | one argument when it declares `in=`, else none | `Tile "<name>" expects <n> argument(s) but got <m>` |
| `V(...)` on a union variant | that variant's payload list | `Variant "<name>" carries <n> payload(s) but got <m>` |

The tile and effect forms are the ones that used to go unreported: a tile called without the argument its `in=` declares leaves `$1` unbound and the mount dies with `_d_1 is not defined`; an effect emitted without its input throws `Cannot destructure property … of 'input'` on the first dispatch; and a tile that declares no `in=` but is *given* an argument mounts and renders normally, silently dropping the value the caller meant to pass.

Built-in calls are not arity-checked: several ignore their arguments entirely at lowering (`Decoder.Json(Text)` lowers to a sentinel regardless), so a count is not a meaningful contract for them.

**Fix**: Pass the declared number of arguments, or change the declaration.

### E0214 `missing-record-field`

A record literal omits a field its declared type requires. Kumiki records have no optional fields — a field that may be absent is `Option(T)` and must still be written.

> `Record literal is missing field "<name>" of type <type>`

One diagnostic is reported per missing field, at the literal.

**Fix**: Supply the field, or change the type.

### E0215 `unknown-record-field`

A record literal, or a `.copy(f=v)` record update, names a field the declared type does not have.

> `Record type has no field "<name>"`

Both lower to a plain object spread, so an undeclared field became a property that nothing ever reads — the value was silently dropped rather than rejected.

**Fix**: Correct the field name, or declare it on the type.

### E0216 `unknown-variant`

A variant constructor names a tag its declared union type does not have — `slot s : Status = Zork` where `type Status = Idle | Busy`.

> `Variant "<name>" is not a member of type "<type>"`

The tag lowers to `{_tag: "Zork"}`, which no `match` arm can match; the UI silently renders nothing and no runtime error is raised. [E0209](#e0209-pat-unknown-variant) is the same mistake on the pattern side.

**Fix**: Use one of the declared tags, or add the tag to the union. `kumiki fix` proposes the closest tag.

### E0217 `int-literal-precision`

An `Int` position is given a literal outside the range JavaScript represents exactly (`Number.MAX_SAFE_INTEGER`, 9007199254740991). The literal is rounded on the way into the AST, so the program would run with a value that is not the one written.

> `Int literal <value> is not exactly representable and was rounded to <value>`

A literal with a fractional part is [E0201](#e0201-type-mismatch) instead — that is a type mistake, not a precision one.

**Fix**: Use a value inside the safe range, or carry the number as `Text`.

## E03xx — Capabilities and Purity

### E0301 `missing-capability`

A capability required by an effect is not declared in `app.caps`.

> `Effect "<effect>" requires capability "<cap>" which is not declared in app.caps`

**Fix**: Add the required capability to `app.caps`. For details on the capability model, see [Lifecycle](./lifecycle.md).

### E0302 `unknown-capability`

An entry in `app.caps` is neither a standard capability ([Standard Capabilities](./stdlib.md#_2-5-standard-capabilities)) nor one registered in a `kumiki.caps.json` manifest.

> `Unknown capability "<name>" in app.caps — use a standard capability or register it in kumiki.caps.json`

**Fix**: Use a standard capability, correct the spelling, or register the custom capability in a `kumiki.caps.json` next to the `.kumiki` file. See [Standard Capabilities](./stdlib.md#_2-5-standard-capabilities).

### E0303 `invalid-cancel-target`

An effect declared with `cap=http.cancel` does not have the required shape `in=EffectId out=Unit`, or declares attributes the cancel path silently ignores (`policy`, `retry`, `map-request`). The cancel capability cancels by id and returns nothing; declaring per-request behaviour on it is a user-intent mismatch.

> `effect "<name>" with cap=http.cancel must declare in=EffectId out=Unit`
> `effect "<name>" with cap=http.cancel cannot declare a policy`
> `effect "<name>" with cap=http.cancel cannot declare retry`
> `effect "<name>" with cap=http.cancel cannot declare map-request`

**Fix**: Change the `in=` and `out=` clauses to `in=EffectId out=Unit`, drop any `policy=` / `retry=` / `map-request=` clauses, or remove the `cap=http.cancel` clause. See [HTTP Cancellation](./http.md#_6-4-cancellation).

### E0304 `derived-slot`

A slot's initial value reads another slot — or itself. Derived slots are prohibited ([Store Layer Invariants](./language.md#_1-4-2-invariants), inv. 4), and `init-expr` ([Store Layer Syntax](./language.md#_1-4-1-syntax)) admits a literal, a record or collection literal, or a builtin call, none of which name a slot.

> `Slot "<name>" reads slot "<other>" in its initial value; derived slots are prohibited — compute it in a fn instead`

The lowering agrees with the invariant: a slot read is emitted as a lookup in the live-value table, and that table is built from the slot table, not before it. So an initializer that reads a slot throws on mount whichever order the two slots are declared in — the declaration order is not what decides it. Because no initializer may read a slot, a cycle between initializers cannot be written, and has no code of its own.

**Fix**: Give the slot a value that stands on its own and compute the derived form in a `fn`, which is the layer for derived computation. A value that must be derived once at startup belongs in a `route.enter` reducer instead.

### E0305 `fn-impurity`

A `fn` (pure function) is reading a slot. A `fn` must depend only on its arguments.

> `fn "<name>" must not read slot "<name>"`

**Fix**: Pass the required slot value as an argument.

## E04xx — Motion

Validity of a `motion` definition's closed grammar ([The motion definition](./style.md#_4-9-1-the-motion-definition)).

### E0401 `motion-unknown-property`

A keyframe stop uses a property outside the closed animatable set (`opacity`, `translate-x`, `translate-y`, `scale`, `rotate`), or gives one a non-number value.

> `motion "<name>": unknown keyframe property "<prop>" (allowed: …)`

**Fix**: Use a supported property, or express the effect with one.

### E0402 `motion-invalid-timing`

A timing field is outside its closed set: `duration` (a number of ms or `fast`/`normal`/`slow`), `easing` (`linear`/`ease`/`ease-in`/`ease-out`/`ease-in-out`), `iteration` (a positive Int or `infinite`), `direction` (`normal`/`reverse`/`alternate`/`alternate-reverse`) — or the field name itself is unknown.

> `motion "<name>": easing must be one of …`

**Fix**: Use a value (or field) from the closed set.

### E0403 `motion-malformed`

A `motion` is missing its `keyframes` record, or the keyframes lack a `from` / `to` stop (or use a stop other than `from` / `to`).

> `motion "<name>" keyframes must include a "to" record`

**Fix**: Provide `keyframes: {from: {…}, to: {…}}`.

## E06xx — reducer Write Rules

### E0601 `duplicate-write`

Within the same reducer, the same slot path shape (lvalue shape) is written more than once. This violates the one-write-per-reducer rule (at path-shape granularity).

> `Slot path "<shape>" is written more than once in this reducer`

**Note**: The granularity is **path shape**. `issues[id].status` and `issues[id].updatedAt` are considered different shapes and can coexist, but double assignment to `count` is forbidden.

## E07xx — Opt-in Checks (a11y, strict-icons, testing-DSL invariants)

A band for checks that either ship as warnings by default and are promoted to errors via an explicit `strict*` opt-in, or that guard invariants of the testing DSL itself. `check()` filters the `strict*` codes out unless the matching flag is set; testing-DSL codes are always active because they only fire inside `test`/`episode-test`/`property-test` bodies.

a11y checking is enabled via `check(program, { strictA11y: true })`.

### E0701 `a11y-button`

> `button must have a text= argument or aria-label prop`

### E0702 `a11y-image`

> `image must have an alt prop`

### E0703 `a11y-link`

> `link must have inner text or aria-label`

**Fix**: Provide visible text, or an `aria-label` / `alt`. For general guidance on forms, see [Forms](./forms.md).

Strict-icons checking is enabled via `check(program, { strictIcons: true, iconNames })`.

### E0704 `unknown-icon`

> `Unknown icon name "<x>" — not in @kumikijs/icons or any theme.icons block`

A literal `icon(name="<x>")` reference whose name is not in the `iconNames` set passed to `check()` (typically the keys of `@kumikijs/icons`'s `ALL_ICONS`) and is not declared in any `theme.icons` block in the source. Dynamic `icon(name=<expr>)` calls are never checked — the name is unresolvable at check time and falls through to the runtime placeholder (see [Style §4.8.4](./style.md#_4-8-4-strict-mode)).

**Fix**: Correct the typo, register the custom path in `theme.icons`, or install `@kumikijs/icons` so the built-in name is in scope.

Testing-DSL invariants (currently E0712; E0710–E0719 reserved for this purpose) fire only inside test-family definitions and do not require an opt-in flag.

### E0712 `episode-mock-invalid`

An `episode-test` `mocks` record binds an effect to a policy value that is not one of the four accepted forms: the bare identifiers `from-log` (replay recorded outcomes) and `ignore` (skip the effect entirely), or the constructor calls `ok(...)` (return a canned success payload) and `err(...)` (return a canned failure). Any other value — a typo like `from_log`, an arbitrary expression, or a bare reducer name — has no defined lowering in codegen and will trigger a loud `Error` at build time. The purpose of E0712 is to surface that failure earlier, at `check` time, with a source position that points at the offending value — instead of a codegen-stage throw whose stack points at the compiler.

> `Mock for "<name>" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``

**Fix**: Replace the mock value with one of the four accepted forms. Use `from-log` to replay from the recorded episode, `ignore` to no-op the effect, `ok(<value>)` to force a success payload, or `err(<value>)` to force a failure. See [episode-test](./testing.md).

## E08xx — Runtime Hazards

A band for statically catching, at the `check` stage, "code" that passes type checking but breaks at runtime. For the three-layer verification model, see [The Three Layers of Tooling Verification](./testing.md#_8-10-the-three-layers-of-tooling-verification).

### E0801 `unimplemented-method`

A method call of the form `obj.method(...)` does not exist in the set of methods implemented by the runtime / code generation. This occurs from a misspelling (`.fitler`), a method that appears in the specification but is unimplemented, or misuse of a method from a different type (such as `.to-result` on `Option`).

> `Method ".<name>" is not implemented by the runtime`

**Note**: The set of implemented methods is solely authoritative in `@kumikijs/compiler`'s `KNOWN_METHODS` (kept in sync with code generation's `methodCallJs`). Calling a no-argument method with `()` is also caught by this band. For the list of standard library methods, see [Standard Library](./stdlib.md).

**Fix**: Correct it to the right method name, or rewrite the operation using implemented means such as `match` / `fold`. If you need an unimplemented specification method, implement it in `packages/` and add a working example in `examples/`.

### E0802 `unimplemented-function`

A call names a function this document describes but the toolchain does not lower yet. Distinct from `E0116`: the name is right, and the gap is on the implementation side.

> `Function "<name>" is documented but not implemented by the runtime`

Currently one name is in this state: `trace(label, value)` ([Standard Library §2.4.6](./stdlib.md#_2-4-6-debugging-aids)). Its specified behaviour is to record into the episode log, and there is no seam from a lowered expression to the mount's episode logger — the fix is a runtime change, not a code-generation case. Reporting it here is what keeps the diagnostic honest in the meantime: without it the call lowers to an undefined global and the program breaks where it is evaluated, with nothing pointing back at the spec.

**Fix**: Remove the call. Nothing in the language is blocked on it — `trace` is a debugging aid.
