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

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/03-blog/app.kumiki ./out
```

Related specs: [routing](../../../spec/routing.md) / [http](../../../spec/http.md) / [lifecycle](../../../spec/lifecycle.md)
