# 03 — Blog SPA

English · [日本語](./README.ja.md)

An SPA with routing and asynchronous data fetching. It handles list → detail navigation and loading states.

## What you'll learn

- Path matching and parameters with `app.routes` (`/posts/:id`)
- Triggering fetch in `route.enter` and the `/404` fallback
- HTTP `effect` and `latest`-style policies
- Loading and error boundaries (suspense)
- Client-side navigation with `link`

## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/03-blog/app.kumiki
pnpm kumiki build packages/examples/apps/03-blog/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/03-blog/app.kumiki
pnpm kumiki run packages/examples/apps/03-blog/app.kumiki packages/examples/apps/03-blog/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI. `app.http.json` is the fixture those runs answer from — the headless tiers never reach the network.

Related specs: [routing](../../../../docs/spec/routing.md) / [http](../../../../docs/spec/http.md) / [lifecycle](../../../../docs/spec/lifecycle.md)
