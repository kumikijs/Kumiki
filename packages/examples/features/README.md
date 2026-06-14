# Feature Catalog

English · [日本語](./README.ja.md)

Minimal examples, one feature per file. Each file is a self-contained, working Kumiki app, with parsing, type checking, and build verified in CI.

## Language core

| Example | Contents |
|---|---|
| [01-slot-and-reducer](https://github.com/kage1020/Kumiki/blob/main/examples/features/01-slot-and-reducer.kumiki) | The basic cycle of slot (state) + reducer (update) + tile (render) |
| [02-nominal-type](https://github.com/kage1020/Kumiki/blob/main/examples/features/02-nominal-type.kumiki) | nominal types and `between` refinement |
| [03-union-and-match](https://github.com/kage1020/Kumiki/blob/main/examples/features/03-union-and-match.kumiki) | union types and the `match` expression |
| [04-record-and-copy](https://github.com/kage1020/Kumiki/blob/main/examples/features/04-record-and-copy.kumiki) | record types and `.copy(field=value)` immutable update |
| [05-pure-fn](https://github.com/kage1020/Kumiki/blob/main/examples/features/05-pure-fn.kumiki) | pure functions `fn` (don't read slots) |
| [06-if-expression](https://github.com/kage1020/Kumiki/blob/main/examples/features/06-if-expression.kumiki) | `if ... then ... else` as a value |

## Collections and standard library

| Example | Contents |
|---|---|
| [07-list](https://github.com/kage1020/Kumiki/blob/main/examples/features/07-list.kumiki) | `List`'s `.map` / `.filter` / `for` |
| [08-map](https://github.com/kage1020/Kumiki/blob/main/examples/features/08-map.kumiki) | `Map`'s insert / get-or / keys |
| [09-set](https://github.com/kage1020/Kumiki/blob/main/examples/features/09-set.kumiki) | `Set`'s toggle / has |
| [10-option](https://github.com/kage1020/Kumiki/blob/main/examples/features/10-option.kumiki) | `Option`'s Some / None |
| [11-time-and-duration](https://github.com/kage1020/Kumiki/blob/main/examples/features/11-time-and-duration.kumiki) | `Time` / `Duration` arithmetic |
| [22-result](https://github.com/kage1020/Kumiki/blob/main/examples/features/22-result.kumiki) | `Result`'s Ok / Err and parsing |

## UI and style

| Example | Contents |
|---|---|
| [12-layout](https://github.com/kage1020/Kumiki/blob/main/examples/features/12-layout.kumiki) | column / row / grid and layout props |
| [13-text-input-bind](https://github.com/kage1020/Kumiki/blob/main/examples/features/13-text-input-bind.kumiki) | two-way `bind` for an input field |
| [14-select](https://github.com/kage1020/Kumiki/blob/main/examples/features/14-select.kumiki) | select with typed options |
| [15-checkbox](https://github.com/kage1020/Kumiki/blob/main/examples/features/15-checkbox.kumiki) | checkbox and disabled |
| [16-conditional-ui](https://github.com/kage1020/Kumiki/blob/main/examples/features/16-conditional-ui.kumiki) | conditional rendering with `when(...)` |
| [17-theme](https://github.com/kage1020/Kumiki/blob/main/examples/features/17-theme.kumiki) | theme tokens and dynamic theme switching |

## App level

| Example | Contents |
|---|---|
| [18-routing](https://github.com/kage1020/Kumiki/blob/main/examples/features/18-routing.kumiki) | path parameters, redirects, 404 |
| [19-effect-http](https://github.com/kage1020/Kumiki/blob/main/examples/features/19-effect-http.kumiki) | HTTP effect and the `latest` policy |
| [20-effect-storage](https://github.com/kage1020/Kumiki/blob/main/examples/features/20-effect-storage.kumiki) | localStorage persistence (once / debounce) |
| [39-effect-session](https://github.com/kage1020/Kumiki/blob/main/examples/features/39-effect-session.kumiki) | sessionStorage persistence (per-tab; same shape as `storage-*`) |
| [21-timer](https://github.com/kage1020/Kumiki/blob/main/examples/features/21-timer.kumiki) | periodic execution with `timer(1s)` |
| [23-lifecycle-route-enter](https://github.com/kage1020/Kumiki/blob/main/examples/features/23-lifecycle-route-enter.kumiki) | `app.start` / `route.enter` |

New questions and bugs are answered first by adding a minimal reproduction here.
