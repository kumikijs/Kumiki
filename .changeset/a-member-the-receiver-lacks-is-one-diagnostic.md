---
"@kumikijs/compiler": patch
---

A method call on a member its receiver does not have is now one diagnostic, **E0108 `undef-member`**, whatever its argument count. `.get`, `.get()`, `.get(k)` and `.get(1, 2)` on a `Text`, an `Int` or a record without a `get` field are each a single E0108, and so are `t.filter()` on a `Text` and `n.get-or(1, 2, 3)` on an `Int`.

Before, the call was E0108 and then had its argument count checked as if the receiver had the member: `n.get(1, 2)` on an `Int` added E0213 "Method ".get" takes no arguments or one, but got 2", and `t.filter()` added "expects 1 argument(s) but got 0" — a second report of the same mistake, about the count of a member that is not there. The field-access spelling (`t.get`) already reported E0108 alone; the two spellings now agree. A receiver whose type the checker cannot decide (`$el.x.get(1)`) is unchanged: it passes, and a count past both of `.get`'s readings is still E0213.
