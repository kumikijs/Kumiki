# Recipes

Each recipe links to a corresponding minimal example. The fastest path is to look at the example first, then confirm the details in [Kumiki Specification](../spec/).

## State

| What you want to do | Example |
|---|---|
| Counter-like state and updates | [01-slot-and-reducer](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/01-slot-and-reducer.kumiki) |
| Constrain a value's range or format | [02-nominal-type](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/02-nominal-type.kumiki) |
| Immutably update a record | [04-record-and-copy](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/04-record-and-copy.kumiki) |
| Pure helper functions | [05-pure-fn](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/05-pure-fn.kumiki) |

## Collections

| What you want to do | Example |
|---|---|
| map / filter / render a list | [07-list](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/07-list.kumiki) |
| Add, get, remove on a Map | [08-map](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/08-map.kumiki) |
| Toggle with a Set | [09-set](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/09-set.kumiki) |
| Handle an optional value (maybe present) | [10-option](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/10-option.kumiki) |
| Represent success or failure | [22-result](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/22-result.kumiki) |
| Date-time and duration | [11-time-and-duration](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/11-time-and-duration.kumiki) |

## UI

| What you want to do | Example |
|---|---|
| Lay out in rows, columns, or grids | [12-layout](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/12-layout.kumiki) |
| Two-way binding with an input field | [13-text-input-bind](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/13-text-input-bind.kumiki) |
| Dropdown | [14-select](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/14-select.kumiki) |
| Checkbox | [15-checkbox](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/15-checkbox.kumiki) |
| Show conditionally | [16-conditional-ui](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/16-conditional-ui.kumiki) |
| Theme switching | [17-theme](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/17-theme.kumiki) |

## App Level

| What you want to do | Example |
|---|---|
| Routing, parameters, and 404 | [18-routing](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/18-routing.kumiki) |
| Fetch data over HTTP | [19-effect-http](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/19-effect-http.kumiki) |
| Persist to localStorage | [20-effect-storage](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/20-effect-storage.kumiki) |
| Periodic execution (timer) | [21-timer](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/21-timer.kumiki) |
| Work on startup or route transition | [23-lifecycle-route-enter](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/23-lifecycle-route-enter.kumiki) |

## See Combinations in Real Apps

- CRUD + Map + Option: [04-issue-tracker](https://github.com/kumikijs/Kumiki/tree/main/packages/examples/apps/04-issue-tracker)
- Nested data + Kanban + theme: [05-project-management](https://github.com/kumikijs/Kumiki/tree/main/packages/examples/apps/05-project-management)
