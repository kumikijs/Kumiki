# Contributing to Kumiki

English · [日本語](./CONTRIBUTING.ja.md)

## Core policy: answer questions and bugs with examples and tests

The goal of this repository is that "**looking at it resolves your question**". Therefore:

- **When a question comes in** → add the relevant minimal example to `packages/examples/features/` (if it doesn't exist).
- **When a bug report comes in** → add a minimal reproduction to `packages/examples/` with a scenario that pins the behavior, add a regression test to the package that owns the bug (`packages/<pkg>/test/`; `packages/tests/` only when it needs several packages together), and then fix it.
- **When you add a new feature** → update `docs/spec/` and add a working example to `packages/examples/`.

The spec (`docs/spec/`) is authoritative, and the implementation (`packages/`) follows it. When you find a discrepancy, record the design decision of which to fix in the PR description.

## Setup

```sh
pnpm install
pnpm build
pnpm test
```

Tooling: the package manager is **pnpm**, the build is **Turborepo** + **tsdown/tsc**, the test runner is **Vitest**, and the linter/formatter is **Biome**.

## Pre-submission check

```sh
pnpm exec turbo run typecheck test build && pnpm lint
```

Everything must be green. In particular:

- **Every new example must pass check + build + smoke** (`packages/tests/` verifies this automatically). `check`/`build` only guarantee syntax, types, and codegen. Whether it **actually mounts and survives interaction** is verified by `kumiki smoke <file>`, which `packages/tests/` runs on every example. "Compiles but errors / renders nothing when run" bugs are caught here.
- **An example never reaches the network.** An example that emits an http effect ships a sibling `<source>.http.json` — `{"GET /api/quote": {"json": …}}`, or an array whose last entry repeats when a retry ladder needs different answers. A request with no entry is reported and fails the run, so a missing fixture cannot hide behind an app's own `.err` reducer.
- **Every app example ships a `scenario.json`**, and `packages/tests/` runs it. Compiling and surviving `smoke` says nothing about whether the app does what it is for; the scenario is where that is written down. A feature example may add `<name>.scenario.json` the same way.
- **A test file lives inside a typechecked program.** Vitest strips types without checking them, so an assertion in an unchecked file can stop asserting without failing. A workspace package that ships tests declares a `typecheck` script whose config includes them.
- **A test exercises behavior.** A test that reads source or documentation files to grep them is a linter in disguise and costs more to maintain than it catches; make the invariant a type, a runtime check, or a lint rule instead. Fixtures come from `@kumikijs/examples` (`feature(name)`, `app(name)`), not from relative paths.
- **No references that go stale.** Code, comments, test names, and examples carry no spec section numbers and no issue or PR numbers; name the spec file when a pointer helps.
- **Inline lint suppression (`@biome-ignore`, etc.) is forbidden**. If you want to add one, fix the design instead.
- **Don't hardcode dependency versions**. Install the latest with `pnpm add`, and put shared versions in the catalog of `pnpm-workspace.yaml`.

## Git

- Don't commit directly to `main` / `dev`. Create a feature branch.
- Commit frequently.

### Branching & release train

`dev` is the integration branch; `main` is release-only. Feature PRs target `dev`,
so changesets accumulate there without triggering a release. When it's time to
release, merge `dev` → `main` (one PR): the `release` workflow then opens a single
"Version Packages" PR for the whole batch, and merging that publishes to npm.

- Feature / fix work → PR into `dev`.
- Release → PR `dev` → `main`, then merge the auto-generated "Version Packages" PR.

## Where things go, by directory

| Change | Location |
|---|---|
| Language/runtime spec | `docs/spec/` |
| Usage / tutorials | `docs/guide/` |
| Working examples | `packages/examples/features/` or `packages/examples/apps/` |
| Implementation | `packages/*/src/` |
| Tests | per-package `test/`; tests that need several packages together in `packages/tests/src/` |

## Changesets

Every change that a user of a published package can observe adds a changeset (`pnpm changeset`). All public packages are released together at one version, so pick the bump for the release as a whole: `minor` for anything that breaks or changes behavior before 1.0, `patch` otherwise.

The first paragraph of a changeset becomes its line in each package's `CHANGELOG.md` — write one user-facing sentence there. The motivation, the investigation, and the edge cases belong in the PR description, which the changelog links to through the commit.
