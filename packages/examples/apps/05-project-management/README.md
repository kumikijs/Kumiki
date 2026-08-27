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

Every command below is run **from the repository root**.

```sh
pnpm kumiki check packages/examples/apps/05-project-management/app.kumiki
pnpm kumiki build packages/examples/apps/05-project-management/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/05-project-management/app.kumiki
pnpm kumiki run packages/examples/apps/05-project-management/app.kumiki packages/examples/apps/05-project-management/scenario.json
```

`scenario.json` distills this app's requirements into executable acceptance criteria; [`packages/tests/`](../../../tests/) replays it in CI.

Related specs: [language](../../../../docs/spec/language.md) / [stdlib](../../../../docs/spec/stdlib.md) / [style](../../../../docs/spec/style.md) / [errors](../../../../docs/spec/errors.md)
