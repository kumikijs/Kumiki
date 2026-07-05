---
"@kumikijs/compiler": minor
"@kumikijs/cli": minor
"@kumikijs/vite": minor
---

feat(compiler,cli,vite): `--strict-icons` to flag unknown `icon(name=...)` at check time (#127).

Kumiki ships a built-in icon set but rendering an unknown `name=` silently fell back to an empty placeholder. `--strict-icons` promotes the runtime silence into a compile-time error so typos and dropped icons are caught during `kumiki check`.

- compiler: `check()` gains a `strictIcons` option; `E02xx strict-icon-unknown` is emitted when `name=` is not a member of the built-in set.
- cli: `kumiki check --strict-icons` and `kumiki build --strict-icons`.
- vite: `strictIcons: true` plugin option.
- spec: `docs/spec/errors.md` and `docs/spec/style.md` document the strict gate.
