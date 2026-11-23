---
"@kumikijs/cli": patch
---

`kumiki fix --apply` no longer rolls back a repair that moves the line or column another error's message names, such as E0103's "declared later, at 8:28".

The regression gate identifies a diagnostic by its code, kind and message and leaves its position out, so a diagnostic a repair only moved is not read as one it introduced. A position written into the message defeated that. E0103 names where a name read too early is declared, and a repair that moves that declaration rewrote the message:

```
$ kumiki fix app.kumiki --apply
before: (auto-patch rolled back — the re-check reported E0103@9:17, which it did not before)
after:  applied 1 fix(es) — 1 error(s) remain
```

Here E0001's repair prepends a `NotFound` tile, which moves every line down by two, so the message became "declared later, at 10:28". A repair that changes a line's length, such as E0119's `$route` → `route`, moved the column the same way.

The gate now reads each `line:col` in a message as any position. A diagnostic the repair did add is still refused: a second E0103 that differs only in the position it names counts as one more, and one whose words changed along with its position is a different diagnostic.
