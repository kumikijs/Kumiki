---
name: kumiki-iterate
description: Build a working Kumiki app from requirements with NO human operating the app. Encodes the autonomous loop — generate → check → smoke → run scenario → read trace → diagnose → patch → repeat — using @kumiki/cli / @kumiki/mcp. Use when asked to build/extend a Kumiki feature or app and verify it actually works, not just compiles.
---

# Iterating on a Kumiki app without a human in the loop

The user states requirements once. You then close the loop yourself: generate the
app, run it, observe reliable state, fix, and repeat — instead of shipping
something that compiles and asking the user to click through it and report errors.

Kumiki makes this tractable: **state is explicit (slots)**, so the oracle is real
app state — not scraped pixels; **events are named (reducers)**, so you drive the
app precisely by name; **effects are mocked at the capability boundary**, so runs
are deterministic and hermetic.

## The loop

1. **Author** the Kumiki (see the `kumiki-author` skill).
2. **Compile** — `kumiki check`, then `kumiki build` (or `kumiki_check`).
   - On `E0xxx` / parse errors: fix (try `kumiki_fix` for name typos), repeat.
3. **Smoke** — `kumiki smoke` (or `kumiki_smoke`). Mounts and auto-exercises the UI.
   - On a runtime throw / empty render: diagnose (see `kumiki-debug`), patch, repeat.
4. **Write the scenario = executable acceptance criteria.** Translate the user's
   requirements (NOT your implementation) into steps with `expect` assertions on
   **state**. This is the TDD AC, made runnable. Example:
   ```json
   {
     "steps": [
       { "do": { "fill": "input[placeholder='Title']", "value": "Fix login" } },
       { "label": "create", "do": { "clickText": "Create issue" },
         "expect": { "noErrors": true, "state": { "issues": { "...": { "title": "Fix login" } } } } }
     ],
     "effects": { "saveIssues": [{ "outcome": "ok" }] }
   }
   ```
5. **Run** — `kumiki run <file> <scenario.json>` (or `kumiki_run_scenario`). You get a
   per-step trace: `state` (slot snapshot), `domText`, `errors`, `emits`, `failures`.
6. **Diagnose from the trace, not guesses.** Each failure says exactly what was
   expected vs. got. `errors` → a throw; `failures` with `state ...` → wrong behavior
   (the class a human would catch by clicking, e.g. a select that always yields the
   last option); `emits` → which effects fired.
7. **Patch** the offending definition (`kumiki replace` / `kumiki_replace`, scoped to
   one def) and **go to step 2.** Stop when the scenario passes.

## Actions (`do`) and assertions (`expect`)

- Actions: `{dispatch, payload?}` (fire a reducer by name), `{clickText}`, `{click}` (CSS),
  `{fill, value}`, `{choose, value}`, `{navigate}`.
- `expect`: `{ noErrors?, errorIncludes?: [], state?: {slot: value}, domIncludes?: [], domExcludes?: [] }`.
  `errorIncludes` asserts an error **was** reported (each substring must appear in one) — for
  contracts whose point is that the runtime surfaces something, e.g. a reducer batch a
  refinement rejected. `noErrors` then means "nothing this step did not ask for", so both compose.
  `state` is a **partial** match; keys may be dotted paths (`issues.id-1.status`).
- `effects`: per-effect queues of `{outcome, value}` returned in order — script HTTP/storage
  so the loop is deterministic and never hits the network.

## Stopping rules (don't loop forever)

- Cap at ~5 rounds. If the **same** failure survives two patches, stop guessing:
  re-read the relevant `docs/spec/` section, or reconsider whether the bug is in your
  Kumiki or in the framework (`packages/runtime` / `packages/compiler`).
- A failure you can't express as a state/DOM assertion usually means the requirement
  is underspecified — ask the user, don't invent behavior.
- Prefer asserting on **state** over DOM text; state is stable, text is incidental.

## When a framework bug is the cause

If the trace shows the runtime/codegen is wrong (not your Kumiki), fix it in
`packages/`, add a minimal `packages/examples/features/*.kumiki` reproducer (CI smoke-tests
it), and keep `pnpm exec turbo run test` green. That is how the repo answers bugs:
with an example and a test.
