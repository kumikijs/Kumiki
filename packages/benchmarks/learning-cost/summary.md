# Learning-Cost Benchmark

The learning-cost tasks measure how well an LLM writes Kumiki it has never seen,
given **only the Kumiki spec and a task spec**. An output is scored twice:

- **Does it build?** parse, typecheck, build and `kumiki smoke` (`eval.mjs`).
- **Does it do what the task asks?** Each task from v3 on carries an acceptance
  contract in its task spec (element ids, button labels, effect names) and a set
  of hidden acceptance scenarios, `vN-*/acceptance/`, one per criterion. The
  model never sees them. `acceptance.mjs` runs each one on a fresh mount; the
  score is the number passed. v1 and v2 have criteria too, written against
  their outputs' common names.

Each task is run on two tracks:

- **spec**: the workspace holds the task spec and `docs/spec/*.md`, nothing
  else. There is no compiler, so the program is written in one pass.
- **toolchain**: the same, plus the Kumiki CLI installed from tarballs. The
  agent may run `npx kumiki guide | check | build | smoke | run | test` as often
  as it likes and write its own scenarios, within 30 minutes.

The first track measures what the documentation teaches; the second, what the
documentation and the tools teach together, which is how Kumiki is meant to be
written.

## Tasks

| Task | What it asks | Criteria |
|---|---|---:|
| v1 Pomodoro | a timer, ~60 LOC | 5 |
| v2 Kanban | three columns of cards, ~200 LOC | 9 |
| v3 Issue Tracker | routes, filters, tags, comments, persistence, ~700 LOC | 17 |
| v4 Project Mgmt | projects, tasks, subtasks, list and board, ~1,000 LOC | 25 |
| v5 Synced Notes | every action goes through an HTTP effect that can fail, be retried, be superseded or sign the user out, ~300 LOC | 14 |
| v6 Change Request | change v4's reference solution (990 lines): add a status, undo a deletion, hide archived projects | 30 |

v6's 30 criteria are 23 of v4's, for what the change must not break, and 7 for
the change; `base.kumiki` scores 23/30. Every task from v3 on has a
`reference/app.kumiki` that meets all of its criteria, which
`packages/tests/src/benchmark-acceptance.test.ts` keeps true.

## Protocol

`run.mjs <task> <vendor> <track>` builds a fresh workspace under the system
temporary directory, writes the prompt (kept there as `prompt.txt`), runs the
agent, and records `vN-*/results/<Vendor>[-toolchain]/output.kumiki` and
`run.json`: duration, and the `kumiki` commands the agent issued, by verb, read
from its transcript. One run per cell, each in a fresh session.

- **Reasoning effort is `high` for all three.** A first Codex pass at `low`, its
  CLI's configured default, failed v1 and v4 of an earlier take.
- **Claude**: Claude Code 2.1.332, Claude Opus 5.5 (`claude -p --model opus
  --effort high`). Tools `Read Write Edit Glob Grep`, plus `Bash` limited to
  `npx kumiki` on the toolchain track, no MCP servers. It loads the user-level
  `CLAUDE.md`, which holds generic coding rules and nothing about Kumiki.
- **Codex**: codex-cli 0.172.0, `gpt-6.1-terra` (`codex exec -s workspace-write
  -c model_reasoning_effort="high"`), one run at a time: concurrent runs could
  not start the Windows sandbox. It reads files through its shell.
- **Gemini**: agy 1.5.18, `gemini-4-neon-high` (`agy --sandbox --mode
  accept-edits`), one run at a time. Headless agy ends the session at the first
  command it refuses, so its allow-list holds the read-only commands (`ls`,
  `Get-Content`, …) besides `npx kumiki`.
- **The CLI** on the toolchain track is `kumiki` 0.4.1 (`@kumikijs/cli` 0.9.0,
  `@kumikijs/compiler` 0.14.0) packed from this repository, with `kumiki guide`.
  Its compiler is the one that scores the outputs.

## Results

Acceptance criteria passed:

| Task | Claude | Claude + CLI | Codex | Codex + CLI | Gemini | Gemini + CLI |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| v1 Pomodoro | 5/5 | — | 5/5 | — | 5/5 | — |
| v2 Kanban | 9/9 | — | 9/9 | — | 9/9 | — |
| v3 Issue Tracker | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 |
| v4 Project Mgmt | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 |
| v5 Synced Notes | 9/14 | 14/14 | 0/14 | 14/14 | 10/14 | 14/14 |
| v6 Change Request | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |

v1 and v2 were run on the spec track only, before the toolchain track existed.

Build, size and effort (v3–v6):

| Task | Run | build | smoke | LOC | cl100k | minutes | `kumiki` calls |
|---|---|:--:|:--:|---:|---:|---:|---:|
| v3 | Claude | ✅ | ✅ | 719 | 5,874 | 10.2 | — |
| | Claude + CLI | ✅ | ✅ | 646 | 5,222 | 8.7 | 4 |
| | Codex | ✅ | ✅ | 364 | 4,201 | 2.5 | — |
| | Codex + CLI | ✅ | ✅ | 215 | 3,844 | 3.5 | 18 |
| | Gemini | ✅ | ✅ | 979 | 7,766 | 6.3 | — |
| | Gemini + CLI | ✅ | ✅ | 915 | 7,213 | 9.2 | 16 |
| v4 | Claude | ✅ | ✅ | 1,006 | 9,686 | 12.6 | — |
| | Claude + CLI | ✅ | ✅ | 851 | 7,742 | 9.9 | 3 |
| | Codex | ✅ | ✅ | 455 | 6,714 | 3.1 | — |
| | Codex + CLI | ✅ | ✅ | 258 | 6,305 | 6.5 | 20 |
| | Gemini | ✅ | ✅ | 1,439 | 12,357 | 9.4 | — |
| | Gemini + CLI | ✅ | ✅ | 1,325 | 10,831 | 11.4 | 25 |
| v5 | Claude | ✅ | ✅ | 279 | 1,945 | 9.6 | — |
| | Claude + CLI | ✅ | ✅ | 252 | 2,079 | 8.4 | 4 |
| | Codex | ❌ E0001 | — | 251 | 2,126 | 1.7 | — |
| | Codex + CLI | ✅ | ✅ | 252 | 2,257 | 7.1 | 36 |
| | Gemini | ✅ | ❌ | 296 | 2,247 | 7.3 | — |
| | Gemini + CLI | ✅ | ✅ | 342 | 2,642 | 17.2 | 41 |
| v6 | Claude | ✅ | ✅ | +64 −7 | 10,787 | 3.7 | — |
| | Claude + CLI | ✅ | ✅ | +64 −7 | 10,782 | 3.7 | 4 |
| | Codex | ✅ | ✅ | +56 −11 | 10,714 | 1.0 | — |
| | Codex + CLI | ✅ | ✅ | +49 −10 | 10,678 | 1.9 | 8 |
| | Gemini | ✅ | ✅ | +68 −4 | 10,927 | 4.1 | — |
| | Gemini + CLI | ✅ | ✅ | +60 −4 | 10,829 | 6.7 | 13 |

For v6, LOC is the lines the change added and removed against `base.kumiki`.
A `kumiki` call is a command the agent issued, `guide` included; Claude's
count includes commands its allow-list refused because they chained another
command before `npx kumiki`.

### Reading the tables

- **Feature-heavy apps are written right from the spec alone.** v3, v4 and the
  v6 change pass every criterion on the spec track for all three vendors. The
  contract names the ids and labels; the spec teaches the rest.
- **Effects are where the spec alone falls short.** On v5 the spec track loses
  5, 14 and 4 criteria; with the CLI all three reach 14/14.
  - Claude and Gemini read the second bind of `updateNote.ok($value, $key)` as
    the note's id. It is the effect's input, the whole `Note`, so the note
    never shows as saved. The spec calls the bind "the request key", and the
    checker gives it no type, so `check` and `smoke` are both clean.
  - Codex routed no `/404`, which the spec requires of every app (E0001). The
    v5 task spec has no routes, and the rule is the kind a compiler run
    catches at once.
  - Gemini's spec-track v5 also sends a `PUT` for a note still under its
    temporary id, which `smoke` reports.
- **The vendors use the CLI differently.** Claude reads a guide and runs
  `check` once or twice. Codex and Gemini write their own scenarios and run
  them, up to 21 times on v5. Either way, with the CLI all three meet every
  criterion of every task.
- **On the large tasks the tools shorten programs.** On v3 and v4 every
  toolchain program is shorter than the same vendor's spec-track one. Codex's
  programs are the shortest throughout: on v3 and v4, a third of Gemini's lines
  or less and about half its tokens.
- **A change to a 990-line program stays small.** The six v6 runs take
  49–68 added lines and 4–11 removed, and none breaks one of the 23 criteria it
  had to keep.

## Gaps this take surfaced

Each is filed against the spec or the tools, not the vendors:

- **The second bind of an effect result is the input, not the request key the
  spec names.** It cost two vendors five and four v5 criteria, silently: the
  bind has no type, so nothing checks what it is used as.
- **`retry=exponential(N, …)` counts attempts; the spec reads as counting
  retries.** v5's task spec says "at most three attempts in all" to stay clear
  of it.
- **A scenario's `state: {x: {}}` matches any map.** The acceptance criteria
  assert the DOM instead.

Earlier takes surfaced documented tiles that crashed at build and rules the spec
stated only by example; both were fixed. Their record, and the results of
earlier takes, are in this file's git history.

## Notes

- **One run per cell.** Model output is non-deterministic, so a single score is
  a sample, not a rate.
- **v1 and v2** keep their earlier spec-track outputs and prompts
  (`codex-prompt.txt`, `gemini-prompt.txt`); their criteria were written after
  them, against the names all three outputs share. From v3 on, `run.mjs` writes
  the prompt.
- **Running it**: `pnpm --filter @kumikijs/benchmarks learning-cost <task>
  <vendor> <spec|toolchain>` runs one cell; the toolchain track installs the CLI
  from the tarballs in `$KUMIKI_TARBALLS`. `eval <files>` writes the rows of
  `results/eval.json`, and `acceptance [tasks]` writes `results/acceptance.json`.
- `packages/tests/src/benchmark-corpus.test.ts` re-checks every output against
  the current compiler and pins the one that fails, Codex's spec-track v5.
