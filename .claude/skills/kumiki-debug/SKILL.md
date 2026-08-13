---
name: kumiki-debug
description: Diagnose and fix Kumiki compiler errors. Use when `kumiki check`/`build` reports a diagnostic (E0001..E08xx, W02xx) or a parse error, or when a built Kumiki app misbehaves in the browser. Covers the error/warning catalog, common root causes, and the auto-fix tool.
---

# Debugging Kumiki

## First: get the diagnostic

```sh
pnpm --filter @kumiki/cli exec tsx src/kumiki.ts check <file>
```

Or `kumiki_check` via `@kumiki/mcp`. Each diagnostic has a stable `code` (E0xxx) documented in `docs/spec/errors.md`. Read that entry first — it states the rule and the fix.

## Error code map (see docs/spec/errors.md for detail)

| code | meaning | usual fix |
|---|---|---|
| `E0001` | `app.routes` missing `/404` | add `"/404" -> NotFound` |
| `E0003` | no `app` definition (an empty file counts) | add the `app` entry point; expected while a program is still being assembled with the editing verbs, which do not enforce it |
| `E0004` | more than one `app` definition — codegen keeps the first and drops the rest | remove or merge the extra; `replace` the app instead of adding a second |
| `E0005` | a tile expands into itself, directly or through other tiles | break the loop — repetition belongs in `for`, alternatives in `when` / `match` |
| `E0006` | a `fn` calls itself, directly or through other functions | rewrite as `fold` / `map` / `filter` over the data |
| `E0007` | two definitions of one layer share a name — only one of them takes effect | delete or rename one |
| `E0008` | a name written twice inside one construct (app/effect/tile clause, record key or field, map key, tile argument or prop, fn/type parameter, `for-all` generator, union tag, route pattern) | delete the later one |
| `E0102` | undefined reducer in a handler | fix the reducer name; try `kumiki_fix` |
| `E0103` | undefined name / slot | declare it, or fix the spelling |
| `E0104` | undefined effect in `emit`, `app.init`, or an `on=<effect>.ok/.err` selector | declare the effect or fix the name |
| `E0105` | undefined tile (incl. route target) | declare the tile or fix the name |
| `E0117` | a type name resolves to nothing | fix the spelling, define the type, or add it to the enclosing `type`'s parameter list; try `kumiki_fix` |
| `E0118` | `app.theme` names neither a `theme` definition nor a slot | fix the spelling, or declare the theme; try `kumiki_fix` |
| `E0201` | a value does not have the type its position requires (slot init, assignment, `fn` argument / return, tile `in=`, operator operand) | correct the value, or widen the declared type |
| `E0202` | an `emit` argument does not match the effect's `in=` | pass a value of the declared type |
| `E0211` | a reducer's `ui.*` selector or `tile.mount` / `tile.unmount` names an undeclared tile | declare the tile or fix the name; try `kumiki_fix` |
| `E0213` | wrong argument count: `fn` call, `emit`, user-tile call, or variant payload | pass the declared number |
| `E0214` | a record literal is missing a declared field | supply it — Kumiki records have no optional fields |
| `E0215` | a record literal / `.copy(f=v)` names a field the type does not have | fix the name, or declare it on the type |
| `E0216` | a variant constructor names a tag the union does not have | use a declared tag; try `kumiki_fix` |
| `E0217` | an `Int` literal past 2^53-1 would be rounded | use a value in range, or carry it as `Text` |
| `E0301` | effect needs a capability not in `app.caps` — including a standard effect (`navigate`, `toast`, `log`, …), which is gated on the cap it is registered behind | add the cap to `caps = [...]` |
| `E0304` | a slot's initial value reads a slot (its own or another's) | give it a standalone value and derive the rest in a `fn` |
| `E0305` | a `fn` reads a slot | pass the value as an argument |
| `E0601` | a slot path-shape is written twice in one reducer | chain the writes into one assignment |
| `E0701`–`E0703` | a11y: button/image/link missing text/alt/aria | add visible text or `aria-label`/`alt` |
| `E0801` | `obj.method(...)` calls a method the runtime doesn't implement (typo, or unimplemented/wrong-type method like `Option.to-result`) | fix the name or rewrite with an implemented op (`match`, `fold`, …); see `KNOWN_METHODS` / docs/spec/stdlib.md |
| `E0000` | parse error (from the lexer/parser) | check the position; look for a missing `)` / wrong keyword |
| `W0212` | `ui.<ev>(Tile)` reducer subscribes to a tile whose root builtin never fires `<ev>` — silent no-op | re-target the selector at a focusable/event-capable tile, or wire the handler explicitly (`input(onFocus=r)`). See docs/spec/errors.md for the per-event allowed-kinds table. |

## Auto-fix

For name-resolution errors, the compiler can suggest the closest existing name. `E0104` (effects + the standard effects), `E0106` (timer names), `E0116` (fn + built-in calls), `E0117` (type names), `E0118` (theme + slot names), `E0209` / `E0216` (variant tags) are scoped to their own namespace, so a slot is never proposed where a type belongs; `E0102`, `E0103`, `E0105`, `E0107` and `E0211` search all top-level definitions.

```sh
pnpm --filter @kumiki/cli exec tsx src/kumiki.ts fix <file>          # show planned fixes
pnpm --filter @kumiki/cli exec tsx src/kumiki.ts fix <file> --apply  # apply them
```

Both forms exit `1` while the file still has errors, so the first one exits `1`
whenever it has anything to propose — that is the proposal succeeding, not
failing. Read the output, not the code, until `--apply` reports the file clean.

Or `kumiki_fix` via `@kumiki/mcp`.

## Warnings (W-codes)

`Wxxxx` diagnostics are non-fatal: `kumiki check` exits 0 and prints `ok (N warning(s))`. They still indicate real bugs — the warning catalog (currently just `W0212`) flags subscriptions whose handler is silently dropped, meaning the reducer never fires. If `smoke` reports "interaction did nothing," scan the warning lines first.

## "It checks but misbehaves at runtime"

`check`/`build` prove parse + typecheck + codegen; they do NOT prove the app runs. First reach for the runtime smoke test, which mounts the app in a headless DOM and drives its UI:

```sh
pnpm --filter @kumiki/cli exec tsx src/kumiki.ts smoke <file>
```

Or `kumiki_smoke` via `@kumiki/mcp`. It reports the failing phase and the interaction that triggered it (e.g. `[interaction] (...).to_result is not a function (on input input[0])`) — catching throws, empty renders, and unhandled rejections that compilation misses.

There are three verification layers; each catches what the previous cannot:

1. **`check` / `build`** — syntax, types, codegen.
2. **`smoke`** — *does it run?* mount + auto-exercise; catches runtime throws / empty render. Generic, no per-app knowledge.
3. **example-specific assertions** (in `packages/tests/` or `packages/cli/test/`) — *is the result correct?* the only layer that catches wrong-but-non-throwing behavior (e.g. a select that always yields the last option). Smoke cannot judge correctness, only liveness.

When you find a runtime bug: add a minimal reproducing `packages/examples/features/*.kumiki` (CI smoke-tests it automatically), then fix. Most runtime bugs are a wrong method dispatch (List vs Map vs Option), a method the runtime doesn't implement, a missing `key=` on a `for`-rendered tile, or a bind-path issue. Runtime fixes live in `packages/runtime/src/index.ts`; codegen fixes in `packages/compiler/src/codegen.ts`. Keep `pnpm exec turbo run test` green.
