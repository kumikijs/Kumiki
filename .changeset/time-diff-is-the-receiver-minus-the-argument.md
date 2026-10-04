---
"@kumikijs/runtime": minor
---

Make `Time.diff` the receiver minus the argument, so its sign says which instant is later

`a.diff(b)` returned `Math.abs(a - b)`, a distance with no sign, so both
`due.diff(now)` and `now.diff(due)` were positive. A program that reads the sign
to tell a past instant from a future one never saw a negative value. The
`05-project-management` app does exactly that, so a task due two days ago was
labelled "Soon" rather than "Overdue":

```kumiki
fn status(t: Time) -> DueStatus
   = let diffMs = t.diff(now).to-ms
     in if diffMs < 0 then Overdue          # never taken
        else if diffMs < 86400000 then DueToday
        else if diffMs < 259200000 then DueSoon
        else DueUpcoming
```

```
before: status(now.minus(Duration.d(2)))  →  DueSoon   (diff = +172800000)
after:  status(now.minus(Duration.d(2)))  →  Overdue   (diff = -172800000)
```

stdlib.md §2.2.8 declared `diff(other) : Duration` without a sign. It now says
that `a.diff(b)` is `a` minus `b`: positive when `a` is the later instant,
negative when it is the earlier one, so `b.plus(a.diff(b))` is `a`. That is how
§2.2.9's own `fn elapsed(start: Time) -> Duration = now.diff(start)` already
read it, and `Duration` is a `nominal Int`, which can be negative.

A program that used `diff` as a distance and put the later instant second now
gets a negative `Duration`. `a.diff(b).to-ms.abs` is the distance whichever
instant is later. `Set(T).diff` is unchanged: it is still the members of the
receiver that the argument lacks.
