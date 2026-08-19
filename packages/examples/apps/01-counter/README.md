# 01 — Counter

English · [日本語](./README.ja.md)

The smallest Kumiki app. With this alone, you get one full cycle of "state, update, render."

## What you'll learn

- Declaring state with `slot`
- Writing `on=` (event) → `do=` (state update) in a `reducer`
- Building UI with `tile` and wiring a `button` click to a reducer
- Tying everything together with `app`

## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/01-counter/app.kumiki
pnpm kumiki run packages/examples/apps/01-counter/app.kumiki packages/examples/apps/01-counter/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [language](../../../../docs/spec/language.md)
