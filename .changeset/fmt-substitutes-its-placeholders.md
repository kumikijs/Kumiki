---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

Substitute the placeholders in `fmt`

`fmt(template, ...args)` returned its template. `packages/runtime/src/stdlib.ts`
carried a helper for every other builtin — `panic`, `file-url`, `prefers-dark`,
`Bytes.from-text` — and none for `fmt`, so codegen's `_s.fmt ? _s.fmt(…) :
template` guard always took the else branch:

```
reducer go on=ui.click(B) do= t := fmt("{0}-{1}", "a", "b")

[FAIL] step 0: clickText "go"
    assert: state t: expected "a-b", got "{0}-{1}"
```

`check`, `build` and `smoke` were all green for that program, and would be for
any program: a template is a `Text`, exactly like the formatted result it stood
in for, so no tier short of one that reads the string could tell them apart.
`packages/examples/apps/03-blog` built its auth header with it, so every request
that app made sent `Authorization: Bearer {0}` and the token never left the
browser.

The runtime helper exists now. A placeholder is `{`, one or more decimal digits,
`}`; each is replaced by the argument at that index, rendered through `show` —
the same rendering `+` gives a value, so one sentence cannot show a value two
ways. Substitution is one left-to-right pass, so a `{0}` arriving *inside* a
substituted value is text rather than a placeholder that reaches back into the
argument list.

Two cases the spec left to the implementation are now decided in
[stdlib.md §2.4.5](docs/spec/stdlib.md) (EN + JA), along with the removal of its
"not implemented yet" note:

- An index the arguments do not reach keeps its placeholder verbatim —
  `fmt("{0} {1}", "a")` is `"a {1}"`. Not an error, and not empty: a template
  that outran its arguments is a mistake, and the rendering that names the
  missing index is the one its author will see.
- A `{` that opens no placeholder is copied through, and so is a `}` that closes
  nothing: `{}`, `{a}`, `{ 0 }` and `{01` are text. There is no escape, the same
  bargain `Time.format` makes with its own tokens, so `fmt("{{0}}", "a")` is
  `"{a}"`.

The codegen guard is gone: `fmt` lowers to a plain `_s.fmt(…)` call. Keeping it
would mean a future runtime without the helper formats nothing and reports
nothing, which is the shape this bug had. That makes it a **generation
requirement** rather than a behaviour change — an app built by this compiler
against an older `@kumikijs/runtime` fails with `_s.fmt is not a function`, as
`_s.prefersDark()` and `_s.random()` did when they were introduced. Compiler and
runtime move together.

`packages/examples/features/88-string-formatting.kumiki` pins each rule with a
scenario, and the blog app's `Authorization` header is now asserted end-to-end
rather than assumed.
