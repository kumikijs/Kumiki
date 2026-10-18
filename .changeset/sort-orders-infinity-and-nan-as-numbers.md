---
"@kumikijs/runtime": patch
---

`sort` orders a `List(Float)` holding `Infinity`, `NaN` or an absent value as numbers

`[10.0, 9.0, 1.5, 1.0 / 0.0].sort` was `[1.5, 10.0, 9.0, Infinity]`. `sort` took
the numeric path only when every element was a finite number, and one
`Infinity`, `-Infinity` or `NaN` sent the whole list to the string comparator,
so `10` sorted before `9`. Those three are ordinary `Float` results: `/` is
JavaScript's `/` (language.md §1.9.4), so `1.0 / 0.0` is `Infinity`, and
stdlib.md §2.2.7 gives `(0.0).log` as `-Infinity` and `(-1.0).sqrt` as `NaN`.
Any `List(Float)` built from division, `log` or `sqrt` could reach it. An
absent value did the same: a `List(Float)` holding a `null` from a JSON body, or
a `List(Text)` holding one, was ordered by each element's text, `null` included.

The path is now chosen by each element's runtime type, with absent values left
out: when every present element is a number, finite or not, or every one is a
`Text`, `sort` orders the list as `sort-by` orders the same values as keys, with
`<`. An infinity sorts below or above every finite value, so the list above is
`[1.5, 9.0, 10.0, Infinity]`; `NaN`, which `<` orders against nothing, sorts
after every other element, `Infinity` included (`[(-1.0).sqrt, 2.0, 1.0].sort`
is `[1.0, 2.0, NaN]`); and an absent element sorts last, keeping its order, so
a `List(Float)` holding `10`, `9`, an absent value and `1.5` sorts as `1.5`,
`9`, `10`, then the absent one. A list mixing numbers and `Text` is still
ordered by each element's text, now with absent elements last as well, since
`<` between a number and a `Text` is no order. `sort-by` changes in one case:
over a list whose elements are their own keys (`xs.sort-by($1)`), an absent
element keeps its order among the `NaN` and absent ones, where an `undefined`
one used to move after all of them. stdlib.md §2.2.3 and §2.2.7 state all of
this. Lists of finite numbers, `Time` lists and `Text` lists with no absent
value sort as before.
