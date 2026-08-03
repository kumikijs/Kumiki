# Getting Started

Kumiki is an AI-first web framework. You describe an app as small, interlocking definitions and the toolchain compiles it to a plain browser app.

## Try it without installing

The fastest taste is the [Playground](./playground.md): it runs the compiler and runtime entirely in your browser. Pick an example, edit on the left, and watch it render on the right — no clone, no install.

Work locally (below) when you want the CLI, MCP, or your own files.

## What a Kumiki program looks like

A counter is just a few declarations — `slot` is state, `reducer` turns an event into a state change, `tile` projects state to UI, and `app` wires it together:

```kumiki
slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+1")
tile App    = column(heading("Count: " + count), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

That is the whole mental model. The full example is [app.kumiki](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/01-counter/app.kumiki), and the seven layers are covered in [Thinking in Kumiki](./thinking-in-kumiki.md).

## Set up locally

You need **Node.js 22+**. Install `@kumikijs/cli`:

```sh
npm i -g @kumikijs/cli
# or run without installing
npx @kumikijs/cli --help
```

If you want to explore the source — examples, benchmarks, and the playground — clone the repository instead and use the workspace `kumiki` script:

```sh
git clone https://github.com/kumikijs/Kumiki.git
cd Kumiki
pnpm install        # links the workspace packages — required before any command
pnpm build          # build all packages
pnpm test           # optional: confirm every package turns green
```

## Run your first example

**Check** — parse and type-check a `.kumiki` file:

```sh
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
# → ok
```

**Build** — compile to a static app:

```sh
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out
# → Wrote out/index.html, app.js, runtime/ (core, stdlib, tiles-layout, tiles-text, tiles-input)
```

Open `out/index.html` in a browser and the counter works: "Count: 0" with buttons that increment, decrement, and reset. `app.js` is the generated pure logic; `runtime/` holds only the DOM-runtime modules this app actually uses (minified — the counter ships ~9KB gzip; an app that never routes or renders tables ships no router or table code).

**Smoke** — confirm it actually runs, not just compiles. This mounts the app in a headless DOM and clicks through it:

```sh
pnpm kumiki smoke packages/examples/apps/01-counter/app.kumiki
# → ok — mounted, rendered, 3 interaction(s), no runtime errors
```

## When something fails

Check errors carry a code and a location:

```
E0103 undef-ref at 3:39: Reference to undefined name "total"
```

The code (here `E0103`) names the category — look it up in the [error catalog](../spec/errors.md). Most failures are a typo or a missing definition, and [Thinking in Kumiki](./thinking-in-kumiki.md) plus the [recipes](./recipes.md) cover the common fixes.

If a command itself errors out:

- `Cannot find package '@kumikijs/compiler'` or `tsx: command not found` → you skipped `pnpm install`; run it.
- A path-not-found on the `.kumiki` file → check the path is relative to the repo root (that is where `pnpm kumiki` runs).

## Editor / AI integration (MCP)

`@kumikijs/mcp` exposes check, build, edit, and spec-search as MCP tools, so an AI agent can drive Kumiki end to end. For an example client configuration, see [README.md](https://github.com/kumikijs/Kumiki/blob/main/packages/mcp/README.md).

## Next

- [Your First App](./your-first-app.md) — write a Counter from scratch, one layer at a time.
- [Thinking in Kumiki](./thinking-in-kumiki.md) — the 7 layers and how they differ from React.
- [Examples](https://github.com/kumikijs/Kumiki/tree/main/packages/examples) — minimal per-feature samples and complete apps.
- [Playground](./playground.md) — keep experimenting in the browser.
