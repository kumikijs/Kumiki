# kumiki

The convenient entry point for **Kumiki**, an AI-first web framework language. This package provides the `kumiki` command and simply wraps [`@kumikijs/cli`](https://www.npmjs.com/package/@kumikijs/cli).

## Install

```sh
npm i -g kumiki
# or run without installing
npx kumiki --help
```

## Usage

```sh
kumiki build <input.kumiki> <outdir>   # compile to a runnable app
kumiki check <input.kumiki>            # type-check and report diagnostics
```

Run `kumiki` with no arguments to see the full command list.

## Library use

For programmatic use, install the scoped packages directly:

- [`@kumikijs/compiler`](https://www.npmjs.com/package/@kumikijs/compiler) — lexer, parser, typechecker, codegen
- [`@kumikijs/runtime`](https://www.npmjs.com/package/@kumikijs/runtime) — DOM runtime
- [`@kumikijs/cli`](https://www.npmjs.com/package/@kumikijs/cli) — the CLI as a library
- [`@kumikijs/mcp`](https://www.npmjs.com/package/@kumikijs/mcp) — MCP server

See <https://github.com/kumikijs/Kumiki>.

## License

Apache-2.0
