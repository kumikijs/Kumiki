# Benchmarks

Kumiki's claims — "fewer tokens than React" and "an LLM can learn it from the spec alone" — are measured, not asserted. Two suites live in [`benchmarks`](https://github.com/kumikijs/Kumiki/tree/main/packages/benchmarks).

- **Size comparison** — how compact is a Kumiki app, and a Kumiki *edit*, versus the equivalent React? Deterministic.
- **Learning cost** — given only the spec, can an LLM write a program that parses, typechecks, and builds in a single pass?

## Size comparison (Kumiki vs React)

Baselines: the same TodoMVC written twice — [`02-todomvc/app.kumiki`](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/02-todomvc/app.kumiki) and a plain React [`App.tsx`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/size-comparison/todomvc-react/src/App.tsx). Tokenized with `gpt-tokenizer`.

### Whole file

| | chars | LOC (code) | cl100k tokens | o200k tokens |
|---|---:|---:|---:|---:|
| Kumiki | 4,710 | 116 | 1,360 | 1,364 |
| React | 7,357 | 236 | 1,887 | 1,926 |
| **React ÷ Kumiki** | **1.56×** | **2.03×** | **1.39×** | **1.41×** |

The same app costs an LLM ~1.4× fewer tokens and ~2× fewer lines in Kumiki.

### Edit scenarios

Whole-file size matters once; edit size matters every iteration. Four realistic feature changes were applied to both implementations, and the resulting unified diffs measured:

| Scenario | Impl | +lines | −lines | chars | cl100k |
|---|---|---:|---:|---:|---:|
| 01 add priority field | Kumiki | 4 | 4 | 568 | 175 |
| | React | 8 | 3 | 483 | 150 |
| 02 strict validation | Kumiki | 7 | 4 | 432 | 112 |
| | React | 4 | 2 | 322 | 88 |
| 03 add archived state | Kumiki | 19 | 11 | 1,540 | 442 |
| | React | 27 | 9 | 1,475 | 417 |
| 04 dark theme | Kumiki | 25 | 6 | 1,315 | 401 |
| | React | 48 | 12 | 2,153 | 638 |
| **Total** | **Kumiki** | **55** | **25** | **3,855** | **1,130** |
| | **React** | **87** | **26** | **4,433** | **1,293** |

Totals favor Kumiki — 1.58× fewer added lines, 1.14× fewer tokens — but not uniformly: small, localized React edits (scenarios 01–02) are cheaper because JSX changes one attribute in place, while Kumiki replaces whole definitions. Kumiki wins where a change crosses state + UI + logic (03, 04), which is where edits get risky in React.

### Edit representation (full file vs patch vs op stream)

Kumiki's AI-editing verbs (`add` / `replace` / `remove`) send whole definitions. Measured across the same four scenarios, the op stream costs **26% of the tokens of rewriting the full file** (1,544 vs 5,896 cl100k) — but a plain unified text patch is smaller still (1,130). The op stream's value is not minimal bytes; it's that each op is independently checkable and never produces a syntactically broken file.

## Learning cost (writing Kumiki from the spec alone)

Each task gives a model **only `docs/spec/` + a task spec** and asks for a single-pass `.kumiki` program — no example apps, no compiler in the loop, no retries. The harness then scores parse / typecheck / build. Protocol details and fairness notes (including why an earlier 4/4 Claude run was discarded) are in [`learning-cost/summary.md`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/learning-cost/summary.md).

| Task | Vendor | LOC | cl100k | parse | typecheck | build |
|---|---|---:|---:|:--:|:--:|:--:|
| v1 Pomodoro (~60 LOC) | Claude | 59 | 384 | ✅ | ✅ | ✅ |
| v2 Kanban (~200 LOC) | Claude | 178 | 1,421 | ✅ | ✅ | ✅ |
| | Codex | 243 | 1,881 | ✅ | ✅ | ✅ |
| | Gemini | 152 | 1,314 | ✅ | ✅ | ✅ |
| v3 Issue Tracker (~600 LOC) | Claude | 629 | 5,325 | ✅ | ✅ | ✅ |
| | Codex | 674 | 6,417 | ✅ | ✅ | ✅ |
| | Gemini | 440 | 4,995 | ✅ | ❌ | ❌ |
| v4 Project Mgmt (~900 LOC) | Claude | 1,029 | 9,552 | ❌ | ❌ | ❌ |
| | Codex | 877 | 8,703 | ✅ | ✅ | ✅ |
| | Gemini | 294 | 4,397 | ❌ | ❌ | ❌ |

What the table says:

- **Mid-size apps build from the spec alone, in one pass.** Every vendor builds v2; two of three build the ~600-LOC v3.
- **Codex builds everything it attempted, including the ~880-LOC v4** — the only vendor to survive the largest task. Claude holds through v3, then trips on an unsupported `match` pattern at v4 scale; Gemini degrades earliest.
- **The benchmark is a compiler test too.** The runs surfaced two real defects — built-in tiles that crashed at build ([#61](https://github.com/kumikijs/Kumiki/issues/61)) and rules the spec stated only by example ([#62](https://github.com/kumikijs/Kumiki/issues/62)). Both are fixed, and the table above is scored against the patched compiler. The three remaining ❌ are genuine authoring errors the toolchain *correctly* rejects.

## Reproducing

```sh
pnpm --filter @kumikijs/benchmarks measure            # whole-file sizes + ratios
pnpm --filter @kumikijs/benchmarks measure:scenarios  # per-scenario patch sizes
pnpm --filter @kumikijs/benchmarks measure:ops        # full-file vs patch vs op stream
pnpm --filter @kumikijs/benchmarks eval <output.kumiki>  # score a learning-cost output
```

To refresh a learning-cost vendor column, run the model on the committed prompt (`vN-*/codex-prompt.txt` / `gemini-prompt.txt`), save its output under `results/<Vendor>/output.kumiki`, and re-run `eval`.
