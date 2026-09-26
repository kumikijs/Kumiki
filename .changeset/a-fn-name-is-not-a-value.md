---
"@kumikijs/compiler": minor
---

A `fn` name written without its parentheses is reported as E0127, and a `fn` name passed as a higher-order fragment is applied to the fragment's positionals (#390).

A `fn` is not a value, but its bare name was accepted wherever a value goes and lowered to the generated function itself. `emit load(label)`, where `label()` was meant, dispatched a *function* to an effect declaring `in=Text`. A storage key stringified to the function's source, an HTTP body serialised to `undefined`, and `check`, `smoke` and the browser all stayed silent. `init = [load(label)]` did the same before the app mounted.

It is now **E0127 `fn-as-value`**, and the message names the call: `"label" is a fn, and a fn is not a value — write the call: label()`. A parameter, a `let` or a slot of the same name shadows the `fn` and is not reported.

The one position where a bare name is right is the fragment argument of a higher-order method (`language.md` §1.8.6): `filter`, `map`, `find` and `sort-by`, `fold`'s second argument, `flat-map`, `map-err`, and `update`'s second argument. That position was broken as well. `items.map(double)`, the spec's own example, lowered to a list of functions, and `items.filter(isActiveOnly)` kept every element. It now lowers to the call it stands for: `double($1)`, and `add($1, $2)` in a `fold`. A `fn` there must take at least one positional and no more than the method binds; anything else is E0213. `fold`'s `fn` takes exactly two, the accumulator and the element. A list method's `fn` takes two only over a `Map` or a `List` of pairs (`.entries`), where `$2` is the value; over any other receiver the checker can decide, a second parameter would get the JS index or the element again, and is E0213.

A `fn` named there runs wherever the method does, so the pre-mount route checks follow it: `slot names = [1, 2].map(here)` with a `here` that reads `route` is E0304, through a chain of `fn`s as well, and the same in an `app.init` argument is E0120.
