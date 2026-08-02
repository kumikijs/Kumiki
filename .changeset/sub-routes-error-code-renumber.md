---
"@kumikijs/compiler": minor
---

fix(compiler): `sub-routes-without-wildcard-parent` reports **E0114**, not E0110
(#186).

E0110 named two unrelated diagnostics — `unknown-token-group` in the style band
and `sub-routes-without-wildcard-parent` in the routing band. One code standing
for two kinds makes a search ambiguous and gives auto-patch two incompatible
repairs to choose between. The routing diagnostic moves to the next free code in
its own band (E0111–E0113), so every code names one kind again and the
"kept as-is" caveat leaves the error index.

Anything matching on the literal `E0110` for this case needs updating; the style
diagnostic keeps the code.
