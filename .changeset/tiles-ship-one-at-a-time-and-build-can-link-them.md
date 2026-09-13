---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
"@kumikijs/cli": minor
---

Ship tiles one at a time, and link them with `kumiki build --bundle`

A counter with one button downloaded the `select` tile's 70-line option
reconciler, the `contenteditable` IME guard, the slider, and the `link` tile's
URL-disposition check and allowlist. `kumiki build` shipped runtime modules per
tile *family* (#71), and a family is a taxonomy, not a unit of code.

Two changes, which only work together.

**The module boundary now follows the code.** `text` and `input` ship one
module per tile (`tiles-text-link`, `tiles-input-button`, plus
`tiles-input-shared` for what the controls genuinely share). `layout` and the
rest still ship whole, because they are already one unit: layout's thirteen
kinds share five renderers — `page` and `column` are both `renderFlexColumn`,
six more are `renderBox` — so splitting it would ship the same bytes under more
names. The compiler's `PER_TILE_FAMILIES` says which is which, and a
cross-package test fails if a listed family gains a kind the runtime build has
no module for.

**`kumiki build --bundle`** links the generated module and the runtime modules
it imports into one minified `app.js`, and emits no `runtime/`.

| app | before | `--bundle` |
|---|---|---|
| 01-counter | 24.70 kB | **17.70 kB** (−28%) |
| 02-todomvc | 29.17 kB | **22.81 kB** (−22%) |
| 04-issue-tracker | 32.75 kB | **26.50 kB** (−19%) |
| 05-project-management | 37.18 kB | **29.87 kB** (−20%) |

(gzip -9, whole output directory. Raw drops by about the same: 192.81 → 137.60
kB for the largest.)

**Why they need each other.** Bundling alone leaves the tiles: a family module
exports one object literal holding every renderer, and the app names the whole
object, so nothing tree-shakes it — bundling the counter without the split is
20.87 kB against 17.37 kB with it. And the split alone *costs* large apps:
compression builds its dictionary per response, so nineteen small modules
compress worse than seven bigger ones, and 04/05 come out ~3% larger
uncompressed-payload-for-payload even though their raw bytes drop. The default
modular build therefore moves a little in both directions — counter −12.5%,
issue-tracker +3.3% gzipped — and `--bundle` is where the win is.

**`--bundle` stays opt-in because it implies minification.** The cache
granularity a modular layout buys — `runtime/core.js` keeping a URL that
survives an app change — is the smaller half of the argument, and nothing
outside HTTP caching depends on that layout: the e2e tier, the MCP server, the
Vite plugin and smoke/run/test all take the `bundle: true` monolith path, and
the emitted `index.html` never names `runtime/`. What is load-bearing is that
`app.js` stays *readable*. The AI debug loop reads its stack traces, and three
harnesses string-replace codegen's emitted lines verbatim. A default that
minified would take both away, which is the same reason `--minify` is opt-in.

**New dependency, and one module subpath goes away.** `@kumikijs/cli` now
depends on `rolldown`, which serves both flags — `--minify` keeps `./runtime/*`
external and minifies the app module alone, `--bundle` pulls them in. It is
pinned to `1.0.3`, the exact version `vite` (already a CLI dependency) pins, so
the two share one copy instead of shipping a second native toolchain; that pin
should move only together with vite's. It is imported lazily, inside the two
functions that use it, so `check` / `list` / `view` / `fix` and `@kumikijs/mcp`
at startup do not pay to load a native addon for flags they never pass.

`@kumikijs/runtime`'s `./modules/*` subpath no longer resolves
`./modules/tiles-text.js` or `./modules/tiles-input.js` — those two families
are now `tiles-text-<kind>` / `tiles-input-<kind>` plus `tiles-input-shared`.
The subpath is there for `kumiki build` to copy from rather than as an API, and
nothing in this repo deep-imports it, but a host that did will need the new
names.

Nothing about authoring changes. The monolith `mount()` still assembles every
family, `textTiles` / `inputTiles` are still exported with the same contents,
and the browser tier (25 Playwright cases, including the select / editable /
video / keyed-list identity guards the tile split could have broken) is green.
