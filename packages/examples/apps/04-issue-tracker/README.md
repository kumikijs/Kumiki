# 04 — Issue Tracker

English · [日本語](./README.ja.md)

A mid-sized, CRUD-centric app (~726 lines). You'll learn a `Map`-based data model and branching on `Option` variants.

## What you'll learn

- Create, update, and delete with a `Map` as the store (immutable updates via `.copy(field=value)`)
- `match` branching on `Option` / user-defined variants (nested payloads such as `Some(Backlog)`)
- Form input and focus retention
- Changing status and priority via `select` / dropdowns
- Setting and displaying due dates (`Time`)
- Adding and removing tags

## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/04-issue-tracker/app.kumiki
pnpm kumiki build packages/examples/apps/04-issue-tracker/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/04-issue-tracker/app.kumiki
pnpm kumiki run packages/examples/apps/04-issue-tracker/app.kumiki packages/examples/apps/04-issue-tracker/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [language](../../../../docs/spec/language.md) / [stdlib](../../../../docs/spec/stdlib.md) / [forms](../../../../docs/spec/forms.md)
