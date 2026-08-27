# Kumiki

English · [日本語](./README.ja.md)

**A web framework of AI, by AI, for AI.** Definitions interlock like Japanese joinery (_kumiki_) — no nails, no glue, no hidden state — so AI can write, edit, and reassemble an app in parallel without breaking it.

```kumiki
slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+1", onClick=inc)
tile App    = column(heading("Count: " + count.show), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Kumiki has none of the "optimized for human cognition" machinery like JSX, Hooks, dependency arrays, or Providers. Instead, it represents an app as a set of independent definitions across **7 layers** (type / slot / effect / reducer / tile / fn / app). Syntax overhead is small, dependencies between definitions are explicit, and AI can safely edit parts of it.

> The language, runtime, and tools are still pre-1.0 and may change between minor versions. Pin exact versions when you depend on it.

## Why Kumiki

Cross-vendor measurements (Claude / Codex / Gemini) show that, from the specification alone and in a single pass, LLMs can write mid-size Kumiki apps — up to a ~600-line multi-route issue tracker — that typecheck and build; larger apps (~1000+ lines) still need an edit loop. Token efficiency is also high: an equivalent app is roughly 1.4–2.0× smaller than React (tokens / lines). See [packages/benchmarks](./packages/benchmarks/).

## Repository layout

| Directory | Role |
|---|---|
| [`docs/`](./docs/) | Documentation site (VitePress). `spec/` (**normative spec**) · `guide/` (tutorials). Japanese pages under `ja/`. |
| [`packages/`](./packages/) | Implementation and supporting code. `compiler` / `runtime` / `cli` / `mcp` / `syntax`, plus `examples` / `tests` / `benchmarks` |

## Quick Start

Write a `.kumiki` file, then:

```sh
npm i -g kumiki
kumiki dev app.kumiki        # serve it with hot reload
kumiki check app.kumiki      # typecheck and report diagnostics
kumiki build app.kumiki ./out
```

[Getting Started](./docs/guide/getting-started.md) walks through that first file, and [Your First App](./docs/guide/your-first-app.md) builds it one layer at a time.

Working on Kumiki itself, from a clone:

```sh
pnpm install
pnpm build          # build all packages
pnpm test           # all tests
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
```

## Packages

| Package | Contents |
|---|---|
| [`@kumikijs/compiler`](./packages/compiler/) | lexer, parser, typechecker, codegen |
| [`@kumikijs/runtime`](./packages/runtime/) | DOM runtime (signal graph, mount, dispatch) |
| [`@kumikijs/cli`](./packages/cli/) | `kumiki` command (build / check / list / view / add / replace / remove / rename / fix) |
| [`@kumikijs/mcp`](./packages/mcp/) | MCP server. Exposes the compiler, AI editing, and spec search as MCP tools |

## Operating model

This repository aims for a state where "**looking at it resolves every question**". Questions, issues, and bug reports are, as a rule, **answered by adding examples and tests**. Broken examples are rejected by CI ([packages/tests/](./packages/tests/)). See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

[Apache-2.0](./LICENSE). See [NOTICE](./NOTICE) for the copyright notice.
