# @kumikijs/benchmarks

Three benchmark suites for Kumiki. Private workspace package; run via `pnpm --filter @kumikijs/benchmarks <script>`.

```
benchmarks/
├── size-comparison/        # How compact is Kumiki vs React?
│   ├── todomvc-react/      #   React baseline (App.tsx)
│   ├── scenarios/          #   4 edit scenarios (kumiki-modified / react-modified)
│   └── scripts/            #   measure.mjs · measure-scenarios.mjs · measure-ops.mjs
├── reactivity/             # How costly is a re-render? (runtime baseline)
│   ├── reactivity-cost.mjs #   nodes created + render time across app sizes
│   ├── keyed-move-cost.mjs #   children moved per reorder of a keyed list
│   └── stats.mjs           #   median / p90 / stddev of the timing sample (+ stats.test.mjs)
└── learning-cost/          # Can an LLM write Kumiki from the spec alone?
    ├── summary.md          #   cross-vendor results + methodology (read this)
    ├── eval.mjs            #   scores one .kumiki file: parse / typecheck / build + LOC / tokens
    ├── v1-pomodoro/        #   ~90 LOC   (Claude only)
    ├── v2-kanban/          #   ~200 LOC
    ├── v3-issue-tracker/   #   ~600 LOC
    └── v4-project-management/  # ~1000 LOC
        ├── task-spec.md / task-spec.ja.md   # the requirements given to the model
        ├── codex-prompt.txt / gemini-prompt.txt  # the exact driving prompts
        └── results/{Claude,Codex,Gemini}/output.kumiki + results/eval.json
```

## Size comparison (Kumiki vs React)

The Kumiki baseline is `packages/examples/apps/02-todomvc/app.kumiki`; the React baseline is `size-comparison/todomvc-react/src/App.tsx`. Deterministic — re-run any time.

```sh
pnpm --filter @kumikijs/benchmarks measure            # whole-file: LOC / chars / cl100k / o200k, React÷Kumiki ratios
pnpm --filter @kumikijs/benchmarks measure:scenarios  # per-scenario patch sizes (lines / chars / tokens)
pnpm --filter @kumikijs/benchmarks measure:ops        # Kumiki edit cost: full-file vs unified-patch vs op-stream
```

Tokenized with `gpt-tokenizer` (cl100k_base / o200k_base). Latest headline: a Kumiki app is ~1.4× fewer tokens and ~2.0× fewer lines than the equivalent React.

## Reactivity cost (runtime re-render baseline)

Quantifies how much work a state change costs. The original runtime tore the whole tile tree down and rebuilt it on every update, so a single-slot change recreated every DOM node even though one text node semantically changed; the tile-level keyed diff and the identity-preserving patch that replaced it now leave the mounted nodes in place and mutate the one text node. The harness mounts generated apps of increasing size in happy-dom and times single-slot updates, so the report shows both sides of that: `waste×` (nodes created ÷ nodes semantically changed) and the render-time distribution per app size (see `docs/design/reactivity-v2.md`).

```sh
pnpm --filter @kumikijs/benchmarks measure:reactivity   # render ms (median / p90 / stddev / min / max) + nodes-recreated / waste× per app size
```

Requires the runtime + compiler dist bundles (`pnpm build` upstream, which Turborepo's `^build` handles). happy-dom is far faster than a real browser, so the absolute times are a floor, not a ceiling; what matters is the **shape** — whether the per-update cost stays decoupled from tile count. Read `median ms` next to `p90 ms`: a real regression moves both, a busy machine moves only the tail, and the run says so itself (a warning on stderr) when its tail detaches from its median. `stddev` is included but is dominated by isolated GC pauses, so it reads as a tail indicator rather than an error bar.

## Keyed reorder cost (how many children a new order costs)

The companion question for lists: keyed matching (`docs/spec/runtime.md` §10.3.10) says which mounted element belongs to which new child, but not how many of them have to be touched to produce the new order. Re-attaching a node blurs it, so a child moved for no reason loses focus, the caret, an open `<select>` and an in-flight IME composition — the state keyed matching exists to keep. The harness drives a keyed list through five transitions (unchanged / move one / insert at head / remove from the middle / reverse) and counts the container's own child mutations, separating **moves** (an element that was already on the page) from mounts and removals.

```sh
pnpm --filter @kumikijs/benchmarks measure:keyed-moves   # moves vs the hand-derived minimum vs the whole-sequence sweep, per list size
```

`minimum` is what the transition costs at best; `sweep` is what replaying the entire target sequence costs (one placement per child), which is what the runtime used to do. The run warns on stderr if any row sits above its minimum, and refuses to report at all if the keyed path was declined mid-measurement (it reads `onDiagnostic`, so a silent fallback cannot masquerade as a result). Note the timings are happy-dom's: its `insertBefore` scans the child array for the reference node where `appendChild` pushes, so a transition that moves nearly everything reads slower there than the sweep did while making one fewer move. That is the fake DOM's child storage, not the algorithm — `moves` is the number to read.

## Learning cost (LLM writes Kumiki from spec)

Each `vN-*/` task gives a model only its `task-spec.md` + `docs/spec/` and asks for a single-pass `.kumiki` program (no example apps, no compiler-in-the-loop). `eval.mjs` then scores parse / typecheck / build and records LOC + token count.

```sh
# score one (or more) output files
pnpm --filter @kumikijs/benchmarks eval learning-cost/v3-issue-tracker/results/Claude/output.kumiki
```

Cross-vendor results (Claude / Codex / Gemini) and the full methodology — including how each model failed and why — are in **[learning-cost/summary.md](./learning-cost/summary.md)**. The runs surfaced two real defects, both since fixed (#61 unimplemented built-in tiles, #62 under-specified rules); the scores there are re-evaluated against the patched compiler.

To refresh a vendor column: run the model on `vN-*/codex-prompt.txt` or `gemini-prompt.txt`, save its output to `results/<Vendor>/output.kumiki`, then re-run `eval` and update `results/eval.json`.
