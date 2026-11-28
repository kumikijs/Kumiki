# Benchmarks

Kumiki's claims — "fewer tokens than React" and "an LLM can learn it from the spec alone" — are measured, not asserted. Two suites live in [`benchmarks`](https://github.com/kumikijs/Kumiki/tree/main/packages/benchmarks).

- **Size comparison** — how compact is a Kumiki app, and a Kumiki *edit*, versus the equivalent React? Deterministic.
- **Learning cost** — given only the spec, can an LLM write a program that builds and does what the task asks, with and without the Kumiki CLI in the loop?

## Size comparison (Kumiki vs React)

Baselines: the same TodoMVC written twice — [`02-todomvc/app.kumiki`](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/02-todomvc/app.kumiki) and a plain React [`App.tsx`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/size-comparison/todomvc-react/src/App.tsx), both with an Add button, a 280-character limit and its message, and blank drafts ignored. Tokenized with `gpt-tokenizer`.

### Whole file

| | chars | LOC (code) | cl100k tokens | o200k tokens |
|---|---:|---:|---:|---:|
| Kumiki | 4,975 | 123 | 1,427 | 1,430 |
| React | 8,023 | 255 | 2,021 | 2,062 |
| **React ÷ Kumiki** | **1.61×** | **2.07×** | **1.42×** | **1.44×** |

The same app costs an LLM ~1.4× fewer tokens and ~2× fewer lines in Kumiki.

### Edit scenarios

Whole-file size matters once; edit size matters every iteration. Four realistic feature changes were applied to both implementations, and the resulting unified diffs measured:

| Scenario | Impl | +lines | −lines | chars | cl100k |
|---|---|---:|---:|---:|---:|
| 01 add priority field | Kumiki | 4 | 4 | 582 | 177 |
| | React | 8 | 3 | 469 | 146 |
| 02 tighten the length limit to 100 | Kumiki | 1 | 1 | 100 | 30 |
| | React | 4 | 3 | 412 | 111 |
| 03 add archived state | Kumiki | 19 | 11 | 1,554 | 444 |
| | React | 27 | 9 | 1,461 | 413 |
| 04 dark theme | Kumiki | 25 | 6 | 1,315 | 401 |
| | React | 48 | 12 | 2,153 | 638 |
| **Total** | **Kumiki** | **49** | **22** | **3,551** | **1,052** |
| | **React** | **87** | **27** | **4,495** | **1,308** |

Totals favor Kumiki — 1.78× fewer added lines, 1.24× fewer tokens — but not uniformly. A small, localized React edit (01) is cheaper because JSX changes one attribute in place, while Kumiki replaces whole definitions. A change to a rule that lives in the type (02) is one line in Kumiki — the message and the refused input follow it — where React edits the guard, the message and `maxLength` in step. Kumiki also wins where a change crosses state + UI + logic (03, 04), which is where edits get risky in React.

### Edit representation (full file vs patch vs op stream)

Kumiki's AI-editing verbs (`add` / `replace` / `remove`) send whole definitions. Measured across the same four scenarios, the op stream costs **24% of the tokens of rewriting the full file** (1,456 vs 6,142 cl100k) — but a plain unified text patch is smaller still (1,052). The op stream's value is not minimal bytes; it's that each op is independently checkable and never produces a syntactically broken file.

## Learning cost (writing Kumiki from the spec)

Each task gives a model **only `docs/spec/` and a task spec**, in a workspace that holds nothing else, and scores the program it writes twice: does it build (parse, typecheck, build, `kumiki smoke`), and does it do what the task asks. For the second, the task spec names the ids, labels and effects the app must use, and hidden acceptance scenarios, one per criterion, drive it through them. Every task is run on two tracks:

- **spec**: no compiler in the workspace, so the program is written in one pass.
- **toolchain**: the Kumiki CLI is installed too, and the model may run `kumiki guide`, `check`, `build`, `smoke`, `run` and `test` as often as it likes, within 30 minutes.

Protocol details, the exact commands and per-run sizes are in [`learning-cost/summary.md`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/learning-cost/summary.md).

Acceptance criteria passed:

| Task | Claude | Claude + CLI | Codex | Codex + CLI | Gemini | Gemini + CLI |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| v1 Pomodoro (~60 LOC) | 5/5 | — | 5/5 | — | 5/5 | — |
| v2 Kanban (~200 LOC) | 9/9 | — | 9/9 | — | 9/9 | — |
| v3 Issue Tracker (~700 LOC) | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 |
| v4 Project Mgmt (~1,000 LOC) | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 |
| v5 Synced Notes (HTTP effects, ~300 LOC) | 9/14 | 14/14 | 0/14 | 14/14 | 10/14 | 14/14 |
| v6 Change Request (edit a 990-line app) | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |

Models: Claude Opus 5.5, Codex `gpt-6.1-terra`, Gemini `gemini-4-neon`, all at reasoning effort `high`, one run per cell. v1 and v2 were run on the spec track only.

What the table says:

- **Feature-heavy apps come out right from the spec alone.** All three vendors meet every criterion of v3, v4 and v6 without ever running a compiler, up to the ~1,000-line v4.
- **Effects are where the spec alone falls short, and the tools close the gap.** On v5, where every action goes through an HTTP effect that can fail, be retried or be superseded, the spec track loses 4–14 criteria. Two vendors misread what an effect result's second bind holds, which nothing checks; the third forgot the `/404` route every app needs. With the CLI all three reach 14/14.
- **Changing a large program stays small.** On v6 the six runs add 49–68 lines to the 990-line app and remove 4–11, and none breaks one of the 23 behaviours the change had to keep.

## Reproducing

```sh
pnpm --filter @kumikijs/benchmarks measure            # whole-file sizes + ratios
pnpm --filter @kumikijs/benchmarks measure:scenarios  # per-scenario patch sizes
pnpm --filter @kumikijs/benchmarks measure:ops        # full-file vs patch vs op stream
pnpm --filter @kumikijs/benchmarks eval <output.kumiki>  # does a learning-cost output build
pnpm --filter @kumikijs/benchmarks acceptance [tasks]     # does it meet its acceptance criteria
```

To refresh a learning-cost cell, run `pnpm --filter @kumikijs/benchmarks learning-cost <task> <vendor> <spec|toolchain>`: it builds the workspace, runs the vendor's agent and saves the output under `results/<Vendor>[-toolchain]/`. Then re-run `eval` and `acceptance`.
