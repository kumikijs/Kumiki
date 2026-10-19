---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

A property-test run holds its `count` to the parser's rule

The parser refuses a written `count` that is not a whole number, 1 or more, but
`runPropertyTest` looped on whatever `count` it was handed, so a test definition
built without the parser reached it unchecked. `count: 0`, `-3`, `-0` or `NaN`
ran no case and reported the property as holding, `0.5` ran one case, `"5"` ran
five, and `Infinity` did not end while the invariant held:

```js
_stdlib.runPropertyTest({ name: "zero", vars, trial: () => false, count: 0 });
// { name: "zero", pass: true, cases: 0 }
```

Each of them now fails without running a case, in the shape a counterexample
takes, so `kumiki test` prints it as a `FAIL` and exits non-zero:

```js
// { name: "zero", pass: false, expected: "count is a whole number, 1 or more",
//   actual: "count = 0", diffAt: "(count)", cases: 0 }
```

A test without `count` runs 100 cases, and `count: 1` runs one, as before.
`count: null` is refused like any other count that is not a number, where it
ran the default 100.

The rule is the one the parser applies. `isPositiveInt` moves from the compiler
into `@kumikijs/runtime`, on a new `@kumikijs/runtime/positive-int` subpath that
the compiler's parser and checker import, so the runner and the compiler ask the
same rule. The compiler's behaviour is unchanged.
