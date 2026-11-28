---
"@kumikijs/compiler": patch
---

A tile that nests `for`s as deep as the parser allows now loads and renders, on a stack as small as Windows' too

One tile may nest 250 `for`s. A `for` whose nodes carry its key compiled to a function called on the spot, holding a `map` callback: several levels of JavaScript for each level of the tree. Past 200 nested `for`s, the module overflowed a 757 KB stack, the size the tests use to stand for Windows', and past 217 its render threw `RangeError: Maximum call stack size exceeded` on Linux's default stack as well.

Such a `for` now compiles to one call of `_loop`, a helper inlined into the module beside `_wk`, with one function for its body. 250 nested `for`s load and render on the 757 KB stack. The keys are the same as before, and a `for` whose nodes carry no key from it compiles as before.
