---
"@kumikijs/compiler": minor
---

Follow an `app.init` argument through the `fn` calls it makes, and report the route it reaches

`E0120` looked at how an argument was spelled, so one `fn` hop walked straight
past it — and landed worse than the direct read it replaces. `route` is not in
the live-value table until a mount installs it, so

```kumiki
fn here() -> Text = route.path
app A … init = [load(here())]
```

lowered to `function here() { return (_live["route"])["path"]; }` reached from
`init:`, which is evaluated while the app object is being built. The direct
form throws at mount; this one throws while the module is still being
**imported**, so nothing loads at all. `check` and `build` both said ok.

The restriction is now on what an argument reaches. The call is followed
through as many hops as it takes, and the chain is in the message — a report
naming only the called `fn` sends the author to a definition that is not itself
wrong. A `fn` that reads the route stays legal everywhere else: a tile, a
reducer and an effect's `map-request` all run after the mount that installs it.

Whether a `route` in a `fn` body is the runtime's is decided by the same gate
that answers it for a direct read, asked of that body in an `app.init`
position — so a name a `let` or a parameter shadows is that binding, on both
paths alike, and `fn safe() -> Text = let route = "x" in route` keeps
compiling. The search is breadth-first and iterative: a `fn` graph is a
program's to declare, so a chain may be longer than the call stack and a cycle
may exist, and this pass terminates whether or not the cycle report is there.
