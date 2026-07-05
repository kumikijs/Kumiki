---
"@kumikijs/runtime": patch
---

feat(runtime): scenario DOM focus / blur primitives (#142).

The scenario testkit now exposes `focus` and `blur` primitives that drive real DOM focus events end-to-end, so a scenario can verify that `addEventListener("focus", …)` wiring actually reaches the reducer — not just that the compiler emitted the handler. This closes the "compiles but never fires" gap for `ui.focus` / `ui.blur`.

- runtime: `packages/runtime/src/scenario.ts` gains `focus(selector)` and `blur(selector)` steps.
- e2e: `packages/e2e/src/browser.ts` mirrors the primitives for Playwright fixtures.
- examples: `packages/examples/features/49-ui-focus-blur.scenario.json` exercises both.
