---
"@kumikijs/runtime": patch
---

Take the same option for a `{choose}` step at both scenario tiers

An option carries two strings a step could mean, its label and its value, and
the two tiers asked for them differently. The scenario tier took the first
option carrying either, in document order; the browser tier asked for a label
first. One step could land on different options in each:

```kumiki
fn picks() -> List({label: Text, value: Text})
   = [{label: "Ay", value: "a"}, {label: "Bee", value: "b"}, {label: "\"b\"", value: "c"}]
tile Box  = box(text("not a select")) {id: "box"}
tile Lbl  = label("pick one", for="pick") {id: "lbl"}
tile Pick = select(bind=pick, options=picks()) {id: "pick"}
```

```
$ kumiki run app.kumiki choose.json
[FAIL] step 0: choose #pick=""b""
    assert: state pick: expected "c", got "b"
[FAIL] step 1: choose #lbl="Bee"
    action failed: undefined is not iterable (cannot read property Symbol(Symbol.iterator))
[FAIL] step 2: choose #box="Ay"
    action failed: undefined is not iterable (cannot read property Symbol(Symbol.iterator))
```

The `select` tile writes each value into its option as JSON, so `"b"` is both
the value of the option labelled Bee and the label of the third option. The
browser tier took the third option, and the scenario tier took Bee. A `<label>`
that the browser tier followed to its select, and a selector that matched no
select at all, both failed with a `TypeError` that named neither.

Both tiers now ask one function, `chooseOption`, exported from
`@kumikijs/runtime`. It takes the option whose label is the step's value,
comparing with whitespace trimmed and runs of it collapsed on both sides. Only
when no option carries that label does it take the option whose value matches
exactly. A selector matching a `<label>` drives the select the label is for. A
step on anything else is refused in the words `{fill}` uses for its own
refusal:

```
[ok] step 0: choose #pick=""b""
[ok] step 1: choose #lbl="Bee"
[FAIL] step 2: choose #box="Ay"
    action failed: #box matched <div>, which holds no options to choose — choose targets a select
```

A select with no matching option still fails with
`no option "Zed" in select #pick`. Every value that chose an option of a `select`
tile before still chooses one. Only a value that is both one option's label and
another option's value now lands differently, on the labelled option, which is
where the browser tier already put it.
