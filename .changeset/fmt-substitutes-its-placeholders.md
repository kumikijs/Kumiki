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
`}`; each is replaced by the argument at that index, rendered through `show`.
Substitution is one left-to-right pass, so a `{0}` arriving *inside* a
substituted value is text rather than a placeholder that reaches back into the
argument list.

Before this, [stdlib.md §2.4.5](https://kumiki.dev/spec/stdlib#_2-4-5-string-formatting)
said substitution was **not implemented**, so the whole semantics was undefined
rather than any particular corner of it. It is written down now (EN + JA), and
these are the three easiest to get wrong:

- An index the arguments do not reach keeps its placeholder verbatim —
  `fmt("{0} {1}", "a")` is `"a {1}"`. Not an error, and not empty: a template
  that outran its arguments is a mistake, and the rendering that names the
  missing index is the one its author will see.
- An argument no placeholder names is dropped — `fmt("{0}", "a", "b")` is
  `"a"`. This is the half with no trace at all: the result is identical to the
  correct call's.
- A `{` that opens no placeholder is copied through, and so is a `}` that closes
  nothing. No escape, the same bargain `Time.format` makes with its own tokens,
  so `fmt("{{0}}", "a")` is `"{a}"`. The digits are read as one decimal index,
  so `{01}` is index 1.

**New warning, [W0214](https://kumiki.dev/spec/errors#w0214-fmt-placeholder-argument-mismatch-warning)
`fmt-placeholder-argument-mismatch`.** A `fmt` whose **literal** template and
argument list disagree, in either direction, is reported by `check` — one
warning per call, naming both halves when a call is wrong both ways. Non-fatal,
so `check` still exits 0 and `build` still emits. A template that is an
expression carries no placeholder set to count and is left to the runtime rules
above.

**`+` renders through `show` now.** `_s.add` was `String(a) + String(b)`, which
never called `show` — so `"x=" + someOption` was `"x=[object Object]"` and
`"x=" + nothing` was `"x=null"`, where §2.4.5 has always said "the equivalent of
`show` is called automatically" and `fmt` now says `None` and `""`. `Text +
<anything>` type-checks, so the two ways to put a value in a sentence had to
agree; the spec was right and `add` was wrong. Numeric `+` is untouched.

**A throwing `app.http.headers` is reported.** The thunk is called per request
behind a `try`, and the `catch` returned `{}` silently: every global header
vanished, the server answered 401, and an app with `on-401` logged its user out
for no stated reason — with nothing on `console.error`, so `smoke` and
`scenario` saw a run that passed. It logs now, which is the channel
`lifecycle.md §7.2` already sends a panic down. The request still goes out.

The codegen guard is gone: `fmt` lowers to a plain `_s.fmt(…)` call. Keeping it
would mean a future runtime without the helper formats nothing and reports
nothing, which is the shape this bug had. That makes it a **generation
requirement** rather than a behaviour change — an app built by this compiler
against an older `@kumikijs/runtime` fails with `_s.fmt is not a function`, as
`_s.prefersDark()` and `_s.random()` did when they were introduced. Compiler and
runtime move together.

`packages/examples/features/88-string-formatting.kumiki` pins each rule with a
scenario — including a template held in a slot, which is the case the runtime
rules exist for — and the blog app's `Authorization` header is now asserted
end-to-end rather than assumed.
