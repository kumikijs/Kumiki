# Contributing to Kumiki

English · [日本語](./CONTRIBUTING.ja.md)

Kumiki is pre-1.0 OSS, and its operating policy is somewhat unusual. Please read this before getting your hands dirty.

## Core policy: answer questions and bugs with examples and tests

The goal of this repository is that "**looking at it resolves your question**". Therefore:

- **When a question comes in** → add the relevant minimal example to `packages/examples/features/` (if it doesn't exist).
- **When a bug report comes in** → add a minimal reproduction to `packages/examples/`, add a regression test to `packages/tests/`, and then fix it.
- **When you add a new feature** → update `docs/spec/` and add a working example to `packages/examples/`.

The spec (`docs/spec/`) is authoritative, and the implementation (`packages/`) follows it. When you find a discrepancy, record the design decision of which to fix in the PR description.

## Development flow (TDD)

1. **Design** — settle the requirements and approach
2. **Acceptance Criteria (AC)** — write out test cases as AC (no code yet)
3. **Test implementation** — write test code from the AC
4. **Implementation** — write production code to pass the tests
5. **Iterate** — until all tests are green

Don't start straight from implementation.

## Setup

```sh
pnpm install
pnpm build
pnpm test
```

Tooling: the package manager is **pnpm**, the build is **Turborepo** + **tsc/esbuild**, the test runner is **Vitest**, and the linter/formatter is **Biome**.

## Pre-submission check

```sh
pnpm exec turbo run typecheck test lint build
```

Everything must be green. In particular:

- **Every new example must pass check + build + smoke** (`packages/tests/` verifies this automatically). `check`/`build` only guarantee syntax, types, and codegen. Whether it **actually mounts and survives interaction** is verified by `kumiki smoke <file>` (= the runtime smoke in `packages/tests/`). "Compiles but errors / renders nothing when run" bugs are caught here.
- **An example never reaches the network.** An example that emits an http effect ships a sibling `<source>.http.json` — `{"GET /api/quote": {"json": …}}`, or an array whose last entry repeats when a retry ladder needs different answers. A request with no entry is reported and fails the run, so a missing fixture cannot hide behind an app's own `.err` reducer.
- **Every app example ships a `scenario.json`**, and `packages/tests/` runs it. Compiling and surviving `smoke` says nothing about whether the app does what it is for; the scenario is where that is written down. A feature example may add `<name>.scenario.json` the same way.
- **A test file lives inside a typechecked program.** Vitest strips types without checking them, so an assertion in an unchecked file can stop asserting without failing: `filter((d) => d.kind === "stale-closure-risk")` is structurally empty once that member is gone, and green forever. A workspace package that ships tests declares a `typecheck` script whose config includes them; where the build config's `rootDir` cannot take `test/`, that is a sibling `tsconfig.typecheck.json`. `packages/tests/typecheck-coverage.test.ts` enumerates the workspace with pnpm and the test files with git, and fails when a package does not.
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
| Tests | per-package `test/`, cross-cutting in `packages/tests/` |

## What CI checks in the docs

Documentation is guarded the same way code is, so a stale cross-reference fails a build instead of misleading a reader.

| Test | What it pins |
|---|---|
| `packages/tests/spec-index.test.ts` | The three indexes in `docs/spec/index.md` list exactly the codes `errors.md` documents and exactly the `.kumiki` files under `packages/examples/features/`; the English and Japanese indexes stay structurally in sync. |
| `packages/tests/docs-links.test.ts` | Every in-tree link and `#anchor` under `docs/` resolves to a page and a heading VitePress really emits. |
| `packages/tests/spec-blocks.test.ts` | Every fenced `kumiki` block under `docs/` behaves as its marker claims: an unmarked block checks clean, a `fragment` does not, a `snippet` does not parse, and an `invalid` fails. |
| `packages/compiler/test/spec-drift.test.ts` | The implementation and `errors.md` agree on the code catalog. |

Together they close the spec ⇆ implementation ⇆ examples triangle, which is why the indexes are generated rather than written by hand.
