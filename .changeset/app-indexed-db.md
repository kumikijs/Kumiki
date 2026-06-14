---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(indexed-db): wire `app.indexed-db` config + `indexed-read` / `indexed-write` / `indexed-delete` / `indexed-query` effects (#79).

`indexed.*` capabilities were spec'd but had no runtime; effects compiled but fell through to "no provider". This change ships the full path.

- compiler: parser/AST capture `app.indexed-db = { name, version, stores: [{ name, key, indexes? }] }`; codegen emits `_idb` and threads it to the `indexed-*` builtins.
- runtime: `effects-indexed.ts` opens the IndexedDB lazily and dispatches `indexed.read` by input shape (point lookup vs range query). Unavailable backends keep returning a clean `err` (the no-silent-failure contract from #37).
- examples: new `packages/examples/features/36-effect-indexed-db.kumiki`; parser/codegen/runtime regression tests; check + build + smoke green.
