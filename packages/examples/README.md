# Kumiki Examples

English · [日本語](./README.ja.md)

This directory is the set of working examples for Kumiki. As an operating policy, every time a question, issue, or bug report comes in, an example is added here, keeping the state where "looking at the repository resolves your question".

All examples have parsing, type checking, and build verified in CI (→ [packages/tests](../tests/)). Broken examples are not merged.

## Structure

### `features/` — per-feature minimal examples

One feature per file. It shows each element of the language with a minimal app focused on just that. A catalog for instantly answering "how do I write this syntax again?".

[`features/README.md`](./features/) is a curated tour grouped by topic. The complete list of what is in the directory lives in the [spec index](../../docs/spec/index.md), which CI keeps in exact step with the files on disk.

### `apps/` — complete apps ordered by size

From small to large. Shows how features combine in real apps.

<!-- apps:start -->

| App | Lines | Main takeaways |
|---|---|---|
| [01-counter](./apps/01-counter/) | 26 lines | slot / reducer / tile / events |
| [02-todomvc](./apps/02-todomvc/) | 161 lines | lists, filters, `bind`, localStorage persistence |
| [03-blog](./apps/03-blog/) | 418 lines | routing, HTTP fetch, suspense |
| [04-issue-tracker](./apps/04-issue-tracker/) | 727 lines | CRUD, `Map`, `Option` variants, forms, dates |
| [05-project-management](./apps/05-project-management/) | 1254 lines | nested data, kanban, comments, tags, theme switching |
| [06-expenses](./apps/06-expenses/) | 56 lines | aggregation with `Map` + `fold`, `Int.parse`, a filter that leaves the total alone |
| [07-app-http](./apps/07-app-http/) | 44 lines | `app.http` — one base URL, shared headers, `on-401`, timeout |
| [08-http-retry](./apps/08-http-retry/) | 36 lines | `retry=exponential(…)` — backoff on 5xx, no retry on 4xx |
| [09-app-meta-analytics](./apps/09-app-meta-analytics/) | 32 lines | `app.meta` head metadata, `app.analytics` as the default sink |
| [10-ssr-hydration](./apps/10-ssr-hydration/) | 42 lines | the SSR snapshot, `volatile` slots, interaction after hydration |
| [11-multi-subscribe](./apps/11-multi-subscribe/) | 23 lines | two reducers on one event, firing in source order |

<!-- apps:end -->

## How to run

Every command below is run **from the repository root**.

```sh
# Type check
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki

# Build (outputs index.html / app.js / runtime/ — only the runtime modules the app uses)
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out

# Mount it in a headless DOM and interact with it
pnpm kumiki smoke packages/examples/apps/01-counter/app.kumiki

# Replay the app's acceptance criteria
pnpm kumiki run packages/examples/apps/01-counter/app.kumiki packages/examples/apps/01-counter/scenario.json
```

`check` and `build` answer for syntax, types, and codegen only. Whether an app mounts and survives interaction is what `smoke` and `run` answer for — see [the verification tiers](../../docs/spec/testing.md).
