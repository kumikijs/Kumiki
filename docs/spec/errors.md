# Error Code Specification

The diagnostics reported by the Kumiki compiler (`@kumikijs/compiler`) split into two families: **parse errors** and **type-check errors**. This document enumerates both normatively. If a code is added or changed on the implementation side, this document must be updated at the same time.

## The Form of an Error

A type-check error is represented as a `KumikiError`:

```ts
type KumikiError = {
  code: string;   // a stable identifier such as "E0103"
  kind: string;   // a machine-readable classification such as "undef-slot"
  message: string; // a human-facing message (includes the target name)
  pos: Pos;        // { line, col }
};
```

`code` is a permanent contract; once assigned, its meaning does not change. `kind` is a sub-classification under the same `code`, used to branch diagnostic logic.

A parse error is `throw`n as a `ParseError` (`message` + `pos`). Because the parse stage stops at the first error, no code is assigned.

## The Code System

| Band | Domain |
|---|---|
| `E00xx` | App structure (such as mandatory routing requirements) |
| `E01xx` | Name resolution (undefined references) |
| `E02xx` | Type mismatch |
| `E03xx` | Capabilities and purity |
| `E04xx` | Motion |
| `E06xx` | reducer write rules |
| `E07xx` | Accessibility (a11y) |
| `E08xx` | Runtime hazards (code that compiles but breaks at runtime) |

## E00xx — Structure

### E0001 `missing-404`

An app that declares `app.routes` must include a route for the `/404` pattern. Unmatched paths fall back here.

> `app.routes must include a "/404" entry`

**Fix**: Add a route to a 404 tile, such as `route "/404" -> NotFound`. See [Routing](./routing.md) for details.

### E0002 `duplicate-timer-name`

Two or more `timer(d, name=N)` triggers declare the same timer name `N`. Timer names share one namespace and must be unique across the app, so that `stop-timer(N)` is unambiguous.

> `Timer name "<name>" is declared more than once`

**Fix**: Rename one of the timers so each `name=` is unique. See [timer](./lifecycle.md#_7-1-5-timer).

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

### E0104 `undef-effect`

The target of an `emit` refers to an undefined effect.

> `Reference to undefined effect "<name>"`

### E0106 `undef-timer`

A `stop-timer(N)` statement refers to a timer name `N` that no `timer(d, name=N)` trigger declares.

> `stop-timer refers to undefined timer name "<name>"`

**Fix**: Check the spelling, or declare the timer with `timer(d, name=N)`. See [timer](./lifecycle.md#_7-1-5-timer).

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

### E0109 `test-wildcard-misuse`

A test wildcard (`<any-id>` / `<slots.X>`) appears outside a `reducer-test` `expect` — in a reducer/tile/fn/app body, or in a test's `given`. Wildcards are a matching construct for the expected result only ([Wildcards](./testing.md#_8-2-2-wildcards)); they have no meaning as a value to compute or feed in.

> `Test wildcard "<any-id>" is only valid inside a reducer-test \`expect\``

**Fix**: Remove the wildcard, or move it into the `reducer-test` `expect`.

### E0110 `sub-routes-without-wildcard-parent`

A tile declares `sub-routes` but its parent route in `app.routes` is not a wildcard (`/*`) pattern. Without a wildcard parent the runtime never reaches the nested matcher, so the sub-routes can never apply. See [Nested Routes](./routing.md#_3-6-nested-routes).

> `Tile "<name>" declares sub-routes but its parent route "<path>" is not a wildcard pattern (must end with "/*")`

**Fix**: Change the parent route's pattern to end with `/*` (e.g. `/settings` → `/settings/*`), or remove the `sub-routes` block.

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

## E02xx — Types

### E0201 `type-mismatch`

An event handler argument / prop must be a reducer name, but was a different kind of value.

> `Event handler arg "<name>" must be a reducer name`
> `Event handler prop "<name>" must be a reducer name`

## E03xx — Capabilities and Purity

### E0301 `missing-capability`

A capability required by an effect is not declared in `app.caps`.

> `Effect "<effect>" requires capability "<cap>" which is not declared in app.caps`

**Fix**: Add the required capability to `app.caps`. For details on the capability model, see [Lifecycle](./lifecycle.md).

### E0302 `unknown-capability`

An entry in `app.caps` is neither a standard capability ([Standard Capabilities](./stdlib.md#_2-5-standard-capabilities)) nor one registered in a `kumiki.caps.json` manifest.

> `Unknown capability "<name>" in app.caps — use a standard capability or register it in kumiki.caps.json`

**Fix**: Use a standard capability, correct the spelling, or register the custom capability in a `kumiki.caps.json` next to the `.kumiki` file. See [Standard Capabilities](./stdlib.md#_2-5-standard-capabilities).

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

## E07xx — Accessibility (a11y)

a11y checking is enabled via `check(program, { strictA11y: true })`.

### E0701 `a11y-button`

> `button must have a text= argument or aria-label prop`

### E0702 `a11y-image`

> `image must have an alt prop`

### E0703 `a11y-link`

> `link must have inner text or aria-label`

**Fix**: Provide visible text, or an `aria-label` / `alt`. For general guidance on forms, see [Forms](./forms.md).

## E08xx — Runtime Hazards

A band for statically catching, at the `check` stage, "code" that passes type checking but breaks at runtime. For the three-layer verification model, see [The Three Layers of Tooling Verification](./testing.md#_8-10-the-three-layers-of-tooling-verification).

### E0801 `unimplemented-method`

A method call of the form `obj.method(...)` does not exist in the set of methods implemented by the runtime / code generation. This occurs from a misspelling (`.fitler`), a method that appears in the specification but is unimplemented, or misuse of a method from a different type (such as `.to-result` on `Option`).

> `Method ".<name>" is not implemented by the runtime`

**Note**: The set of implemented methods is solely authoritative in `@kumikijs/compiler`'s `KNOWN_METHODS` (kept in sync with code generation's `methodCallJs`). Calling a no-argument method with `()` is also caught by this band. For the list of standard library methods, see [Standard Library](./stdlib.md).

**Fix**: Correct it to the right method name, or rewrite the operation using implemented means such as `match` / `fold`. If you need an unimplemented specification method, implement it in `packages/` and add a working example in `examples/`.
