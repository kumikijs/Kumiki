---
"@kumikijs/compiler": patch
---

A user tile's body no longer sees its caller's `for` / `match` bindings. A slot the body reads stays the slot wherever the tile is called from (language.md §1.7.2 Invariant 1).

The call is inlined, and the body was lowered with the caller's local bindings copied in, so a slot read that shared its name with a binding around the call site read that binding instead. In `row(for filter in filters FilterBtn(filter))`, where `FilterBtn` marks `$1 == filter` against the `filter` slot, every button was marked current. The body is now lowered in a scope of its own. The caller's bindings still reach the call's argument and props, so `FilterBtn(filter)` passes the loop variable as `$1`.
