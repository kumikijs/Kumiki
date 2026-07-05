---
"@kumikijs/cli": minor
---

feat(cli): `kumiki dev` — Vite dev server + episode timeline panel (#118).

New `kumiki dev <file>` verb boots a Vite dev server that compiles the source `.kumiki` on-the-fly, remounts the app across HMR without losing the in-flight episode, and exposes a browser-side episode timeline panel for step-through inspection.

- cli: `packages/cli/src/dev.ts` orchestrates the Vite server; middleware serves the compiled bundle non-silently on errors. HMR remount catches listener leaks by cleaning up before remounting.
- cli: `packages/cli/src/dev/panel.ts` renders the timeline overlay; `dev/client.ts` streams episode events to it.
- tests: CLI dispatch test widened to 30s for tsx cold start.
