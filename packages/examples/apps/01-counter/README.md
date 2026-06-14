# 01 — Counter

English · [日本語](./README.ja.md)

The smallest Kumiki app. With this alone, you get one full cycle of "state, update, render."

## What you'll learn

- Declaring state with `slot`
- Writing `on=` (event) → `do=` (state update) in a `reducer`
- Building UI with `tile` and wiring a `button` click to a reducer
- Tying everything together with `app`

## Run

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/01-counter/app.kumiki ./out
```

Related specs: [language](../../../spec/language.md)
