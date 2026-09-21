---
"@kumikijs/runtime": minor
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

Fail a `{dispatch}` step that drives nothing

`{dispatch}` is the one action verb that does not go through a selector: it
names a reducer, and the `_dispatch` seam returns silently when the name matches
nothing. So a fixture left behind by a rename kept passing:

```json
{ "do": { "dispatch": "addTodo" }, "expect": { "state": { "todos": "" } } }
```

```
$ kumiki run todos.kumiki renamed.json
[ok] step 0: dispatch addTodo
scenario passed
```

The reducer never ran, the slot was still at its initial value, and the
assertion happened to describe that value — the same shape as the failed
actions that became `actionError`, for the verb that change did not reach.

A step naming a reducer the app does not have now fails, on `actionError`, where
neither `errorIncludes` nor `noErrors` can see it:

```
[FAIL] step 0: dispatch addTodo
    action failed: no reducer named "addTodo"
```

A name close to one that exists is named, under the same threshold `kumiki fix`
repairs with — at most two edits, or a quarter of the written name's length.
A rename that genuinely renames is usually further than that, and a suggestion
that is not the name the author meant sends the repair at the wrong one:

```
    action failed: no reducer named "addTodoIten" — did you mean "addTodoItem"?
```

A step naming an `on=ui.click(Tile#id)` reducer without the matching `{"id": …}`
in its payload fails the same way. On the click path §1.6.2's id filter is the
feature — the runtime calls the seam once per same-tile reducer and the
mismatched ones drop out — but an explicit `{dispatch}` step names one reducer
and asks for it, so one that cannot reach it drove nothing:

```
action failed: reducer "scopedMiss" is scoped to #edit (§1.6.2), so this step
drives nothing — pass payload {"id": "edit"}
```

The check is a precondition in the runner, not a throw in the seam: `_dispatch`
is production code that every codegen'd handler reaches, and making it throw
would change what an app does to enforce a test-harness contract. A `{dispatch}`
or `{navigate}` on a shape carrying no seam at all now fails too, rather than
doing nothing and reporting nothing.

`@kumikijs/e2e` asks the same question through the same function, so §8.10's
"exactly as at the scenario tier" holds for this verb as well.

`@kumikijs/runtime` also gains `levenshtein` / `nearestName` (the did-you-mean
metric and the ranking built on it, moved down from `@kumikijs/compiler`, which
re-exports them) on a `./text-distance` subpath, and `dispatchFault` — the rule
both tiers ask.
