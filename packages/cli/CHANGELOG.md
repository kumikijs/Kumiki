# @kumikijs/cli

## 0.9.0

### Minor Changes

- 3e8d1ba: Reproduce a run that read the environment when replaying its episode

  An episode recorded what a reducer _wrote_ and nothing about what it read, and
  `replayEpisodes` re-executes the reducer body. So the one episode most worth
  replaying — the one whose reducer rolled a die or stamped a time — was the one
  replay could not answer for. Recorded `roll: 0 -> 3`, then three separate runs
  of the same command:

  ```
  $ kumiki replay r.kumiki --from-log ep.jsonl
    [reducer] roll6  roll: 0 -> 2, inRange: false -> true
  $ kumiki replay r.kumiki --from-log ep.jsonl
    [reducer] roll6  roll: 0 -> 1, inRange: false -> true
  $ kumiki replay r.kumiki --from-log ep.jsonl
    [reducer] roll6  roll: 0 -> 3, inRange: false -> true
  ```

  A `reducer` step now carries `env-reads`: what the body read from the
  environment while it ran, in the order it asked, each entry `{kind, value}` with
  `kind` one of `now` / `random` / `fresh-id` / `prefers-dark` — the builtins whose
  answer comes from outside the program, so that nothing in the slots determines
  it. Replay installs that reducer's recorded reads before running its body, and
  those builtins return what they returned during the recording instead of reading
  the clock / the random source / the id generator / the OS preference again.
  Replaying an episode that read the environment now reproduces its recorded
  `slot-diffs` exactly, every time.

  A `panic` step carries the same, plus the `name` of the reducer that threw. A
  reducer that panicked wrote no `reducer` step at all, so the episode a bug
  report is most worth carrying — the one that crashed — would otherwise have
  replayed as an episode with nothing in it, re-read the environment, taken a
  different branch, and exited 0.

  The scope that is recorded is the reducer body: a read in a tile expression or
  during a render is not journalled, and nothing replays those. What a read
  _answers_ is recorded; the local time zone that `now.format(...)` later resolves
  in is not.

  `random()` used to lower to an inline `Math.random()`, which is invisible to the
  log; it lowers to `_s.random()` now, beside the three that already went through
  the runtime. That is a **generation requirement**, not a log-format one: an app
  built by this compiler against an older `@kumikijs/runtime` fails at runtime
  with `_s.random is not a function`, exactly as `_s.prefersDark()` did when it
  was introduced. Compiler and runtime move together.

  `kumiki replay` now reports environment-read provenance — `(env: N read live)`
  on a step, and an `environment reads:` summary at the end — so "returned the
  recorded value" and "read the clock again" are distinguishable after the fact.
  An entry whose `value` is missing or is the wrong type for its `kind` is
  rejected when the scope opens rather than handed to a reducer body as
  `undefined`, and counted as `malformed`.

  `withEnvRecord` / `withEnvReplay` are exported for a host that runs reducer
  bodies itself; they take the body as a callback so the process-wide scope is
  balanced by construction.

  Log-format compatibility holds in both directions: the field is omitted when a
  reducer read nothing, so a log written before this is byte-identical to one
  written now, and a log that carries no `env-reads` still parses and replays,
  reading live as before. A read with no recorded answer left falls through to the
  live source rather than failing the replay.

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

- fe8e6a4: `kumiki build --minify`

  The generated `app.js` was the only thing in a build's output that shipped
  unminified — the runtime modules beside it come minified from the runtime's own
  build. On a large app it is the bigger of the two:

  ```
  kumiki build packages/examples/apps/05-project-management/app.kumiki out
    app.js      118.72 kB   runtime/  73.58 kB
  kumiki build packages/examples/apps/05-project-management/app.kumiki out --minify
    app.js       72.15 kB   runtime/  73.58 kB
  ```

  | app                   | total raw          | total gzip           |
  | --------------------- | ------------------ | -------------------- |
  | 01-counter            | 73.25 → 69.47 kB   | 24.70 → **23.77 kB** |
  | 02-todomvc            | 89.15 → 81.79 kB   | 29.17 → **28.16 kB** |
  | 04-issue-tracker      | 128.15 → 107.22 kB | 32.75 → **31.38 kB** |
  | 05-project-management | 192.81 → 146.23 kB | 37.18 → **35.02 kB** |

  Raw drops 5–24%, gzip 3.5–6%. The raw number is the one that matters most
  here: it is what the browser parses before the first render, and gzip was
  already flattening the generated code's repetition.

  **It is opt-in, and the readable default is the point.** The AI debug loop
  reads `app.js` stack traces, and the harnesses (`build-and-load.ts`,
  `tests/helpers/load.ts`, `e2e/src/browser.ts`) patch two of codegen's emitted
  lines by verbatim string replace. Minifying renames every top-level binding, so
  a build that did it unasked would take both away. Nothing but `app.js` changes:
  `index.html` and every `runtime/*.js` are byte-identical with and without the
  flag.

  A minifier error fails the build rather than falling back to the unminified
  source — under a flag that says `--minify`, a silent fallback would deploy the
  readable build. Nothing reaches the output directory until the minified module
  is in hand, either, so a failure leaves no complete-but-unminified build behind
  for a deploy step that missed the exit code to ship instead.

  `packages/cli/test/build-minify.test.ts` covers all four: the default still
  carries the spelling the harnesses patch, `--minify` is substantially smaller,
  only `app.js` differs, and the minified counter still mounts, still increments
  on a click, and still publishes `globalThis.__kumikiApp`.

- 10ad414: `patch revert` of a `remove --cascade` restores everything the cascade removed

  The revert re-added only the definition that `remove` was given. Every
  dependent the cascade took stayed deleted, and the command still exited `0`.
  The lost set can include the `app`. In this example it is two tiles:

  ```
  removed slot.b  (op_…)
    cascaded tile.Page
    cascaded tile.Show
  reverted op_…  (op_…)
  $ kumiki list c.kumiki
  slot     a  (1-1)
  slot     b  (6-6)
  ```

  Every `remove` now records the body of each definition it deletes, as it stood
  at that moment, in a new `bodies` field. The revert restores all of them as one
  `add` op. The requested definition is the op's own `layer` / `name` / `body`,
  and the dependents go in a new `with` field. The definitions are written in one
  batch and validated together, since a dependent does not typecheck without the
  definition it refers to. Because the bodies come from the remove itself, a
  dependent restores correctly even if the op log never recorded it, or a rename
  rewrote it without logging a new body.

  A `remove` logged before `bodies` existed falls back to the last body the op
  log recorded for each name. If any body is missing, nothing is written and the
  command exits `1`, naming what it could not restore:

  ```
  Error: patch revert: cannot reconstruct the body of slot.b, tile.Show removed by op_…; nothing was written
  ```

  A cascade logged without its `removed` list is refused, because what it
  removed is unknown.

  Reverting that restore removes exactly the set it added, including a member
  that no longer depends on the named definition. It is refused before anything
  is written if a member is gone from the file, is locked by another agent, or is
  referenced from outside the set:

  ```
  Error: remove rejected: tile.Other references tile.Show, outside the definitions being removed (slot.b, tile.Page, tile.Show); nothing was written
  ```

  `patch apply` replays an `add` with `with` as the same single op, and a cascade
  `remove` that carries `removed` as a removal of that recorded set. `with`,
  `bodies` and `removed` are checked when a patch file or the op log is read: a
  malformed one is rejected by field name instead of writing `slot undefined` or
  failing with a `TypeError`. `view --history` of a definition now also lists the
  cascades that removed it and the restores that brought it back.

- d78498d: Stop the fix regression gate mistaking a moved diagnostic for an introduced one

  The gate identified a diagnostic by `code@line:col`, so anything a repair moved
  was not in the before-set and read as a failure the repair had created. Two
  shapes reached it, and both rolled back a correct repair over a diagnostic no
  patch had touched:

  - a rewrite shorter than what it replaced moves every diagnostic to its right
    on that line — `$route` → `route` beside an unrepairable name;
  - `E0001`'s repair prepends a `tile NotFound` block, so **every** diagnostic
    below it moves two lines down. That made the commonest repair in the
    catalogue unusable on any file that also carried one unrepairable name.

  A diagnostic is now identified by its **code, kind and message**, and the two
  sets are compared as multisets. Counting codes alone is nearly enough and fails
  where a second repair balances the books — reword one `E0211` and resolve one
  `E0119` in the same plan, and the per-code counts report a clean repair while
  the reworded diagnostic is still in the file. A set rather than a multiset
  would compute "nothing resolved" for a file holding two diagnostics with one
  key where a repair cleared one of them, and roll a real repair back.

  A 1-for-1 swap (`E0301` → `E0302` via a typo) is still caught, and so is a
  repair that turns a name error into a type error at the same position.

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

- fe8e6a4: Ship tiles one at a time, and link them with `kumiki build --bundle`

  A counter with one button downloaded the `select` tile's 70-line option
  reconciler, the `contenteditable` IME guard, the slider, and the `link` tile's
  URL-disposition check and allowlist. `kumiki build` shipped runtime modules per
  tile _family_ (#71), and a family is a taxonomy, not a unit of code.

  Two changes, which only work together.

  **The module boundary now follows the code.** `text` and `input` ship one
  module per tile (`tiles-text-link`, `tiles-input-button`, plus
  `tiles-input-shared` for what the controls genuinely share). `layout` and the
  rest still ship whole, because they are already one unit: layout's thirteen
  kinds share five renderers — `page` and `column` are both `renderFlexColumn`,
  six more are `renderBox` — so splitting it would ship the same bytes under more
  names. The compiler's `PER_TILE_FAMILIES` says which is which, and a
  cross-package test fails if a listed family gains a kind the runtime build has
  no module for.

  **`kumiki build --bundle`** links the generated module and the runtime modules
  it imports into one minified `app.js`, and emits no `runtime/`.

  | app                   | before   | `--bundle`          |
  | --------------------- | -------- | ------------------- |
  | 01-counter            | 24.70 kB | **17.70 kB** (−28%) |
  | 02-todomvc            | 29.17 kB | **22.81 kB** (−22%) |
  | 04-issue-tracker      | 32.75 kB | **26.50 kB** (−19%) |
  | 05-project-management | 37.18 kB | **29.87 kB** (−20%) |

  (gzip -9, whole output directory. Raw drops by about the same: 192.81 → 137.60
  kB for the largest.)

  **Why they need each other.** Bundling alone leaves the tiles: a family module
  exports one object literal holding every renderer, and the app names the whole
  object, so nothing tree-shakes it — bundling the counter without the split is
  20.87 kB against 17.37 kB with it. And the split alone _costs_ large apps:
  compression builds its dictionary per response, so nineteen small modules
  compress worse than seven bigger ones, and 04/05 come out ~3% larger
  uncompressed-payload-for-payload even though their raw bytes drop. The default
  modular build therefore moves a little in both directions — counter −12.5%,
  issue-tracker +3.3% gzipped — and `--bundle` is where the win is.

  **`--bundle` stays opt-in because it implies minification.** The cache
  granularity a modular layout buys — `runtime/core.js` keeping a URL that
  survives an app change — is the smaller half of the argument, and nothing
  outside HTTP caching depends on that layout: the e2e tier, the MCP server, the
  Vite plugin and smoke/run/test all take the `bundle: true` monolith path, and
  the emitted `index.html` never names `runtime/`. What is load-bearing is that
  `app.js` stays _readable_. The AI debug loop reads its stack traces, and three
  harnesses string-replace codegen's emitted lines verbatim. A default that
  minified would take both away, which is the same reason `--minify` is opt-in.

  **New dependency, and one module subpath goes away.** `@kumikijs/cli` now
  depends on `rolldown`, which serves both flags — `--minify` keeps `./runtime/*`
  external and minifies the app module alone, `--bundle` pulls them in. It is
  pinned to `1.0.3`, the exact version `vite` (already a CLI dependency) pins, so
  the two share one copy instead of shipping a second native toolchain; that pin
  should move only together with vite's. It is imported lazily, inside the two
  functions that use it, so `check` / `list` / `view` / `fix` and `@kumikijs/mcp`
  at startup do not pay to load a native addon for flags they never pass.

  `@kumikijs/runtime`'s `./modules/*` subpath no longer resolves
  `./modules/tiles-text.js` or `./modules/tiles-input.js` — those two families
  are now `tiles-text-<kind>` / `tiles-input-<kind>` plus `tiles-input-shared`.
  The subpath is there for `kumiki build` to copy from rather than as an API, and
  nothing in this repo deep-imports it, but a host that did will need the new
  names.

  Nothing about authoring changes. The monolith `mount()` still assembles every
  family, `textTiles` / `inputTiles` are still exported with the same contents,
  and the browser tier (25 Playwright cases, including the select / editable /
  video / keyed-list identity guards the tile split could have broken) is green.

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

- d63d50d: An ownership lock covers every definition an op touches

  The lock was only checked against the name the verb was called with. As a
  result, an agent whose direct `replace` or `remove` of a locked definition was
  refused could still reach that definition another way:

  - `remove slot.count --cascade` deleted every locked reducer and tile that
    depended on it.
  - `rename slot.count todos` created `slot.todos` inside another agent's
    `slot.todos*` namespace.
  - `rename slot.count total` rewrote the bodies of four locked referrers.
  - A `replace`, `add` or `edit` body is written as given, so a body that went
    on to a second definition (`slot todosX : Int = 0`, `reducer inc2 …`)
    created it inside a locked namespace.

  What an op touched is now read off the file rather than off the verb. After
  the op's write passes validation, the definitions before and after it are
  compared by qualified name, and every one that was added, removed or whose
  text changed is checked against the lock table. A locked definition anywhere
  in that set rejects the whole op: it exits `1`, the file is restored
  byte-identical, no op is logged, and the message names the first locked
  definition (in qualified-name order) and its owner:

  ```
  Error: replace rejected: lock violation: slot.todosX is locked by agent:a (pattern "slot.todos*"). Set KUMIKI_AUTHOR=agent:a to edit.
  ```

  `patch apply`, `patch revert` and the MCP tools call the same mutators, so the
  same check applies to them. That includes the revert of a cascade, which puts
  back every definition the cascade took, and the revert of that restore, which
  removes the same recorded set: a locked member anywhere in the set refuses it.

- 18f2e91: A replayed episode hands its entry reducer the payload the live run handed it (`runtime.md` §10.5.3).

  The live runtime records `trigger.payload` as the reducer payload itself — `{$el, $event}` for a UI event, `{$1}` for an effect result — and the replay executor behind `kumiki replay` and `episode-test` wrapped it a second time as `{$el: payload, $event: payload}`. So `$el.idx` and `$event.value` replayed as `undefined`, and an episode opened by an effect result panicked on its `$1`:

  ```
  [reducer] clicked  n: 0 -> undefined
  [panic:reducer] Cannot read properties of undefined (reading 'text')  reducer "loaded"
  ```

  The payload is now passed on unchanged. An `ssr.hydrate` bootstrap episode, whose trigger carries no payload, hands its first `.ok` / `.err` reducer the value of the last `effect-end` of that effect and outcome recorded before it, and a `from-log` mock of that effect continues after it. An `episode-test` with `slots-equal: from-log, no-panics: true` over a log of the unchanged program now passes for both.

  When the log carries no such `effect-end` (a trimmed or hand-edited log), the reducer still runs with no `$1`, but replay now says so instead of leaving the panic to read as a reducer bug: the episode line ends in `(no recorded result for <reducer>)`, the run ends with an `entry results missing:` summary, and `ReplayReport.entryResultsMissing` lists the episodes.

- 8d3595f: A scenario step that drives a control the platform would refuse now fails, naming the control and the reason, instead of passing (#369).

  `fill` on a `disabled` input moved the slot and ran the `ui.input` reducer, because the runner wrote the value and dispatched the event itself — so `disabled` never entered the picture. A scenario asserting a guard held was green having tested nothing.

  All three drivers — both verification tiers and `kumiki smoke` — now ask one rule before a verb drives a control (`controlFault` / `readControl`, beside `dispatchFault`): `disabled` refuses every verb that drives one, `readonly` and an `editable`'s `contenteditable="false"` refuse the typing alone. `hover` is deliberately outside the rule — Chromium fires `mouseenter` on a disabled control, measured rather than assumed. The rule cannot be left to the browser: Chromium refuses a real click on a disabled control but delivers a dispatched one, and dispatching is what a driver does.

  `expect.actionErrorIncludes` is the new key that asserts a refusal, so "this button is disabled and clicking it does nothing" is expressible rather than merely green. It matches the refusal alone, not the whole `actionError` channel, so a step cannot claim one on a selector that matched nothing. `kumiki run`'s trace prints a claimed refusal as `expected refusal:`.

  The rule resolves in both directions: a verb aimed at the `<label>` `check` / `radio` / `switch` render is judged by the `<input>` inside it, and a verb aimed at something inside a disabled control — the spinner a `loading` button renders — is judged by that control, since the dispatched event reaches it.

  `kumiki smoke` asks the same rule, and no longer fires at a control a user could not reach.

- 13a5cbb: A `tile-test` compares every content field its expected node carries, not only `kind`, `text` and `children` (`testing.md` §8.4). That covers the fields a builtin lifts (`src`, `to`, `value`, `options`, a toggle's checked state, …) and every other named argument the expected node is written with (`alt`, `disabled`, `variant`, `aria-*`, `id`, …). Each `aria-*` attribute is compared on its own, so stating `aria-label` asserts the label alone, at `button.aria-label`; a toggle's checked state is reported as `check.value`, the argument that sets it.

  ```kumiki
  tile Pic = image(src="/real.png")

  test pic-src =
      tile-test Pic
          given  = {slots: {}}
          expect = image(src="/WRONG.png")
  ```

  This test passed. So did a `link` with the wrong `to`, a `check` with the wrong checked state, an `input` with the wrong `value`, an `image` with the wrong `alt` and `button(text="Go", disabled=true)` against an enabled button. The snapshot never looked at those fields, and the report could not show them. They now fail with the field's path and the value arrow:

  ```
  FAIL  pic-src
    expected: image(src="/WRONG.png")
    actual:   image(src="/real.png")
    diff at:  image.src  "/WRONG.png" -> "/real.png"
  ```

  The `expected:` and `actual:` lines print only the compared fields, on both sides.

  Some things stay out of the comparison: the `{…}` block (styles, classes and any prop written there, which the compiler now leaves out of a tile-test's expected tree), handlers, a node's `key`, a control's `bind` wiring, a link's `prefetch`, and any field the expected node does not carry. A builtin's default for an argument left out _is_ carried. `check()` is an unchecked check and a `select` with no `options=` has none; §8.4 lists every such default.

  `kumiki fix --auto-patch` proposes a literal repair for a tile-test only when the failing field is text. A `checked` state or an `options` list is often decided by `given.slots`, so rewriting the slot's initial literal could not make the test pass.

- 6b861ce: A value builtin now renders the content argument it is written with, or
  reports the one it would drop as **E0129 `unrendered-arg`**.

  Each value builtin reads its content from one place, now one table the checker
  and the lowering share: `text` / `heading` / `code` / `markdown` from their
  first positional argument; `link` / `label` / `editable` from their first
  positional argument, or `text=` when none is written; `image` / `icon` from
  `src=` / `name=`.

  `label("Name")` and `link("Home", to="/x")` now render their label. The
  positional argument was parsed, type-checked and dropped, so both rendered
  empty. `text=` written beside a positional argument on these is never read, so
  it is E0129 like the other dropped arguments.

  An argument written as content that the builtin never reads is E0129, at that
  argument:

  ```
  text("FirstA", "SecondB")      # SecondB was dropped
  heading(text="Title")          # rendered an empty heading: text= is a prop here
  image("a.png", alt="a")        # image reads src=
  label(text="A", "B")           # renders B: text= is read only with no positional
  ```

  `kumiki fix` repairs the `text=` shape by making the value the positional
  content (`heading(text=title)` → `heading(title)`), and removes a `text=` that a
  positional argument shadows (`label(text="A", "B")` → `label("B")`). A dropped
  positional has no single repair and is reported as skipped. The diagnostic's
  `unrendered` field names the shape, so `fix` does not read the message.

- d8ff739: Several writers that find a lock left by an exited writer no longer lose one another's edit.

  Taking over a dead writer's lock moved the lock aside, checked it, and put it back if it turned out to be newer than the one seen. When one waiter had already taken over and a second moved that live lock aside, a third could create the lock in between; the second's put-back then failed and it deleted the live lock it had moved. Two writers held the lock at once, and one `add` was lost while both reported success.

  A waiter now touches the lock only once it is known to be the dead one. It first creates a claim file named after the lock it saw (created like the lock, so one waiter at a time holds it), looks at the lock again, and deletes it only if it is still that one. A claim left by a waiter that stopped in between is judged like a lock and passed over. Releasing goes through the same claim. What is taken over, and when, is unchanged.

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

- 87292c5: Start the CLI without loading vite or happy-dom until a verb needs them

  Every `kumiki` invocation imported vite (through the `dev` verb's module) and
  happy-dom (through the smoke loader) at start-up, so `kumiki check`, `build`,
  `--help` and the edit verbs paid for a dev server and a DOM they never use —
  about 0.9s of a 1.3s start. `dev` now loads its server when it runs, and the
  smoke / run / test / replay paths load happy-dom the first time they set up a
  DOM. What each verb does and prints is unchanged.

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

- 23abe23: The installed `kumiki dev` starts again (#459). The build copied the dev-server client and panel to `dist/dev/dev/`, while the built dev chunk reads them from `dist/dev/`, so every `kumiki dev <app>` from the published package failed with `ENOENT … dist/dev/client.ts` before listening. They now land in `dist/dev/`.
- 739cd7a: A type-member call qualified by a type constructor is now reported, as the new [E0124 `type-constructor-qualifier`](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0124-type-constructor-qualifier) (#432).

  `List`, `Map`, `Tuple` and a `type Box(T) = …` name types but are not types on their own: they still want their type arguments. So `Box.fresh()`, `List.fresh()` and `Option.show(v)` have no type to work with. For `fresh` and `show`, each existing check declined them on its own terms. E0117 did not fire because the name _is_ a type's, E0116 did not fire because the callee resolves, and E0201 had nothing to compare. `slot n : Int = Box.fresh()` stored a uuid string in an `Int` slot with nothing reported. `parse` was already reported, as E0802 "has no reading of a text". That message is wrong for `type Tagged(T) = nominal Text`, whose `type OrderId = Tagged(Int)` parses fine.

  The call is now E0124 for `fresh`, `parse` and `show` alike, and `Tuple` is covered: variadic is still not zero. On `parse` it replaces the E0802, which now covers only a complete type with no reading. The repair is to name the application as a type, as in `type IntBox = Box(Int)` then `IntBox.fresh()`. On `parse` the message also says that the applied type needs a base with a reading of a text (Int, Float, Time, Bool, Text or Bytes), so `List.parse` is not sent to `type IntList = List(Int)` only to meet E0802 on the next round. A qualifier that is already a complete type answers exactly as before.

  **CLI**: `kumiki fix` records the skip reason `e0124-type-arguments-unknown` for it. Which arguments to apply is the author's choice, so it proposes no patch.

- Updated dependencies [276089b]
- Updated dependencies [f36269f]
- Updated dependencies [8eca379]
- Updated dependencies [6cae7d8]
- Updated dependencies [72ff1df]
- Updated dependencies [b2b14c4]
- Updated dependencies [a69f7f4]
- Updated dependencies [0a8762c]
- Updated dependencies [13eacc9]
- Updated dependencies [e96eba6]
- Updated dependencies [62cc960]
- Updated dependencies [68b27a1]
- Updated dependencies [2dfc73f]
- Updated dependencies [027cf25]
- Updated dependencies [bf86b16]
- Updated dependencies [3db2d76]
- Updated dependencies [b74e05a]
- Updated dependencies [fe62177]
- Updated dependencies [eb5215c]
- Updated dependencies [9a2965f]
- Updated dependencies [4f7e35b]
- Updated dependencies [1e90ba3]
- Updated dependencies [b53ae7f]
- Updated dependencies [1c1cb23]
- Updated dependencies [9237208]
- Updated dependencies [8820b8e]
- Updated dependencies [e7da073]
- Updated dependencies [fbbec02]
- Updated dependencies [fac7523]
- Updated dependencies [3e8d1ba]
- Updated dependencies [18f2e91]
- Updated dependencies [1bc3e8a]
- Updated dependencies [c858728]
- Updated dependencies [3043987]
- Updated dependencies [6925c32]
- Updated dependencies [8d3595f]
- Updated dependencies [fbbec02]
- Updated dependencies [e709ac7]
- Updated dependencies [8f2d978]
- Updated dependencies [13a5cbb]
- Updated dependencies [6b334a4]
- Updated dependencies [e2b8d2d]
- Updated dependencies [0aff1de]
- Updated dependencies [14522b7]
- Updated dependencies [e0ce4ed]
- Updated dependencies [7ed2e94]
- Updated dependencies [6b861ce]
- Updated dependencies [730690b]
- Updated dependencies [528c9d3]
- Updated dependencies [67a6ea1]
- Updated dependencies [29e24c1]
- Updated dependencies [e2a3cda]
- Updated dependencies [36340c7]
- Updated dependencies [8f7b051]
- Updated dependencies [1ed9ec0]
- Updated dependencies [f2a7d92]
- Updated dependencies [4e52e29]
- Updated dependencies [178199f]
- Updated dependencies [3aae0ea]
- Updated dependencies [b33d62d]
- Updated dependencies [39eb32b]
- Updated dependencies [fbd7685]
- Updated dependencies [5945a3e]
- Updated dependencies [0f4dc74]
- Updated dependencies [5072599]
- Updated dependencies [d029b60]
- Updated dependencies [88effc6]
- Updated dependencies [5907ee2]
- Updated dependencies [b2ee6a6]
- Updated dependencies [2adec5b]
- Updated dependencies [6f38fd8]
- Updated dependencies [1c1cb23]
- Updated dependencies [d0b334d]
- Updated dependencies [0f93dda]
- Updated dependencies [aa8ce0b]
- Updated dependencies [dbae0a7]
- Updated dependencies [dbf5258]
- Updated dependencies [a489ee1]
- Updated dependencies [4cd6c29]
- Updated dependencies [29aa08e]
- Updated dependencies [46d9dca]
- Updated dependencies [4b126f4]
- Updated dependencies [21dc29e]
- Updated dependencies [c1df514]
- Updated dependencies [1b92331]
- Updated dependencies [3573ca7]
- Updated dependencies [d8ff739]
- Updated dependencies [3573ca7]
- Updated dependencies [58d3da3]
- Updated dependencies [db913dc]
- Updated dependencies [8d4eb0c]
- Updated dependencies [891a942]
- Updated dependencies [d3d6611]
- Updated dependencies [d9d29ca]
- Updated dependencies [ead317d]
- Updated dependencies [7cedcce]
- Updated dependencies [ad2c6f8]
- Updated dependencies [43ccd6e]
- Updated dependencies [2546469]
- Updated dependencies [fe8e6a4]
- Updated dependencies [2061f11]
- Updated dependencies [b7e922c]
- Updated dependencies [0a7ae12]
- Updated dependencies [1a3b24c]
- Updated dependencies [da4069f]
- Updated dependencies [fe8e6a4]
- Updated dependencies [f9a999c]
- Updated dependencies [739cd7a]
- Updated dependencies [b9e5ca6]
  - @kumikijs/compiler@0.14.0
  - @kumikijs/runtime@0.14.0
  - @kumikijs/vite@0.6.1

## 0.8.0

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

- 7a754ad: fix(compiler): report a `$route` the runtime never binds (E0119), and fix the
  patch composition it exposed.

  **E0119 `route-bind-out-of-scope`.** `$route` is not a name in a table — it is a
  payload field the runtime fills in, on the route lifecycle path (`route.enter` /
  `route.leave` / `route.error`) and on a link's prefetch path, and nowhere else.
  Every other reducer read `{}`: each field off it came back `undefined`, so every
  comparison against one was quietly false and the body did nothing. The check
  names the `route` slot, which holds the current route and is readable from every
  reducer, and `kumiki fix` proposes that rewrite.

  The exemption for a prefetch target is by NAME, and deliberately so: a reducer
  has one trigger and the check has no path sensitivity, so a reducer that is both
  a prefetch target and triggered some other way is not reported on either path.
  Exempting is the side that never rejects a working program.

  The spec moved to match the runtime rather than the other way round: it named
  enter/leave, and the runtime has always also bound `route.error` and the
  prefetch target — `routing.md` §3.4 and `language.md` §1.6.5 now name all four.

  **`kumiki fix` composes a plan by what each patch disturbs.** `AutoPatch` gains
  a required `anchor`: `span` (writes at a position — composed from the right),
  `line` (rewrites the first match on its line, so it can move a column no
  position predicts — composed after every span), `region` (adds or extends text
  elsewhere — composed last). Without it, one repair moved the column another was
  measured at, the regression gate read the moved diagnostic as introduced, and
  the whole plan rolled back with the file unchanged. `runFixFromTest`'s tier-1
  repair, which writes with no gate at all, composed the same way and landed half
  a plan.

  A name-suggest repair now writes at the reported position when the position
  really holds the name it quotes, and falls back to the line scan only where it
  does not (E0211 reports at the reducer and names a tile).

  Repairs no longer rewrite a file's line endings: editing a line used to
  round-trip the whole file through `split(/\r?\n/).join("\n")`, turning a
  one-token repair into a whole-file diff on any CRLF checkout.

- 4de2473: Close the blind spots that let a broken example stay green.

  `kumiki smoke` and the test suite were two implementations of one pipeline and
  disagreed about the same example: six examples reached real hosts, and whether
  the DNS failure landed inside the settle window decided the outcome. They share
  one loader now, and both install the same doubles — a `fetch` answered by the
  example's own `<source>.http.json`, and an `IntersectionObserver` that actually
  notifies, since happy-dom's `observe()` is a no-op and the runtime's prefetch
  path was unreachable from either headless tier.

  `smoke` also answers for two things it used to wave through: a render of nothing
  but empty containers is now reported as not rendered, and forms are submitted —
  after the fields inside them — so a form written without a submit button, the
  shape the spec's own example uses, reaches its `ui.submit` reducer at all.

  The scenario runner refuses what it cannot evaluate. The `expect` keys, the
  action kinds and the document itself are closed sets, the browser tier's names
  fail with a message saying so, and a scenario is checked before the app is
  mounted. Two actions join: `wait`, so a debounce window or a retry backoff is
  one step, and `submit`, whose selector may name the form or anything inside it.
  The first paint is now a step of its own when it reports anything, so an
  `app.init` effect that fails with no `.err` reducer fails the run instead of
  being dropped.

  The `Action` union gains `submit` and `wait` at both tiers; `@kumikijs/cli`
  newly exports the test doubles (`installTestDoubles`, `useHttpFixture`,
  `readHttpFixture`, `httpRequests`) and its app loader. A scenario that carried a
  key nobody evaluated used to pass and now fails, which is the point.

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

### Patch Changes

- d398cbc: fix: make the spec's own examples compile, and give each code one meaning.

  **Every ` ```kumiki ` block in `docs/` is now checked.** Fewer than half of
  them parsed: 27 blocks used `;` as a comment while `language.md` §1.2 defines
  `#` as the comment and `;` as the statement separator — which the corpus uses
  it as, so the conversion is per occurrence rather than wholesale. A block now
  declares what it is (a complete program, a `fragment` of definitions, a
  `snippet` of less than a definition, or a deliberately `invalid` example) and
  each mark is falsifiable in both directions, so a wrong mark fails as loudly as
  a wrong block. English and Japanese must mark the same block the same way.

  **`ai-edit.md` defined a second table of diagnostic codes**, disagreeing with
  `errors.md` on eleven of them — `E0302` meant "direct effect call" in one and
  "unknown capability" in the other, in a document that calls a code a permanent
  contract. The section now points at `errors.md`, and the spec-drift guard reads
  every file that assigns a code (`typecheck.ts`, `cli/src/fix.ts`,
  `mcp/src/index.ts`), not the checker alone. `E0000` — which those two tools
  synthesize so a parse failure can appear in a list of diagnostics — is
  documented rather than deleted; `--refs` no longer claims a band (`E05xx`) that
  no code has ever belonged to.

  Two implementation-side corrections came out of the same pass:

  - **`Route` gains `pattern` and `hash`.** The router builds all five fields and
    `routing.md` §3.2 documents all five; the compiler's standard-library table
    had three, so a generated provider signature typed `route.pattern` as
    `unknown`.
  - **`toast` honours `duration` and carries its `kind`.** `lifecycle.md` §7.7
    has always shown `duration: Option(Duration)` and the example corpus emits
    it; the runtime ignored it and every `kind`, hardcoding three seconds. The
    kind lands as `data-kumiki-toast-kind` with no built-in appearance (the call
    `variant` makes on a button), and the toast is the `aria-live` region
    `lifecycle.md` §7.8 lists as a runtime guarantee.

- 732cb16: fix(compiler): resolve the names a test body writes, and a call's qualifier.

  Two holes of the same kind: a name that resolved to nothing, accepted because
  nothing asked.

  **A test body was not name-resolved at all.** `checkTest` walked a `given` for
  misplaced wildcards, an invariant for `run-reducer`'s target, and an `expect`
  for `<slots.X>` — none of which reaches `checkExpr`. What the lowering could
  not read, it dropped:

  | Written                           | `check` | `kumiki test`                             |
  | --------------------------------- | ------- | ----------------------------------------- |
  | `given = {slots: {conut: 3}}`     | ok      | passes — against the slot's default       |
  | `given = {event: {target: Nope}}` | ok      | passes — the target is dropped either way |
  | `invariant = doubel(n) == n * 2`  | ok      | "counterexample at n = 0"                 |

  The last one is the sharpest: the property runner catches the trial's
  `doubel is not defined` and renders it as a falsified invariant, so the output
  accuses the code under test of a bug it does not have.

  A test body cannot simply be handed to `checkExpr`, because it is a schema:
  `event: {type: ui.click, target: B}` is an event pattern, `effects: [persist(x)]`
  is a list of effects rather than of calls, and `mocks: {persist: err("x")}` is
  neither. Each position is checked as what codegen lowers it as — a slot key is
  a slot, an `effects` entry is an effect (standard ones included), an event
  `target` is a tile when the trigger is a `ui.*` one, and everything the
  lowering evaluates is an expression. `docs/spec/testing.md` §8.1.1 is the table.

  Two positions are checked for _shape_, under the new **E0713**, because an
  unrecognised one is not ignored but re-interpreted: a `reducer-test` mock that
  is not `ok(...)` / `err(...)` / `delay(...)` became a _success_ mock, so a test
  asserting what happens when an effect fails passed without ever failing it; and
  an `expect.effects` that is not a list became the assertion that no effect was
  emitted, so a forgotten pair of brackets replaced the test rather than
  weakening it. Both throw at codegen too, so the check and the lowering cannot
  drift apart.

  `run-reducer` is refused outside a property-test invariant, where alone it can
  lower: elsewhere the generated module reads `_init`, which nothing binds, and
  the whole suite dies with `_init is not defined` before a single test reports.
  Its argument is counted and required to be a reducer name — `run-reducer("inc")`
  reached the runner as `reducer "" not found`.

  **A call's qualifier resolved to nothing.** `T.fresh()` / `T.parse(t)` /
  `T.show(v)` lower on any capitalised `T`, because codegen matches the shape by
  regex — and the checker took that as its own rule. `parse` branches on the
  qualifier, so a misspelling changed the value instead of failing:
  `Int.parse("12")` is `Some(12)` and `Itn.parse("12")` is `Some("12")`, which an
  `Int` slot then holds and every later sum concatenates. `fresh` and `show`
  discard it, so those are checked because a qualifier naming no type is wrong on
  its own terms. It is `E0117` now, with the sentence `resolveType` already
  produced, so `kumiki fix`'s did-you-mean over type names covers it — and
  `Int.pasre(t)` gets one too, built from the qualifier the author wrote.

  **Breaking**, in two places:

  - A test that named something undeclared no longer compiles: a slot key with a
    typo, a `ui.*` event target that is not a tile, the old
    `event: {kind: click, tile: B, id: none}` spelling (whose `kind` and `id`
    values name nothing), and the two shapes above.
  - `T.fresh()` and `T.show(v)` on an undeclared type are now `E0117`. Codegen
    ignores the qualifier for those two, so this rejects a program that ran
    correctly — `SessionId.fresh()` with no `type SessionId` is the shape to
    expect.

- Updated dependencies [82cfa6c]
- Updated dependencies [85a792b]
- Updated dependencies [3b1f5e8]
- Updated dependencies [7cce9ce]
- Updated dependencies [301b09a]
- Updated dependencies [3e33233]
- Updated dependencies [f04b1c5]
- Updated dependencies [7a754ad]
- Updated dependencies [c11152b]
- Updated dependencies [080f358]
- Updated dependencies [d398cbc]
- Updated dependencies [79b221e]
- Updated dependencies [732cb16]
- Updated dependencies [b8bd5d9]
- Updated dependencies [4de2473]
- Updated dependencies [db8e843]
  - @kumikijs/compiler@0.13.0
  - @kumikijs/runtime@0.13.0
  - @kumikijs/vite@0.6.0

## 0.7.0

### Minor Changes

- 35df48f: feat(cli): adopt commander and split kumiki.ts by verb (#163).

  - Replaces the 600-line hand-rolled `switch` in `packages/cli/src/kumiki.ts` with a commander program. Each verb now lives in `packages/cli/src/commands/<verb>.ts` and registers itself with the top-level program; the entry file is a thin wire-up.
  - Adds `--body-file <path>` to `kumiki add` and `kumiki replace` (and `--patch-file <path>` to `kumiki edit`). The flag accepts `-` for stdin. Multi-line bodies are preserved verbatim — the positional form still exists for back-compat but collapses whitespace, so multi-line definitions should go through `--body-file` from now on.
  - `kumiki --help` and `kumiki <verb> --help` are auto-generated by commander instead of the previous hand-written `usage()` block.
  - `--strict-a11y` / `--strict-icons` / `--strict-selector-id` are declared in a single shared helper so `check` and `dev` cannot drift on their flag surface.
  - Programmatic API (`@kumikijs/cli`) is unchanged: library functions (`addDef`, `smokeCmd`, `replayCmd`, …) still live in the thematic modules and index.ts re-exports them from the same paths.
  - Spec: `docs/spec/ai-edit.md` §9.2.2 and its Japanese mirror document `--body-file` / `--patch-file`.

- 46bee64: feat(cli): `kumiki fix --auto-patch` repairs more than an exactly-one-literal
  match (#156).

  `planTestPatch` gains scope-aware disambiguation, non-string leaves, string
  prefix/suffix repair, and reducer arithmetic; `planFixes` gains close-name
  suggestions for E0106 / E0107 / E0209 / E0211 and capability injection for
  E0301.

  Two guarantees came out of the review and are worth stating, because they are
  what makes the wider coverage safe to run unattended:

  - **Nothing broken reaches disk.** A composed patch that fails to parse, or that
    raises the diagnostic set, is rolled back before the write and reported as
    `regressionBlocked`. The gate compares diagnostics by `code@line:col` rather
    than by count, so a 1-for-1 swap (`E0301` → `E0302` via a typo'd cap) is
    caught rather than counted as an improvement.
  - **Suggestions stay in scope.** A did-you-mean is only offered from the
    namespace the diagnostic is about, never from the top-level definition list.

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

- 46bee64: feat(cli,compiler): E0106 and E0209 are auto-patchable again, each from its own
  scoped candidate set (#176).

  Both were pulled out of `kumiki fix --auto-patch` when it turned out their
  did-you-mean fell back to the top-level definition list — a scope that has
  nothing to do with either diagnostic, and that could rewrite `stop-timer("x")`
  to an unrelated identifier. They return with candidates drawn from the right
  namespace instead:

  - **compiler** exports two pure AST walkers, `collectTimerNames` and
    `variantTagsOf`. Both read a `Program` without re-typechecking it.
  - **cli** generalises `suggestName` to any candidate iterable, wires E0106 to
    the timer names and E0209 to the scrutinee union's variant tags — `Option` and
    `Result` built-ins plus user `TypeDef` bodies, resolved through alias, nominal
    and refinement wrappers.

  The auto-patch coverage table flips both back to `yes`, and the scope-safety
  invariant (a top-level name is never picked when only a timer or variant scope
  is valid) is pinned by tests rather than by the doc comment alone.

- fb02913: feat(mcp): add apply / auto-patch / test / episode bridges to close the AI fix loop (#155).

  - mcp: `kumiki_fix` gains `apply` / `only` / `capabilities` options. With `apply: true`, patches are written to disk and the tool returns `{ applied, before, after, remaining }` (plus `parseError` when the composed patches broke syntax). Default remains dry-run so existing agents keep their safe default.
  - mcp: new `kumiki_auto_patch` tool wraps `kumiki fix --auto-patch <test-name>`. Returns a structured `FixFromTestOutcome` (`status` in `{already-pass | proposed | applied | compile-proposed | compile-remaining | no-patch | not-found}`). On `apply: true` runs, the `regressed` field is always populated so regression detection is baked into the tool output.
  - mcp: new `kumiki_test` tool wraps `kumiki test`, returning `{ total, passed, failed, results }` with optional `filter` (name or `prefix*`).
  - mcp: new `kumiki_episode_list` / `kumiki_episode_tail` tools read `<file>.kumiki-episodes.jsonl` sidecars. `list` returns compact summaries (`id`, `trigger.kind`, `trigger.target`, `status`, `steps`), newest first; `tail` returns full episode JSON, newest first.
  - mcp: `kumiki_check` gains `strictA11y` / `strictIcons` / `strictSelectorId` toggles (the same set the CLI's `--strict-*` flags surface). With `path` + `strictIcons`, `@kumikijs/icons` is resolved to widen the icon-name domain.
  - mcp: `kumiki_run_scenario` description updated to name the loop-closing tools (`kumiki_auto_patch` and `kumiki_fix` with `apply: true`), so the generate → run → observe → **fix** loop is fully documented at the tool surface.
  - cli: `fix.ts` and `smoke.ts` split into pure computation (`planFix` / `applyFixPlan` / `runFixFromTest` / `runTests`) and CLI printers (`fixCmd` / `fixFromTest` / `testCmd`). MCP handlers reuse the pure variants so stdio protocol is never polluted by CLI stdout. Existing CLI behavior is unchanged.

- 46bee64: feat(runtime,cli): a recorded panic keeps its stack, its `Error.cause` chain,
  and where it was caught (#162).

  A caught throw was reduced to its message, so the episode log said _that_
  something panicked and nothing about _where_. Every catch site now routes
  through `panicInfo(e, category)`, which captures `.stack`, walks `Error.cause`
  into a JSON-safe chain (depth-capped at 8, cycle-safe), and tags the origin —
  `reducer` / `effect` / `capability` / `tile-render` / `hydrate` / `unknown`.

  The fields ride along as optional keys on the episode log's panic step, so logs
  written before this still parse and the reserved categories can be wired to new
  catch sites without a schema break. SSR's reducer path and the replay executor
  carry the same fields as the live path, and `kumiki replay` renders a panic as a
  `[panic:<category>]` header with indented stack and `Caused by:` blocks, falling
  back to the single-line form for older logs. `reportPanic`'s
  `[kumiki] panic in …` header is unchanged, so smoke/scenario greps still match.

  Spec: `docs/spec/runtime.md` §10.5.1, `docs/spec/lifecycle.md` §7.2.3 — including
  the forward-compat contract that stack and cause stay in the episode log and
  never reach a reducer's `$event` payload.

- 687ae40: feat(runtime): dev-mode observability for the reconcile diff, and a fix for the
  patcher registry that never reached built apps (#206).

  **Fix, and the reason the rest of this exists.** The per-app DCE path in
  codegen assembled the tile renderer registry (`_tiles`) but never the companion
  patcher registry, so every `kumiki build` artifact mounted with
  `tilePatchers` defaulting to `{}`. With no patcher for a kind the reconcile
  rebuilds the whole subtree on any data-prop change, which discards exactly the
  browser-owned state the in-place patch exists to keep: input focus and caret,
  `<select>` open dropdown, `<video>` playback position, `<details>` open,
  contenteditable caret. Nothing caught it because the verified corpus and the
  reconcile suite all mount through the monolith entry, which merges the full
  patcher set itself. The guard now drives a real build artifact and asserts
  element identity survives a data change.

  **`MountOptions.onDiagnostic`** opts into seeing the reconcile's
  identity-losing decisions. Same shape as `episodeLogger`: absent by default, so
  a production mount pays one optional call per fallback and never runs the
  stale-closure scan. There is no build-time flag — a production mount is silent
  because it did not opt in.

  - Reported: `no-patcher`, `child-count-change` (with the old/new counts),
    `child-hole` (with the index), `child-unmapped` (with the index and the
    child's kind). Each also names the tile — kind, authored `tile` name, and
    the same `id` the episode log uses.
  - Deliberately not reported: a `kind` change (a different thing occupies that
    position, so there is no identity to preserve) and a patcher declining via
    `PatchRequiresRebuild` (a normal outcome that sentinel exists to keep out of
    the log).
  - `stale-closure-risk` fires on the _reuse_ decision for host-registered tile
    kinds, where the prop-equality kernel's "any two functions are equal" rule
    can leave a captured handler firing forever. Built-ins route handlers through
    per-element slots and are exempt. A host sink that throws is swallowed: a
    diagnostic must never be able to change the render it observes.

  **Consumers.** `SmokeReport.diagnostics` (new, non-fatal — each entry carries
  the phase and trigger that provoked it) plus `SmokeOptions.diagnosticsAsIssues`
  and `kumiki smoke --diagnostics-as-issues` for the strict reading.
  `StepResult.diagnostics` (new) attributes churn to the scenario step that
  caused it, and `kumiki run` prints it under that step. `kumiki dev` warns on
  fallbacks and errors on stale closures — they are different severities.

  **Spec** — `docs/spec/runtime.md` §10.3.12 with a JA mirror, and
  `packages/examples/features/58-unkeyed-conditional-rebuild.kumiki` showing the
  unkeyed shape that pays for a rebuild next to the keyed one that does not.

### Patch Changes

- 46bee64: fix(cli): `kumiki fix`'s arithmetic tier bails on an operand it cannot represent,
  rather than splicing a silently-rounded result (#180).

  `planArithmeticPatchExplained` guarded with `Number.isFinite`, which a
  20-digit operand passes — and the lexer accepts arbitrary digit strings, so that
  operand is reachable from ordinary source. It now guards with
  `Number.isSafeInteger` and reports `non-safe-integer-operand`.

  Also: the `"(?:[^"\]|\.)*"` string-literal regex, which had been written out
  twice, is consolidated into one `iterStringLiterals` helper feeding both
  `stringLiteralSpans` and the partial-string tier; and `combinedExcluded`'s
  bounds are tightened to `> lo && +len < hi`, which is the "inside the body, not
  the quotes" rule it was always meant to express.

- 75a809b: fix(cli, mcp): escape-normalized partial-string repair + structured `writeError` surfacing.

  Robustness follow-ups from the prior review round.

  - **Escape normalization.** `planPartialStringPatchExplained` compared decoded `TestResult.leaf` values (`\n` as a real newline, `\"` as a quote, …) against raw source-literal bodies (`\n` as two chars). Any Kumiki source literal spelling an escape — `\n \t \r \" \\` — could either silently bail with `no-string-literal-contains-mida` or, worse, splice the divergent middle into the raw body and re-encode, corrupting untouched escapes (e.g. an existing `\n` doubled to `\\n`). The tier now decodes each literal body via a private `decodeKumikiStringBody` helper (lockstep with the lexer's escape set) and does its `midA` comparison, splice, and `kumikiStringLit` re-encode entirely in decoded space, so escapes round-trip canonically.
  - **I/O error surface.** The three `writeFileSync` sites in `applyFixPlan` / `runFixFromTest` used to leak EACCES / ENOSPC / EBUSY as raw stacks — asymmetric with the same file's `parseError` / `regressionBlocked` / `testRunError` structured returns. Every write now goes through a new `atomicWriteFileSync` helper (`.kumiki-tmp` staging + `renameSync`) so a mid-write ENOSPC leaves the target byte-identical instead of truncating it. `FixApplyResult` gains an optional `writeError?: string` modifier; `FixFromTestOutcome` gains a `write-failed` variant with `phase: "compile" | "test"` discriminating the two write sites (and preserving the proposed `patch` on `phase: "test"`). `fixCmd` fails loudly on stderr and sets `process.exitCode = 1` on write failure. `kumiki_fix` (MCP) surfaces `writeError` / `regressionBlocked` on the wire alongside `parseError`. `kumiki_auto_patch` documents the new status. Both consumer switches gain `default: never` exhaustiveness guards.

- 88bd531: fix(cli): skip self-matches in `suggestNameFrom` and expand `planTestPatch` test coverage (#178).

  - `suggestNameFrom` now skips a candidate whose Levenshtein distance to the missing name is 0 during the sweep, rather than latching onto it and later bailing. This preserves the "no `replace X with X` no-op patch" guarantee while still surfacing a genuinely close alternative when one exists (e.g., missing `"App"` with candidates `["App", "AppTile"]` now correctly proposes `"AppTile"`). Motivated by defending against transient compiler-message drift or future diagnostics that could legitimately quote an existing def name.
  - Adds targeted tests to `packages/cli/test/ai-edit.test.ts` for previously-untouched paths in `planTestPatch`:
    - The multiplicative-tier positive branch (`count := count * newN`), which had zero coverage.
    - The `n === 0` side of `multiplicative-zero-guard` (the existing test only exercised `actual === 0`).
    - A distinct instance of `multiplicative-nonintegral-solution` as a canary against future regex narrowing.
    - The `top.length !== 1` bail in `planPartialStringPatch` for both rank-0 (target scope) and rank-1 (deps scope) ties, complementing the existing rank-2 case.
    - Self-match regression pin (`missing` equals the only candidate) and an alternative-preservation pin (self-match must not eclipse a close alternative).

- cad3f0c: feat(runtime): report a tile whose data props can never compare equal, closing
  the one way to burn a render budget that the diagnostics channel could not see
  (#219).

  **The gap.** `onDiagnostic` reported every decision where the walker _loses_
  identity — `no-patcher`, `child-count-change`, `child-hole`, `child-unmapped`,
  `wrapped-children`, `unplaceable-insert`. All of them fire on a rebuild path.
  A tile whose data props compare unequal on every render while a patcher is
  registered for its kind is the identity-preserving happy path as far as the
  walker is concerned: the patcher runs, the element survives, nothing degraded,
  so nothing was reported. The app is correct and looks healthy; it is just
  re-applying the same attributes forever.

  **`never-equal-prop`** is the mirror image of `stale-closure-risk` on the other
  side of the equality fork. It reads the unequal decision for a value that could
  not have compared equal however identical the two renders were, and names the
  field: a non-plain object (`Date`, `Map`, `Set`, `RegExp`, a DOM node, a class
  instance, or a cross-realm object — only `===` can make two of those equal) or
  `NaN`. Same `hostTileKinds` scope and the same one-level-into-`props` bound as
  the stale-closure scan, so a built-in never produces one and the walk stays
  bounded on the render path. Neither cause can come out of codegen; the whole
  class is reachable only through `MountOptions.tiles` or a host-built tree, which
  is exactly the audience this channel exists for.

  Both host-tile scans are now guarded as a whole rather than only at the sink.
  Reading a host node's fields runs `Object.keys`, property getters and
  `Object.getPrototypeOf` against values the host owns, and the equality kernel
  short-circuits at the first difference — so a Proxy trap or an accessor can
  throw where the kernel never reached. That throw would have landed in the
  reconcile bailout as a panic and rebuilt the whole tree, which is the identity
  loss the channel exists to report. The scan is abandoned instead.

  - Fires whether or not a patcher is registered. With one it is the only signal
    that the tile churns; without one the rebuild is already reported as
    `no-patcher` and this names the field that reason cannot. Both are emitted,
    cause before consequence.
  - A value reports only once both sides are of the same never-equal shape — a
    plain bag becoming a `Date` is an ordinary change on the render it happens and
    reports on the next one. The same instance handed over twice compares equal
    through `===` and is never reported.
  - A mount without `onDiagnostic` runs the pre-existing code path plus one `?.`
    check, unchanged.

  **Consumers.** `describeDiagnostic` gains wording per cause, with the same
  `never`-typed exhaustiveness tripwire `describeFallback` carries. `kumiki dev`
  warns rather than errors — the running code is correct, only wasteful.
  `kumiki smoke`'s per-reason summary now labels every non-fallback diagnostic by
  its kind instead of assuming any non-fallback is a stale closure, so a future
  kind cannot be silently counted as an existing one.

  **Spec** — `docs/spec/runtime.md` §10.3.12 documents the kind and its two
  causes, and §10.3.13's non-plain-object and `NaN` rules link to it. The JA
  mirror gains both, including §10.3.13 itself, which had never been translated.

- Updated dependencies [46bee64]
- Updated dependencies [5fb6fb6]
- Updated dependencies [353cd5c]
- Updated dependencies [46bee64]
- Updated dependencies [027a8af]
- Updated dependencies [3d89383]
- Updated dependencies [cad3f0c]
- Updated dependencies [46bee64]
- Updated dependencies [4a58f8f]
- Updated dependencies [32dd683]
- Updated dependencies [687ae40]
- Updated dependencies [92ca76d]
- Updated dependencies [6f3f3e3]
- Updated dependencies [9ae4327]
- Updated dependencies [46bee64]
- Updated dependencies [49cafdb]
  - @kumikijs/compiler@0.12.0
  - @kumikijs/runtime@0.12.0
  - @kumikijs/vite@0.5.1

## 0.6.0

### Minor Changes

- 07e9c6b: feat(runtime,compiler,cli): episode logger (§10.5) + `episode-test` (§8.6) (#90).

  - runtime: new `createEpisodeLogger` (in-memory ring buffer + opt-in localStorage mirror) plus `MountOptions.episodeLogger` hooked into every reducer / effect-start / effect-end / signal-update / panic seam. Mounted apps expose `app.episodes()` (§10.7). Volatile slots are excluded from `slot-diffs` per language.md §175.
  - runtime/testkit: new `_stdlibTest.runEpisodeTest` — replays the logged trigger → reducer chain, resolves effects via `from-log` / `ignore` / `ok(v)` / `err(e)` mocks, and asserts `slots-equal: from-log` / `no-panics` / `no-errors`.
  - compiler: `episode-test` added to AST / parser / typecheck / codegen. The log fixture is read at compile time via the injected `readEpisodeLog` (Node helper `nodeEpisodeLogReader`) so the runtime never touches the filesystem.
  - cli: `kumiki run --episode-log <file>` now emits real per-trigger §10.5.1 episodes instead of the placeholder one-scenario-step records. `kumiki test` wires `readEpisodeLog` automatically when an `episode-test` is present.
  - examples: new `packages/examples/features/44-episode-test.kumiki` + fixture.

- 07e9c6b: feat(cli): `kumiki dev` — Vite dev server + episode timeline panel (#118).

  New `kumiki dev <file>` verb boots a Vite dev server that compiles the source `.kumiki` on-the-fly, remounts the app across HMR without losing the in-flight episode, and exposes a browser-side episode timeline panel for step-through inspection.

  - cli: `packages/cli/src/dev.ts` orchestrates the Vite server; middleware serves the compiled bundle non-silently on errors. HMR remount catches listener leaks by cleaning up before remounting.
  - cli: `packages/cli/src/dev/panel.ts` renders the timeline overlay; `dev/client.ts` streams episode events to it.
  - tests: CLI dispatch test widened to 30s for tsx cold start.

- 07e9c6b: feat(cli,runtime): `kumiki replay` — interactive episode replay (§10.5.3) (#117).

  - cli: new `replay` verb. `kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]` replays a recorded episode log against a compiled app and streams the per-step trace (reducer / effect-start / effect-end / signal-update). `--mock` is repeatable; values follow §8.6's `from-log | ignore | ok(<json>) | err(<json>)` grammar. `--until-step` halts after the Nth observed step (1-indexed, global across episodes) and prints the slots at that moment.
  - runtime/testkit: extracted the per-episode executor that already powered `runEpisodeTest` into a shared `executeEpisode` and exposed it through a new `replayEpisodes` export. Both the assert-based test runner and the CLI trace formatter call the same engine — `from-log` cursor, refine ward, and unhandled-error accounting can no longer drift between them.
  - compiler: `parseEpisodeLogText` is now exported from `@kumikijs/compiler/node` so CLI tooling can consume `kumiki run --episode-log` output without going through codegen.

- 07e9c6b: feat(compiler,cli,vite): `--strict-icons` to flag unknown `icon(name=...)` at check time (#127).

  Kumiki ships a built-in icon set but rendering an unknown `name=` silently fell back to an empty placeholder. `--strict-icons` promotes the runtime silence into a compile-time error so typos and dropped icons are caught during `kumiki check`.

  - compiler: `check()` gains a `strictIcons` option; `E02xx strict-icon-unknown` is emitted when `name=` is not a member of the built-in set.
  - cli: `kumiki check --strict-icons` and `kumiki build --strict-icons`.
  - vite: `strictIcons: true` plugin option.
  - spec: `docs/spec/errors.md` and `docs/spec/style.md` document the strict gate.

- 07e9c6b: feat(compiler,cli,vite): `--strict-selector-id` to flag `TileName#id` typos at check time (#149).

  `E0212 selector-id-mismatch` is now emitted (opt-in via `strictSelectorId`) when a reducer subscribes to `Tile#id` but every declaration of `Tile` has a **literal** `{id: "..."}` that does not match the selector's id — the reducer would otherwise silently never fire at runtime. Tiles whose `{id}` is computed are deliberately exempt so the runtime filter remains the authority for dynamic ids.

  - compiler: `check()` gains `strictSelectorId`; `E0212` mirrors the existing `strictIcons` / `strictA11y` gate pattern.
  - cli: `kumiki check --strict-selector-id` and `kumiki build --strict-selector-id`.
  - vite: `strictSelectorId: true` plugin option.
  - spec: `docs/spec/errors.md` documents `E0212` alongside the runtime-filter fallback for dynamic ids.

### Patch Changes

- 07e9c6b: feat(compiler): `W0212 ui-event-subscription-mismatch` — warn on `ui-event` subscriptions that cannot fire (#143).

  When a reducer subscribes to a `ui-event` on a tile that cannot emit it (e.g. `ui.submit(DivTile)` or `ui.focus(NonFocusableTile)`), the compiler now emits `W0212` instead of silently generating a handler the DOM will never invoke. The rule consults the ui-event implicit-lift table (single source of truth in `packages/compiler/src/ui-lifts.ts`) to decide whether the subscription is admissible.

  - compiler: `checkReducer` cross-references the target tile's kind against the ui-event's admissible tile set.
  - runtime / cli / vite: no behavioural change; the diagnostic surfaces through the standard `check` gate and Vite overlay.
  - spec: `docs/spec/errors.md` and `docs/spec/stdlib.md` document `W0212`; `docs/spec/language.md` cross-links to the ui-event lift table.

- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
  - @kumikijs/runtime@0.11.0
  - @kumikijs/compiler@0.11.0
  - @kumikijs/vite@0.5.0

## 0.5.1

### Patch Changes

- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
  - @kumikijs/compiler@0.10.0
  - @kumikijs/runtime@0.10.0

## 0.5.0

### Minor Changes

- 7e589bc: Per-app dead-code elimination for `kumiki build` (#71). The runtime is now
  composed of granular feature modules — `core` (mount/dispatch/theme/render
  seam), `stdlib`, `testkit` (the reducer/property/tile test harness),
  `router`, `effects-{storage,http,toast}`, and seven `tiles-*` renderer
  families — published as `@kumikijs/runtime/modules/*` (minified ESM).
  Codegen tracks which built-in tiles, effects, and routing features an app
  uses and, in the new `runtimeModulesDir` mode, imports only those modules,
  mounting through the new `mountCore` (the classic `mount`, merged
  `_stdlib`, `builtinEffects`, and the `./bundle` / `./bundle.min` artifacts
  are unchanged). `kumiki build` ships `runtime/` with exactly that pruned
  set instead of a monolithic `runtime.js`: the counter example drops from
  50KB/15.2KB gzip to ~27KB/~9KB gzip and carries no router, table/overlay
  tile, effect-handler, or test-harness code. The router ships only when the
  app can actually navigate (nav caps, `navigate*` emits, `link` /
  `route-outlet`, redirects, or routes beyond the `"/"` + `"/404"`
  boilerplate) — a static single-route app never reads the URL, so a deep
  link to an unknown path renders the root tile rather than the 404 tile.

### Patch Changes

- c40b121: Ship a minified runtime to built apps. `@kumikijs/runtime` now emits two
  artifacts: `./bundle` (unminified — still what codegen inlines for
  smoke/run/test and the playground, where readable traces matter and the
  inliner relies on stable top-level names) and the new `./bundle.min`
  (minified ESM). `kumiki build` writes `bundle.min` as the app's
  `runtime.js`, cutting it from 90KB/24.8KB gzip to 50KB/15.2KB gzip. The
  package also declares `sideEffects: false`, so bundlers consuming
  `@kumikijs/runtime` through `@kumikijs/vite` can tree-shake unused exports.
  A new CLI test mounts the exact built artifact pair in a headless DOM to
  guarantee runtime parity.
- a27e63c: Replace jsdom with happy-dom as the headless DOM behind `kumiki smoke` / `run` /
  `test`. jsdom pulled ~40 transitive packages into every CLI install; happy-dom's
  `GlobalRegistrator` provides the same DOM globals with a handful of dependencies
  and also replaces the hand-rolled realm patching (Node's own `Event` /
  `navigator` globals vs the DOM realm) that jsdom required. Verification behavior
  is unchanged — the whole example corpus passes check + build + smoke + scenario
  runs on the new environment.
- Updated dependencies [c40b121]
- Updated dependencies [7e589bc]
- Updated dependencies [c4833bd]
  - @kumikijs/runtime@0.9.0
  - @kumikijs/compiler@0.9.0

## 0.4.1

### Patch Changes

- Updated dependencies [3ee1a9a]
  - @kumikijs/compiler@0.8.0
  - @kumikijs/runtime@0.8.0

## 0.4.0

### Minor Changes

- 33fc749: v0.6 M4 (#52) — `kumiki test` runner polish (`spec/testing.md` §8.7). Per-test timings on every line (`(1ms)`; property-tests add `(100 cases, 23ms)`); `--coverage` reports per reducer/effect/tile what the suite exercises and lists the uncovered (computed statically by codegen into `globalThis.__kumikiCoverage`); `--watch` re-runs the filtered suite on `.kumiki` change (debounced, clean Ctrl-C exit). Completes the v0.6 testing-DSL milestone.

### Patch Changes

- Updated dependencies [afe1b15]
- Updated dependencies [e92f5df]
- Updated dependencies [33fc749]
  - @kumikijs/compiler@0.7.0
  - @kumikijs/runtime@0.7.0

## 0.3.4

### Patch Changes

- Updated dependencies [cd1e88a]
  - @kumikijs/compiler@0.6.0
  - @kumikijs/runtime@0.6.0

## 0.3.3

### Patch Changes

- Updated dependencies [20c8601]
- Updated dependencies [20c8601]
  - @kumikijs/runtime@0.5.0
  - @kumikijs/compiler@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
  - @kumikijs/runtime@0.4.0
  - @kumikijs/compiler@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [81d0791]
  - @kumikijs/compiler@0.3.1

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

### Patch Changes

- Updated dependencies [be38e20]
  - @kumikijs/compiler@0.3.0
  - @kumikijs/runtime@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [c0c1708]
  - @kumikijs/compiler@0.2.1
  - @kumikijs/runtime@0.2.1

## 0.2.0

### Minor Changes

- 77938ee: v0.2 — close the five spec-deferred features (M1–M5)

  - **M1 `stop-timer(name)`** — explicit named-timer stop; errors E0002 / E0106.
  - **M2 `overlay` builtin** — z-axis stacking (modals / toasts / dropdowns), `align` prop, composes with `when`.
  - **M3 plugin capability registration** — `kumiki.caps.json` manifest; unlisted caps are now a compile error (E0302).
  - **M4 `test` layer + `kumiki test` runner**, and **`kumiki fix --auto-patch <test-name>`** — in-language reducer-test / tile-test with PASS/FAIL + diff output, plus deterministic repair from a failing test.
  - **M5 `motion` layer** — reusable, closed-grammar, scoped animations referenced from a tile's `motion` prop; honors `prefers-reduced-motion`; errors E0107, E0401–E0403.

  See CHANGELOG.md for the full detail.

### Patch Changes

- Updated dependencies [77938ee]
  - @kumikijs/compiler@0.2.0
  - @kumikijs/runtime@0.2.0
