---
"@kumikijs/compiler": patch
---

`o.get()` and `r.get()` — the unwrap on an `Option` / `Result`, written with its optional parentheses — now build, and lower to the same unwrap as the paren-free `o.get` (stdlib.md §2.2.3 / §2.2.4 / §2.2.5).

The checker accepted them, since `.get`'s argument count is decided by its receiver, but the lowering only knew the keyed reading (`Map.get(k)` / `List.get(i)`) and read an argument the call did not have: `check` said ok, then `build` and `smoke` died with `TypeError: Cannot read properties of undefined (reading 'kind')`, naming no file or line. A `.get()` on a receiver the checker cannot decide lowers to the unwrap too, and on `None` / `Err` it panics exactly as `.get` does.
