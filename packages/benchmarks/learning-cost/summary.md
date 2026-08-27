# Learning-Cost Benchmark — cross-vendor re-take (current implementation)

The four learning-cost tasks measure how accurately an LLM, given **only the
Kumiki spec + the task spec**, can write a `.kumiki` program that **parses,
typechecks, and builds**, in a **single pass**. LOC / token counts are recorded
for token-efficiency.

The committed `results/*/eval.json` were generated in the old **"Strand"** era
(pre-rename, an earlier compiler). This re-take refreshes them against the
current toolchain across three vendors **under one protocol**.

> **Re-scored after [#61](https://github.com/kumikijs/Kumiki/issues/61) +
> [#62](https://github.com/kumikijs/Kumiki/issues/62) were fixed.** The *same*
> single-pass model outputs are re-evaluated against the patched compiler. The
> `error` built-in tile now builds, which flips **Codex's v3 and v4 from
> build-fail to build-green** — Codex now builds all three tasks it attempted,
> including the ~880-LOC v4. The remaining failures (v3 Gemini, v4 Claude, v4
> Gemini) are genuine authoring errors that #62 now documents as *intentionally*
> rejected — the toolchain is correctly refusing them, not gapping.

## Protocol (uniform — single pass, spec only)

- **Inputs**: each version's `task-spec.md` + `docs/spec/*.md` only. The worked
  example apps under `packages/examples/apps/` (esp. `04-issue-tracker`,
  `05-project-management`, which mirror v3/v4) were **off-limits** — reading them
  is copying the answer, not measuring learning cost.
- **Single pass**: write from spec once; **no `check`/`build`/`smoke` loop**, no
  scratch compiles. The author never sees a compiler error before submitting.
  Verification (the table below) is run *afterward* by the harness.
- **Claude** — Opus 4.8, each task written by a **fresh isolated sub-agent** with
  no prior session context (see "Fairness note").
- **Codex** — `codex exec --full-auto` (v0.125).
- **Gemini** — `agy --print` (antigravity-cli), run in an isolated temp workspace
  (spec + task-spec only). agy writes to its SQLite conversation store, not
  stdout; outputs were extracted from there.

## Results

| Task | Vendor | LOC | chars | cl100k | parse | typecheck | build | first error |
|---|---|---:|---:|---:|:--:|:--:|:--:|---|
| v1 Pomodoro | Claude | 59 | 1,347 | 384 | ✅ | ✅ | ✅ | — |
| v2 Kanban | Claude | 178 | 5,291 | 1,421 | ✅ | ✅ | ✅ | — |
| v2 Kanban | Codex | 243 | 6,517 | 1,881 | ✅ | ✅ | ✅ | — |
| v2 Kanban | Gemini | 152 | 4,591 | 1,314 | ✅ | ✅ | ✅ | — |
| v3 Issue Tracker | Claude | 629 | 23,915 | 5,325 | ✅ | ✅ | ✅ | — |
| v3 Issue Tracker | Codex | 674 | 23,210 | 6,417 | ✅ | ✅ | ✅ | — |
| v3 Issue Tracker | Gemini | 440 | 20,270 | 4,995 | ✅ | ❌ | ❌ | typecheck E0103: `$1` w/o `in=` (×23) |
| v4 Project Mgmt | Claude | 1029 | 39,178 | 9,552 | ❌ | ❌ | ❌ | parse @201:20 (literal match pattern) |
| v4 Project Mgmt | Codex | 877 | 32,376 | 8,703 | ✅ | ✅ | ✅ | — |
| v4 Project Mgmt | Gemini | 294 | 16,517 | 4,397 | ❌ | ❌ | ❌ | parse @152:50 (tile call in props block) |

### Reading the table

- **Build-green, single pass**: Codex 3/3 (v2–v4), Claude 3/4 (v1–v3), Gemini 1/3.
- **Codex is the only vendor to build v4** (~880 LOC) in one pass — and it builds
  *everything* it attempted. The earlier prediction held: the sole thing blocking
  its v3/v4 was the `error`-tile codegen gap ([#61](https://github.com/kumikijs/Kumiki/issues/61)),
  now fixed, so both flipped to build-green on re-score.
- **Claude leads on smaller tasks but parse-fails v4** — it used a literal `match`
  pattern, which is *not* supported (now stated in spec §1.9.1 via
  [#62](https://github.com/kumikijs/Kumiki/issues/62)).
- **Token efficiency** (v2, the one task all three build): Gemini 1,314 <
  Claude 1,421 < Codex 1,881 tokens.
- **Degradation with scale**: Gemini builds v2 → typecheck-fails v3 → parse-fails
  v4. Claude holds through v3 then parse-fails v4. **Codex builds all the way
  through v4** — the most robust at scale.

## Fairness note (why this is a re-take of the re-take)

The **first** Claude column reported 4/4 builds. That was **not a fair
measurement** and was discarded: it was written inline by the main session,
which had (a) read the full spec carefully up front, (b) run small "is this
syntax legal?" probe-compiles before writing (a check loop the vendors were
forbidden), and (c) accumulated compiler-specific knowledge earlier in the
session. Re-running Claude as **fresh isolated sub-agents under the same
single-pass, no-check, spec-only protocol as Codex/Gemini** drops it to **3/4**
(v4 parse-fails) — consistent with the vendors struggling at v4 scale.

## Gaps surfaced by the benchmark → issues #61 / #62 (both fixed)

The re-take surfaced two real defects, now resolved:

- **[#61](https://github.com/kumikijs/Kumiki/issues/61) — documented tiles that
  crashed at build.** Codex's v3/v4 failed `build` on `Tile "error" not found`.
  The `error` tile (and `code`/`video`/`list`/`table`/`modal`/`drawer`/`tooltip`/
  `popover`/`toast`/`progress`) was documented in `stdlib.md §2.3` and accepted by
  `check`, but missing from codegen — accept-then-crash-at-build. **Fixed**: all
  built-in tiles are now single-sourced and implemented, so Codex v3/v4 build.
- **[#62](https://github.com/kumikijs/Kumiki/issues/62) — under-specified rules
  models reliably got wrong.** The three remaining failures each hit a rule the
  spec stated only by example: a literal `match` pattern (Claude v4), `$1` in a
  tile with no `in=` (Gemini v3), and a tile call inside the `{}` props block
  (Gemini v4). **Fixed**: §1.6.5 / §1.7.1 / §1.9.1 now state each rule, with
  counterexamples and an E0103 `in=` hint. These outputs still fail — correctly,
  because the constructs are illegal by design.

## Notes

- **v1 S1/S2/S3** (zero/one/few-shot) are not reproduced — they measure a
  cold-context single pass under different prompting strategies that an
  interactive agent cannot honestly simulate. v1 has no vendor columns.
- **agy quirks**: writes answers to `~/.gemini/antigravity-cli/conversations/*.db`
  (not stdout); large outputs truncate at the default 5-minute `--print-timeout`;
  runs are non-deterministic (v4 took 3 attempts). Prompts:
  `learning-cost/v{2,3,4}-*/gemini-prompt.txt`.
