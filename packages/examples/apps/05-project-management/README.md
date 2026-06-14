# 05 — Project Management

English · [日本語](./README.ja.md)

The largest reference app (~1255 lines). It covers a full range of elements that real apps need: nested data, kanban, and theme switching.

## What you'll learn

- A nested data model of projects / tasks / comments (multi-level `Map` composition)
- A kanban board and status transitions (`nextStatus`)
- Parent-child tasks (`parentTaskId: Option<TaskId>`) and cascading on delete
- Adding and removing tags and comments
- Reducers that follow the path-shape-granularity 1-write rule (`tasks[id].status` and `tasks[id].updatedAt` can coexist)
- Dynamic theme switching (`app.theme = slotName`)

## Run

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/05-project-management/app.kumiki ./out
```

Related specs: [language](../../../spec/language.md) / [stdlib](../../../spec/stdlib.md) / [style](../../../spec/style.md) / [errors](../../../spec/errors.md)
