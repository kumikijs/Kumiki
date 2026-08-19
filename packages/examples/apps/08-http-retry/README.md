# 08 — HTTP Retry

English · [日本語](./README.ja.md)

The same fetch as 07, with a retry policy on it. `retry=exponential(3, 200ms, 2.0)` makes the runtime retry 5xx and connection errors with exponential backoff, and leaves a 4xx as a final failure.

## What you'll learn

- Declaring `retry=exponential(attempts, delay, factor)` on an HTTP effect
- Which failures are retried (5xx, connection) and which are not (4xx)
- Combining `retry` with `policy=latest`
- Reporting the failure that survives every attempt through an `.err` reducer
## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/08-http-retry/app.kumiki
pnpm kumiki build packages/examples/apps/08-http-retry/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/08-http-retry/app.kumiki
pnpm kumiki run packages/examples/apps/08-http-retry/app.kumiki packages/examples/apps/08-http-retry/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI. `app.http.json` is the fixture those runs answer from — the headless tiers never reach the network.

Related specs: [http](../../../../docs/spec/http.md)
