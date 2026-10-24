---
"@kumikijs/runtime": minor
---

Make `Time.diff` the receiver minus the argument, so its sign says which instant is later

`a.diff(b)` returned `Math.abs(a - b)`, a distance with no sign, so both
`due.diff(now)` and `now.diff(due)` were positive. A program that reads the sign
to tell a past instant from a future one never saw a negative value. The
`05-project-management` app does exactly that, so a task due two days ago was
labelled "Soon" rather than "Overdue". Its `dueDateStatus` reads the sign in
its `Some` arm:

```kumiki
fn dueDateStatus(d: Option(Time)) -> DueStatus
   = match d with
       | None     -> NoDue
       | Some(t)  -> let diffMs = t.diff(now).to-ms
                     in if diffMs < 0 then Overdue          # never taken
                        else if diffMs < 86400000 then DueToday
                        else if diffMs < 259200000 then DueSoon
                        else DueUpcoming
```

```
before: dueDateStatus(Some(now.minus(Duration.d(2))))  →  DueSoon   (diff = +172800000)
after:  dueDateStatus(Some(now.minus(Duration.d(2))))  →  Overdue   (diff = -172800000)
```

stdlib.md declared `diff(other) : Duration` without a sign. It now says
that `a.diff(b)` is `a` minus `b`, so `b.plus(a.diff(b))` is `a`, and that the
result is positive when `a` is the later instant and negative when it is the
earlier one. That is how its own
`fn elapsed(start: Time) -> Duration = now.diff(start)` already read it, and
`Duration` is a `nominal Int`, which can be negative. The `Duration` section
now says a `Duration` is signed.

A program that used `diff` as a distance and put the later instant second now
gets a negative `Duration`. `a.diff(b).to-ms.abs` is the distance whichever
instant is later. `Set(T).diff` is unchanged: it is still the members of the
receiver that the argument lacks.
