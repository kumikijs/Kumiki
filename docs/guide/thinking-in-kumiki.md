# Thinking in Kumiki

## 7 Layers = Separation of Roles

A Kumiki app is a collection of 7 kinds of definitions. There are no file boundaries or modules; each definition refers to others by name.

| layer | In a word | React equivalent |
|---|---|---|
| `type` | Shape of the domain | TypeScript types |
| `slot` | State | `useState` |
| `effect` | Side effects on the outside world | `useEffect` + a fetch wrapper |
| `reducer` | Event → state update | Event handler + setState |
| `tile` | UI component | Component (JSX) |
| `fn` | Pure function | Just a function (but cannot read state) |
| `app` | Root (caps/routes/init/theme) | Root configuration + router |

## Eliminate the Implicit

Kumiki has no rules about the order of Hook calls, no dependency arrays, and no implicit scoping via Context.

- **State lives in `slot`**, consolidated and changed only via `:=` in a `reducer`. You can trace, in the text, where and what gets rewritten.
- **Side effects are confined to `effect`**, and the required **capability** is declared explicitly in `app.caps`. Using a capability not in the declaration triggers [E0301](../spec/errors.md#e0301-missing-capability).
- **`fn` is pure**. It cannot read a slot ([E0305](../spec/errors.md#e0305-fn-impurity)). This makes it easy to test, and easy for AI to reason about.

## One Write per Reducer (Path-Shape Granularity)

Writing to the same **path shape** multiple times within a single reducer triggers [E0601](../spec/errors.md#e06xx---reducer-write-rules). This guarantees that "updates are consolidated in one place," making partial edits safe.

```kumiki
# NG: double write to tasks
tasks := tasks.remove(id)
tasks := tasks.filter(pred)

# OK: a single chained call
tasks := tasks.remove(id).filter(pred)
```

`tasks[id].status` and `tasks[id].updatedAt` are different shapes, so they can coexist.

## A Design Easy for AI to Partially Edit

Because each definition is independent and references are explicit, `@kumikijs/cli` / `@kumikijs/mcp` can list / view / add / replace / remove / rename / fix at the **per-definition** level. This is the core of the goal that "AI can work in parallel." For details, see [AI Editing](../spec/ai-edit.md).
