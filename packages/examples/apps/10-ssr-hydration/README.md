# 10 — SSR and Hydration

English · [日本語](./README.ja.md)

The server-render boundary. The app renders on the server with `app.init` already resolved, then hydrates in the browser and carries on from there.

## What you'll learn

- `app.init` firing an effect whose result is part of the SSR snapshot
- `volatile` slots, which are deliberately absent from that snapshot
- Interaction after hydration, and the episode continuity it produces
- `bind` on an input the server rendered no value for
## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/10-ssr-hydration/app.kumiki
pnpm kumiki build packages/examples/apps/10-ssr-hydration/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/10-ssr-hydration/app.kumiki
pnpm kumiki run packages/examples/apps/10-ssr-hydration/app.kumiki packages/examples/apps/10-ssr-hydration/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI. `app.http.json` is the fixture those runs answer from — the headless tiers never reach the network.

Related specs: [runtime](../../../../docs/spec/runtime.md) / [http](../../../../docs/spec/http.md)
