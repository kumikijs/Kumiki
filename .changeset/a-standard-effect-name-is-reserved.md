---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A program cannot declare an effect under a standard effect's name

The runtime registers its standard effects — `navigate`, `navigate-replace`,
`navigate-back`, `scroll-to`, `toast`, `confirm`, `log` — on `app.effects` when
the app mounts, writing over whatever the program compiled under the same
name: its capability, its request and its `policy` alike. The checker accepted
such a declaration and checked every emit against it, so the program that was
checked was not the program that ran:

```kumiki
slot lastId : EffectId = EffectId.none
effect log cap=http.get in=Text out=Result(Text, HttpError)
           policy=latest-per-key($1)
           map-request={url: "/api/" + $1, decode: Decoder.Text}
reducer go on=ui.click(B) do= lastId := emit log("x")
tile B = button(text="b", onClick=go)
tile Home = column(B, text(lastId.show))
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
```

Before:

```
$ kumiki check app.kumiki
ok
```

and clicking the button never made the request. `emit log("x")` ran the
built-in `log`, which panicked with `capability "log.write" is not declared in
app.caps`, and the id `lastId` kept named a policy the running effect did not
have.

After:

```
$ kumiki check app.kumiki
E0234 reserved-effect-name at 2:1: Effect "log" collides with the built-in effect log; emits of it never run this effect
```

It is reported once per declaration. The program's uses of the name are still
checked against the declaration they were written for, so E0234 is the only
report, and `kumiki rename app.kumiki effect.log logRequest` — which rewrites
the declaration, its emits, its `app.init` entries and its `.ok` / `.err`
reducers — leaves nothing else to fix. `kumiki rename` and `kumiki add` now
refuse an edit that would put an effect under one of these names.

Emitting a standard effect needs no declaration and is unchanged, as are
effects named `logger`, `toasts` or `navigate2`, and a reducer or slot named
`log` or `toast`. A declaration that restates a standard effect with its own
signature — `effect navigate cap=nav.push in={path: Text, …}` — is refused
too, and is deleted rather than renamed.

The list is kept once: the compiler's table of standard effects is keyed by
the runtime's new `BuiltinEffectName` type, the names its installers register,
and the installers write `app.effects` through a view that takes no other
name. A standard effect added on one side only is a type error.
