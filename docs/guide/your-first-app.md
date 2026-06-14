# Your First App — Counter

Build a working Counter by adding the 7 layers one at a time. The finished version is [01-counter](https://github.com/kage1020/Kumiki/blob/main/packages/examples/apps/01-counter/app.kumiki).

## 1. Declare State (slot)

```kumiki
slot count : Int = 0
```

A `slot` is mutable state. It has a type and an initial value.

## 2. Write Updates (reducer)

```kumiki
reducer inc on=ui.click(IncBtn) do= count := count + 1
```

`on=` is the event (here, a click on the tile `IncBtn`), and `do=` is the state update. `:=` is assignment.

## 3. Assemble the UI (tile)

```kumiki
tile IncBtn = button(text="+1", onClick=inc)
tile App    = column(heading("Count: " + count.show), IncBtn)
```

A `tile` is a UI component. `onClick=inc` binds the click to the reducer. `count.show` stringifies the number.

## 4. Tie It Together (app)

```kumiki
app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

`routes` must always include `/404` (otherwise [E0001](../spec/errors.md#e0001-missing-404)).

## 5. Check and Run

```sh
kumiki check counter.kumiki
kumiki build counter.kumiki ./out
```

## Going Further

- Constrain a value's range → nominal type + refinement ([02-nominal-type](https://github.com/kage1020/Kumiki/blob/main/packages/examples/features/02-nominal-type.kumiki))
- Two-way binding with an input field → `bind` ([13-text-input-bind](https://github.com/kage1020/Kumiki/blob/main/packages/examples/features/13-text-input-bind.kumiki))
- Render a list → `for ... in` ([07-list](https://github.com/kage1020/Kumiki/blob/main/packages/examples/features/07-list.kumiki))

For the big picture of how to think about it, head to [Thinking in Kumiki](./thinking-in-kumiki.md).
