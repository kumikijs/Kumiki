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

A parse error is `throw`n as a `ParseError` (`message` + `pos`), and a lexical one as a `LexError`. Neither carries a `code`: the stage stops at the first error, so there is no set of diagnostics for one to index into. A tool whose output *is* such a set — `kumiki fix`'s rollback report, the MCP tools' JSON envelope — synthesizes [E0000](#e0000-parse-error) so that "no diagnostics" keeps meaning "clean".

The checker's codes come from `packages/compiler/src/typecheck.ts`; `E0000` is assigned by the two tools named above. The mechanized spec-drift guard (`packages/compiler/test/spec-drift.test.ts`) extracts the implementation side from every file that assigns a code, so a code invented in a tool and documented nowhere fails the same way as one invented in the checker.

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
and the write is rolled back whenever the result introduces a new failure OR
fails to resolve any pre-existing one.

The gate asks whether a repair **introduced a failure**, not whether anything
moved, so it identifies a diagnostic by its **code, kind and message** and
compares the two sets as multisets. Position is deliberately not part of it: a
rewrite shorter than what it replaced shifts every diagnostic to its right, and
a repair that inserts lines shifts every diagnostic below it, so a
position-keyed comparison reads an untouched diagnostic as one the repair
created. The message is what tells two diagnostics of one code apart, which matters
when a second repair balances the per-code counts: reword one `E0211` and
resolve one `E0119`, and counting codes alone reports a clean repair while the
reworded diagnostic is still there. Counting rather than set membership is what
lets one of two identical diagnostics count as resolved. A 1-for-1 swap like `E0301 → E0302 via a
typo` is still caught rather than accepted, because the two differ by code.

| Code | Auto-patch | Strategy |
|---|---|---|
| `E0001` | yes | Inject a `NotFound` tile and add `"/404" -> NotFound` to `app.routes`. |
| `E0102` | yes | Close-name suggestion (Levenshtein ≤ 2 or ≤ 25%) against known reducer names. |
| `E0103` | yes | Close-name suggestion against known slot / binding names. |
| `E0104` | yes | Close-name suggestion against declared `effect` names plus the [standard effects](./stdlib.md#_2-6-standard-effects), which no program declares (scoped — a tile or slot whose name is close is not a candidate). |
| `E0105` | yes | Close-name suggestion against known tile names. |
| `E0107` | yes | Close-name suggestion against declared motion names. |
| `E0116` | yes | Close-name suggestion against declared `fn` names plus the built-in calls (scoped — a slot or tile whose name is close is not a candidate). |
| `E0211` | yes | Close-name suggestion against declared tile names for the selector target. |
| `E0301` | yes | Append the required capability to the app's `caps = [...]` array. |
| `E0106` | yes | Close-name suggestion against timer names collected from `on=timer(d, name=N)` triggers (scoped — top-level defs are not candidates). |
| `E0209` | yes | Close-name suggestion against variant tags of the scrutinee union (built-in `Option` / `Result` plus user `TypeDef` bodies, resolved through aliases). |
| `E0117` | yes | Close-name suggestion against type names — the program's own `type` definitions first, then the primitives, the standard library's domain types, and the generic constructors (scoped — a slot or fn whose name is close is not a candidate). |
| `E0118` | yes | Close-name suggestion against declared theme names and slot names — the two namespaces `app.theme` accepts (scoped — a tile or reducer whose name is close is not a candidate). |
| `E0216` | yes | Close-name suggestion against variant tags of the declared union, the same resolution E0209 uses on the pattern side. |
| `E0119` | yes | Rewrite `$route` to `route` at the reported position — the slot holds the current route and is readable from every reducer. |
| `E0121` | no | Choosing a replacement name, and rewriting every read of it in the body, is user intent. |
| `E0122` | no | Which of the two binds is the mistaken one, and what the other should be called, is user intent. |
| `E0123` | no | Which of the two binds is the mistaken one, and what the other should be called, is user intent — as for E0122, whose rule this is at the trigger. |
| `E0218` | yes | Append the list accessor the iterated collection is missing (`.keys` for a `Map`, `.to-list` for a `Set`), when the iterated expression is a plain name. |
| `E0210` | no | Adding type arguments requires synthesizing user-intent — outside static repair. |
| `E0003` | no | Synthesizing an entry point means choosing a root tile, a route table and a capability set — user intent, not static repair. |
| `E0004` | no | Which of the apps is the intended one, and whether the other's routes should be merged in, is user intent. |
| `E0005` | no | Which edge of the loop is the mistaken one, and what the tile should render there instead, is user intent. |
| `E0006` | no | Rewriting recursion as a fold over data is a change of algorithm, not a substitution. |
| `E0007` | no | Which of the two definitions is the intended one is user intent — and deleting the wrong one silently changes behaviour. |
| `E0008` | no | Same: which occurrence to keep is user intent, and for `caps` the choice is a capability decision. |
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

### E0000 `parse-error`

The source could not be lexed or parsed. Not produced by the checker: the parser throws, and a tool that has to return a *list* of diagnostics synthesizes this code so an empty list still means a clean file. `message` is the parser's own sentence and `pos` the token it stopped at.

> `Parse error at <line>:<col>: <what was expected>`

**Fix**: Correct the syntax at the reported position. Every other code in this document presumes a file that parses.

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

The edges are the ones code generation follows: nested tile calls, an identifier argument standing in for a tile, the branches of `for` / `when` / `if` / `match`, and the tile's own `error-boundary` — the boundary's body is inlined into the `catch` at every call site of the tile that declares it, so a boundary that leads back closes a loop like any other child. `sub-routes` is not an edge: a sub-route is selected by the router through `route-outlet` and is never inlined.

**Fix**: Break the loop. Repetition belongs in `for` over a collection, and an alternative rendering in `when` / `match` — neither of which needs a tile to contain itself.

### E0006 `fn-cycle`

A `fn` calls itself, directly or through other functions ([fn Layer Invariants](./language.md#_1-8-3-invariants), inv. 5). Direct recursion is prohibited outright, and mutual recursion is admitted only where the depth can be proven at the type level — which the language has no form for, so every loop in the call graph is reported. Reported once per cycle, at the first call of it.

> `fn "<name>" calls itself (<f> → <g> → <f>)`

**Fix**: Express the repetition over data instead — `fold` / `map` / `filter` over a `List` terminate by construction, which is what the invariant is protecting.

### E0007 `duplicate-definition`

Two definitions of the same layer share a name. Symbol collection keeps one entry per name, so the later declaration replaced the earlier one and the program that ran was not the program that was written. Reported once per declaration past the first, at that declaration.

> `<layer> "<name>" is declared more than once; only one of the two declarations takes effect`

Which declaration survives is not uniform, which is why the message does not say. Symbol collection keeps the **last**, so that is what the checker validated — but two `reducer`s of one name both reach the artifact and the runtime dispatches the **first**. The two halves of the toolchain disagreed about which definition existed.

The namespace is per layer, and only within a layer: a `slot` and a `tile` sharing a name is legal — code generation resolves a bare identifier child to a tile before anything else — and a program's own `type Route = …` shadowing the standard library's is legal too. A second `app` is `E0004`, which predates this and keeps its own code.

**Fix**: Remove one, or rename it. `kumiki rename` refuses to create a duplicate, and `kumiki add` rolls back on one.

### E0008 `duplicate-clause` / `duplicate-key` / `duplicate-field` / `duplicate-param` / `duplicate-variant`

A name written twice inside one construct. Reported at the later occurrence — the one to delete.

> `<what> "<name>" is written more than once`

| `kind` | Where |
|---|---|
| `duplicate-clause` | an `app`, `effect` or `tile` clause (`caps = … caps = …`, `cap=… cap=…`, `in=… in=…`) |
| `duplicate-key` | a record literal field, a literal map key, a `theme` / `motion` entry at any depth, a named tile argument, a tile prop, a route pattern in `app.routes` or in a tile's `sub-routes` |
| `duplicate-field` | a record **type**'s fields, wherever the record type is written |
| `duplicate-param` | a `fn`'s parameters, a `type`'s parameters, a `property-test`'s `for-all` generators |
| `duplicate-variant` | a union's variant tags |

The search is structural: it descends every definition into every expression, type, tile and test body it contains. So `app.meta = {title: …, title: …}`, a duplicate key inside a `reducer-test`'s `given`, and a tile prop written twice are all reached — none of them is on the path of any other check.

`caps` is why this is not cosmetic: the clauses are assembled into one field, so the later one wins and reversing the order of two `caps` clauses silently changes the capability set — a security boundary decided by line order, undetectable in a workflow where an agent appends. A duplicate route pattern emits both entries and the router matches the first, leaving the second tile unreachable. A duplicate variant tag makes one arm of every `match` on that union unreachable.

A computed map key is not compared: whether two of them collide is the runtime's question, and the answer is not available here.

**Fix**: Delete the later one, or rename it if both were meant.

## E01xx — Name Resolution

### E0102 `undef-reducer`

A reducer name refers to no `reducer` definition. Three sites name one: an event handler argument or prop, `link`'s `prefetch`, and the `on-401` / `on-403` / `on-5xx` fields of [`app.http`](./http.md#_6-3-authentication) — where a name that resolves to nothing leaves the response with no handler, which is indistinguishable from a response the app chose not to handle.

> `Reference to undefined reducer "<name>"`

A **tile** name written in a handler is this error rather than [E0201](#e0201-type-mismatch): the position resolves in the reducer namespace and the tile layer is not in it, so `onClick=Card` on a defined `tile Card` reports the reducer `Card` as undefined. The spelling is not the thing to check there — the layer is.

**Fix**: Check the spelling of the reducer name, or — when the name is spelled correctly and defined in another layer — that a reducer is what the position wanted. `kumiki fix` can suggest a close name (→ [AI Editing](./ai-edit.md)).

### E0103 `undef-ref` / `undef-slot`

- `undef-ref`: An undefined name was referenced in an expression.
  > `Reference to undefined name "<name>"`
- `undef-slot`: An assignment was made to an undefined slot in a reducer body.
  > `Assignment to undefined slot "<name>"`

A name written `count-1` is one name, not a subtraction: `-` continues an identifier when an identifier character follows it ([§1.2](./language.md#_1-2-lexical)), and `on-401` is core syntax written exactly the same way. When the part before the hyphen does resolve to something, the message says which spelling to use instead.

> `Reference to undefined name "count-1" — "-" continues an identifier, so this is one name. Write "count - 1" with spaces for subtraction.`

**Fix**: Confirm that the referenced slot / binding is declared.

### E0104 `undef-effect` / `init-not-effect-call`

The target of an `emit`, or the effect a reducer waits on in `on=<effect>.ok(…)` / `.err(…)`, refers to an undefined effect. A misspelled selector leaves the reducer waiting for a result nothing produces, which is indistinguishable from an effect that never completes. An `app.init` entry is validated the same way — the grammar makes it an effect call ([§1.12](./language.md#_1-12-application-entry-app)), so the same capability and argument checks apply, and the built-in effects (`toast`, `navigate`, `log`, …) are equally legal there.

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

This is the `E0008` rule under an older code: it came first, and a code's meaning is permanent, so a repeated sub-route path stays here rather than being reported twice. Everything `E0008` says about *how* applies — reported at the later entry, once per entry past the first.

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

A `slot` is declared with a name the compiler resolves before it consults the slot table, so nothing can ever read it. The name is `route`, the router-maintained route slot ([Routing](./routing.md#_3-2-current-route-state)) — every other such name (`now`, `self`, …) is a reserved word the lexer rejects first. Without this diagnostic the declaration compiles and the slot silently renders the route object instead of its own value.

> `Slot "<name>" collides with <what it collides with>; reads of it never see this slot`

**Fix**: Rename the slot.

### E0116 `undef-call`

A call `f(...)` names no function. The candidate set is the program's `fn` definitions plus the built-in calls, which are spread across three documents:

| Callee | Where it is specified |
|---|---|
| `now`, `random`, `fmt`, `panic` | [Standard Library §2.4](./stdlib.md#_2-4-built-in-functions) |
| `Duration.*`, `Bytes.*`, `<T>.fresh` / `.parse` / `.show` | [Standard Library §2.2](./stdlib.md#_2-2-collection-methods), [§2.4](./stdlib.md#_2-4-built-in-functions) |
| `Decoder.*`, `EffectId.none` | [HTTP / Storage §6.1.4](./http.md#_6-1-4-the-decoder-type), [Standard Library §2.1.1.1](./stdlib.md#_2-1-1-1-effectid) |
| `file-url` | [Forms §5.10](./forms.md#_5-10-file-upload) |
| `prefers-dark` | [Style §4.6.1](./style.md#_4-6-1-following-os-settings) |

A qualified member written **without parentheses** is a call given no arguments, not a value: that is how `Decoder.Text` and `EffectId.none` are written, and `Duration.s` / `Bytes.from-text` are read the same way even though neither namespace has a zero-argument member. So a member a namespace does not declare is reported here rather than evaluating to nothing — `Duration.nope` is an E0116 — and a real member given no argument is an [E0213](#e0213-call-arity-mismatch).

`run-reducer` is not in the set: it lowers only inside a generated property-test trial ([Testing §8.3](./testing.md#_8-3-property-tests)), and a property-test invariant is resolved by its own walk rather than through this check. Writing it anywhere else is an E0116, and inside a test body it carries its own sentence, because the position is what is wrong rather than the name:

> `Call to "run-reducer" outside a property-test invariant`

The lowering reads `_init` and `_event`, which are bound only inside a trial, so the module a `given` or an `expect` produces dies with `_init is not defined` before a single test reports its result.

> `Call to undefined function "<name>"`

Code generation lowers an unrecognised callee to a call on a binding of the same name, so without this check a misspelling compiles, builds, and throws `<name> is not defined` on the first evaluation. The accepted set is exactly the set code generation can lower — a checker looser than the lowering it guards is what produced that failure, and a stricter one would reject programs that run.

`E0801` is the same relationship for `obj.method(...)`, which is a different expression form and resolved separately.

**Fix**: Correct the spelling, or declare the `fn`.

### E0117 `undef-type`

A type name resolves to nothing: it names no `type` definition, no [standard-library type](./stdlib.md#_2-1-built-in-types), and no type parameter of the enclosing `type` definition.

> `Reference to undefined type "<name>"`

An unresolved name is *opaque*, and an opaque type accepts every value — so before this check `slot v : NoSuchType = 1` was accepted, and so was every subsequent use of `v`. One misspelling turned off value checking for everything downstream of it.

Type parameters are in scope inside the body of the definition that declares them, and only there: `type Box(T) = {v: T}` is fine, `type Box(T) = {v: U}` is not. No other declaration site (`slot`, `fn`, `effect`, `tile in=`) has type parameters, so an unresolved name at one of those is always an error.

A **call's qualifier** is a type name too. `T.fresh()`, `T.parse(t)` and `T.show(v)` are lowered on any capitalised `T` — codegen matches the shape by regex — and the two members answer differently for it. `parse` branches on the qualifier, so a misspelling did not fail, it changed which branch ran: `Int.parse("12")` answers `Some(12)` and `Itn.parse("12")` answers `Some("12")`, which an `Int` slot then holds and every later sum concatenates. `fresh` and `show` discard the qualifier, so a misspelling there produces the same value — and the name is reported because a qualifier that resolves to no type is wrong on its own terms, which makes this check deliberately stricter than the lowering for those two. The qualifier resolves against the same namespace as any other type name, primitives included, and must be spelled as one: a name with a hyphen is not a qualifier, and a call written with one is [E0116](#e0116-undef-call) rather than this.

**Fix**: Correct the spelling, define the type, or add the name to the enclosing definition's parameter list. `kumiki fix` proposes the closest type name.

### E0118 `undef-theme`

`app.theme = <name>` where `<name>` is neither a `theme` definition nor a slot. Both are legal: a theme name selects that theme, and a slot selects whichever theme its value names, so the theme can change while the app runs ([Style §4.6](./style.md#_4-6-dark-mode)).

> `Reference to undefined theme "<name>"`

A name that resolves to neither leaves the runtime looking up a theme that was never registered. It falls back to the built-in defaults and renders, so the app looks merely unstyled rather than misconfigured.

**Fix**: Correct the spelling, or declare the theme. `kumiki fix` proposes the closest theme or slot name.

### E0119 `route-bind-out-of-scope`

A reducer reads `$route`, but the runtime does not put one in that reducer's payload. `$route` is bound in a `route.enter` / `route.leave` / `route.error` reducer, and in the reducer a link names as its `prefetch` target — which fires with the same binding so one body can serve both the prefetch and the navigation ([Routing §3.4](./routing.md#_3-4-route-lifecycle), [§3.8](./routing.md#_3-8-prefetch)). Every other trigger applies the reducer with a payload that has no route in it.

> `"$route" is only bound in a route.enter / route.leave / route.error reducer and in a link's prefetch target; nothing binds one here, so every field off it reads undefined. Read the "route" slot instead — it holds the current route and is in scope everywhere`

Without this check the read lowers to an empty object: `$route.params.get-or("id", "")` returns the fallback and `$route.pattern` returns `undefined`, so every comparison against them is false and the reducer's whole body quietly does nothing. A `fn` or a tile body is not applied with a payload at all, so `$route` there is an undefined name ([E0103](#e0103-undef-ref-undef-slot)) rather than this, and an `app.init` argument reports [E0120](#e0120-route-in-app-init) — which is what lets the message above promise the `route` slot without qualification: the one position where that advice would not hold never reaches this check. A name an enclosing `let` or pattern binds is that binding, not the payload, and is not reported at all.

**Fix**: Read the `route` slot ([Routing §3.2](./routing.md#_3-2-current-route-state)), which the runtime maintains and every layer can read. `kumiki fix` proposes the rewrite.

### E0120 `route-in-app-init`

An `app.init` argument reads `route` or `$route`, or calls a `fn` that reads one. Init arguments are evaluated **once**, while the app object is being constructed ([Language §1.12.1](./language.md#_1-12-1-when-init-arguments-are-evaluated)); the runtime installs `app.live.route` during the mount that follows, so at the moment these arguments are captured there is no route to read.

> `"<name>" is not available in an app.init argument: these arguments are evaluated once, while the app object is being built, and the runtime installs the route during the mount that follows. Take the route from a route.enter reducer, which runs with the route the app landed on`
> `"<name>" is not available in an app.init argument through "<fn>" (<fn> → … → <name>): …`

Without this check the argument lowers to `_live["route"]` and captures `undefined`, so `init = [load(route.path)]` compiles clean and throws `Cannot read properties of undefined (reading 'path')` at mount — the app never renders. `$route` is the same hole from the other side: nothing binds one here, and [E0119](#e0119-route-bind-out-of-scope)'s advice would send the author to the `route` spelling this check rejects.

**The restriction is on what the argument reaches, not on how it is spelled.** A `fn` that reads the route is correct — it is not in the slot table, so the purity rule does not see it, and every other caller runs after the mount that installs it. Only the call from `app.init` is wrong, and it is wrong more loudly than the direct read: the call lands in the app object literal, so the module throws while it is being *imported* and nothing loads at all. The call is followed through as many hops as it takes, and the chain that gets there is in the message, because a report naming only the called `fn` sends the author to a definition that is not itself wrong.

**Fix**: Take the route from a `route.enter` reducer ([Routing §3.4](./routing.md#_3-4-route-lifecycle)), which the runtime applies with the route the app landed on. An `init` entry that needs nothing from the route stays where it is; one that calls a `fn` for something else keeps that call.

### E0121 `reserved-bind-name`

An `effect-event` trigger binds a payload positional to `$el`, `$event` or `$route`. Those three are the [positional bindings](./language.md#_1-6-5-positional-binding), and the compiler declares all three in every reducer body — seeded from whatever the trigger's payload carries, which for an effect event is `{$1, $2}` and so carries none of them. A bind that takes one of the names is therefore a second declaration of it.

> `"<name>" is a positional binding the compiler declares in every reducer body, so an effect-event bind cannot also take the name — the two declarations collide and the module does not load. Rename the bind`

Without this check the reducer lowers to a body that declares the same `const` twice, so the whole module throws `SyntaxError: Identifier '<name>' has already been declared` at load and the app never renders — with `check` and `build` clean, and the emitted source reading as if it were. A bind named `$1` is not reported, because nothing else declares one; the digit does not tie it to a position either way (`on=load.ok(_, $1)` binds the *second* positional to it). Neither is `$now` reported, which nothing declares at all.

**Only an `effect-event` bind is checked.** A `let` in the body may still take one of the names, and should: a name declared over one already in scope shadows it ([Language §1.6.7](./language.md#_1-6-7-scoping-and-shadowing)), so the `let` wins for every read below it and [E0119](#e0119-route-bind-out-of-scope) reports none of them. That is why the rule here is about the bind list and not about the names: a bind names the payload's positionals, so a bind that took `$el` would have nowhere left to put the positional it stands for, while a `let` has an outer binding to shadow and a value of its own to put there.

`$route` collects this and nothing else. The bind still enters the reducer's scope, so the body's reads resolve to it rather than to a payload field out of its trigger's scope — [E0119](#e0119-route-bind-out-of-scope) would otherwise fire on every one of them and send the author to the `route` slot for a name they chose themselves.

**Fix**: Rename the bind.

### E0122 `duplicate-pattern-bind`

One pattern binds a name twice — `Both(a, a)`, or `(dup, dup)`. The binds of a pattern are **peers**: nothing nests them, so there is no scope between them for the second to shadow the first ([Language §1.6.7](./language.md#_1-6-7-scoping-and-shadowing)), and one of the two values the pattern names is left with no name to read it by. A whole pattern is one namespace, so a tuple's items are checked against each other as well.

> `"<name>" is bound twice in this pattern. The two binds are peers — nothing nests them, so the second does not shadow the first — and one of the two values the pattern names would be unreadable. Rename one`

Without this check the arm compiles: the second bind takes an identifier of its own and every read of the name in the body silently resolves to the *later* value, with `check` and `smoke` both clean. Before the shadowing rule reached patterns it was a module that threw `SyntaxError: Identifier '<name>' has already been declared` at load, which is louder and no more useful — either way the arm does not mean what it says. `_` is exempt, however many times it is written: it names nothing, and a pattern is expected to carry several.

Two *arms* binding the same name are unaffected — they are alternatives, each with its own scope — and so is a bind that shadows a name from outside the pattern, which is the rule working as [§1.6.7](./language.md#_1-6-7-scoping-and-shadowing) states it.

**Fix**: Rename one of the two binds, or write `_` for the value the arm does not read.

### E0123 `duplicate-effect-bind`

An `effect-event` trigger binds two of the payload's positionals to one name — `on=load.ok(dup, dup)`.

> `"<name>" is bound twice in this trigger: it names $<i> and then $<j>, so the two binds are peers — nothing nests them, the second does not shadow the first, and $<i> has no name left to read it by. Rename one, or write "_" for a positional the reducer does not read`

This is [E0122](#e0122-duplicate-pattern-bind)'s rule at the trigger rather than at a pattern, and the same collision as [E0121](#e0121-reserved-bind-name) from the other side: there a bind takes a name the compiler declares, here it takes a name another bind declares. Codegen emits one `const` per bind, so the reducer body declared the name twice and the whole module threw `SyntaxError: Identifier '<name>' has already been declared` at load — nothing rendered, with `check` and `build` clean and the emitted source reading as if it were.

A bind list names the payload's positionals **in order**, so two binds naming one thing is not an abbreviation for anything: whichever value the name resolved to, the other positional would have no name to read it by. The index in the message is the position — `_` occupies one rather than skipping it, so `on=load.ok(_, x, x)` is a collision between `$2` and `$3`.

`_` itself is exempt however often it is written: it names nothing, and it is the spelling for a positional the reducer does not read.

**A repeated name that is also a reserved one is E0121 alone.** `on=load.ok($el, $el)` collects one E0121 per bind and no E0123: those reports already say to rename the bind, and renaming it settles the duplicate too, so a third would repeat one mistake rather than name another. The bind still enters the reducer's scope either way, so the body's reads resolve to it and collect nothing further.

**Fix**: Rename one of the two binds, or write `_` for the positional the reducer does not read.

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

An event handler binds a **reducer**, in either form — `f(onX=r)` and `f() {onX: r}`. It is the one argument position resolved in the reducer namespace, so what a bare identifier there means is decided by that and not by its shape.

The shapes it arrives in differ, which is why the handler is asked about before the value is. A lowercase name parses as a reference. A capitalised one parses as a *tile call* when it is a named argument of a builtin that takes tiles (`box(text("x"), onClick=Card)`) and as a variant tag everywhere else — in a props block, on a value-arg builtin such as `link`, and on a user tile. All three are read as the name they carry, so a reducer whose own name is capitalised binds like any other: what the shape records is capitalisation and which tile the argument sits on, and neither is something the author is saying in this position. The argument form used to check the shape first, which is how a tile name there compiled into an element with no listener at all.

The parser gives the bare name, the argument-less call and the empty brace form one identical node — `onClick=Bump`, `onClick=Bump()` and `onClick=Bump {}` are indistinguishable after parsing — so all three name the reducer. There is nothing left to tell them apart by, and no diagnostic can single one out.

So what this error reports is a value that is no name: a literal, a variant tag carrying a payload (`onClick=Some(1)`), a tile call carrying arguments (`onClick=box(text("z"))`) or props (`onClick=Card {x: 1}`). A bare name that names no reducer is [E0102](#e0102-undef-reducer) instead, whatever its capitalisation — including a tile written there, because the handler position resolves in one namespace and the tile layer is not it.

The positions with a declared type to check against are: a `slot`'s initial value, the right-hand side of an assignment (through `.field` and `[k]` paths), an argument to a declared `fn`, a `fn` body against its `->` return type, an argument to a user tile that declares `in=`, the fallback of `.get-or`, and the operands of every operator. An `emit` argument is checked too, and reports [E0202](#e0202-emit-arg-type-mismatch).

A `.get-or` fallback is checked against what the call answers, not against the receiver: it is the value the call produces on the empty case, so it carries the result type. That result comes out of the receiver's type argument — `Option(T)` and `Result(T, E)` answer `T`, `Map(K, V)` answers `V` — which is why `opt := opt.get-or(None)` on an `Option(S)` slot is reported twice: once at the fallback, which is not an `S`, and once at the assignment, because an `S` is not an `Option(S)`. Which of the two readings a call takes is decided by its argument count ([Runtime §10.3.7](./runtime.md#_10-3-7-polymorphic-collection-methods)), so a count that does not fit its receiver is not resolved here and is checked against nothing. It is still lowered — to the reading its count names, on the receiver it was given — which is a defect of its own rather than a silence.

Assignability is structural, with one implicit conversion — `Int` flows into a `Float` position and never the reverse. Aliases and generic instantiations are followed, and a `where` refinement is transparent: this check never evaluates one. On `type Volume = nominal Int where between(0, 11)`, `volume := 50` is not this error — whether a value is in range is decided at validation ([Forms §5.6](./forms.md#_5-6-validation-strategy)).

`nominal` is the exception, and the one rule in this code that reports where *every* value of the actual type is a valid value of the declared one: `1.5` is not an `Int` and `{a, b}` is not an `{a: Int}`, but every `Yen` is a perfectly good `Cents`. A nominal type is identified by the name it is declared under ([§1.3.5](./language.md#_1-3-5-type-canonicalization)), so two declarations over one base reject each other — `Cents := Yen`, `postId := userId`. A type carrying no nominal name of its own still meets any nominal declared over it in both directions, which is what leaves `slot c : Cents = 1` and `c := c + 1` legal; a nominal declared over another nominal goes one way, toward the one it was declared as.

The operators are outside the rule: `==` is defined on every type, and ordering asks only whether both sides share a family — number, text or time — which two nominals over a number, text or time base always do. So neither `cents < yen` nor `postId < userId` is reported. Over any other base neither side has a family, and the operator reports that instead: `flag < mark` on two `nominal Bool` declarations is `Operator "<" cannot compare Flag with Mark`.

**The check is one-sided.** It reports what is definitely wrong and stays silent about everything it cannot resolve — an unknown type name, a method whose result nothing resolves (`.get` and `.get-or` answer from their receiver's type argument — `Option(T)` and `Result(T, E)` to `T`, and a `Map` lookup to `Option(V)` with `.get` or to `V` with a fallback; `.copy` answers its receiver unchanged, and a fixed table — `show`, `to-int`, `floor`, … — answers a primitive; everything else stays dynamic), a `let` binding of an unresolvable expression. A wrong diagnostic rejects a program that runs; a missing one only fails to add a diagnostic that never existed. So a clean `check` is not a proof of type correctness, and [E0801](#e0801-unimplemented-method) / [E0116](#e0116-undef-call) remain the checks that a name exists at all.

**Fix**: Correct the value, or widen the declared type. For a nominal mismatch that is deliberate, convert through the base the two types share and write it as a `fn` whose return type is the destination — `-> UserId = p + ""`, not `-> UserId = p`, which is this same error. The `fn` records the intent; what is enforced is that its body reached the base.

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

```kumiki invalid
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", bind=avatar)
```

**Fix**: Remove `bind=`, and add a reducer that picks the file from the event:

```kumiki fragment
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", accept="image/*")
reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
```

### E0206 `file-only-prop`

The `accept` and `multiple` props on `input` apply only when `type="file"`. They are rendered onto the underlying `<input>` element, where they are valid HTML only for a file picker ([Forms §5.10](./forms.md#_5-10-file-upload)). Used on any other input type — or when `type` is omitted (it defaults to `"text"`) — they are invalid HTML and a latent bug. The diagnostic fires only when the type is statically known to not be `"file"`; a non-literal `type=` expression is left alone.

> `input prop "accept" requires type="file" (got type="text"); accept/multiple are only valid on file inputs`
> `input prop "multiple" requires type="file" (got no type, defaults to "text"); accept/multiple are only valid on file inputs`

```kumiki invalid
slot draft : Text = ""
tile Picker = input(type="text", bind=draft, accept="image/*")
```

**Fix**: Either add `type="file"` to opt into a file picker, or remove the `accept` / `multiple` prop:

```kumiki fragment
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

A reducer names a tile that has not been declared, in either of the two triggers that name one: a `ui.*` selector, or `tile.mount(<Tile>)` / `tile.unmount(<Tile>)`. Without this check a typo (`ui.click(SaveBtn)` vs `ui.click(SaveBtnn)`) compiles silently and binds nothing — indistinguishable from a deliberately unused reducer.

> `Reducer "<name>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" is not declared`
> `Reducer "<name>" subscribes to tile.mount(<Tile>) but tile "<Tile>" is not declared`

**Fix**: Add a `tile <Tile> = …` declaration, or correct the tile name to match an existing one. The `_` wildcard (for reducers dispatched indirectly via `emit confirm({onYes: r, …})` callbacks, see [Lifecycle §7](./lifecycle.md)) is accepted in a `ui.*` selector and has no tile to resolve. A lifecycle event has no such form: it fires when a *named* tile enters or leaves the rendered tree.

### E0212 `selector-id-mismatch` (opt-in via `--strict-selector-id`)

A reducer's `ui.<ev>(Tile#id)` selector names an id that the target tile's literal `{id: "..."}` prop cannot produce. E0211 catches typos in the tile name; this catches typos in the `#id` fragment — e.g. `on=ui.submit(NewForm#nw)` against `tile NewForm = form(...) {id: "new"}`. The runtime `_dispatch` filter (spec [§1.6.2](./language.md#_1-6-2-selectors)) silently skips the mismatch, so without this check the reducer never fires and the developer sees no error. Opt in with `kumiki check --strict-selector-id` or `compile({ strictSelectorId: true })`.

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

A reducer subscribes to `ui.<ev>(<Tile>)` whose target tile has no descendant that fires `<ev>` in the DOM — e.g. `ui.focus(Card)` where `tile Card = box(...)`. Codegen silently drops the handler, so the reducer is dead code. Lifting that into a warning surfaces the silent failure at check time without breaking the build. The checker walks the tile's body (including child tiles), so a cascade pattern like `TodoRow = row(check(...), …)` + `ui.click(TodoRow)` does NOT trigger the warning — codegen routes the handler to the focusable descendant. "Including child tiles" is load-bearing on both sides: a body that names its descendant (`tile Row = box(Leaf)`) is walked exactly as the inline `box(input(...))` is, and codegen lifts the handler through the same edge ([§1.6.2](./language.md#_1-6-2-selectors)). The two used to disagree — the checker walked the reference and codegen did not — which produced the silent drop this warning exists to report, with no warning. One half of the cascade is still open: when the descendant is reached through a call site that writes the same handler prop (`RemoveBtn {onClick: remove}`), that prop replaces the lifted subscription rather than joining it, and the container's reducer does not fire — [#407](https://github.com/kumikijs/Kumiki/issues/407).

> `Reducer "<r>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" has no descendant that fires "<ev>" (DOM-allowed: …; observed in body: …). The handler is silently dropped.`

The allowed root builtins per event are (current toolchain coverage; the implementation-side source of truth is `packages/compiler/src/ui-lifts.ts` — `UI_LIFTS`, which both `codegen.ts`'s handler-emission gate and the W0212 check derive from. Runtime DOM-event surfaces are owned by `packages/runtime/src/tiles-input.ts` and the universal `applyUiEventHandlers` in `core.ts`):

| `ui.<ev>` | allowed root tile kinds |
|---|---|
| `click`  | `button`, `check`, `switch`, `radio` |
| `submit` | `form` |
| `change` | `select`, `input`, `textarea`, `check`, `radio`, `switch`, `slider` |
| `input`  | `input`, `textarea`, `editable` |
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
| `b(...)` on a built-in call | the arguments a call to it must supply | `Function "<name>" expects [at least ]<n> argument(s) but got <m>` |
| `emit E(...)` | one argument, or none when `in=Unit` | `Effect "<name>" expects <n> argument(s) but got <m>` |
| `T(...)` on a user tile | one argument when it declares `in=`, else none | `Tile "<name>" expects <n> argument(s) but got <m>` |
| `V(...)` on a union variant | that variant's payload list | `Variant "<name>" carries <n> payload(s) but got <m>` |
| `x.m(...)` on a stdlib method | the arguments its lowering reads | `Method ".<m>" expects <n> argument(s) but got <m>` |
| `"/p" -> T` in `app.routes` | no argument, so no `in=` | `Route "<path>" targets tile "<name>", which expects 1 argument(s) — a route target is rendered with none` |
| `"/p" -> T` in a tile's `sub-routes` | the same | `Sub-route "<path>" in tile "<parent>" targets tile "<name>", which expects 1 argument(s) — a route target is rendered with none` |

A **route entry** is the one application that cannot pass anything: it lowers to `tile: () => …`, so a target declaring `in=` left `$1` unbound and the mount died with `_d_1 is not defined` after `check` and `build` had both said ok. A sub-route entry — and therefore whatever `route-outlet` renders — is the same rule. Both are stated in [Routing §3.1.4](./routing.md#_3-1-4-a-route-target-takes-no-argument), where the reason the rule costs nothing is too: the route being rendered is in the `route` slot, which every tile can read without an argument.

The tile, effect and route forms are the ones that used to go unreported: a tile called without the argument its `in=` declares leaves `$1` unbound and the mount dies with `_d_1 is not defined`; an effect emitted without its input throws `Cannot destructure property … of 'input'` on the first dispatch; and a tile that declares no `in=` but is *given* an argument mounts and renders normally, silently dropping the value the caller meant to pass. A route entry reaches the first of those deaths with no call written anywhere: it applies its target itself, and can pass nothing.

A built-in call is counted the same way. What the count describes is what a *call* must supply, which is not always what the lowering reads: `Decoder.Json(User)` lowers to a sentinel that reads nothing at all. Nor is the argument's *type* checked — the sentinel ignores it. That type is nonetheless why `Decoder.Json` requires one argument while `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` require none — it is what makes the decode type-safe ([HTTP §6.1.4](./http.md#_6-1-4-the-decoder-type)), and a decoder written without it was indistinguishable, in the source and in the output alike, from one that had it. Before the count was enforced, a builtin's argument list was whatever its lowering happened to read: `Duration.s()` lowered to `((0) * 1000)`, so a timer written with an empty duration fired immediately and forever, and `Duration.s(1, 2, "x")` dropped the tail. The parentheses are not what makes it a call and so not what makes it counted: `Duration.s` written bare is the same zero-argument call and the same E0213, which is the one spelling that used to reach that timer with the count enforced.

`fmt` is the only builtin with a range. Its signature is `fmt(template, ...args)` ([Standard Library §2.4.5](./stdlib.md#_2-4-5-string-formatting)), so the template is all that can be required, and its message names a minimum — `expects at least 1 argument(s) but got 0`. `now` is held to exactly none, but no call can break that: it is a keyword rather than a name, and the parser builds its zero-argument call itself, so `now(1)` is a parse error before any of this is reached.

A **method** is checked when its lowering reads a fixed number of arguments — `t.format()` used to pass `check` and then kill `build` with a bare `TypeError` carrying no position. Only the minimum is enforced: `get-or` and `slice` branch on how many they were given.

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

### E0218 `for-over-non-list`

A `for` iterates a `Map` or a `Set` directly. The iteration target of `for` is a list ([Tile Layer Invariants](./language.md#_1-7-2-invariants), inv. 5), and both of those are keyed objects at runtime — the program compiles and then throws where the loop is used: `.map is not a function` in a tile, `object is not iterable` in a reducer.

> `"for" iterates a List, but this is a <Map|Set> — iterate its .<keys|to-list>`

A `Map` holds two lists and they bind different things: `for k in m.keys` binds the key, `for v in m.values` binds the value. The message names `.keys` first because that is the form [§1.7.2](./language.md#_1-7-2-invariants) inv. 5 lists, and `kumiki fix` proposes that one — check which the loop body actually wanted.

Fires for both forms of the loop — inside a tile and inside a reducer's `do=` block. A target whose type cannot be determined is not reported.

**Fix**: Iterate `m.keys` for a `Map` and `s.to-list` for a `Set`. `kumiki fix` proposes the suffix.

### W0213 `handler-on-inert-tile` (warning)

A handler prop is written on a tile whose renderer never reads it — `row(text("card"), onClick=open)`, `card(...) {onChange: r}`. Only the tiles that own the matching DOM event wire these: `onClick` on `button` / `check` / `radio` / `switch`, `onChange` on the input tiles, `onInput` on the input tiles and `editable`, `onSubmit` on `form`, `onClose` on the overlay tiles. Everything else drops the handler with no trace, so the reducer is dead code.

> `"<handler>" on <tile>() is dropped — <tile> does not fire it. Put it on <tiles>, or subscribe with a reducer's on=ui.<event>(<Tile>)`

A **user tile** is asked the same question, and answered in a second form. A handler written on one is merged onto the node that tile renders ([§1.7.3](./language.md#_1-7-3-event-handler-props)), so what fires is decided by what it renders — `Inner(onClick=open)` over `tile Inner = box(text("clickme"))` renders, wires nothing, and is the failure this warning exists to name. Nothing else can: this warning is non-fatal, so `check` still exits 0 (`ok (1 warning)`) and `build` still emits, and `smoke` sees a tile that renders fine with nothing to click.

> `"<handler>" on <tile>() is dropped — <tile> renders nothing that fires it (observed in body: <kinds>). Put it on <tiles>, or subscribe with a reducer's on=ui.<event>(<Tile>)`

The kinds come from walking the tile's render tree, the same walk [W0212](#w0212-ui-event-tile-mismatch-warning) uses, and only a tree with no firing kind anywhere in it is reported. That is deliberately less than the whole truth: the prop lands on the tile's **root** node, so `tile Card = box(button(...))` drops the handler too and is *not* reported, because the walk does not distinguish a root from a descendant. Everything it does report is a certain drop.

When the walk finds no kind at all, nothing is reported — the tile's own root is a name that resolves to neither a builtin nor a declared tile (`tile Inner = Nope()`, or a cycle `tile Inner = Inner()`), so the walk learned nothing and W0212 declines the same empty answer. Those shapes have their own codes ([E0005](#e0005-tile-cycle), [E0105](#e0105-undef-tile)). An unresolvable name *nested* inside a resolvable body (`tile Inner = box(Nope())`) is a different case: the kinds around it are a true answer about the root, so W0213 stands beside the code that names the unresolvable part.

`onKeyDown`, `onMouseEnter`, `onFocus` and `onBlur` are never reported: the runtime attaches those listeners to whatever element the tile produced. That is about the listener, not about the event reaching it — `focus` and `blur` do not bubble, so a container that is not focusable never fires them, and `keydown` reaches a container only from a focusable descendant. Reporting those would take a focusability analysis this check does not do.

[W0212](#w0212-ui-event-tile-mismatch-warning) is the same silent drop reached from the other side — a `ui.<ev>(Tile)` subscription whose target cannot fire `<ev>`. It cannot catch this one: a container passes it as soon as any descendant is clickable, which every card-with-a-button layout is.

**Fix**: Move the handler onto the tile that fires the event, or wrap the content in a `button` — on a user tile, either at the call site or inside the tile itself, so its root is the tile that fires. To react to a click anywhere in a region, subscribe a reducer with `on=ui.click(<the clickable child>)`.

## E03xx — Capabilities and Purity

### E0301 `missing-capability`

A capability required by an effect is not declared in `app.caps`. The requirement comes from the effect's own `cap=`, or — for a [standard effect](./stdlib.md#_2-6-standard-effects) such as `navigate` or `toast`, which no program declares — from the capability that effect is registered behind. The DOM runtime gates both the same way: an undeclared capability drops the effect with a console warning, so without this check the emit compiles, mounts, and silently does nothing.

> `Effect "<effect>" requires capability "<cap>" which is not declared in app.caps`

**Fix**: Add the required capability to `app.caps`. For details on the capability model, see [Lifecycle](./lifecycle.md).

### E0302 `unknown-capability`

An entry in `app.caps` is neither a standard capability ([Standard Capabilities](./stdlib.md#_2-5-standard-capabilities)) nor one registered in a `kumiki.caps.json` manifest.

> `Unknown capability "<name>" in app.caps — use a standard capability or register it in kumiki.caps.json`

**Fix**: Use a standard capability, correct the spelling, or register the custom capability in a `kumiki.caps.json` — beside the `.kumiki` file or anywhere up to the project root. `kumiki check`, `kumiki build` and the Vite plugin name the manifest that was read, or the directories searched when none was found. See [Standard Capabilities](./stdlib.md#_2-5-standard-capabilities).

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

The same code covers the other side of purity: an `emit` written as an *expression* anywhere but a reducer body — a `fn`, a tile, a slot initializer, an `effect`'s `map-request`, an `app.init` argument ([Language §1.12.1](./language.md#_1-12-1-when-init-arguments-are-evaluated)). None of them is evaluated with an effect queue around it, so the dispatch would have nowhere to go.

> `emit "<name>" used as an expression is only allowed inside a reducer body`

**Fix**: Move the `emit` into a reducer. An `app.init` entry is already a dispatch — write the effect as the entry itself rather than as an argument to one.

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

A band for checks that are **off** unless an explicit `strict*` opt-in turns them on, plus the ones that guard invariants of the testing DSL itself. There is no warning tier here: without the matching flag `check()` filters the `strict*` codes out entirely, so they neither print nor affect the exit code; with it they are errors. Testing-DSL codes are always active, because they only fire inside `test` / `episode-test` / `property-test` bodies.

a11y checking is enabled via `check(program, { strictA11y: true })`.

### E0701 `a11y-button`

> `button must have a text= argument or aria-label prop`

### E0702 `a11y-image`

> `image must have an alt prop`

### E0703 `a11y-link`

> `link must have inner text or aria-label`

**Fix**: Provide visible text, or an `aria-label` / `alt`. For general guidance on forms, see [Forms](./forms.md).

### E0705 `a11y-label-for`

> `label for="<x>" names no tile — no id="<x>" in this program`

A `label {for: "<x>"}` whose literal target matches no `id="<x>"` / `{id: "<x>"}` anywhere in the program. Such a label labels nothing: clicking it focuses no control, and a screen reader announces the field as unnamed — while the source reads as if the association were made.

Only literals are resolved, on both sides. A `for` that is itself an expression is never looked up, and an id built at runtime (`{id: "row-" + t.id}`) is not part of the domain — the same literal-only discipline [E0704](#e0704-unknown-icon) applies to icon names.

That second half has a consequence worth stating: a **literal** `for` against a **computed** id is reported. It is the right report — one literal name cannot address a control per row — but the fix is not "add an id".

**Fix**: Give the control the id the label names, or correct the name. Where the id is built per row, build the `for` the same way (`label(text="Name") {for: "row-" + t.id}`) — a computed `for` is not looked up, because the pair is undecidable at check time. See [Forms](./forms.md).

Strict-icons checking is enabled via `check(program, { strictIcons: true, iconNames })`.

### E0704 `unknown-icon`

> `Unknown icon name "<x>" — not in @kumikijs/icons or any theme.icons block`

A literal `icon(name="<x>")` reference whose name is not in the `iconNames` set passed to `check()` (typically the keys of `@kumikijs/icons`'s `ALL_ICONS`) and is not declared in any `theme.icons` block in the source. Dynamic `icon(name=<expr>)` calls are never checked — the name is unresolvable at check time and falls through to the runtime placeholder (see [Style §4.8.4](./style.md#_4-8-4-strict-mode)).

**Fix**: Correct the typo, register the custom path in `theme.icons`, or install `@kumikijs/icons` so the built-in name is in scope.

Testing-DSL invariants (currently E0712 and E0713; E0710–E0719 reserved for this purpose) fire only inside test-family definitions and do not require an opt-in flag.

### E0712 `episode-mock-invalid`

An `episode-test` `mocks` record binds an effect to a policy value that is not one of the four accepted forms: the bare identifiers `from-log` (replay recorded outcomes) and `ignore` (skip the effect entirely), or the constructor calls `ok(...)` (return a canned success payload) and `err(...)` (return a canned failure). Any other value — a typo like `from_log`, an arbitrary expression, or a bare reducer name — has no defined lowering in codegen and will trigger a loud `Error` at build time. The purpose of E0712 is to surface that failure earlier, at `check` time, with a source position that points at the offending value — instead of a codegen-stage throw whose stack points at the compiler.

> `Mock for "<name>" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``

**Fix**: Replace the mock value with one of the four accepted forms. Use `from-log` to replay from the recorded episode, `ignore` to no-op the effect, `ok(<value>)` to force a success payload, or `err(<value>)` to force a failure. See [episode-test](./testing.md).

### E0713 `test-shape-invalid`

A test-body position holds a value whose shape the lowering does not read, and whose fallback is an assertion of its own rather than a failure.

Two positions have one today:

- A `reducer-test`'s `given.mocks` binds an effect to something other than `ok(...)`, `err(...)` or `delay(<ms>, ok(...)|err(...))`. `mockScriptJs` answers anything else with `{outcome: "ok", value: null}`, so a mock written to drive the failure path drove the success one — and a test asserting what happens when an effect fails passed, permanently, having never failed it. ([E0712](#e0712-episode-mock-invalid) is the same rule for an `episode-test`, whose vocabulary also includes `from-log` and `ignore`.)
- An `expect.effects` that is not a list. `effectListJs` lowers a non-list to `[]`, which is not an absent assertion but the assertion *no effects were emitted* — so `effects: persist(count)`, a forgotten pair of brackets, passes against a reducer that emits nothing, and the effect named inside it is never resolved.

> `Mock for "<name>" must be \`ok(...)\`, \`err(...)\`, or \`delay(ms, ok(...)|err(...))\``
> `` `expect.effects` must be a list of effects ``

**Fix**: Write the accepted shape. Both positions also throw at codegen now, so a caller that skips `check` gets a named failure rather than a silently rewritten assertion.

## E08xx — Runtime Hazards

A band for statically catching, at the `check` stage, "code" that passes type checking but breaks at runtime. For the three-layer verification model, see [The Three Layers of Tooling Verification](./testing.md#_8-10-the-three-layers-of-tooling-verification).

### E0801 `unimplemented-method`

A method call of the form `obj.method(...)` does not exist in the set of methods implemented by the runtime / code generation. This occurs from a misspelling (`.fitler`), a method that appears in the specification but is unimplemented, or misuse of a method from a different type (such as `.to-result` on `Option`).

> `Method ".<name>" is not implemented by the runtime`

**Note**: The set of implemented methods is solely authoritative in `@kumikijs/compiler`'s `KNOWN_METHODS` (kept in sync with code generation's `methodCallJs`). A no-argument method may be written with or without `()` — [Standard Library §2.2.3](./stdlib.md#_2-2-3-list-t) calls the bare form a shortcut, and both forms compile. For the list of standard library methods, see [Standard Library](./stdlib.md).

**Fix**: Correct it to the right method name, or rewrite the operation using implemented means such as `match` / `fold`. If you need an unimplemented specification method, implement it in `packages/` and add a working example in `examples/`.

### E0802 `unimplemented-function`

A call names a function this document describes but the toolchain does not lower yet. Distinct from `E0116`: the name is right, and the gap is on the implementation side.

> `Function "<name>" is documented but not implemented by the runtime`

Currently one name is in this state: `trace(label, value)` ([Standard Library §2.4.6](./stdlib.md#_2-4-6-debugging-aids)). Its specified behaviour is to record into the episode log, and there is no seam from a lowered expression to the mount's episode logger — the fix is a runtime change, not a code-generation case. Reporting it here is what keeps the diagnostic honest in the meantime: without it the call lowers to an undefined global and the program breaks where it is evaluated, with nothing pointing back at the spec.

**Fix**: Remove the call. Nothing in the language is blocked on it — `trace` is a debugging aid.
