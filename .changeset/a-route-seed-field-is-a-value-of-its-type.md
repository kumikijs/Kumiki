---
"@kumikijs/compiler": patch
---

Check a test's `route` seed field by field against the standard `Route`

A slot value a test writes — a `given.slots` seed, an `expect.slots` value, an
`episode-test`'s `slots-equal` record — is checked against the slot's declared
type, in every test kind. `route` was the one slot left out. A program cannot
declare it (the runtime maintains it), so the checker only asked that its seed
be a record naming route fields, and never looked at the values:

```kumiki
test locate = reducer-test locate
    given  = {slots: {at: "", route: {params: {"id": 7}, hash: "top"}},
              event: {type: ui.click, target: WhereBtn}}
    expect = {slots: {at: "7#top"}}
```

```
$ kumiki check a.kumiki
ok
$ kumiki test a.kumiki
PASS  locate
```

The harness fills in only the fields a seed leaves out, so these reached the
reducer as written: a number where `params` holds `Text`, a bare `"top"` where
`hash` holds an `Option(Text)`. The test passed against a route the app can
never be on, and `route: {path: 5}` gave a `route.path.length` of `undefined`.

Each field a route seed writes is now a value of that field's type in the
standard `Route` (routing.md §3.2), or **E0201** at the value:

> `Expected Text but got Int` — at the `7`
>
> `Expected Option(Text) but got Text` — at the `"top"`

The same holds for `route` in an `expect.slots` and a `slots-equal` record.
The type is the runtime's whatever a program's own `type Route` declares,
because that is what the slot holds. A seed may still name only the fields it
needs, and an `expect` wildcard still stands for any value.

testing.md §8.1.1 now states the rule for every slot value a test writes, and
§8.2.5 for the route's fields (en + ja). Example
`211-test-slot-seed-type.kumiki` writes a well-typed slot value in each test
kind, the multi-step reducer-test and `slots-equal` included.
