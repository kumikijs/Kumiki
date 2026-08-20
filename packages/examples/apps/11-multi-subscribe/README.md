# 11 — Multi-subscribe

English · [日本語](./README.ja.md)

Two reducers subscribing to one event. Both fire, in source order — a rule that is easier to trust once you have watched both slots advance on a single click.

## What you'll learn

- Two `reducer`s declaring the same `on=ui.click(...)`
- Source order deciding which of them writes first
- Each reducer owning its own slot, so neither has to know about the other
## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/11-multi-subscribe/app.kumiki
pnpm kumiki build packages/examples/apps/11-multi-subscribe/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/11-multi-subscribe/app.kumiki
pnpm kumiki run packages/examples/apps/11-multi-subscribe/app.kumiki packages/examples/apps/11-multi-subscribe/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [language](../../../../docs/spec/language.md)
