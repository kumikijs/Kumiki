---
"@kumikijs/runtime": patch
---

Report an emit that names no effect

Both dispatch paths dropped an emit whose name was not a key of `app.effects`,
and said nothing: no console line, no `panic` step, no `app.error`. An app whose
only emit named a misspelled effect mounted, rendered, and passed `check`,
`build`, `smoke` and `scenario`. The compiler rejects such an emit (E0104), so
the cases that reach the runtime are a host-built `AppShape`, an `effects` map
edited after codegen, and a codegen or plugin bug that drops an effect while an
emit of it survives.

It is now reported the way a refused capability is, by the same reporter and
in the same header:

```
[kumiki] panic in effect "sve": effect "sve" is not declared in app.effects
```

to `console.error` on the live path and the SSR pass alike; as a `panic` step
on the episode that owns the emit; and, on the live path, to `app.error`, whose
`$event.category` is `"effect"`. That category was a reserved value until now;
`runtime.md` §10.5.1 and `lifecycle.md` §7.2.3 define it as an emit the
dispatcher could not run, and `capability` stays the refusal of a known effect
for its capability. Nothing was thrown, so the record carries no `stack` and no
`cause`. The other emits of the same batch still run.

No `effect-start` / `effect-cancel` pair is recorded around it on either pass:
a policy is a property of an effect, and with no effect there is nothing to
defer the emit or claim a start for. The report lands on the episode in focus —
the triggering one, or the one an effect result reopens around its `.ok` /
`.err` reducer. From `app.init` it is reported as a refused capability is at
that moment: on the live path no episode is open yet, so the console and
`app.error` (with `episode-id: None`) carry it; on the server it is a `panic`
step on the bootstrap episode, which makes that episode `status: "panic"`.

The standard effects (`log`, `toast`, `confirm`, `navigate`,
`navigate-replace`, `navigate-back`, `scroll-to`) are not this case. A live
mount installs the ones its build ships onto `app.effects` before it dispatches
anything; the server pass installs none and runs none, and an emit of one there
is skipped without a report, as before — otherwise every server render of a
program whose `init` writes a `log` would print a panic and ship a `"panic"`
bootstrap.

`runtime.md` §10.4.1 states the rule in both language tracks, and
`lifecycle.md` §7.2.3 defines the category in both. `runtime.md`'s §10.5.1
category list, §10.5.1.1 (which lists it beside the refused capability as an
emit that produces no pair) and §10.6.1's snapshot bullets exist in the English
track only, and say it there.
