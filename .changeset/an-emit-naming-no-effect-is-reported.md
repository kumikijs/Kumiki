---
"@kumikijs/runtime": patch
---

An emit naming no effect in `app.effects` is reported, on both paths

Both dispatch paths dropped an emit whose name was not a key of `app.effects`,
and said nothing: no console line, no `panic` step, no `app.error`. An
`AppShape` whose emit named a misspelled effect mounted and rendered with
nothing on the console. The compiler rejects such an emit (E0104), so the
cases that reach the runtime are a `mountCore` host that leaves out a standard
effect's installer (`installToast` or `installConfirm` in `builtins`, or
`routing` for `navigate`, `navigate-replace`, `navigate-back` and
`scroll-to`), which is the one way a correctly compiled program gets here; a
host-built `AppShape`; an `effects` map edited after codegen; and a codegen or
plugin bug that drops an effect while an emit of it survives.

It is now reported the way a refused capability is, by the same reporter and
in the same header:

```
[kumiki] panic in effect "sve": effect "sve" is not declared in app.effects
```

to `console.error` on the live path and the SSR pass alike; as a `panic` step
on the episode that owns the emit; and, on the live path, to `app.error`, whose
`$event.category` is `"effect"`. That category was a reserved value until now;
`runtime.md` and `lifecycle.md` define it as an emit the dispatcher could not
run, and `capability` stays the refusal of a known effect for its capability.
Nothing was thrown, so the record carries no `stack` and no `cause`. The other
emits of the same batch still run. A name every object inherits, such as
`toString` or `constructor`, is not a key of `app.effects` either: it used to
be reported as a refused capability, under the wrong name, and is now this
report.

No `effect-start` / `effect-cancel` pair is recorded around it on either pass:
a policy is a property of an effect, and with no effect there is nothing to
defer the emit or claim a start for. The report lands on the episode in focus —
the triggering one, or the one an effect result reopens around its `.ok` /
`.err` reducer. From `app.init` it is reported as a refused capability is at
that moment: on the live path no episode is open yet, so the console and
`app.error` (with `episode-id: None`) carry it; on the server it is a `panic`
step on the bootstrap episode, which makes that episode `status: "panic"`.

The standard effects listed in stdlib.md are not this case. A live mount
installs the ones its build ships onto `app.effects` before it dispatches
anything. The server pass installs none, so an emit of a standard effect finds
no entry there and is skipped without a report, as before — otherwise every
server render of a program whose `init` emits one would print a panic and ship
a `"panic"` bootstrap. Hydration does not run `app.init` again, so in an app
rendered on the server and then hydrated, none of the seven standard effects
runs when the `init` chain emits it.
