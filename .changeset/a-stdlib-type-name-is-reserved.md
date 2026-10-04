---
"@kumikijs/compiler": patch
---

A program cannot declare a type under a standard-library type name

The standard library's domain types — `HttpStatus`, `HttpError`, `Url`,
`Email`, `Uuid`, `Duration`, `Route`, `FormData`, `FormValue`, `PanicInfo` —
were seeded into the checker's table before the program's own definitions, so
a program's `type PanicInfo = …` replaced the standard one for every check that
named it. The runtime kept supplying the standard value. In this program the
fallback's `$1` was checked as a `Text` while the runtime bound the panic
record to it:

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

**E0231 `reserved-type-name`** is reported at each such declaration, whatever
its body. The name keeps the standard library's definition, so every use of it
is checked against the value the runtime supplies, and `type Route = Route` is
E0231 alone rather than also a cycle (E0009). Writing the names is unchanged:
an annotation, a tile's `in=`, a record field, an alias or a refinement over
one, and a type parameter, variant tag, slot, `fn` or tile spelled the same
way all check as before.

**Migration**: rename the program's type — `type AppPanic = …` instead of
`type PanicInfo = …` — along with every use that meant it. A program that
redeclared one of these names identically (`type Email = nominal Text where
email`) can delete the declaration: the standard library's is the same type.
