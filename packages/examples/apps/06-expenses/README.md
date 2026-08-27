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

## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/06-expenses/app.kumiki
pnpm kumiki build packages/examples/apps/06-expenses/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/06-expenses/app.kumiki
pnpm kumiki run packages/examples/apps/06-expenses/app.kumiki packages/examples/apps/06-expenses/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [stdlib](../../../../docs/spec/stdlib.md) / [testing](../../../../docs/spec/testing.md)
