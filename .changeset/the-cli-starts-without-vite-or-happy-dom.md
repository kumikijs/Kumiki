---
"@kumikijs/cli": patch
---

Start the CLI without loading vite or happy-dom until a verb needs them

Every `kumiki` invocation imported vite (through the `dev` verb's module) and
happy-dom (through the smoke loader) at start-up, so `kumiki check`, `build`,
`--help` and the edit verbs paid for a dev server and a DOM they never use —
about 0.9s of a 1.3s start. `dev` now loads its server when it runs, and the
smoke / run / test / replay paths load happy-dom the first time they set up a
DOM. What each verb does and prints is unchanged.
