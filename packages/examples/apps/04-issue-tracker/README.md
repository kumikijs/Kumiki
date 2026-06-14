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

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/04-issue-tracker/app.kumiki ./out
```

Related specs: [language](../../../spec/language.md) / [stdlib](../../../spec/stdlib.md) / [forms](../../../spec/forms.md)
