# 07 — App-level HTTP

English · [日本語](./README.ja.md)

One HTTP configuration for the whole app. `app.http` carries the base URL, the headers every request sends, the timeout, and the reducer an unauthorized response routes to, so no individual effect has to repeat them.

## What you'll learn

- Setting `base-url` once, so each effect's `map-request` names only a path
- Headers built from a slot (`X-Session`), so they follow the state
- `on-401` routing an unauthorized response to a reducer
- `timeout` and `credentials` declared at the app level
- Rendering a `Result` with `match` — spinner, card, error text
## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/07-app-http/app.kumiki
pnpm kumiki build packages/examples/apps/07-app-http/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/07-app-http/app.kumiki
pnpm kumiki run packages/examples/apps/07-app-http/app.kumiki packages/examples/apps/07-app-http/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI. `app.http.json` is the fixture those runs answer from — the headless tiers never reach the network.

Related specs: [http](../../../../docs/spec/http.md)
