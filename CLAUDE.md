# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Kumiki is an **AI-first web framework language** — a declarative DSL plus compiler/runtime/tooling, optimized for LLMs to write/edit/reason about rather than for humans to read. A `.kumiki` source is a set of independent definitions across **7 layers** (type / slot / effect / reducer / tile / fn / app). The repo is a pnpm + Turborepo monorepo; `docs/spec/` is the **normative spec** and `packages/*` implements it.

For authoring, debugging, or iterating on `.kumiki` programs themselves, prefer the dedicated skills: `kumiki-author`, `kumiki-debug`, `kumiki-iterate`. This file is about working on the repo's TypeScript implementation.

## Commands

All workspace tasks run through Turborepo; `^build` is a dependency of `test`/`typecheck`, so they build upstream packages first. Turbo prints a task's log only when it fails (`outputLogs: errors-only`); pass `--output-logs=full` to see everything. Vitest prints console output only for failing tests (`silent: "passed-only"` in `vitest.shared.ts`).

```sh
pnpm install
pnpm build            # build all packages (tsdown / tsc)
pnpm test             # all tests (Vitest)
pnpm typecheck        # tsc --noEmit across packages
pnpm lint             # biome check . (the only lint that covers docs/ and benchmarks/)
pnpm format           # biome format --write .

# Pre-submission gate — everything must be green:
pnpm exec turbo run typecheck test build && pnpm lint
```

Single package / single test (Vitest):

```sh
pnpm --filter @kumikijs/compiler test
pnpm --filter @kumikijs/compiler exec vitest run test/parser.test.ts
pnpm --filter @kumikijs/compiler exec vitest run -t "test name substring"
```

Driving the Kumiki CLI from the repo root (runs the TS entry via tsx, no build needed):

```sh
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out
pnpm kumiki smoke <file>            # mount + interact in happy-dom (catches "compiles but renders nothing")
pnpm kumiki run <file> <scenario.json>
```

CLI verbs (registered in `packages/cli/src/kumiki.ts`, one file each under `src/commands/`): `build / dev / check / smoke / test / run / replay` and the AI-editing verbs `list / view / refs / add / replace / remove / rename / edit / patch / lock / unlock / fix`.

> **Environment note**: the shell is PowerShell on Windows. The user has a deny rule on running PowerShell cmdlets through the Bash tool — use the dedicated file/search tools, or invoke `pnpm`/`git` directly.

## Architecture

Published packages (`packages/*`, all released at one version):

| Package | Role |
|---|---|
| `@kumikijs/compiler` | The pipeline: `lex → parse → check → codegen` (`src/compile.ts`). Pure/browser-safe; Node-only helpers (capability manifest, runtime bundle reader) are isolated in `src/node.ts` and exported as `@kumikijs/compiler/node`. |
| `@kumikijs/runtime` | DOM runtime — signal graph, mount, effect dispatch, SSR, and the smoke / scenario runners. Compiled apps import from it (or it's inlined via `bundle: true`). |
| `@kumikijs/cli` | The `kumiki` commands listed above. |
| `@kumikijs/mcp` | MCP server exposing the compiler, AI-editing, and spec search as MCP tools. |
| `@kumikijs/vite` | Vite plugin — `import App from "./app.kumiki"` in any Vite/Next project (compiles via `exportApp`; optional typed `.gen.ts` provider helpers). |
| `@kumikijs/syntax` | TextMate grammar for `.kumiki` (Shiki / VitePress / VS Code). |
| `@kumikijs/icons` | Built-in icon set, bundled by the CLI and the Vite plugin. |
| `kumiki` | Thin CLI wrapper over `@kumikijs/cli`; the package users install. |

Private packages:

| Package | Role |
|---|---|
| `@kumikijs/examples` | `features/` (one feature per file) and `apps/` (size-ordered apps), each optionally with `.scenario.json` / `.http.json` / `.browser.json` beside it. `src/index.ts` exports their paths (`feature(name)`, `app(name)`, `allFiles()`, `scenarioCases()`, …) — tests import fixtures from here instead of walking relative paths. |
| `@kumikijs/tests` | Integration tests that need compiler + runtime + CLI together, in `src/`. `examples.test.ts` compiles, smokes and mounts every example; `scenarios.test.ts` runs every scenario. |
| `@kumikijs/e2e` | Real-browser tier (Playwright/Chromium), runs the `.browser.json` fixtures. |
| `@kumikijs/benchmarks` | Learning-cost, token and bundle-size benchmarks. Baseline sources there are frozen inputs — never reformat them. |
| `docs` (`@kumikijs/docs`) | VitePress site: spec, guide, playground, example showcase. |

**The compiler keeps Node imports out of the core.** Anything touching the filesystem belongs in `src/node.ts`, injected into `compile()` (e.g. `readRuntimeBundle`) so the compiler runs unchanged in the browser. Preserve this boundary.

**The runtime ships per-app.** A build includes only the runtime modules an app uses: each module is a tsdown entry in `packages/runtime/tsdown.config.ts`, and `preserveEntrySignatures: "allow-extension"` folds shared code into entry chunks instead of an anonymous shared chunk. Code a build should be able to leave out must be its own entry, registered wherever the compiler and CLI enumerate runtime modules.

**3-tier verification** — `check`/`build` only guarantee syntax, types, and codegen. Whether an app actually mounts and survives interaction is a separate guarantee:
1. **check / build** — lexer, parser, typechecker, codegen.
2. **smoke / scenario** (`kumiki smoke`, `kumiki run`; runtime in happy-dom) — catches "compiles but renders nothing / throws on interaction", and with a scenario, wrong behavior.
3. **e2e** (`@kumikijs/e2e`, Chromium) — CSS layout, real focus, rendering bugs a headless DOM can't see.

## Operating model (read before making changes)

The repo's policy is "**looking at it resolves every question**" — questions and bugs are answered by adding examples and tests, not prose. From `CONTRIBUTING.md`:

- **New feature** → update `docs/spec/` (authoritative) **and** add a working example to `packages/examples/`.
- **Bug** → add a minimal repro to `packages/examples/` with a scenario that pins the behavior, plus a regression test in the package that owns the bug (`packages/<pkg>/test/`; `packages/tests/` only when it needs several packages), then fix.
- **Spec ⇆ implementation discrepancy** → the spec wins; record which side to fix in the PR description.
- **Every example must pass check + build + smoke**, and every app example ships a `scenario.json` — `@kumikijs/tests` enforces this in CI.

Follow **TDD (t_wada style)**: Design → Acceptance Criteria (as AC, no code) → test code → implementation → iterate. Don't jump straight to implementation.

### What a test is for

- A test exercises behavior through an API. Tests that read source or doc files and grep them are linters in disguise — don't write them; make the invariant a type, a runtime check, or a Biome rule instead.
- A comment that explains *what* the code does should be a test case instead. Comments carry only a short *why* that the code cannot.
- Shared test helpers live in each package's `test/helpers/` (`packages/tests/src/helpers/`); don't redefine `freshRoot`, `runCli`, `codes`, etc. per file. Table-drive cases that differ only by data (`it.each`).

## Conventions

- **Package manager is pnpm**; build is Turborepo + tsdown/tsc; tests are Vitest; lint/format is Biome (2-space, width 100). Run `pnpm format` before finishing.
- **Never hardcode dependency versions.** Install latest via `pnpm add`; put shared versions in the `catalog:` block of `pnpm-workspace.yaml` and reference them as `"catalog:"`.
- **Inline lint suppression is forbidden** (`@biome-ignore`, `@ts-ignore`, etc.). If you reach for one, the design is wrong — fix the root cause. Biome enables `useImportType`, `useNodejsImportProtocol`, and warns on `noExplicitAny`.
- **No references that go stale** in code, comments, test names, or examples: no spec section numbers (`§2.2`), no issue/PR numbers or links. Name the spec file if a pointer is needed. Section numbers belong inside `docs/spec/` only.
- **Publishing**: packages dev-resolve `exports` to `src/*.ts`, and `publishConfig.exports` switches to built `dist/*.js` at publish. tsdown builds the dist. Don't point exports at dist for local dev.
- **Releases**: Changesets, with every public package in one `fixed` group (one version for all) and private packages unversioned. A changeset's first paragraph is its changelog entry — write one user-facing sentence there; detail goes in the PR. The changelog formatter is `.changeset/changelog.cjs`.
- **Git**: never commit to `main`/`dev`; branch first and commit frequently. Feature PRs target `dev`; a release is a `dev` → `main` PR followed by the generated "Version Packages" PR.
