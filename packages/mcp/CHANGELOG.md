# @kumikijs/mcp

## 0.6.0

### Minor Changes

- 8bcc1c2: `fix --auto-patch --apply` replaces whole tokens only, and writes through a gate

  The behavioural tier found the failing leaf's actual value with a plain
  substring search, so a numeric `1` matched the `1` inside the tile name `Btn1`
  or inside the threshold `10`, and `--apply` wrote that with nothing gating the
  write (the tests were re-run only after it had landed):

  ```
  $ kumiki fix ap.kumiki --auto-patch inc-adds-two --apply
  Error: compile failed:
  E0211 Reducer "inc" subscribes to ui.click(Btn2) but tile "Btn2" is not declared
  ```

  A candidate is now a whole token, read from the lexer: the `1` in `Btn1`, in
  `10`, inside a string or inside a comment is never one. In that program the
  only token `1` is `fn step() -> Int = 1`, and replacing it makes the test pass.

  The write is gated the way the compile tier's already was. The patched source
  is parsed, typechecked and tested before it reaches disk, and it is written
  only if it compiles, the named test passes and no test that passed before
  fails or stops running. Otherwise the behavioural patch is not written and the
  outcome is the new `test-blocked` status. The file is then exactly as the
  compile tier left it: byte-identical to before the call when there were no
  compile fixes, and carrying them when there were (`compileFixes` counts them,
  and the CLI says `behavioural patch not written (compile fixes kept)` instead
  of `file left unchanged`). `blocked.reason` is `parse-error`, `introduced`
  (with the diagnostics), `test-runner-threw` (with the runner's message),
  `named-test-missing`, `still-fails` (with the test's result) or `regressed`
  (with the test names):

  ```
  $ kumiki fix nc.kumiki --auto-patch set-to-one --apply
  refused fix for "set-to-one" — file left unchanged:
    replace 5 with 1 (from failing test "set-to-one" @ slots.count)
    reason: introduced
    E0804 Refinement between(2, 1) has a lower bound above its upper bound, so no value satisfies it
  ```

  A test that was already failing before the patch does not block it, whether
  it keeps failing or starts passing. A dry run proposes the patch without
  running the gate. `TestPatchBlock`, the type of `blocked`, is exported from
  `@kumikijs/cli`. `planTestPatchExplained` on a source that does not lex now
  reports `source-does-not-lex` rather than `no-scoped-literal-hit`.

  Upgrading: `applied` now always means the named test passes and nothing
  regressed (`ok: true`, `pass: true`, `regressed: []` — the field's type is now
  `[]`, kept so existing readers still find it). A patch that would have landed
  as `applied` with `pass: false` or a non-empty `regressed` is `test-blocked`,
  and the MCP `kumiki_auto_patch` tool reports it the same way.

- 7de26d4: Gate `fix --auto-patch`'s compile repair the way every other write is gated

  `fix --apply` guarantees "apply ⇒ the file is either strictly cleaner or
  unchanged": it re-parses and re-typechecks the composed patches and rolls the
  write back when they resolve nothing or introduce a diagnostic. The tier-1
  repair inside `--auto-patch` composed the same plan and wrote it to disk
  unguarded. On the same input, `fix --apply` rolled back and `fix --auto-patch
<test> --apply` wrote — and then reported the error the repair had just
  created as the author's own.

  Tier 1 now goes through `applyFixPlan`, so there is one gate and one write. A
  refusal is its own outcome, **`compile-blocked`**, distinct from "no patch
  available": the file is unchanged, the errors reported are the ones the patch
  was offered for, and `blocked` names what it would have introduced. The
  sentence the CLI prints for it comes from the same function `fix --apply`
  prints, so the two verbs cannot describe one refusal differently.

  The count reported for a write is now the number of patches that changed the
  source rather than the number planned — a patch can decline to change
  anything, and the composed write would have counted it. A dry run still
  reports what it proposes, which is the honest number for something not yet
  applied.

  `FixApplyResult.blocked` gains a `parse-error` member, so the gate's three
  conditions have three answers rather than two and a field to consult
  afterwards. Without it a refusal because the composed source did not parse
  reached an MCP client as `{"reason":"resolved-none"}` — "the repair was
  pointless", where the truth is that a repair rule emitted source that does not
  parse, which is the opposite conclusion. `compile-remaining` no longer carries
  a `parseError`: syntax breakage is caught before anything reaches disk, so it
  is described in exactly one place.

  `FixApplyResult` also gains `skipped` (the plan's skip reasons, so a caller
  reporting "nothing to apply" need not plan the file a second time) and
  `approved` (the patches the gate passed, which differs from `applied` only
  when the write itself threw). A compile-tier `no-patch` whose errors all had
  patches that declined to change anything reports `every-patch-declined` rather
  than no reason at all. `@kumikijs/mcp` serialises the new status and
  `kumiki_fix_from_test` documents it.

### Patch Changes

- 13eacc9: Fail a `{dispatch}` step that drives nothing

  `{dispatch}` is the one action verb that does not go through a selector: it
  names a reducer, and the `_dispatch` seam returns silently when the name matches
  nothing. So a fixture left behind by a rename kept passing:

  ```json
  { "do": { "dispatch": "addTodo" }, "expect": { "state": { "todos": "" } } }
  ```

  ```
  $ kumiki run todos.kumiki renamed.json
  [ok] step 0: dispatch addTodo
  scenario passed
  ```

  The reducer never ran, the slot was still at its initial value, and the
  assertion happened to describe that value — the same shape as the failed
  actions that became `actionError`, for the verb that change did not reach.

  A step naming a reducer the app does not have now fails, on `actionError`, where
  neither `errorIncludes` nor `noErrors` can see it:

  ```
  [FAIL] step 0: dispatch addTodo
      action failed: no reducer named "addTodo"
  ```

  A name close to one that exists is named, under the same threshold `kumiki fix`
  repairs with — at most two edits, or a quarter of the written name's length.
  A rename that genuinely renames is usually further than that, and a suggestion
  that is not the name the author meant sends the repair at the wrong one:

  ```
      action failed: no reducer named "addTodoIten" — did you mean "addTodoItem"?
  ```

  A step naming an `on=ui.click(Tile#id)` reducer without the matching `{"id": …}`
  in its payload fails the same way. On the click path §1.6.2's id filter is the
  feature — the runtime calls the seam once per same-tile reducer and the
  mismatched ones drop out — but an explicit `{dispatch}` step names one reducer
  and asks for it, so one that cannot reach it drove nothing:

  ```
  action failed: reducer "scopedMiss" is scoped to #edit (§1.6.2), so this step
  drives nothing — pass payload {"id": "edit"}
  ```

  The check is a precondition in the runner, not a throw in the seam: `_dispatch`
  is production code that every codegen'd handler reaches, and making it throw
  would change what an app does to enforce a test-harness contract. A `{dispatch}`
  or `{navigate}` on a shape carrying no seam at all now fails too, rather than
  doing nothing and reporting nothing.

  `@kumikijs/e2e` asks the same question through the same function, so §8.10's
  "exactly as at the scenario tier" holds for this verb as well.

  `@kumikijs/runtime` also gains `levenshtein` / `nearestName` (the did-you-mean
  metric and the ranking built on it, moved down from `@kumikijs/compiler`, which
  re-exports them) on a `./text-distance` subpath, and `dispatchFault` — the rule
  both tiers ask.

- 8d3595f: A scenario step that drives a control the platform would refuse now fails, naming the control and the reason, instead of passing (#369).

  `fill` on a `disabled` input moved the slot and ran the `ui.input` reducer, because the runner wrote the value and dispatched the event itself — so `disabled` never entered the picture. A scenario asserting a guard held was green having tested nothing.

  All three drivers — both verification tiers and `kumiki smoke` — now ask one rule before a verb drives a control (`controlFault` / `readControl`, beside `dispatchFault`): `disabled` refuses every verb that drives one, `readonly` and an `editable`'s `contenteditable="false"` refuse the typing alone. `hover` is deliberately outside the rule — Chromium fires `mouseenter` on a disabled control, measured rather than assumed. The rule cannot be left to the browser: Chromium refuses a real click on a disabled control but delivers a dispatched one, and dispatching is what a driver does.

  `expect.actionErrorIncludes` is the new key that asserts a refusal, so "this button is disabled and clicking it does nothing" is expressible rather than merely green. It matches the refusal alone, not the whole `actionError` channel, so a step cannot claim one on a selector that matched nothing. `kumiki run`'s trace prints a claimed refusal as `expected refusal:`.

  The rule resolves in both directions: a verb aimed at the `<label>` `check` / `radio` / `switch` render is judged by the `<input>` inside it, and a verb aimed at something inside a disabled control — the spinner a `loading` button renders — is judged by that control, since the dispatched event reaches it.

  `kumiki smoke` asks the same rule, and no longer fires at a control a user could not reach.

- 730690b: Report an action that could not run as its own thing, not as an app error

  `errorIncludes` asserts that the _runtime_ surfaced something — a reducer batch
  a refinement rejected, an effect error no `.err` reducer consumes. A failed
  action was reported through the same buffer, so it could satisfy the assertion:

  ```json
  {
    "do": { "key": "#typo", "value": "Enter" },
    "expect": { "errorIncludes": ["no element"] }
  }
  ```

  ```
  $ kumiki run a.kumiki typo.json
  [ok] step 0: key #typo "Enter"
  scenario passed
  ```

  — a fixture asserting that its own mistake happened, having pressed nothing.
  The same shape worked for `click`, `focus`, `blur`, `hover`, `fill`, `choose`,
  `clickText` and `submit`.

  An action that cannot run is a fault in the scenario, not an observation about
  the app, so it is now a channel of its own: `StepResult.actionError`, printed by
  `kumiki run` and `kumiki_run_scenario` as `action failed:`. It fails the step,
  and neither `errorIncludes` nor `noErrors` can see it — the two are reported
  separately because they are different things:

  ```
  [FAIL] step 0 (typo): click #nope
      action failed: no element matching selector #nope
      assert: expected an error including "no element" but got: none
  ```

  `@kumikijs/e2e` splits the same way. That tier refuses `errorIncludes` outright,
  but it treats every reported error as fatal, so a fixture's broken selector was
  reported as a defect in the app. Its `fill` also now names the element it
  matched — `#box matched <div>, which holds no text to fill` — which
  Playwright's own refusal does not, so a selector that drifted onto a wrapper
  reads the same message in both tiers.

- d5d1d6b: Concurrent write verbs on one file no longer lose each other's edits

  Every mutation read the `.kumiki` file, wrote it back, re-read it to validate,
  and rolled back to its own snapshot on failure, with no lock. Of eight `add`s
  started at the same instant, all eight printed an op-id and logged an op, but
  only two of the definitions reached the file. In another run, two valid adds
  were rejected with a parse error, because `validate` had read a file another
  writer was halfway through writing.

  Write verbs now take a per-file write lock, a sibling
  `<file>.kumiki-write.lock`, for the whole read → validate → write → log
  sequence. `patch apply` and `patch revert` hold it once across the ops they
  are made of. The composed source is validated before it is written, so a
  rejected op never overwrites anything, and an op whose log entry cannot be
  appended puts the file back. A writer that finds the lock held waits for it,
  30 s by default or `KUMIKI_WRITE_LOCK_WAIT_MS`; if it is not released in time,
  the op is rejected with exit `1`, nothing is written or logged, and the
  message names the holder and the lock file. A lock left by a process on this
  host that has exited, or one that names no holder and is over 2 s old, is
  taken over; a lock naming a process on another host never is, and has to be
  deleted by hand if that process is gone.

  The MCP tools call the same mutators, so they wait the same way — and while a
  tool call waits, the MCP server answers no other request, for up to the same
  30 s.

  Every write verb (and `kumiki fix`, which already did) now replaces the file
  with a renamed sibling instead of writing it in place, so a reader never sees
  a half-written file. A symlink at the file's path is replaced rather than
  followed, and the file does not keep its own permissions. `kumiki fix --apply`
  does not take the write lock.

- fe8e6a4: Publish the `.js` artifacts without their JSDoc

  The largest file any of these packages ships was mostly prose. `dist/index.js`
  of `@kumikijs/runtime` — the package entry, and the `./bundle` export codegen
  inlines for `bundle: true` / smoke / run / test — was 296 kB, of which 83 kB
  was JSDoc. `@kumikijs/compiler`'s was 372 kB with 95 kB of it.

  That prose has two better readers than a published bundle. Editors read it
  from the `.d.ts`, which keeps every block. People read it from the source on
  GitHub. What was left was a per-install download nobody opens.

  `tsdown.shared.ts` now carries one output setting for every package:

  ```ts
  comments: { legal: true, annotation: true, jsdoc: false }
  ```

  | artifact                  | before | after  | gzip before → after |
  | ------------------------- | ------ | ------ | ------------------- |
  | `@kumikijs/runtime` dist  | 621 kB | 538 kB | 163 kB → 128 kB     |
  | `@kumikijs/compiler` dist | 423 kB | 328 kB | 105 kB → 65 kB      |
  | `@kumikijs/cli` dist      | 196 kB | 162 kB | 45 kB → 30 kB       |
  | `@kumikijs/mcp` dist      | 33 kB  | 29 kB  | 10 kB → 9 kB        |

  This is not minification, and the two comment kinds a build cannot regenerate
  are kept:

  - `annotation` (`@__PURE__`, `@__NO_SIDE_EFFECTS__`, `@vite-ignore`). Dropping
    these would silently cost downstream bundlers the tree-shaking
    `sideEffects: false` promises — a fatter app bundle with no error anywhere.
  - `legal` (`@license`, `@preserve`, `//!`, `/*!`), which has to survive
    redistribution.

  Identifiers, formatting and the trailing `export { … }` line are untouched, so
  `@kumikijs/runtime`'s `dist/index.js` stays unminified, readable in a stack
  trace, and inline-able by `inlineRuntime` exactly as before.
  `packages/tests/dist-comments.test.ts` pins all of that: no JSDoc in any
  published `.js`, JSDoc still in the `.d.ts`, annotations still present, and an
  `inlineRuntime` round-trip over the real built bundle.

  What a compiled app downloads is unchanged — `kumiki build` ships
  `dist/modules/*`, which were already minified. An app built with
  `bundle: true` inlines 83 kB less.

## 0.5.0

### Minor Changes

- bf37539: Stop `fix` from treating a warning as a file it cannot repair, and report the warnings it sets aside.

  The fix-from-test path gated its behavioural tier on "does this file have diagnostics", counting advisory ones. A `W0212` anywhere in a file made `kumiki fix --auto-patch <test>` return `no-patch` without running the test at all — and the second gate did the same after a compile repair had already landed, so a successful repair reported the warning it revealed as what remained.

  Warnings are now carried rather than dropped: `FixPlan`, `FixApplyResult` and `FixFromTestOutcome` each expose them, both `fix` modes report a clean-but-advisory file the way `check` does (`no errors (1 warning)`, exit 0) and list the warnings under every verdict, and `kumiki_fix` does the same — including on the wire, where the apply envelope now carries a `warnings` array beside `remaining`.

- f48fd58: fix(mcp): the edit tools report what they did — the op-id, and the whole
  cascade a `remove` took.

  `kumiki_remove` answered `removed slot.count` for an operation that had also
  deleted the reducers reading that slot, the tile rendering them, and the `app`
  routing to that tile. The CLI has printed the cascade since the op log learned
  to record it (spec/ai-edit.md §9.4.1); the MCP handler dropped the result on
  the floor, so the surface agents actually drive was the one that said an edit
  deleting six definitions had deleted one — and a file could lose its entry
  point with nothing in the transcript to say so.

  The op-id went the same way, in `kumiki_add`, `kumiki_replace`,
  `kumiki_remove` and `kumiki_rename` alike, though the §9.7 tool table lists it
  as the return value of all five edit tools. It is the handle `kumiki patch
revert` takes, and what identifies the op among the entries `kumiki_history`
  returns, so an agent that made an edit could not name it afterwards.

  Both surfaces now format their report with one shared function, `describeEdit`,
  newly exported from `@kumikijs/cli` — the CLI verbs print it and the MCP tools
  return it, so the two cannot answer the same edit differently. CLI output is
  unchanged, byte for byte.

- 301b09a: chore: require Node 24.

  Node 20 reached end of life, so every package's `engines.node` moves from
  `>=20` (`>=20.6` for `@kumikijs/vite`, which needs the synchronous
  `import.meta.resolve` that landed there) to `>=24`. CI builds and tests on 24
  as well, matching the release workflow, which was already there.

  **Breaking for anyone installing on Node 20 or 22**: the packages declare the
  new floor, so `npm i` warns and an `engine-strict` install fails. Nothing in
  the published code depends on a Node 24 API today — the bump states the
  version the toolchain is actually tested on, rather than one that no longer
  receives security fixes.

- db8e843: fix: let the Vite plugin do what a bundler plugin is for.

  **The runtime is no longer copied into every module.** `bundle` now defaults to
  `false`, so the compiled module keeps its `import "@kumikijs/runtime"` and the
  bundler ships one copy. The old default fought the pattern this plugin's own
  documentation recommends — `mount` comes from that same package — so a project
  that imported one `.kumiki` file built the runtime twice (129 kB against 82 kB
  for the counter), and each further `.kumiki` import added another. Size was the
  smaller half: the runtime keeps module-level state, and the injected
  state-style sheet is found by DOM id while its sequence counter restarts per
  copy. The plugin resolves the specifier from the project when it can and from
  its own dependency otherwise, so a project that installed only `@kumikijs/vite`
  still builds — with one copy either way. `bundle: true` remains for a module
  that must stand alone.

  **`generateDts` emitted TypeScript that did not compile.** A slot name is
  allowed to be kebab-case, and it was written into the declaration bare
  (`my-slot: string`); the generated helpers were called `Provider` / `Slots` /
  `Providers`, which are among the likelier names a program declares itself. With
  `types: true` both landed in the user's project and broke their `tsc`. Slot
  names are now quoted — the spelling the emitted `slots` object actually uses —
  the helpers are `KumikiProvider` / `KumikiSlots` / `KumikiProviders`, and a type
  whose Kumiki name is not a TypeScript identifier is declared under one that is.
  The guard runs a real `tsc` over the generated output.

  **A parse error is now a diagnostic.** `compile()` returns type errors but
  throws lex and parse errors, and the plugin only handled the returned form — so
  the most common authoring mistake reached Vite's overlay as a stack of compiler
  frames with no line to jump to. Both now arrive with file, line and column.

  **`kumiki.caps.json` is found where a project would put it.** The lookup only
  ever checked the directory holding the `.kumiki` file; a manifest at the project
  root — where the rest of a Vite project's configuration lives — was ignored
  without a word. It is now searched for from the source file up to the project
  root — the nearest `package.json` — nearest manifest wins, and a
  malformed manifest on that path is an error naming the file rather than a
  silent fall-through. `E0302` now says which manifest was read, or which
  directories were searched — in the plugin and in `kumiki check` / `kumiki
build` alike. `@kumikijs/mcp` resolves capabilities through the same helper, so
  its `path` inputs get the widened search too.

  The Vite plugin's `engines.node` moves to `>=20.6`, the release that made
  `import.meta.resolve` synchronous — the runtime fallback above is built on it.

## 0.4.0

### Minor Changes

- 46bee64: feat(cli,mcp): `kumiki fix` says why it produced no patch, instead of collapsing
  20+ distinct dead ends into one message (#177).

  `planTestPatch`'s third tier and `planFixes` between them had over twenty silent
  `return null` / `continue` branches, all of which surfaced as
  `(no auto-patch available)`. An AI iteration loop could not tell "no repair
  exists for this" from "the compiler's message format moved and the extractor
  stopped matching" — so a change to the quoted-name shape would have disabled
  every auto-patch with no signal at all.

  `planFixesExplained` / `planTestPatchExplained` return a stable kebab-case reason
  per skip. It reaches `FixFromTestOutcome`'s `no-patch` result, is printed by the
  CLI, and is exposed to the MCP bridge, with the whole chain available under
  `KUMIKI_DEBUG=fix`. Message-format drift now reads as an anomaly in the reason
  distribution rather than as silence. `planFixes` and `planTestPatch` remain as
  wrappers, so no existing caller changes.

- fb02913: feat(mcp): add apply / auto-patch / test / episode bridges to close the AI fix loop (#155).

  - mcp: `kumiki_fix` gains `apply` / `only` / `capabilities` options. With `apply: true`, patches are written to disk and the tool returns `{ applied, before, after, remaining }` (plus `parseError` when the composed patches broke syntax). Default remains dry-run so existing agents keep their safe default.
  - mcp: new `kumiki_auto_patch` tool wraps `kumiki fix --auto-patch <test-name>`. Returns a structured `FixFromTestOutcome` (`status` in `{already-pass | proposed | applied | compile-proposed | compile-remaining | no-patch | not-found}`). On `apply: true` runs, the `regressed` field is always populated so regression detection is baked into the tool output.
  - mcp: new `kumiki_test` tool wraps `kumiki test`, returning `{ total, passed, failed, results }` with optional `filter` (name or `prefix*`).
  - mcp: new `kumiki_episode_list` / `kumiki_episode_tail` tools read `<file>.kumiki-episodes.jsonl` sidecars. `list` returns compact summaries (`id`, `trigger.kind`, `trigger.target`, `status`, `steps`), newest first; `tail` returns full episode JSON, newest first.
  - mcp: `kumiki_check` gains `strictA11y` / `strictIcons` / `strictSelectorId` toggles (the same set the CLI's `--strict-*` flags surface). With `path` + `strictIcons`, `@kumikijs/icons` is resolved to widen the icon-name domain.
  - mcp: `kumiki_run_scenario` description updated to name the loop-closing tools (`kumiki_auto_patch` and `kumiki_fix` with `apply: true`), so the generate → run → observe → **fix** loop is fully documented at the tool surface.
  - cli: `fix.ts` and `smoke.ts` split into pure computation (`planFix` / `applyFixPlan` / `runFixFromTest` / `runTests`) and CLI printers (`fixCmd` / `fixFromTest` / `testCmd`). MCP handlers reuse the pure variants so stdio protocol is never polluted by CLI stdout. Existing CLI behavior is unchanged.

### Patch Changes

- 75a809b: fix(cli, mcp): escape-normalized partial-string repair + structured `writeError` surfacing.

  Robustness follow-ups from the prior review round.

  - **Escape normalization.** `planPartialStringPatchExplained` compared decoded `TestResult.leaf` values (`\n` as a real newline, `\"` as a quote, …) against raw source-literal bodies (`\n` as two chars). Any Kumiki source literal spelling an escape — `\n \t \r \" \\` — could either silently bail with `no-string-literal-contains-mida` or, worse, splice the divergent middle into the raw body and re-encode, corrupting untouched escapes (e.g. an existing `\n` doubled to `\\n`). The tier now decodes each literal body via a private `decodeKumikiStringBody` helper (lockstep with the lexer's escape set) and does its `midA` comparison, splice, and `kumikiStringLit` re-encode entirely in decoded space, so escapes round-trip canonically.
  - **I/O error surface.** The three `writeFileSync` sites in `applyFixPlan` / `runFixFromTest` used to leak EACCES / ENOSPC / EBUSY as raw stacks — asymmetric with the same file's `parseError` / `regressionBlocked` / `testRunError` structured returns. Every write now goes through a new `atomicWriteFileSync` helper (`.kumiki-tmp` staging + `renameSync`) so a mid-write ENOSPC leaves the target byte-identical instead of truncating it. `FixApplyResult` gains an optional `writeError?: string` modifier; `FixFromTestOutcome` gains a `write-failed` variant with `phase: "compile" | "test"` discriminating the two write sites (and preserving the proposed `patch` on `phase: "test"`). `fixCmd` fails loudly on stderr and sets `process.exitCode = 1` on write failure. `kumiki_fix` (MCP) surfaces `writeError` / `regressionBlocked` on the wire alongside `parseError`. `kumiki_auto_patch` documents the new status. Both consumer switches gain `default: never` exhaustiveness guards.

## 0.3.0

### Minor Changes

- be38e20: v0.3 — the type-soundness & robustness milestone. Two soundness gaps the 0.2.1
  code review filed as issues, both closed:

  - **M1 (#24) — clean panic handling on the live path.** A panic on the live
    path (`panic(message)`, `Result.get-err` on `Ok`, or the polymorphic `.get`
    on `None`/`Err`) used to escape the DOM event handler / render uncaught. Now
    there is one model: a tagged `KumikiPanic`, caught around live reducer
    dispatch so the episode is rolled back (no partial slot writes), surfaced to
    the `smoke`/scenario tiers, and routed to the `app.error` reducer with
    `PanicInfo`; a render panic with no enclosing `error-boundary` shows a built-in
    top-level fallback. Fixes two latent bugs: `panic(message)` was unimplemented,
    and `.get` did not panic on the empty case (opposite to `.get-err`).

  - **M2 (#23) — receiver type inference for method-shortcut dispatch.** The
    parenthesis-free shortcut `recv.m` was dispatched by name only, so a record
    field named like a method (`node.head`) was silently shadowed and an unknown
    `recv.bogus` compiled to `undefined`. The checker gained its first
    type-inference pass: `FieldAccess` now dispatches field-vs-shortcut by the
    receiver's inferred type, and an unknown member on a known type is a compile
    error (**new E0108 `undef-member`**) instead of a silent wrong value.

  E0108 is a deliberate tightening (pre-1.0): a program that previously compiled
  `recv.bogus` to `undefined` now fails to compile.

## 0.2.0

### Minor Changes

- 77938ee: v0.2 — close the five spec-deferred features (M1–M5)

  - **M1 `stop-timer(name)`** — explicit named-timer stop; errors E0002 / E0106.
  - **M2 `overlay` builtin** — z-axis stacking (modals / toasts / dropdowns), `align` prop, composes with `when`.
  - **M3 plugin capability registration** — `kumiki.caps.json` manifest; unlisted caps are now a compile error (E0302).
  - **M4 `test` layer + `kumiki test` runner**, and **`kumiki fix --auto-patch <test-name>`** — in-language reducer-test / tile-test with PASS/FAIL + diff output, plus deterministic repair from a failing test.
  - **M5 `motion` layer** — reusable, closed-grammar, scoped animations referenced from a tile's `motion` prop; honors `prefers-reduced-motion`; errors E0107, E0401–E0403.

  See CHANGELOG.md for the full detail.
