# 02 — TodoMVC

English · [日本語](./README.ja.md)

The classic TodoMVC. It adds list operations and persistence, forming the skeleton of a practical app.

## What you'll learn

- Adding, removing, and updating entries of a `Map`, plus `.filter`
- Two-way binding of input fields with `bind`, and a form submitted by its Add button or Enter
- A refinement on the draft (`len-lt(280)`) shown by `error(field=draft)` while the form holds the submit back
- Switching filter state (All / Active / Done), with the current tab styled by `bg` / `color`
- Persistence with `effect` + localStorage (debouncing `saveTodos`)
- Restoring state in the `app.start` lifecycle

## Run

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/02-todomvc/app.kumiki
pnpm kumiki build packages/examples/apps/02-todomvc/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/02-todomvc/app.kumiki
pnpm kumiki run packages/examples/apps/02-todomvc/app.kumiki packages/examples/apps/02-todomvc/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [language](../../../../docs/spec/language.md) / [forms](../../../../docs/spec/forms.md) / [http](../../../../docs/spec/http.md)
