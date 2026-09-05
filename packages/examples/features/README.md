# Feature Catalog

English · [日本語](./README.ja.md)

Minimal examples, one feature per file. Each file is a self-contained, working Kumiki app, with parsing, type checking, and build verified in CI.

The tables below are a curated tour grouped by topic, not a directory listing. The complete list of what ships here is the examples table in the [spec index](../../../docs/spec/index.md), which CI keeps in exact step with the files on disk.

## Language core

| Example | Contents |
|---|---|
| [01-slot-and-reducer](./01-slot-and-reducer.kumiki) | The basic cycle of slot (state) + reducer (update) + tile (render) |
| [02-nominal-type](./02-nominal-type.kumiki) | nominal types and `between` refinement |
| [03-union-and-match](./03-union-and-match.kumiki) | union types and the `match` expression |
| [04-record-and-copy](./04-record-and-copy.kumiki) | record types and `.copy(field=value)` immutable update |
| [05-pure-fn](./05-pure-fn.kumiki) | pure functions `fn` (don't read slots) |
| [06-if-expression](./06-if-expression.kumiki) | `if ... then ... else` as a value |

## Collections and standard library

| Example | Contents |
|---|---|
| [07-list](./07-list.kumiki) | `List`'s `.map` / `.filter` / `for` |
| [08-map](./08-map.kumiki) | `Map`'s insert / get-or / keys |
| [09-set](./09-set.kumiki) | `Set`'s toggle / has |
| [10-option](./10-option.kumiki) | `Option`'s Some / None |
| [11-time-and-duration](./11-time-and-duration.kumiki) | `Time` / `Duration` arithmetic |
| [22-result](./22-result.kumiki) | `Result`'s Ok / Err and parsing |

## UI and style

| Example | Contents |
|---|---|
| [12-layout](./12-layout.kumiki) | column / row / grid and layout props |
| [13-text-input-bind](./13-text-input-bind.kumiki) | two-way `bind` for an input field |
| [14-select](./14-select.kumiki) | select with typed options |
| [15-checkbox](./15-checkbox.kumiki) | checkbox and disabled |
| [16-conditional-ui](./16-conditional-ui.kumiki) | conditional rendering with `when(...)` |
| [17-theme](./17-theme.kumiki) | theme tokens and dynamic theme switching |
| [74-common-tile-props](./74-common-tile-props.kumiki) | the props every tile accepts (`class` / `aria` / `test-id` / `role`), the sizing shorthands, and a button that is disabled while it loads |

## App level

| Example | Contents |
|---|---|
| [18-routing](./18-routing.kumiki) | path parameters, redirects, 404 |
| [19-effect-http](./19-effect-http.kumiki) | HTTP effect and the `latest` policy |
| [20-effect-storage](./20-effect-storage.kumiki) | localStorage persistence (once / debounce) |
| [39-effect-session](./39-effect-session.kumiki) | sessionStorage persistence (per-tab; same shape as `storage-*`) |
| [21-timer](./21-timer.kumiki) | periodic execution with `timer(1s)` |
| [23-lifecycle-route-enter](./23-lifecycle-route-enter.kumiki) | `app.start` / `route.enter` |
| [46-stdlib-paren-methods](./46-stdlib-paren-methods.kumiki) | paren-form stdlib methods (`is-ok()` / `values()` / `lower()` / `sort()` etc.) + `Bytes.from-text/base64/bytes` constructors |
| [61-reserved-identifier-names](./61-reserved-identifier-names.kumiki) | names that are JS reserved words (`new` / `class` / `var`) or look like runtime internals (`_live` / `_s`) |
| [62-conditional-inline-tile-handlers](./62-conditional-inline-tile-handlers.kumiki) | a conditional swapping two inline tiles that differ only in their handler |
| [76-conditional-adds-a-universal-handler](./76-conditional-adds-a-universal-handler.kumiki) | a conditional whose later branch *adds* `onFocus` / `onBlur`, which the runtime lifts rather than any renderer |
| [86-container-selector-through-reference](./86-container-selector-through-reference.kumiki) | `ui.key` / `ui.focus` / `ui.blur` / `ui.hover` on a container whose body is a tile reference, beside the inline form of the same tree |
| [63-reducer-batch-atomicity](./63-reducer-batch-atomicity.kumiki) | a refinement rejects the whole reducer batch, and the guard to write instead |
| [64-init-slot-argument](./64-init-slot-argument.kumiki) | `app.init` firing an effect with a slot reference as its argument |
| [65-prefers-dark](./65-prefers-dark.kumiki) | following the OS colour scheme with `prefers-dark()` |
| [66-value-types](./66-value-types.kumiki) | the shapes value-level type checking accepts, and the mistake each one used to hide |
| [87-replayed-environment-read](./87-replayed-environment-read.kumiki) | an episode records what `random()` / `now` answered, so replaying it reproduces the run |
| [88-string-formatting](./88-string-formatting.kumiki) | `fmt("{0}", …)` substitution — a repeated index, an index the arguments do not reach, and a `{` that opens no placeholder |

New questions and bugs are answered first by adding a minimal reproduction here.
