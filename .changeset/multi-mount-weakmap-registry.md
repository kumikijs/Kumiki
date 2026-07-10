---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

feat(runtime,compiler): replace the `__kumikiApp` global with a WeakMap mount-root registry for safe multi-mount.

Several Kumiki apps on one page (multiple Web Components, micro-frontends, Storybook previews) previously shared one `window.__kumikiApp` reference — the last mount captured every other app's bind write-back, link navigation, icon lookup, and generated event dispatch (last-write-wins).

**BREAKING (runtime)**

- `mount` / `mountCore` no longer write `window.__kumikiApp`. App resolution is keyed off the mount target: each mount stamps its target element with `data-kumiki-root` and registers in a WeakMap; the new public `resolveApp(el)` walks up to the nearest mount root (hopping shadow boundaries) to find the owning app. Compiled bundles still assign `globalThis.__kumikiApp = App` at module evaluation — that assignment is now a tooling-only state oracle (smoke / scenario / e2e / benchmarks) and nothing in the runtime reads it.
- `currentTheme()` returns the theme of the app whose render/mount pass is currently running, and `null` outside one (previously: the most-recently-mounted app's theme, at any time). Hosts that called `currentTheme()` outside a render pass must resolve the app themselves (e.g. via `resolveApp`).
- Events fired on elements detached from any mount (e.g. a node replaced by a re-render) are now a no-op instead of being delivered to the most-recently-mounted app.

**BREAKING (compiler)**

- Generated event handlers call `App._dispatch(...)` (the enclosing `createApp()` instance) instead of `globalThis.__kumikiApp._dispatch(...)`. Public API is unchanged; tools that string-match the generated JS must follow.

**New**

- runtime: `resolveApp(el)` public export.
- `defineKumikiElement` instances are now DOM-event-safe under multi-mount for both `shadow: true` and `shadow: false`.
- e2e: `runMultiOnPage(page, sources, scenario)` co-mounts several compiled apps on one page with a per-app-index state oracle (`"0.count"`).

Out of scope: theme `<style>` node contention when several *themed* apps share one style root (document head) — shadow DOM remains the isolation answer there.
