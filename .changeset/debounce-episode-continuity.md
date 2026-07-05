---
"@kumikijs/runtime": minor
---

feat(runtime): keep debounce-deferred effects on their originating episode (#120).

Previously, a debounced effect that fired long after its originating reducer would open a **new** episode, breaking the causal chain in the episode log. The dispatcher now retains the originating episode id across the debounce window so the deferred effect lands under the same episode as the reducer that scheduled it. `http.cancel` / missing-capability / dispose paths also drain their debounce timers and notify `onPolicyCancel` correctly, closing the previously observed leaks.

- runtime: `packages/runtime/src/core.ts` dispatcher preserves episode id through `debounce` / `throttle` / `latest` / `latest-per-key`.
- runtime: `packages/runtime/src/episode.ts` records the cancel notification with the originating episode context.
- spec: `docs/spec/runtime.md` §policy expanded with the continuity guarantee.
