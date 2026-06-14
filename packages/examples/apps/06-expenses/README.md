# 06 — Expense Tracker

English · [日本語](./README.ja.md)

A small app that adds and removes expenses and has a total plus a "large expenses only" filter. It covers aggregation with `Map` + `fold` and numeric parsing.

This app was built as a **demo of the autonomous iterate loop**, and in the process it detected and fixed two framework bugs:

- `List.fold` codegen was unimplemented (`_d_1 is not defined`) — caught at the smoke layer.
- `Int.parse` returned a string instead of converting to a number (the total broke via string concatenation, a non-exception bug) — caught by state/DOM assertions at the scenario layer.

## What you'll learn

- CRUD on `Map(Id, V)` and computing a total with `.values.fold(0, $1 + $2.amount)`
- Parsing input with `Int.parse(text).get-or(0)`
- A filter toggle and a total that is unaffected by the filter
- Clearing the input field after adding

## Validation

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts smoke examples/apps/06-expenses/app.kumiki
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts run   examples/apps/06-expenses/app.kumiki examples/apps/06-expenses/scenario.json
```

`scenario.json` distills the requirements into executable acceptance criteria (AC). `tests/` runs them in CI.
