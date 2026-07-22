---
"@kumikijs/runtime": minor
---

runtime: populate episode `signal-update` step's `binds-updated` field from the tiles/binds the keyed diff (#187) actually patched (#189, follow-up to #159 Decision 3).

Turns "slots X, Y changed" in the episode log into "slots X, Y changed → tiles A, B / bind `todo.title` were re-rendered" — a causal chain that makes "slot changed but tile did not update" bugs directly visible in `kumiki run --episode-log` traces and the MCP episode reader. Identifier priority per patched subtree root: `bind` (joined with `bindPath`, matching `data-kumiki-bind`) → `TileNode.key` → `kind`.

No schema change: the field was already declared on `EpisodeStep` and always emitted as `[]`; consumers that ignored it continue to work. SSR bootstrap episodes still emit `binds-updated: []` (no diff runs there).
