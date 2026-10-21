---
"@kumikijs/compiler": patch
---

A program cannot declare a type under a primitive or a built-in type constructor name

`type Int = …`, `type File = …`, `type Option = …` and `type List(T) = …` passed
`kumiki check`, and the declaration was then ignored or half-applied. A
primitive is read as itself wherever a type is written, so `type Int = Text`
reached no use. A constructor's definition answered where the checker looked
the name up and not where it applied the built-in:

```kumiki
type Option = Int
slot o : Option(Int) = None
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
```

Before:

```
$ kumiki check app.kumiki
E0210 type-arity-mismatch at 2:10: Type "Option" expects 0 type argument(s) but got 1
E0201 type-mismatch at 2:24: Expected Option(Int) but got variant "None"
```

With `type List(T) = {v: T}`, `List(Int)` accepted both `{v: 1}` and `[1, 2]`,
and `l.length` was refused as a member the record lacks.

After:

```
$ kumiki check app.kumiki
E0231 reserved-type-name at 1:1: Type "Option" collides with the built-in type constructor Option; uses of it never see this type
```

**E0231 `reserved-type-name`** now covers three groups, read from the checker's
own tables: the primitives (`Text`, `Int`, `Float`, `Bool`, `Unit`, `Bytes`,
`Time`, `File`, `EffectId`), the built-in type constructors (`List`, `Set`,
`Map`, `Option`, `Result`, `Tuple`), and the six runtime-supplied names it
already reserved. The message names the group. The declaration is never seeded,
so every use of the name keeps its built-in meaning: `Option(Int) = None` and
`List(Int) = [1, 2]` check, `l.length` is the List's member, and
`type List(T) = List(T)` is E0231 alone rather than also a cycle (E0009). A use
that only fits the program's own type gets the built-in's ordinary report beside
E0231 — `E0201` for `slot a : List(Int) = {v: 1}`, `E0210` for a bare `Option`.

Writing the names elsewhere is unchanged: annotations, aliases, record fields,
slots, `fn`s and tiles spelled the same way, and types whose name starts or ends
with one (`IntRange`, `TodoList`).

**Migration**: rename the program's type — `type Box(T) = {v: T}` instead of
`type List(T) = {v: T}` — along with every use that meant it. A declaration
that restated a built-in (`type Option(T) = None | Some(T)`) can be deleted.
