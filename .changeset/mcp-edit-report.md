---
"@kumikijs/mcp": minor
"@kumikijs/cli": minor
---

fix(mcp): the edit tools report what they did — the op-id, and the whole
cascade a `remove` took.

`kumiki_remove` answered `removed slot.count` for an operation that had also
deleted the reducers reading that slot, the tile rendering them, and the `app`
routing to that tile. The CLI has printed the cascade since the op log learned
to record it (spec/ai-edit.md §9.4.1); the MCP handler dropped the result on
the floor, so the surface agents actually drive was the one that said an edit
deleting six definitions had deleted one — and a file could lose its entry
point with nothing in the transcript to say so.

The op-id went the same way, in `kumiki_add`, `kumiki_replace`,
`kumiki_remove` and `kumiki_rename` alike, though the §9.7 tool table lists it
as the return value of all five edit tools. It is the handle `kumiki patch
revert` takes and the key `kumiki_history` is read by, so an agent that made an
edit could not name it afterwards.

Both surfaces now format their report with one shared function, `describeEdit`,
newly exported from `@kumikijs/cli` — the CLI verbs print it and the MCP tools
return it, so the two cannot answer the same edit differently. CLI output is
unchanged, byte for byte.
