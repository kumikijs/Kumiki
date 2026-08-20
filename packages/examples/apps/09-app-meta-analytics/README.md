# 09 — App Meta and Analytics

English · [日本語](./README.ja.md)

Two app-level blocks that need no code of their own. `app.meta` puts the page's head metadata under the app's control, and `app.analytics` gives the `analytics.send` capability a default sink, so measurement events go somewhere without a host SDK wired in.

## What you'll learn

- `app.meta` — title, description, og-image, and favicon, reflected at mount
- `app.analytics` — provider and app-id as the default sink for `analytics.send`
- Emitting an `analytics.send` effect from a reducer, alongside a slot write
- Declaring the capability the effect needs in `caps`
## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/09-app-meta-analytics/app.kumiki
pnpm kumiki build packages/examples/apps/09-app-meta-analytics/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/09-app-meta-analytics/app.kumiki
pnpm kumiki run packages/examples/apps/09-app-meta-analytics/app.kumiki packages/examples/apps/09-app-meta-analytics/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [runtime](../../../../docs/spec/runtime.md)
