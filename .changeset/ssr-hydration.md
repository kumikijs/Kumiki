---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(runtime,compiler): SSR + hydration with bootstrap episode (#119).

Kumiki apps can now be pre-rendered on the server and hydrated on the client without losing the reactive graph or replaying the initial reducers. The hydration path opens a **bootstrap episode** so any HTTP / storage prefetch performed during SSR shows up in the client-side episode log as the first coherent step, rather than as untracked side-effects before the app "starts".

- runtime: `mountCore` gains a hydrate path that adopts the server-rendered DOM as the initial tile tree (v1 shape: `replaceChildren` overwrite — identity-preserving hydration tracked separately). Per-request `app.live` initialisation prevents cross-request signal leakage.
- runtime: SSR version check bails **non-silently** if the runtime version embedded in the SSR payload disagrees with the client bundle.
- compiler: codegen threads the bootstrap-episode shape through so SSR-side effects land in the hydrated log.
- examples: new `packages/examples/apps/10-ssr-hydration`.
- spec: `docs/spec/runtime.md` §SSR expanded to cover the bootstrap-episode contract.
