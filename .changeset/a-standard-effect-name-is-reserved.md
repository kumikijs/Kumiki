---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A program cannot declare an effect under a standard effect's name (E0234)

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
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
```

Before:

```
$ kumiki check app.kumiki
ok
```

and clicking the button never made the request. `emit log("x")` ran the
built-in `log`, which panicked with `capability "log.write" is not declared in
app.caps`, and `lastId` held an id minted under the built-in's default policy,
not the per-key one the declaration asked for.

After:

```
$ kumiki check app.kumiki
error E0234 reserved-effect-name at 2:1: Effect "log" collides with the built-in effect log; emits of it never run this effect
```

It is reported once per declaration. The program's uses of the name are still
checked against the declaration they were written for, so for this program
E0234 is the only report, and `kumiki rename app.kumiki effect.log logRequest` — which rewrites
the declaration, its emits, its `app.init` entries and its `.ok` / `.err`
reducers — leaves nothing else to fix. `kumiki rename` and `kumiki add` now
refuse an edit that would put an effect under one of these names.

Emitting a standard effect needs no declaration and is unchanged, as are
effects named `logger`, `toasts` or `navigate2`, and a reducer or slot named
`log` or `toast`. A declaration that restates a standard effect with its own
signature — `effect navigate cap=nav.push in={path: Text, …}` — is refused
too, and is deleted rather than renamed. Delete its line directly:
`kumiki remove` counts the emits as references to the declaration and refuses.

The list is kept once: the compiler's table of standard effects is keyed by
the runtime's new `BuiltinEffectName` type, so a name added to one and not the
other is a type error. The installers write `app.effects` through a view keyed
by the same names, and a test mounts an app to check that what they register is
that list.
