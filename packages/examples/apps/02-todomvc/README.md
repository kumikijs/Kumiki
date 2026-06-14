# 02 — TodoMVC

English · [日本語](./README.ja.md)

The classic TodoMVC. It adds list operations and persistence, forming the skeleton of a practical app.

## What you'll learn

- Adding, removing, and updating a `List`, plus `.filter` / `.map`
- Two-way binding of input fields with `bind`
- Switching filter state (All / Active / Done)
- Persistence with `effect` + localStorage (debouncing `saveTodos`)
- Restoring state in the `app.start` lifecycle

## Run

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/02-todomvc/app.kumiki ./out
```

Related specs: [language](../../../spec/language.md) / [forms](../../../spec/forms.md) / [http](../../../spec/http.md)
