---
"@kumikijs/cli": minor
"@kumikijs/mcp": minor
---

feat(cli,mcp): `kumiki fix` says why it produced no patch, instead of collapsing
20+ distinct dead ends into one message (#177).

`planTestPatch`'s third tier and `planFixes` between them had over twenty silent
`return null` / `continue` branches, all of which surfaced as
`(no auto-patch available)`. An AI iteration loop could not tell "no repair
exists for this" from "the compiler's message format moved and the extractor
stopped matching" — so a change to the quoted-name shape would have disabled
every auto-patch with no signal at all.

`planFixesExplained` / `planTestPatchExplained` return a stable kebab-case reason
per skip. It reaches `FixFromTestOutcome`'s `no-patch` result, is printed by the
CLI, and is exposed to the MCP bridge, with the whole chain available under
`KUMIKI_DEBUG=fix`. Message-format drift now reads as an anomaly in the reason
distribution rather than as silence. `planFixes` and `planTestPatch` remain as
wrappers, so no existing caller changes.
