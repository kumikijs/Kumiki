---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
"@kumikijs/syntax": minor
"@kumikijs/icons": minor
"@kumikijs/vite": minor
"@kumikijs/cli": minor
"@kumikijs/mcp": minor
"kumiki": minor
---

chore: require Node 24.

Node 20 reached end of life, so every package's `engines.node` moves from
`>=20` (`>=20.6` for `@kumikijs/vite`, which needs the synchronous
`import.meta.resolve` that landed there) to `>=24`. CI builds and tests on 24
as well, matching the release workflow, which was already there.

**Breaking for anyone installing on Node 20 or 22**: the packages declare the
new floor, so `npm i` warns and an `engine-strict` install fails. Nothing in
the published code depends on a Node 24 API today — the bump states the
version the toolchain is actually tested on, rather than one that no longer
receives security fixes.
