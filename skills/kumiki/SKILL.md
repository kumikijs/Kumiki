---
name: kumiki
description: Write, debug and verify Kumiki programs (.kumiki files) — the declarative web app language. Use whenever you create or edit a .kumiki file, hit a Kumiki diagnostic (E0xxx / W0xxx), or need to prove a Kumiki app works. The instructions come from the installed kumiki CLI, so they match its version.
---

# Kumiki

The instructions for Kumiki ship with the `kumiki` CLI, so they always match the compiler you
run. Read them from it instead of relying on what you remember about the language:

```sh
kumiki guide author    # before writing or extending a program
kumiki guide debug     # when `kumiki check` reports a diagnostic, or the app misbehaves
kumiki guide iterate   # to prove an app meets its requirements, with a scenario
kumiki guide E0201     # one diagnostic's rule and fix
kumiki guide language  # a spec document; `kumiki guide` lists them all
```

No global install? Prefix each command with `npx`. In the Kumiki repository itself, run
`pnpm kumiki guide …` from the root. Over MCP (`@kumikijs/mcp`), the `kumiki_guide` tool answers
the same topics.

Whatever the guide says, never call a Kumiki app done on `kumiki check` alone: also run
`kumiki smoke`, and a scenario with `kumiki run` when there are requirements to meet.
