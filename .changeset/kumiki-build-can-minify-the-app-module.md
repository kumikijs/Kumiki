---
"@kumikijs/cli": minor
---

`kumiki build --minify`

The generated `app.js` was the only thing in a build's output that shipped
unminified — the runtime modules beside it come minified from the runtime's own
build. On a large app it is the bigger of the two:

```
kumiki build packages/examples/apps/05-project-management/app.kumiki out
  app.js      118.72 kB   runtime/  73.58 kB
kumiki build packages/examples/apps/05-project-management/app.kumiki out --minify
  app.js       72.15 kB   runtime/  73.58 kB
```

| app | total raw | total gzip |
|---|---|---|
| 01-counter | 73.25 → 69.47 kB | 24.70 → **23.77 kB** |
| 02-todomvc | 89.15 → 81.79 kB | 29.17 → **28.16 kB** |
| 04-issue-tracker | 128.15 → 107.22 kB | 32.75 → **31.38 kB** |
| 05-project-management | 192.81 → 146.23 kB | 37.18 → **35.02 kB** |

Raw drops 5–24%, gzip 3.5–6%. The raw number is the one that matters most
here: it is what the browser parses before the first render, and gzip was
already flattening the generated code's repetition.

**It is opt-in, and the readable default is the point.** The AI debug loop
reads `app.js` stack traces, and the harnesses (`build-and-load.ts`,
`tests/helpers/load.ts`, `e2e/src/browser.ts`) patch two of codegen's emitted
lines by verbatim string replace. Minifying renames every top-level binding, so
a build that did it unasked would take both away. Nothing but `app.js` changes:
`index.html` and every `runtime/*.js` are byte-identical with and without the
flag.

A minifier error fails the build rather than falling back to the unminified
source — under a flag that says `--minify`, a silent fallback would deploy the
readable build. Nothing reaches the output directory until the minified module
is in hand, either, so a failure leaves no complete-but-unminified build behind
for a deploy step that missed the exit code to ship instead.

`packages/cli/test/build-minify.test.ts` covers all four: the default still
carries the spelling the harnesses patch, `--minify` is substantially smaller,
only `app.js` differs, and the minified counter still mounts, still increments
on a click, and still publishes `globalThis.__kumikiApp`.
