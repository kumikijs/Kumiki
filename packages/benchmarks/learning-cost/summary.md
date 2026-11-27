# Learning-Cost Benchmark — cross-vendor re-take (current implementation)

The four learning-cost tasks measure how accurately an LLM, given **only the
Kumiki spec + the task spec**, can write a `.kumiki` program that **parses,
typechecks, and builds**, in a **single pass**. LOC / token counts are recorded
for token-efficiency.

This is the second cross-vendor re-take: all three vendors, all four tasks, on
current models, against the current spec and compiler. The previous re-take's
results (Claude Opus 4.8 sub-agents, Codex v0.125, Gemini via agy's default
model) are in this file's git history.

## Protocol (uniform — single pass, spec only)

- **Inputs**: each version's `task-spec.md` + `docs/spec/*.md` only, copied into
  a fresh temporary workspace that holds nothing else — no `packages/examples/`
  (whose `04-issue-tracker` and `05-project-management` mirror v3/v4), no
  compiler, no `node_modules`. The prompts (`vN-*/codex-prompt.txt`, also used
  for Claude with its own output path, and `gemini-prompt.txt`) point at that
  workspace.
- **Single pass**: write from spec once; **no `check`/`build`/`smoke` loop**, no
  scratch compiles. The author never sees a compiler error before submitting.
  Verification (the table below) is run *afterward* by the harness. With no
  compiler in the workspace the rule is enforced, not only asked for; the
  session records confirm it (Claude had no shell; Codex's commands only read
  files; Gemini's sessions made only `read_file` calls).
- **Claude** — Claude Code 2.1.332, `claude -p --model opus` (Claude Opus 5.5),
  tools limited to `Read Write Glob Grep`, one fresh session per task. It loads
  the user-level `CLAUDE.md`, which holds generic coding rules and nothing about
  Kumiki.
- **Codex** — codex-cli 0.172.0 (`gpt-6.1-terra`),
  `codex exec -s workspace-write`, one task at a time: four concurrent runs
  could not start the Windows sandbox and ended having read nothing.
- **Gemini** — agy 1.5.18, `agy --model gemini-4-neon-high --sandbox --print`,
  one task at a time; the code is taken from between the prompt's
  `===KUMIKI_BEGIN===` / `===KUMIKI_END===` markers on stdout.

## Results

| Task | Vendor | LOC | chars | cl100k | parse | typecheck | build | first error |
|---|---|---:|---:|---:|:--:|:--:|:--:|---|
| v1 Pomodoro | Claude | 63 | 1,543 | 439 | ✅ | ✅ | ✅ | — |
| v1 Pomodoro | Codex | 41 | 1,047 | 289 | ✅ | ❌ | ❌ | typecheck E0302: `timer` listed in `app.caps` |
| v1 Pomodoro | Gemini | 69 | 2,077 | 609 | ✅ | ✅ | ✅ | — |
| v2 Kanban | Claude | 188 | 5,492 | 1,624 | ✅ | ✅ | ✅ | — |
| v2 Kanban | Codex | 157 | 4,637 | 1,311 | ✅ | ✅ | ✅ | — |
| v2 Kanban | Gemini | 331 | 8,192 | 2,323 | ✅ | ✅ | ✅ | — |
| v3 Issue Tracker | Claude | 864 | 26,705 | 7,482 | ✅ | ✅ | ✅ | — |
| v3 Issue Tracker | Codex | 606 | 17,273 | 4,305 | ✅ | ✅ | ✅ | — |
| v3 Issue Tracker | Gemini | 1,460 | 45,224 | 10,353 | ✅ | ✅ | ✅ | — |
| v4 Project Mgmt | Claude | 986 | 35,751 | 10,122 | ✅ | ✅ | ✅ | — |
| v4 Project Mgmt | Codex | 287 | 22,532 | 6,218 | ✅ | ❌ | ❌ | typecheck E0601: `tasks` written twice in one reducer (×1, and one E0201) |
| v4 Project Mgmt | Gemini | 1,995 | 71,908 | 16,598 | ✅ | ✅ | ✅ | — |

Every output that builds also passes `kumiki smoke`: it mounts, renders, and
survives the generic interaction pass without a runtime error.

### Reading the table

- **Build-green, single pass**: Claude 4/4, Gemini 4/4, Codex 2/4 (v2, v3).
  Every output parses; the two failures are one rule each.
- **Scale no longer breaks the single pass.** The previous re-take had every
  vendor fail at least one of v3 / v4. This time Claude and Gemini build the
  ~1,000-line v4, and no output fails to parse.
- **Codex under-delivers rather than mis-writes.** Its v4 is 287 lines for a task
  that asks for 800–1,500, and its own summary says the implementation is
  shorter than requested; the build failure is one double write. Its v1 lists
  `timer` as a capability, which is not one.
- **Size varies more than correctness.** For v3 Codex writes 606 lines, Claude
  864, Gemini 1,460; for v4 Gemini writes twice Claude's tokens. A build-green
  output says the program is legal and runs, not that it covers the task spec.

## Fairness note (why the first re-take was itself re-taken)

The **first** Claude column reported 4/4 builds. That was **not a fair
measurement** and was discarded: it was written inline by the main session,
which had (a) read the full spec carefully up front, (b) run small "is this
syntax legal?" probe-compiles before writing (a check loop the vendors were
forbidden), and (c) accumulated compiler-specific knowledge earlier in the
session. Re-running Claude as **fresh isolated sub-agents under the same
single-pass, no-check, spec-only protocol as Codex/Gemini** drops it to **3/4**
(v4 parse-fails) — consistent with the vendors struggling at v4 scale.

## Gaps surfaced by the first re-take (both fixed)

The first re-take surfaced two real defects, now resolved. The outputs it
describes have since been replaced by this re-take's.


- **Documented tiles that crashed at build.** Codex's v3/v4 failed `build` on `Tile "error" not found`.
  The `error` tile (and `code`/`video`/`list`/`table`/`modal`/`drawer`/`tooltip`/
  `popover`/`toast`/`progress`) was documented in `stdlib.md` and accepted by
  `check`, but missing from codegen — accept-then-crash-at-build. **Fixed**: all
  built-in tiles are now single-sourced and implemented.
- **Under-specified rules models reliably got wrong.** The three remaining failures each hit a rule the
  spec stated only by example: a literal `match` pattern (Claude v4), `$1` in a
  tile with no `in=` (Gemini v3), and a tile call inside the `{}` props block
  (Gemini v4). **Fixed**: `language.md` now states each rule, with
  counterexamples and an E0103 `in=` hint. None of the three recurs in this
  re-take.

## Notes

- **v1 S1/S2/S3** (zero/one/few-shot) are not reproduced — they measure a
  cold-context single pass under different prompting strategies that an
  interactive agent cannot honestly simulate. v1 is run like the other tasks,
  from prompts derived from v2's.
- **One run per cell.** Model output is non-deterministic, so a single ✅ or ❌
  is a sample, not a rate.
- **Scoring**: `pnpm --filter @kumikijs/benchmarks eval <files>` writes the rows
  of `results/eval.json`, with repository-relative paths.
  `packages/tests/src/benchmark-corpus.test.ts` re-checks every output against
  the current compiler and pins the two failures above.
