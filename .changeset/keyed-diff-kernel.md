---
"@kumikijs/runtime": minor
---

feat(runtime): reconcile the new tile tree against the mounted one instead of
tearing the whole tree down on every state change (#187).

Every slot write used to rebuild the entire tile tree and hand it to
`target.replaceChild`, so a leaf-only change re-created every Element on the
page. The walker now diffs the new `TileNode` tree against the mounted one and
rebuilds only the subtrees that actually changed; an unchanged tile keeps its
live DOM node, and with it focus, caret, `<select>` open state, and its event
listeners. Identity is structural here — position plus `kind` — with explicit
keys arriving in #188.

Measured on the reactivity benchmark (`measure:reactivity`, happy-dom floor),
waste ratio and median render for a single leaf change:

| tiles | before | after |
|---|---|---|
| 10 | 13× / ~0.12 ms | 1× / ~0.03 ms |
| 50 | 53× / ~0.43 ms | 1× / ~0.05 ms |
| 200 | 203× / ~1.40 ms | 1× / ~0.14 ms |
| 500 | 503× / ~3.88 ms | 1× / ~0.22 ms |

Render time decouples from total tile count: one Element created per update,
which is the semantic minimum. The focus/scroll snapshot layer stays as the
fallback for tiles that did rebuild.

Design: `docs/design/reactivity-v2.md` §2 Decision 1(a).
