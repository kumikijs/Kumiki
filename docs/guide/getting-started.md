# Getting Started

Install the CLI, write one file, and watch it run in a browser. Nothing else is required — no clone, no bundler config, no project scaffold.

## Install

```sh
npm i -g kumiki
# or, without installing
npx kumiki --help
```

Node.js 22 or newer.

::: tip No install at all
The [Playground](./playground.md) runs the compiler and the runtime inside your browser. Pick an example, edit on the left, watch it render on the right.
:::

## Write an app

Save this as `app.kumiki`:

```kumiki
slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+1", onClick=inc)
tile App    = column(heading("Count: " + count.show), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Four declarations: `slot` is the state, `reducer` turns an event into a state change, `tile` projects state to UI, and `app` names the entry point. [Your First App](./your-first-app.md) builds the same file line by line, and [Thinking in Kumiki](./thinking-in-kumiki.md) covers the remaining three layers.

## Run it

```sh
kumiki dev app.kumiki
# → kumiki dev — http://localhost:5173/
```

Open that URL and click `+1`. The dev server rebuilds on save and shows compile errors in an overlay.

When you want a static bundle instead:

```sh
kumiki build app.kumiki ./out
# → Wrote out/index.html, app.js, runtime/ (core, stdlib, tiles-layout, tiles-text, tiles-input)
```

`out/index.html` opens straight from disk. `runtime/` carries only the modules this app touches, so the counter ships about 9KB gzipped; an app that never routes or renders a table ships no router and no table code.

## Verify it

`check` reads the file without running it:

```sh
kumiki check app.kumiki
# → ok
```

`smoke` mounts the app in a headless DOM and clicks through it, which catches the app that compiles and then renders nothing:

```sh
kumiki smoke app.kumiki
# → ok — mounted, rendered, 1 interaction(s), no runtime errors
```

Both are worth running before you ship. `kumiki` with no arguments lists the rest of the commands.

## When check fails

Every diagnostic carries a code and a position:

```
E0103 undef-ref at 3:39: Reference to undefined name "total"
```

The code names the category. Look it up in the [error catalog](../spec/errors.md) — `E0103` there tells you the name resolves to nothing, which is a typo or a missing definition nine times out of ten. `kumiki fix app.kumiki E0103` proposes a patch for the codes that have one.

## Next

- [Your First App](./your-first-app.md) — the counter, one layer at a time
- [Recipes](./recipes.md) — reverse lookup from "I want to do X" to a working example
- [Examples](https://github.com/kumikijs/Kumiki/tree/main/packages/examples) — one file per feature, plus complete apps

::: details Working from a clone
Clone the repository when you want the examples, the benchmarks, or the compiler source. The workspace exposes the same CLI as `pnpm kumiki`, run from the repository root:

```sh
git clone https://github.com/kumikijs/Kumiki.git
cd Kumiki
pnpm install
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
```
:::

::: details Driving Kumiki from an AI agent
`@kumikijs/mcp` exposes check, build, per-definition editing, and spec search as MCP tools. See its [README](https://github.com/kumikijs/Kumiki/blob/main/packages/mcp/README.md) for a client configuration.
:::
