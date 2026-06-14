---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(http): execute `retry=linear(N, ms)` / `retry=exponential(N, ms, factor)` at runtime (#83).

The compiler already parsed retry clauses; the runtime ignored them. This change wires the policy through:

- compiler: `genEffect` now emits `retry: { kind, n, ms[, factor] }` on every `EffectSpec`.
- runtime: `EffectSpec.retry` is read by the dispatcher's launch loop. Only 5xx responses and connection errors (status 0) are retried; 4xx is treated as a final failure (spec §6.5).
- examples: `packages/examples/apps/08-http-retry`.
