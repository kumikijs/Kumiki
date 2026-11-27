---
name: kumiki-contribute
description: Change the Kumiki framework itself in this repository — the compiler, runtime, CLI, MCP server, spec or examples. Use when fixing a Kumiki bug, adding a language or runtime feature, or reconciling the spec with the implementation. For writing .kumiki programs, use the kumiki skill (`pnpm kumiki guide author`) instead.
---

# Contributing to Kumiki

`CLAUDE.md` and `CONTRIBUTING.md` are the rules; this is the order to apply them in.

## Writing or reading `.kumiki` in this repo

Run the guides from source, so they match the branch you are on:

```sh
pnpm kumiki guide author      # also: debug, iterate, a code such as E0201, a spec document
```

## A bug

1. Reproduce it with the smallest program: a `packages/examples/features/<n>-<name>.kumiki` plus a
   `<n>-<name>.scenario.json` that pins the correct behavior (it fails now). Take the next free
   number; list it in `packages/examples/features/README.md` and `README.ja.md`.
2. Add a regression test in the package that owns the bug (`packages/<pkg>/test/`), or
   `packages/tests/src/` only when it needs several packages together. Reuse the helpers in
   `test/helpers/`.
3. Fix it. If the spec and the implementation disagree, the spec wins unless the PR says why not.

## A feature

1. Acceptance criteria first, then tests, then code (t_wada-style TDD).
2. Update `docs/spec/` in both languages (`docs/spec/` and `docs/ja/spec/`).
3. Add a working example under `packages/examples/`.
4. If the change alters something a guide states — a diagnostic's fix, a CLI verb, a scenario
   field — update `packages/cli/src/guides/`. Diagnostic entries need no copy: `kumiki guide E0xxx`
   reads them from `docs/spec/errors.md`.

## Before the PR

```sh
pnpm exec turbo run typecheck test build && pnpm lint
```

- Add a changeset (`pnpm changeset`) for anything a user of a published package can observe; its
  first paragraph is one user-facing sentence.
- Branch from `dev`, and target `dev`.
