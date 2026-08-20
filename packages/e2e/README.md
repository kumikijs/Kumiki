# @kumikijs/e2e

English · [日本語](./README.ja.md)

An **opt-in tier** that verifies Kumiki apps in a real browser (Chromium / Playwright). It catches layers invisible to a headless DOM (happy-dom) — CSS layout, **real focus**, real rendering, and real events.

It uses the **same scenario format** as `@kumikijs/runtime`'s headless-DOM `runScenario`, plus browser-only assertions:

- `focused`: that the given CSS selector is actually focused (detects focus-stealing bugs on re-render)
- `visible` / `hidden`: that it is really visible / invisible per computed style (visibility you can't tell from mere DOM presence, e.g. `display:none`)

The state oracle, as in the headless-DOM version, reads `window.__kumikiApp.live` (slot values) via `page.evaluate`. Displayed text is `innerText` (visible only).

## Usage

A one-time browser install is required:

```sh
pnpm --filter @kumikijs/e2e exec playwright install chromium
```

Run, from the repository root:

```sh
pnpm exec tsx packages/e2e/src/cli.ts <app.kumiki> <scenario.browser.json> [--headed]
```

Example:

```sh
pnpm exec tsx packages/e2e/src/cli.ts \
  packages/examples/apps/06-expenses/app.kumiki \
  packages/examples/apps/06-expenses/scenario.browser.json
```

## When to use it

Within the 3-layer verification ([docs/spec/testing.md](../../docs/spec/testing.md) §8.10), this is the heaviest but most faithful layer. Day to day, run `kumiki check` / `kumiki smoke` / `kumiki run` (happy-dom, fast, CI standard), and use this tier for bugs involving focus, layout, or real rendering, or for final confirmation.

Because it's heavy (browser binaries), it's not included in the default `turbo run test`. To use it routinely in CI, add `playwright install chromium` to the workflow.
