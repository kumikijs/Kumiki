---
"@kumikijs/compiler": patch
---

A program cannot declare a type under a standard-library name whose values the runtime supplies

The standard library's domain types were seeded into the checker's table before
the program's own definitions, so a program's `type PanicInfo = …` replaced the
standard one for every check that named it. The runtime kept supplying the
standard value. In this program the fallback's `$1` was checked as a `Text`
while the runtime bound the panic record to it:

```kumiki
type PanicInfo = Text
slot secret : Option(Text) = None
slot reveal : Bool = false
tile Fb in=PanicInfo = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = when(reveal, text(secret.get))
tile Btn = button(text="go") {id: "go"}
reducer go on=ui.click(Btn) do= reveal := true
tile App = column(Risky, Btn)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
```

Before:

```
$ kumiki check app.kumiki
ok
```

and clicking `#go` rendered `recovered: [object Object]` — the `in=Text`
fallback that E0220 refuses, passing under the name `PanicInfo`.

After:

```
$ kumiki check app.kumiki
E0231 reserved-type-name at 1:1: Type "PanicInfo" collides with the standard library's PanicInfo; uses of it never see this type
```

**E0231 `reserved-type-name`** is reported at each declaration under one of the
six names the runtime or the standard library supplies or reads values of:
`PanicInfo`, `Route`, `HttpError`, `HttpStatus`, `Duration` and `FormValue`.
The name keeps the standard library's definition, so every use of it is checked
against the value the runtime supplies, and `type Route = Route` is E0231 alone
rather than also a cycle (E0009). Writing those names is unchanged: an
annotation, a tile's `in=`, a record field, an alias or a refinement over one,
and a type parameter, variant tag, slot, `fn` or tile spelled the same way all
check as before.

`Url`, `Email`, `Uuid` and `FormData` are not affected: they name types only a
program builds values of, so a program's own `type Email = …` still replaces
the standard library's and its uses mean the program's type.

**Migration**: rename the program's type — `type AppPanic = …` instead of
`type PanicInfo = …` — along with every use that meant it. A program that
redeclared one of the six identically (`type HttpStatus = nominal Int where
between(0, 599)`) can delete the declaration: the standard library's is the
same type.
