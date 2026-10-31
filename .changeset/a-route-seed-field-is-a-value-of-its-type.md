---
"@kumikijs/compiler": patch
---

A value a test writes for a `route` field is checked against that field's type in the standard `Route`

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

Each field a route record writes is now a value of that field's type in the
standard `Route` (routing.md §3.2), or a type error at that position
(**E0201**, or E0213 / E0216 for an `Option` of the wrong shape, such as
`hash: Some("a", "b")`):

> `Expected Text but got Int` — at the `7`
>
> `Expected Option(Text) but got Text` — at the `"top"`

The same field types hold for `route` in an `expect.slots` and a
`slots-equal` record. Each field's type is the standard `Route`'s, because the
slot holds the runtime's route. A seed may still name only the fields it needs, and a wildcard in a
`reducer-test` `expect` field is still not held to a type. A `route` in an
`expect.slots` or a `slots-equal` that leaves fields out still checks `ok`,
although it is compared against the whole route and so can never match.

testing.md §8.1.1 now states the rule for every slot value a test writes, and
§8.2.5 for the route's fields (en + ja). §8.1.1 also records, as a known gap,
that a value the checker does not infer (an empty `{}` written for a type that
is not a collection, the result of a `.map`) is not yet held to the slot's
type, in a test as in a slot's initializer. Example
`211-test-slot-seed-type.kumiki` writes a well-typed slot value in each test
kind, the multi-step reducer-test and `slots-equal` included.
