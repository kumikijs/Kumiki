# 07 — HTTP

English · [日本語](./README.ja.md)

One HTTP configuration for the whole app, and a retry policy on the effect that uses it. `app.http` carries the base URL, a header built from a slot, the reducer a 401 routes to, the timeout and the credentials mode, so the effect names only its path. `retry=exponential(3, 200ms, 2.0)` makes the runtime retry 5xx and connection errors with backoff, and leaves a 4xx as the final failure.

## What you'll learn

- Setting `base-url` once, so each effect's `map-request` names only a path
- A header built from a slot (`X-Session`), so it follows the state — sign in and the next request carries the new value
- `on-401` routing an unauthorized response to an `on=app.http-401` reducer
- `timeout` and `credentials` declared at the app level
- `retry=exponential(attempts, delay, factor)`: what is retried (5xx, connection errors) and what is not (4xx), alongside `policy=latest`
- Rendering the load with `match` — spinner, card, error text

## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/07-http/app.kumiki
pnpm kumiki build packages/examples/apps/07-http/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/07-http/app.kumiki
pnpm kumiki run packages/examples/apps/07-http/app.kumiki packages/examples/apps/07-http/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI. `app.http.json` is the fixture the showcase answers from: two 503s, then the quote, so the first load visibly retries.

Related specs: [http](../../../../docs/spec/http.md)
