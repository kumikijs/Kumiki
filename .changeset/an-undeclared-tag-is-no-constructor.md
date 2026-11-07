---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Report a variant tag no union declares, and a qualifier that names nothing

Any capitalised name in an expression parses as a variant constructor, and code
generation builds one from any spelling. Wherever no declared type judged it, a
tag no union declares was accepted and lowered to a record nothing reads:

```kumiki
effect loadNote cap=http.get
                in=Unit
                out=Result(Text, HttpError)
                map-request={url: "/x", decode: Nonsense}
```

Before:

```
$ kumiki check a.kumiki
ok
```

`decode` received `{_tag: "Nonsense"}`. A misspelt qualifier went the same way:
`decode: Decodr.None` was a field read on a variant `Decodr`, evaluated to
`undefined`, and also checked ok.

After:

```
E0116 undef-variant at 5:49: Reference to undefined variant "Nonsense"
E0116 undef-qualifier at 5:49: Reference to undefined qualifier "Decodr" in "Decodr.None" — did you mean "Decoder"?
```

The tags are those of every union the program writes — a `type` body, or a
union written inline in a slot, a record field, a `fn` signature, an `in=` /
`out=` or a `for-all` — and the standard library's: `Some` / `None`, `Ok` /
`Err`, `FormValue`'s, and the `HttpBody` request bodies. A qualifier may name a
tag (`Idle.show`), a type (`Time.now`) or a built-in-call namespace. In a
position whose declared type judges the variant, E0216 (or E0201 / E0202)
reports it as before, and alone.

`kumiki fix` repairs both from the candidates the message suggests from:
`Idel` becomes `Idle`, and `Decodr` becomes `Decoder`. A slot, tile or `fn`
whose name is close is not a candidate.

One consequence worth knowing before upgrading: a type's own name written as a
constructor is reported too. A `nominal` has no construction form —
`type ItemId = nominal Int` takes `1` as it is — so `ItemId(1)` built
`{_tag: "ItemId", _0: 1}`, a variant where a number belongs, and a
`Map(ItemId, Text)` keyed by it never met a key written as `1`. Write the base
value instead.
