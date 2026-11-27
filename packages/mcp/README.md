# @kumikijs/mcp

English · [日本語](./README.ja.md)

Exposes the Kumiki compiler and the AI editing toolchain as an **MCP (Model Context Protocol) server**. From editors or AI agents, you can check, build, navigate, edit, and look up the spec for Kumiki programs.

## Tools

| Tool | Purpose |
|---|---|
| `kumiki_check` | Parse + type-check `source` or `path` and return diagnostics |
| `kumiki_build` | Compile to a self-contained JS module (runtime inlined) |
| `kumiki_smoke` | Mount to a headless DOM and operate the UI to detect runtime exceptions, empty rendering, and unhandled rejections (the layer check/build don't catch) |
| `kumiki_run_scenario` | Drive the app with a scenario (operation sequence + state assertions), returning per-step slot state, DOM, errors, and emits as a trace. The substrate for the human-free generate → run → observe → fix loop |
| `kumiki_list` | List definitions in a file (filterable by layer) |
| `kumiki_view` | Show a single definition (with dependencies via `withDeps`) |
| `kumiki_refs` | Search for references to a definition |
| `kumiki_add` / `kumiki_replace` / `kumiki_remove` / `kumiki_rename` | Edit definitions |
| `kumiki_fix` | Propose auto-patches for fixable diagnostics |
| `kumiki_guide` | What `kumiki guide` prints: the `author` / `debug` / `iterate` workflow guides, a diagnostic's entry (`E0201`), or a spec document |
| `kumiki_spec_search` / `kumiki_spec_list` / `kumiki_spec_get` | Search, list, and retrieve the normative spec (spec/) |

## Startup

```sh
pnpm --filter @kumikijs/mcp start
```

Example configuration for an MCP client (e.g. Claude Code):

```json
{
  "mcpServers": {
    "kumiki": {
      "command": "node",
      "args": ["--import", "tsx", "packages/mcp/src/server.ts"]
    }
  }
}
```

The guides and the spec are the ones `@kumikijs/cli` is built with, so the answers match the version installed. To read another copy of the spec, set the `KUMIKI_SPEC_DIR` environment variable.
