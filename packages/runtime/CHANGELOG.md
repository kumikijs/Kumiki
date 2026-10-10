# @kumikijs/runtime

## 0.14.0

### Minor Changes

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

- 1c1cb23: Check a refinement written inside a record, union or container at its path

  ```kumiki
  slot form : {email: Text where email, age: Int where between(0, 120)} = {email: "ada@example.com", age: 36}
  ```

  used to be emitted with no check at all: `form.email := "nope"` and `age := 999`
  both committed, with `check`, `build` and `smoke` silent. A predicate is now
  checked wherever in the type it is written — a record field, a union variant's
  payload, a `List` / `Set` element, a `Map` key or value, `Option` / `Result`
  payloads, a `Tuple` member — through names, generics and recursive types. A
  refused write discards its reducer's batch like any other, and the report names
  the predicate and where it failed:

  ```
  slot "form" cannot hold {"email":"nope","age":36} (email at .email)
  ```

  `error(field=form)` renders that predicate's message. A slot whose predicates
  all sit on its own type is emitted exactly as before.

  A value of the wrong shape at a position — a decoded `{}` where a list belongs,
  an untagged value where an `Option` does — is refused against that position's
  first predicate, rather than passing untested or throwing. A `Set` member that
  is not text or a number is not walked, because the runtime keys a set by the
  member's text. A generic that applies itself to a growing argument more than 32
  levels deep, with a refinement along it, is `E0803` at build time.

  `HttpStatus` is now `nominal Int where between(0, 599)`: a request that got no
  response (an abort, a `policy=latest` cancellation, a timeout, a network
  failure) reports `status: 0` (http.md §6.4.1), and a slot holding the
  `HttpError` has to accept it.

  For a host that builds `SlotMeta` itself: `refineFailure`, when present, is the
  whole gate (`slotAccepts`), and `RefinementFailure.path` is a list of
  `RefinementStep`s, `[]` for the value itself; `showRefinementPath` writes one
  the way the report does.

  **Upgrading:** a program that declares refinements inside its types now
  enforces them. A reducer that writes such a value — an empty `text` into a
  `{text: Text where nonempty}` element, say — is now rejected rather than
  committed; guard the write, or loosen the type.

  **Data persisted before the upgrade** is checked the same way when it comes
  back. Storage written by an older build can hold what the type now refuses — a
  `Map(TodoId, Todo)` keyed by a non-uuid id from the old `fresh()`, a todo whose
  `text` was saved empty — and the reducer that restores it (`todos :=
$m.get-or({})` in `02-todomvc`) is then rejected as a whole, including a
  `ready := true` in the same batch, so an app that waits on that flag stays on
  its boot screen. Before shipping, either migrate or clear the stored data, or
  restore it through a `fn` that drops the entries the type refuses.

- 8820b8e: Make every refinement predicate a check that can fail, stdlib nominals included

  `docs/spec/forms.md` §5.6 and `language.md` §1.3.3 present a refinement as a
  runtime check: the value is validated on its way into the slot, and a write that
  fails is refused. Five of the twelve predicates were. `refinementToJs` ended in

  ```ts
  default:
    return `(_v) => true`;
  ```

  so `positive`, `negative`, `email`, `url`, `uuid`, `regex` and `one-of` reached
  the runtime as a check that cannot fail:

  ```
  slot n : Int where positive = 5
  reducer bad on=ui.click(B) do= n := 0 - 7    # landed. n held -7.
  ```

  The standard library's refined nominals were worse, by a different route.
  `refinementJs` resolved a `TypeRef` through the program's own `type`
  definitions, and `Email`, `Url`, `Uuid` and `HttpStatus` are synthesised in
  `stdlib-types.ts` — so the lookup returned `undefined` before any predicate was
  considered, and `slot e : Email = "not-an-email"` emitted no `refine` and no
  `refineKind` at all. Every write was accepted, and `error(field=e)` on it
  rendered nothing, on a form whose whole purpose was to say the address is not
  one.

  All twelve now lower. What each tests is written down in §1.3.3 rather than left
  to the implementation: `positive` / `negative` are strict about zero, `email` is
  `local@host` with a dot in the host, `url` is absolute (a scheme and an
  authority — `kumiki.dev` is not one), `uuid` is the 8-4-4-4-12 shape in either
  case, `regex` is anchored so the pattern describes the **whole** value, and
  `one-of` is membership. A value of the wrong shape answers `false` rather than
  throwing.

  Codegen's type table is seeded with the standard library's definitions as well
  as the program's, which is what lets the walk over a type's `where` clauses
  reach them at all — so `slot e : Email`, `type Handle = Email` and
  `slot e : Text where email` are one guarantee written three ways.

  The `default` arm is gone in both directions. One table now holds the names the
  parser accepts and the lowering each has, so the two cannot drift; a registered
  predicate with no lowering is **E0803** `unimplemented-refinement` at build time
  (nothing is in that state — it is the guard for the next predicate added to
  §1.3.3). Arguments are checked too, as **E0804** `refinement-args-invalid`: a
  refinement no value can satisfy is the same defect as one every value satisfies,
  and an argument the predicate does not take produces one or the other —
  `between(5, 1)` and `len-eq(2.5)` refuse everything, `len-gt(-1)` accepts
  everything, `one-of()` has nothing to admit, and `regex("(")` is not a pattern.
  `between(0, "x")` is the sharpest of them: the emitted check read
  `v >= 0 && v <= x`, whose second half is a reference to a name nothing declares,
  so the first write threw a `ReferenceError`. A `regex` pattern is compiled twice
  — as written, then anchored — so one whose own parentheses would close the
  anchor group (`a)|(b`) is reported rather than lowered unanchored.

  Property-test generation moves with the runtime, since the two answer the same
  question from opposite ends: `email` / `url` / `uuid` generate an instance of
  the shape, `one-of` draws from the listed literals, and `negative` bounds the
  sign — a generator that ignored them would drive a property over states the app
  refuses to be in. `regex` has no constraint to fold and §8.3.2 now says so.

  `packages/examples/features/90-refinement-validation.kumiki` writes to each
  family from a reducer and its scenario asserts the refusal — the batch is
  discarded whole, the rejection is reported, and `error(field=…)` on a pristine
  `Email` slot renders its message.

  Named here rather than fixed here, from the review of this PR. A predicate over
  a base type it cannot test (`Text where positive`) refuses every write with no
  diagnostic, and `len-lt(0)` does the same through well-formed arguments (#440).
  Shrinking a property-test counterexample ignores the descriptor the generator
  honoured, so a minimised case can sit outside the domain `for-all` declares
  (#441). The refinements `stdlib-types.ts` declares never pass through the
  checker that would report them (#442). A `bind` the predicate refuses leaves the
  input and the slot disagreeing with no message, and the `strict` prop the spec
  offers as the escape hatch is unimplemented (#443). The generation descriptor
  is one wire format with two unrelated types (#445).

  **A program can stop working**, and it was already not doing what it said: a
  write these predicates refuse used to land silently, and now discards its
  reducer's batch ([runtime.md §10.3.3](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/runtime.md)).
  The repair is the one a reachable bound has always needed — guard the write, or
  widen the slot's type and refine at the boundary.

- fbbec02: Make a decoded value that `Decoder.Json(T)`'s `T` refuses the effect's `.err`

  `Decoder.Json(T)` lowered to a bare `"json"` sentinel, so nothing checked the
  decoded value against `T`. A restore of data the type refuses (a base-36 id
  from an older `fresh()` under `TodoId = nominal Text where uuid`, an empty
  `text` on `Text where nonempty`) answered `.ok`, the reducer's writes were
  refused as a batch (runtime.md §10.3.3), and `02-todomvc`, which sets `ready`
  in that reducer, stayed on its boot screen with nothing able to clear it.

  Now `Decoder.Json(T)` for a `T` that carries a predicate anywhere in it lowers
  to the walk a slot of type `T` is gated by, and the storage, session,
  IndexedDB and HTTP read handlers run it on what they decoded (http.md §6.1.4,
  §6.7.2). A refused value is `.err`: from storage, session or IndexedDB the
  `Text` its `out=` declares, such as `decode failed: uuid at .keys["k3j9x"]`,
  and from HTTP an `HttpError` with the
  response's status and text, which is not retried. A `T` with no predicate lowers to the
  sentinel as before. The check ships in a new `effects-decode` runtime module,
  only with the handlers that import it, so an app that decodes nothing (the
  counter) is unchanged.

  A host provider for a read capability receives the check as `decode` on the
  request. A scenario's scripted `.ok` stands for a value already decoded and is
  not checked.

  `apps/03-blog` decoded its stored session with `Decoder.Json(Option(Session))`,
  though a storage read already answers `Option` of what it decodes (http.md
  §6.7.2). The check now reads that `T` literally, so the example decodes
  `Session`. Its `saveSession` stored the `Option` wrapper that check refuses on
  the next boot; it now stores the `Session` itself, and logout emits a new
  `clearSession`, a key-only write that removes the entry.

- fac7523: Report a refused effect to the app

  `runtime.md` §10.4.2 defines the capability check in two clauses — "A violation
  is not executed **and is notified to `app.error`**" — and only the first was
  enforced. A violation reached `console.warn` and stopped:

  ```ts
  console.warn(`Capability "${cap}" not declared in app.caps`);
  ```

  No `app.error` reducer ran and no `panic` step landed. Worse, neither `smoke`
  nor `scenario` patches `console.warn` — they watch `console.error` — so an app
  whose only effect was refused mounted, rendered, and **passed** every
  verification tier. The compile-time half (E0301) catches the common case, which
  is exactly why the cases that reach the runtime (a host-built `AppShape`, a
  `caps` array edited after codegen, a provider that was supposed to register)
  were the ones a silent channel served worst.

  A refusal is now reported, in three places:

  ```
  [kumiki] panic in effect "save": capability "storage.write" is not declared in app.caps
  ```

  to `console.error`, where the tiers read; to the episode as a `panic` step with
  `category: "capability"` — the value the spec had already declared for it — so
  `kumiki replay` shows why nothing ran; and to `app.error`, which takes it as an
  ordinary `PanicInfo`:

  ```kumiki fragment
  reducer onPanic
      on=app.error
      do= lastError := Some($event)     # $event.category is "capability"
  ```

  Both the live dispatcher and the SSR pass report, in the same words, through
  one shared builder. What differs is what each can report _to_: `renderToString`
  has no `app.error` to fire, the same way a reducer panic on that pass is a
  `panic` step and nothing more, so on the server the console and the episode are
  the whole of it.

  The episode a refusal attaches to is the one that owns the emit, which is not
  always the one in focus. A deferred policy (`debounce`, `queue`) launches from
  a timer or a queue tail, long after the triggering episode closed, so the
  refusal is recorded against the episode that claimed the `effect-start` — and
  `episode-id` names it. Without that, a refused `debounce` left its episode
  holding an `effect-start` and an `effect-cancel` and nothing else, which is
  exactly what a _replaced_ timer looks like. The one emit with no episode to
  name is one from `app.init`, dispatched before the first episode opens; it
  reports to the console and to `app.error` carrying `episode-id: None`.

  **The bootstrap episode of a refused emit is now `status: "panic"`** rather
  than `"completed"`, because it carries a panic step — which is what that status
  means on the live path too. Where a refusal records both a `panic` step and an
  `effect-cancel`, the panic comes first: the cancel settles the episode (a step
  appended after it lands on one already handed to `onEpisode` and the
  localStorage mirror), and the reason reads ahead of the consequence.

  One consequence worth naming: the `kumiki dev` error overlay raises on an
  episode whose status is `"panic"` _and_ whose last step is a `panic`, so a
  refusal under the default policy now raises it where it previously did not.
  One whose `panic` step is followed by an `effect-cancel` — the SSR bootstrap,
  and a deferred-policy refusal — still does not, exactly as before.

  §10.4.2 now says all of this instead of one sentence, in both language tracks.
  `docs/spec/runtime.md` §10.5.1 and `lifecycle.md` §7.2.3 said the opposite —
  that `capability` was a value reserved for a callsite not yet wired — and now
  say it is wired; so do the `PanicCategory` declaration and E0301's rationale,
  which still described the console warning that is gone. The JA track has no
  §10.5.1.1, so `runtime.md`'s JA diff is the §10.4.2 hunk alone; `lifecycle.md`
  and `errors.md` are fixed in both.

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

- c858728: A Set literal is a Set (stdlib.md §2.2.2).

  A list literal written where a `Set` is declared lowered to a JavaScript array, while every Set member reads a Set as `{ [key]: true }`. So `slot s : Set(Int) = [5]` answered `s.has(5)` with `false`, `[5, 5]` had size 2, `s.add(5)` made the mix `{"0": 5, "5": true}`, and a reducer-test whose `given` / `expect` slots held Set literals compared an array with an object. `check` said `ok`.

  The checker marks a list literal it checks against a `Set` type, and codegen builds it with `_s.setOf` (new in the runtime), the same value `add` builds from those members. That is every position the checker reads against a type: for example a slot, a record field, a `fn` parameter or return value, a reducer write, a `let … in` body, an element of a `List(Set(T))` or a value of a `Map(K, Set(T))`, the argument of `List.contains` / `push` / `prepend` and the value of `Map.insert` / `update`, and a test's slot values, expected effect arguments and mocked results. A `<any-id>` member of a Set literal in a reducer-test `expect` pairs with one generated member. Where the checker cannot type the receiver — `$1` in a fragment over a `List(Set(T))` — a literal argument stays an array.

  New diagnostics on programs `check` used to accept:

  - The argument of `union` / `intersect` / `diff` is checked against the receiver's `Set(T)`: a `List`, a `Set` of another element type or an `Option(Set(T))` there is E0201.
  - The argument of `List.contains` / `push` / `prepend` is checked against the element type, and the value of `Map.insert` / `update` against the value type (E0201).
  - A test's slot values are checked against the slot's type, an expected effect's argument against its `in=` type, and a mock's payload against its `out=` type (E0201 / E0214 / E0215), as a slot initializer already was.

  A Set literal of records or variants now holds what the `add` chain of the same members holds: today those members are keyed by their string form, so `[{x: 1}, {x: 2}]` has one member where the array had two. How structured members are keyed is tracked in #658.

- 8d3595f: A scenario step that drives a control the platform would refuse now fails, naming the control and the reason, instead of passing (#369).

  `fill` on a `disabled` input moved the slot and ran the `ui.input` reducer, because the runner wrote the value and dispatched the event itself — so `disabled` never entered the picture. A scenario asserting a guard held was green having tested nothing.

  All three drivers — both verification tiers and `kumiki smoke` — now ask one rule before a verb drives a control (`controlFault` / `readControl`, beside `dispatchFault`): `disabled` refuses every verb that drives one, `readonly` and an `editable`'s `contenteditable="false"` refuse the typing alone. `hover` is deliberately outside the rule — Chromium fires `mouseenter` on a disabled control, measured rather than assumed. The rule cannot be left to the browser: Chromium refuses a real click on a disabled control but delivers a dispatched one, and dispatching is what a driver does.

  `expect.actionErrorIncludes` is the new key that asserts a refusal, so "this button is disabled and clicking it does nothing" is expressible rather than merely green. It matches the refusal alone, not the whole `actionError` channel, so a step cannot claim one on a selector that matched nothing. `kumiki run`'s trace prints a claimed refusal as `expected refusal:`.

  The rule resolves in both directions: a verb aimed at the `<label>` `check` / `radio` / `switch` render is judged by the `<input>` inside it, and a verb aimed at something inside a disabled control — the spinner a `loading` button renders — is judged by that control, since the dispatched event reaches it.

  `kumiki smoke` asks the same rule, and no longer fires at a control a user could not reach.

- fbbec02: A failed storage / session / indexed effect now delivers the `Text` its `out=Result(T, Text)` declares to `.err`, `$e` there is typed `Text`, and declaring any other `E` on these effects is the new E0306 `err-type-not-text` (#504).

  The spec declares these effects' failure as `Text`, but the handlers delivered a `{message: …}` record. A reducer written to the declaration, `problem := $e`, rendered `[object Object]`; one written to the runtime, `$e.message`, contradicted the declared type, so `$e` had to stay unchecked.

  The handlers in `effects-storage.ts` and `effects-indexed.ts` now deliver the failure's message itself (`"Error: storage blocked"`, `"app.indexed-db is not declared"`), and read the storage global and the request inside their own `try`, so a `SecurityError` from the `localStorage` getter or a missing request is that `Text` too. Codegen runs everything in such an effect's invoke inside a `try` — the `map-request`, the host provider and the built-in handler, awaited — and reads every err value, returned or thrown, through one normalizer: a `Text` is itself, an `Error` is `Name: message`, a record with a `Text` `message` is that `message`, anything else is its JSON text. A throw caught there is marked `final`, so `retry=` makes one attempt for it, as it did when the throw reached the dispatcher.

  `.err($e, _)` on one of these effects binds `$e : Text`, so `$e.message` is E0108 and `n := $e` into an `Int` slot is E0201. A program that read `$e.message` must read `$e`, and one that declared `out=Result(T, {message: Text})` must declare `Result(T, Text)`. A host provider for `storage.*` / `session.*` / `indexed.*` should return its failure as a `Text`. HTTP effects are unchanged: they still deliver the `HttpError` record, and `.err` on HTTP and custom capabilities stays unchecked.

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

- 8f7b051: An index write into a `List` leaves a `List`, an index into a `List` is an `Int`, and an index write into a `Set` is refused (#462).

  `xs[i] := v` on a `List` replaced the list with an object keyed by its indices: the setter shared by reducer assignments and `bind=` write-back ended every step with an object spread, and `{...[1, 2, 3]}` is `{"0": 1, "1": 2, "2": 3}`. `check` said `ok`, and every reader after the write — `.length`, `.head`, a `for`, the state a scenario asserts — saw something other than a List.

  The setter now copies a List and replaces the element at the index, at any depth, so `rows[1].n := 9` and `grid[1][0] := 0` keep every level's shape. An index that names no element — past the end, or negative — is a panic, as lifecycle.md §7.2.2 already listed: the reducer's writes roll back, the episode log records it and `app.error` runs. The read `xs[i]` panics at the same indices instead of reading `undefined`, so both sides of `:=` agree; `xs.get(i)` still answers `None`. An index that meets no List at all — a missing value, or a missing element to write through — panics too, rather than building `{"0": v}` or a partial record. The `Map` and record paths are unchanged.

  A `List` index is checked against `Int` on both sides of `:=`, so `xs[k]` with `k : Text` or `k : Float` is E0201 rather than an index that names nothing at run time.

  A `Set` has membership and no places, so `tags[x] := v` is now E0602, the code a member write already gets, and the message points at `.add` / `.remove` / `.toggle`.

- 3aae0ea: Write through `.get` into the payload instead of a field named `get`

  `language.md` §1.6.3 documents assignment through `.get` — `draft.get.title := v`
  — and says a write against a `None` is a no-op. A write against a `Some` was
  not a write at all: the lvalue was flattened into a plain field path, so the
  assignment set a sibling field named `get` beside `_tag` / `_0` and left the
  payload untouched. The read side has always lowered `.get` through the
  polymorphic unwrap, so the same path read correctly and wrote wrong — the
  editor in `03-blog` typed into a field nothing read back.

  **A write that used to do nothing now edits the payload.** An app that reads
  the phantom `get` field, or that relied on the payload not changing, changes
  behaviour.

  **And a `bind=` through `.get` now panics while the value is empty.** It used
  to walk the path defensively and hand the control an empty string; it reads
  through the same unwrap as every other `.get` now, so `input(bind=draft.get.title)`
  with `draft = None` fails during the first render and the app does not mount.
  Reach the control through a `match` on the Option. This is the more disruptive
  half of the change for an app already written against the old behaviour.

  Both spellings are fixed together and now share one implementation: the
  assignment a reducer lowers to and a `bind=` path's write-back both call the
  runtime's setter, so they cannot disagree about what a path means. A `.get`
  segment travels as `{get: true}` in `TileNode.bindPath`, which widens from
  `string[]` to `(string | {get: true})[]`.

  The name stays dispatched rather than reserved: on a record that declares a
  field named `get`, both sides still resolve it as that field. `Result` is
  covered the same way `.get` covers it when read — an `Ok` payload is edited, an
  `Err` is skipped.

- d029b60: Supply every field of `PanicInfo`

  `PanicInfo` declares five fields and the runtime supplied three. `episode-id`
  and `cause` were never written, so a program that read them got JavaScript's
  `undefined` — through `+`, that renders:

  ```kumiki fragment
  reducer onPanic
      on=app.error
      do= caught := "episode " + $event.episode-id
  ```

  ```
  episode undefined
  ```

  `episode-id` was typed `Text`, so "absent" was not something the program could
  match on, and `lifecycle.md` §7.2.3 told reducers to "treat both as
  None-equivalent" — a rule nothing could enforce and, for a `Text`, nothing could
  even express.

  `episode-id` is now `Option(Text)`, and is supplied: it carries the id of the
  episode the panic happened in, which is the join between a panic a user saw and
  what `kumiki replay` / `kumiki_episode_tail` read back. It is `None` when there
  is no episode to name — a host that attached no episode logger, or a panic
  raised outside any dispatch — so the absent case is a value the language can
  say:

  ```kumiki fragment
  text("episode: " + $event.episode-id.get-or("(none)"))
  ```

  `cause` is now supplied too: the **nearest** `Error.cause` message when the
  throw carried one, `None` otherwise. The chain behind it and the stack with it
  stay in the episode log, where §7.2.3 already says they belong; `episode-id` is
  how to reach them.

  All three paths a panic reaches a program — an `app.error` reducer, a
  `route.error` reducer, and an `error-boundary` fallback — are handed the same
  record, built by one function (`userPanicInfo`) rather than three literals. #362
  aligned the boundary's payload with the live one by hand, and both were then
  missing the same two fields in the same way; a shared builder is what keeps them
  from drifting again.

  The runtime's `EpisodeLogger` gains `currentId()` — the question `hasOpenEpisode`
  answers, with the answer a caller can name — and a mounted app publishes an
  episode seam so the boundary path, which runs inside an app's own inlined
  runtime copy, can read it across that boundary.

  **A hand-written `EpisodeLogger` needs a `currentId()`.** It is a required
  member, so a logger built against the previous shape no longer satisfies the
  type. Anything from `createEpisodeLogger()` already has it. The runtime does not
  assume it at runtime: a logger without one degrades to `episode-id: None` and
  warns once, rather than throwing from inside a panic catch.

- 5907ee2: Substitute the placeholders in `fmt`

  `fmt(template, ...args)` returned its template. `packages/runtime/src/stdlib.ts`
  carried a helper for every other builtin — `panic`, `file-url`, `prefers-dark`,
  `Bytes.from-text` — and none for `fmt`, so codegen's `_s.fmt ? _s.fmt(…) :
template` guard always took the else branch:

  ```
  reducer go on=ui.click(B) do= t := fmt("{0}-{1}", "a", "b")

  [FAIL] step 0: clickText "go"
      assert: state t: expected "a-b", got "{0}-{1}"
  ```

  `check`, `build` and `smoke` were all green for that program, and would be for
  any program: a template is a `Text`, exactly like the formatted result it stood
  in for, so no tier short of one that reads the string could tell them apart.
  `packages/examples/apps/03-blog` built its auth header with it, so every request
  that app made sent `Authorization: Bearer {0}` and the token never left the
  browser.

  The runtime helper exists now. A placeholder is `{`, one or more decimal digits,
  `}`; each is replaced by the argument at that index, rendered through `show`.
  Substitution is one left-to-right pass, so a `{0}` arriving _inside_ a
  substituted value is text rather than a placeholder that reaches back into the
  argument list.

  Before this, [stdlib.md §2.4.5](https://kumiki.dev/spec/stdlib#_2-4-5-string-formatting)
  said substitution was **not implemented**, so the whole semantics was undefined
  rather than any particular corner of it. It is written down now (EN + JA), and
  these are the three easiest to get wrong:

  - An index the arguments do not reach keeps its placeholder verbatim —
    `fmt("{0} {1}", "a")` is `"a {1}"`. Not an error, and not empty: a template
    that outran its arguments is a mistake, and the rendering that names the
    missing index is the one its author will see.
  - An argument no placeholder names is dropped — `fmt("{0}", "a", "b")` is
    `"a"`. This is the half with no trace at all: the result is identical to the
    correct call's.
  - A `{` that opens no placeholder is copied through, and so is a `}` that closes
    nothing. No escape, the same bargain `Time.format` makes with its own tokens,
    so `fmt("{{0}}", "a")` is `"{a}"`. The digits are read as one decimal index,
    so `{01}` is index 1.

  **New warning, [W0214](https://kumiki.dev/spec/errors#w0214-fmt-placeholder-argument-mismatch-warning)
  `fmt-placeholder-argument-mismatch`.** A `fmt` whose **literal** template and
  argument list disagree, in either direction, is reported by `check` — one
  warning per call, naming both halves when a call is wrong both ways. Non-fatal,
  so `check` still exits 0 and `build` still emits. A template that is an
  expression carries no placeholder set to count and is left to the runtime rules
  above.

  **`+` renders through `show` now.** `_s.add` was `String(a) + String(b)`, which
  never called `show` — so `"x=" + someOption` was `"x=[object Object]"` and
  `"x=" + nothing` was `"x=null"`, where §2.4.5 has always said "the equivalent of
  `show` is called automatically" and `fmt` now says `None` and `""`. `Text +
<anything>` type-checks, so the two ways to put a value in a sentence had to
  agree; the spec was right and `add` was wrong. Numeric `+` is untouched.

  **A throwing `app.http.headers` is reported.** The thunk is called per request
  behind a `try`, and the `catch` returned `{}` silently: every global header
  vanished, the server answered 401, and an app with `on-401` logged its user out
  for no stated reason — with nothing on `console.error`, so `smoke` and
  `scenario` saw a run that passed. It logs now, which is the channel
  `lifecycle.md §7.2` already sends a panic down. The request still goes out.

  The codegen guard is gone: `fmt` lowers to a plain `_s.fmt(…)` call. Keeping it
  would mean a future runtime without the helper formats nothing and reports
  nothing, which is the shape this bug had. That makes it a **generation
  requirement** rather than a behaviour change — an app built by this compiler
  against an older `@kumikijs/runtime` fails with `_s.fmt is not a function`, as
  `_s.prefersDark()` and `_s.random()` did when they were introduced. Compiler and
  runtime move together.

  `packages/examples/features/88-string-formatting.kumiki` pins each rule with a
  scenario — including a template held in a slot, which is the case the runtime
  rules exist for — and the blog app's `Authorization` header is now asserted
  end-to-end rather than assumed.

- db913dc: fix(compiler): give a route target the chrome every other call site gets.

  A user tile carries two things the runtime needs: the `_named(…)` marker it
  diffs `tile.mount` / `tile.unmount` against (lifecycle.md §7.1.6), and the
  `try` / `catch` its `error-boundary` lowers to (§7.3). Both are applied by
  `tileCallJs`, the lowering for a _call site_. A route target is lowered
  straight from the route table by `genTile` — the body and nothing else — so a
  tile had both guarantees everywhere except at a route root.

  For the boundary that inverted the guarantee. The same tile, the same
  declaration, two positions:

  ```kumiki
  tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
  tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
  tile Host = column(Boom())
  ```

  `routes={"/" -> Host}` caught the panic and rendered the fallback.
  `routes={"/" -> Boom}` — the position §7.3 names — let it escape, and the app
  did not mount. `check` and `build` were green either way.

  For the marker it was a silence: `on=tile.mount(Panel)` never fired if `Panel`
  was named by a route, and fired if the same `Panel` was a child.

  A route target is now lowered as what it is — a call site of that tile — at all
  three route-table sites: a plain route, a `sub-routes` parent, and a
  `sub-routes` child. The boundary belongs to the tile, which is what §7.3 says:
  it scopes the boundary to renders _under that tile_, and says nothing about
  where the tile was written.

  **Observable** for a program that already declared either: a `tile.mount` /
  `tile.unmount` reducer on a route target starts firing, and a route root's
  `error-boundary` starts catching where the panic used to escape to the built-in
  top-level display. The third one is the headline: a route root whose render
  panics used to leave the app unmounted — `smoke` reported a failure and nothing
  rendered — and now mounts with the fallback in place.

  A tile that is showing its fallback fires no `tile.mount` for itself, because
  the boundary wraps the marker from the outside and the tile did not render.
  That was already true at a call site; it is now true at a route root too, which
  is the point — the two positions agree.

  `genTile`'s other caller — the `_tilesById` table a `tile-test` compares against
  — is deliberately unchanged. Not because of the marker: `tileStructEqual`
  leaves the `_tile` marker out of the comparison, so `_named` is invisible to a
  `tile-test`. It is the boundary, which would make a test on a
  panicking tile compare the fallback tree instead.

  **A boundary catches a panic, and re-raises anything else.** Giving a route
  target one closes a detection path, so what it will not swallow has to be
  decided rather than inherited: `smoke` and `scenario` both verify through the
  error channel, and before this, declaring a boundary was enough to hide a
  defect from them entirely.

  ```kumiki
  tile Needs in=Text error-boundary=Fallback = column(text($1))
  app M caps=[] routes={"/" -> Needs, "/404" -> Host} init=[]
  ```

  `smoke` said `ok — mounted, rendered, no runtime errors` on a program that
  renders nothing but `_d_1 is not defined` — the route target with an `in=`
  (#361). The same happened to `_wk`'s deliberate throw on a key that would
  collapse two tiles onto one identity, whose own comment asks for the render
  bailout to see it.

  A panic is the controlled signal lifecycle.md §7.2.2 defines — `panic(message)`,
  the polymorphic `.get`. A `ReferenceError` is not one, and is re-raised for the
  top-level display. The fallback's payload is now built by the same `panicInfo`
  `app.error` uses, so it carries `category` (it read `undefined` before) and an
  empty message stays empty instead of stringifying the error object.

  **`error-boundary` naming no tile is `E0105`.** It was the only tile-name
  position nothing resolved: the lowering skipped a name it could not find and
  produced a tile with no boundary and no diagnostic, so a misspelling stayed
  invisible until something panicked. The skip is a throw now, so the check and
  the lowering cannot drift apart.

- 891a942: Conjoin every `where` a type carries, and name the one that refused a value

  The grammar lets a type carry more than one `where`, and the parser folds the
  first onto the `nominal` node as a property and wraps the rest. Codegen read
  exactly one layer, so the outermost predicate was emitted and every inner one
  disappeared:

  ```
  type Handle = nominal Text where len-gt(3) where nonempty
  ```

  ```js
  "h": { value: "abcd", refine: (v) => typeof v === "string" && v.length > 0, … }
  ```

  `h := "ab"` was accepted at runtime by a type that says the value must be longer
  than three characters, and nothing reported it — `check` was silent, `build` was
  silent, and the emitted descriptor looked well formed.

  `language.md` §1.3.1 now states the reading, in both language tracks: the
  predicates **conjoin**, and a value is accepted only when every one of them
  holds. It is the reading the rest of the compiler already had — the checker
  peels every layer to decide nominal identity, and the property-test generator
  folds every layer into its bound — so the fix is codegen catching up rather than
  the language moving.

  The predicates are collected along the edges that lead from a type to the next
  name — an alias, a `nominal` wrapper, a `where` — so they accumulate over a name
  as well as over one type expression: with `type Short = Text where len-lt(9)`, a
  `nominal Short where len-gt(3)` carries both. A type written in terms of itself
  terminates the walk rather than looping. (A generic that hands a parameter back,
  `type NonEmpty(T) = T where nonempty`, is an edge normalization follows and this
  walk does not yet — its refinement is still dropped, tracked separately.)

  `refinement-type` is recursive in §1.3.1, but the parser tested for `where`
  twice with no loop, so a third one was a parse error against a grammar that
  admits any number. It chains now, and the predicates a type can carry are no
  longer capped at two.

  A conjunction cannot say _which_ predicate refused a value, so a slot whose type
  carries several now also emits them separately (`refineAll`), ordered as the
  chain is read — from the base outward, which inside one type expression is the
  order they are written. Both places a predicate is named read it: the rejection
  reported for a discarded reducer batch and the `error` tile's message. A
  pristine `Text where nonempty where len-lt(7)` field reads "Required" instead of
  naming a bound the empty value is well inside, and a write refused by an inner
  predicate is reported against that one rather than against the outermost.

  **What changes for an existing program.** A type whose predicates were being
  dropped is now enforced, which is the fix and is also a behaviour change:

  - `type Handle = nominal Short` over a refined `Short` emitted **no** `refine`
    at all and accepted every write; it is checked now, and codegen wraps writes
    to it in `_s.slotWrite` where it did not before.
  - `refineKind` used to hold the outermost predicate and now holds the first of
    the chain, so a report that reads it without `refineAll` can name a different
    predicate than it did — for a single-predicate type, the common case, nothing
    moves and the emitted descriptor is byte-identical.
  - A type whose predicates contradict each other (`Text where between(1, 5)
where nonempty` — `check` does not yet reject a predicate against its base
    type) used to work by dropping one of them, and now refuses every value.

- 2546469: Match a path against the most specific route, not the first one written

  `docs/spec/routing.md` §3.1.2 ranks routes static > parameter > wildcard and
  keeps definition order for ties. The router tried routes in source order and
  took the first match, so with `"/todos/:id"` written above `"/todos/new"`, the
  path `/todos/new` rendered the detail tile with `id = "new"`. The outcome
  depended on which entry was appended first.

  Routes are now compared segment by segment from the left: at the first segment
  where two patterns differ in kind, a static segment wins over a parameter and a
  parameter wins over a wildcard. Only a full tie falls back to definition order.
  Redirects are ranked in the same table as the routes that render: the first
  entry in that order owns the path, so `"/todos/new" -> NewTodo` now renders even
  when `"/todos/*" ->> "/"` is written above it (a redirect used to be tried before
  any page). Inside a `sub-routes` parent, children and child redirects share the
  order the same way, and only the parent that owns the path is consulted. The
  winning pattern is also the one `route.enter` names. When `renderToString` is
  handed `routing`, it picks the rendered route in the same order; it does not
  follow redirects. §3.1.2, §3.6.3 and §3.10 spell this out in both language
  tracks.
  `packages/examples/features/153-route-specificity.kumiki` declares the routes
  in the unhelpful order, and its scenario checks each one.

- 2061f11: Seed the `route` slot in the test harness, the way `mount` does

  A reducer that reads `route.path` works in an app and panicked under `kumiki
test`: `route` is maintained by the runtime rather than declared by a program,
  so the harness — which rebuilt its slot table from the declared slots and the
  test's `given` — had no such slot, and there was no way to write a passing test
  for that reducer at all. E0119 makes reading it the _recommended_ spelling, so
  this was reachable by following the compiler's own advice.

  Both reset paths now seed `route` with the same empty route `mount` seeds:
  `resetLive`, shared by `reducer-test`, its multi-step form, `tile-test` and
  `run-reducer`; and `resetLiveFromSlots`, which `episode-test` and `kumiki
replay` use. A test may name `route` in `given.slots` to drive a reducer that
  branches on the current route, and one that names only some of its fields takes
  the empty route's values for the rest — an abbreviation cannot hand a reducer an
  undefined `params`.

  `given.slots` / `expect.slots` naming `route` is no longer `E0103 undef-slot`,
  in a `reducer-test` and in an `episode-test`'s `slots-equal` alike: a reserved
  slot name is a slot a test may write, which is the only kind of slot the
  program cannot declare itself. A field the route does not have is **E0108** and
  a `route` that is not a record is **E0201** — without those the completion
  would swallow a typo, leaving a green test that ran against the empty route.

- b7e922c: Serve the element tree the client builds, for every tile kind

  The SSR parity gate compared a hand-written half of the tile catalogue, and it
  compared the **root element only** — every fixture had `children: []`. So a kind
  with no row was indistinguishable from a kind verified to agree, and a kind
  whose children differed passed on the strength of its outer `<div>`.

  Eight kinds diverged. The server served an `error` as a `<div>` with no colour
  where the renderer builds a red `<span>`; a `toast` without the padding and
  corners the renderer paints; `data-lang` on the `<pre>` rather than on the
  `<code>` the renderer marks; a `tooltip` without `data-placement`; a `markdown`
  body as its raw source in one text node instead of the paragraphs the renderer
  parses, so the first paint ran the whole document together into one block; an
  `overlay`'s children flat, without the absolutely-positioned layer each one
  after the first is wrapped in, so a stack painted as a column; and a closed
  `modal` / `drawer` / `popover` as an empty string rather than the
  present-but-hidden host the renderer mounts — so a crawler was served a page
  with the dialog's content missing and the first paint laid out as if the
  surface were not there.

  Two divergences were the client's. A `<select>` carried no `data-kumiki-bind`,
  though §10.3.5 names it alongside `input` / `textarea` and §10.3.9 re-identifies
  a focused picker by that marker; and a `modal` had neither `role="dialog"` nor
  the `aria-label` its `title` gives it, both of which the served page already
  had and the client's first render then dropped. An overlay layer and a modal
  host now stretch with the four inset longhands instead of the `inset`
  shorthand, which a DOM that does not implement it — `happy-dom`, the one
  `kumiki smoke` runs in — drops on assignment, leaving the layer covering
  nothing. The server also stopped serving `title=""` / `placeholder=""` /
  `colspan="0"` and the like where the renderer writes no attribute at all, and
  it now skips the `null` children a `when` leaves behind rather than throwing on
  the first one.

  The gate itself is now total over `TileNode["kind"]` and compares the subtree
  rather than the root, so a kind with no row fails to typecheck and a kind whose
  children drift fails the suite. Form state the client keeps as a non-reflecting
  property (`value`, `checked`, `selected`) is asserted on the served markup
  directly, since an attribute dropped from both sides of a comparison is one the
  comparison cannot speak for.

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

- 6cae7d8: Cover the child in a `route-outlet` with the parent's `error-boundary`

  `docs/spec/lifecycle.md` §7.3 says a render panic is caught by the nearest
  enclosing `error-boundary`. A child a `sub-routes` entry injects into the
  parent's `route-outlet` is under the parent in the rendered tree, and was not
  covered by the parent's boundary:

  ```kumiki
  tile Boom = column(text(xs.head.get.show))            # declares no boundary
  tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(route-outlet())
  ```

  Navigating to `/shell/a` rendered the built-in top-level display, not
  `Fallback`. `pickRootTile` returned from the parent's factory — and so from the
  `try` / `catch` its boundary lowers to — before it built the child, so the child
  rendered outside it. A boundary on the shell, the obvious way to write "one
  fallback for this whole section", silently covered the frame and nothing else.

  The parent's factory now takes the outlet's contents as a callback and applies
  it around its own tree from inside its boundary, so the child is built under the
  parent's guard. What follows is pinned beside it: the nearest boundary wins (a
  child that declares its own shows its own fallback inside the outlet, and the
  shell stays up), and the fallback's `PanicInfo.location` names the tile that
  panicked rather than the one that declared the boundary — every route entry now
  carries the name of the tile it targets, and a panic raised while building it is
  attributed to that tile when nothing nearer has. The same attribution reaches
  the built-in display: `data-kumiki-panic` names the route tile that panicked
  where it used to be empty.

  §7.3 says which reading holds, in both language tracks, and the known exception
  its implementation status carried is gone. Routing §3.6.3 names the case.
  `packages/examples/features/92-outlet-error-boundary.kumiki` is the section
  with one fallback and a child that keeps its own, and its scenario asserts both.

  `route.error`'s `$event.location` moves with it: for a render panic it was
  absent, and it is the route target's name now — the same attribution the
  built-in display carries. `app.error` and the episode log are unchanged; both
  set `location` themselves.

  `RouteEntry.tile` takes an optional `OutletFill` (new export). The runtime
  always passes one, so an entry written as `tile: () => …` — a host's, or one a
  runtime bundle from before this change emitted — still type-checks on both
  sides and still renders its child: a parent that declares no parameter has
  its outlet filled after it returns, outside its boundary, which is the
  behaviour that factory was written for. A parent whose matched child finds no
  `route-outlet` in the rendered tree (one under `when` / `if` / `match` that is
  absent at runtime — E0113 accepts it) now reports the discarded child on
  `console.error`, where the smoke and scenario tiers listen.

- 027cf25: A non-`Text` key reads back as its declared type from `Set(T).to-list`, `Map(K, V).keys`, `Map(K, V).entries`, and as the `$1` of a `Map(K, V).filter` predicate (#467).

  A Set is stored as `{ [key]: true }` and a Map as a plain object, so their keys are JavaScript object keys — strings. The readers returned them as they were stored, so a `Set(Int)` built with `add` answered `["7", "8"]` under a `List(Int)` type. Every later reader disagreed with it: `contains(7)` was false, `sort` ordered text, `fold(0, $1 + $2)` concatenated, a `for k in m.keys` over a `Map(Int, V)` bound strings, and `m.filter($1 == 3)` kept nothing. `check` and `build` both said `ok`.

  The checker now records, on each of those members, how the receiver's key type is represented — a number for `Int` / `Float` / `Time` (and a `nominal` / `where` over one), a boolean for `Bool` — and codegen passes it to the runtime helper, which restores the keys it reads. A `Text` key lowers exactly as before. The storage and `add` / `remove` / `toggle` / `has` are unchanged, and already agree: they key by `String(x)`. stdlib.md §2.2.2 states the rule.

  For the receiver's type to be known in more places, two things the checker left untyped now have types:

  - **`$1` / `$2` in a fragment** are bound to what the lowering hands it, read off the receiver: the element of a `List` or `Option`, the halves of a `.entries` tuple, a Map's key and value under `filter`, `fold`'s element, `Map.update`'s value. So `rs.map($1.ids.to-list)` restores keys, and a value passed on through them is checked like any other: `xs.map(loud($1))` with `loud(t: Text)` over a `List(Int)` is now E0201. Where the lowering's reading is not certain (an element that is itself a `List` or `Set`, `fold`'s accumulator) nothing is bound, as before.
  - **`run-reducer(r)` in a property-test invariant** answers `{slots: {…}}` typed with the program's slots, so `run-reducer(add).slots.st.to-list.contains(7)` no longer reports a counterexample against a correct program, and a slot name the program does not declare is E0108.

  **`T.fresh()` on a type a `Text` does not go into is now E0802.** `fresh` mints a uuid `Text` whatever `T` says; on a `nominal Int` the string used to pass silently, and with keys now restored by type a `Set` of such ids read them back as `NaN`. Declare the id `nominal Text`. The E0124 message for `fresh` on a type constructor names that half of the repair too.

- 3db2d76: Leave an off-origin link to the browser instead of throwing

  `link(to="https://example.com/docs")` without `external: true` was intercepted
  like any other link: the click handler called `preventDefault()` and handed the
  target to `history.pushState`, which refuses an off-origin URL.

  ```
  SecurityError: Failed to execute 'pushState' on 'History': A history state object
  with URL 'https://example.com/docs' cannot be created in a document with origin
  'http://localhost:3000'
  ```

  The navigation was cancelled _and_ did not happen, so the link was dead, and the
  console named the History API rather than the link.

  The handler now decides whether the target is one this app's router can serve —
  before `preventDefault()`, so the browser still owns the click — and falls back
  to native navigation when it is not, the same fallback it already takes for a
  link outside any live mount. A one-line `console.warn` naming the link and its
  target goes with it. Same-origin targets are unaffected: a relative path, an
  absolute URL to this origin and a protocol-relative one all still route.

  Falling back is limited to the schemes a click can be handed to a browser for
  (`http:`, `https:`, `mailto:`, `tel:`, `sms:`). `to` is an arbitrary expression,
  so a slot filled from an HTTP response can reach it, and "the router cannot
  serve this" must not become "the document executes it": a `javascript:` target
  is cancelled and reported instead, with or without `external`. It did not work
  before this either — it threw out of `pushState`.

  `external: true` remains the way a link says it leaves the app, and is still
  what opens it in a new browsing context — it is no longer what decides whether
  an off-origin link works at all.

- e7da073: Show why a bound field was refused, and report the `strict` prop nothing implemented

  A `bind` whose value the slot's refinement refuses leaves the slot on the last
  value it accepted, and the control keeps what was typed. `error(field=…)` used
  to judge the slot, which still held the old, valid value — so the field showed
  `ada@examplecom`, the slot held `ada@example.com`, and the page said nothing.
  The error tile now judges what the field shows: while a control shows a value
  its refinement refused, that value's message is rendered, across unrelated
  reducers too, until the field is edited to a value the slot takes or a reducer
  rewrites the slot and the field follows.
  With one app mounted into several hosts, each view's error tile speaks only
  for its own view's field, and during an IME composition the message is settled
  when the composition ends rather than for every intermediate value.

  `strict=false`, which forms.md §5.1.2 used to describe as a second mode, was
  never implemented and its `valid` flag had no reader. The section now has one
  mode, and `strict` on any bind control kind (`input`, `textarea`, `select`,
  `slider`, `check`, `switch`, `radio`, `editable`), bound or not, is **E0219**:

  > `"strict" is not a prop of input: a value its refinement refuses is always refused, and error(field=…) shows why (see docs/spec/forms.md §5.1.2)`

- 18f2e91: A replayed episode hands its entry reducer the payload the live run handed it (`runtime.md` §10.5.3).

  The live runtime records `trigger.payload` as the reducer payload itself — `{$el, $event}` for a UI event, `{$1}` for an effect result — and the replay executor behind `kumiki replay` and `episode-test` wrapped it a second time as `{$el: payload, $event: payload}`. So `$el.idx` and `$event.value` replayed as `undefined`, and an episode opened by an effect result panicked on its `$1`:

  ```
  [reducer] clicked  n: 0 -> undefined
  [panic:reducer] Cannot read properties of undefined (reading 'text')  reducer "loaded"
  ```

  The payload is now passed on unchanged. An `ssr.hydrate` bootstrap episode, whose trigger carries no payload, hands its first `.ok` / `.err` reducer the value of the last `effect-end` of that effect and outcome recorded before it, and a `from-log` mock of that effect continues after it. An `episode-test` with `slots-equal: from-log, no-panics: true` over a log of the unchanged program now passes for both.

  When the log carries no such `effect-end` (a trimmed or hand-edited log), the reducer still runs with no `$1`, but replay now says so instead of leaving the panic to read as a reducer bug: the episode line ends in `(no recorded result for <reducer>)`, the run ends with an `entry results missing:` summary, and `ReplayReport.entryResultsMissing` lists the episodes.

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

- e2a3cda: Send each `HttpBody` variant as what it names

  A request body that was not a JS string was `JSON.stringify`ed as-is under
  `Content-Type: application/json`, and nothing read the variant. So `Form(m)`
  posted `{"_tag":"Form","_0":{…}}` as JSON, `Json(v)` posted the wrapper instead
  of `v`, `Text(t)` posted a JSON object, and `Empty` sent a body. `apps/03-blog`
  logs in and saves posts with `body: Json($1)`, so both requests carried the
  wrapper.

  Now (http.md §6.1.3 / §6.1.5): `Form` is URL-encoded as
  `application/x-www-form-urlencoded`, `Json` sends its payload as
  `application/json` (`Json` of `Unit` sends `null`), `Text` sends the text,
  `Multipart` a `FormData`, `Bytes` the bytes, and `Empty` no body. Any other
  body (a record, a list, a bare `Text`) is JSON, as the spec says; a bare `Text`
  used to go out as the raw string with no Content-Type.

  A `Multipart` `FileV` that holds no file (a file record restored from
  persistence) fails the effect with `HttpError{status: 0}` instead of uploading
  `"[object Object]"`. A `Content-Type` set on a `Multipart` body is dropped, so
  fetch writes the one with the boundary.

  Header names are compared case-insensitively when the defaults,
  `app.http.headers` and the effect's own `headers` are merged, so a global
  `Content-Type` and an effect's `content-type` no longer both reach the server.

- 36340c7: Send an HTTP effect's `query` as the URL's query string

  http.md §6.1.2 puts `query: Map(Text, Text)` in every HTTP request, and the
  spec's own expansion example carries `query: {}`. The built-in handler fetched
  `base-url + url` and never read it, so `map-request={url: "/search", query:
{"q": $1}}` requested `/search` — `check` and `build` said ok, the headers from
  the same record were sent, and the server answered an unfiltered request.

  Each entry is now URL-encoded and appended to `url`, after any query string it
  already carries and before a fragment: `{url: "/search?x=1", query: {"q":
"a b&c"}}` requests `/search?x=1&q=a+b%26c`. An empty `query` leaves the url as
  written. Example 127 makes the request through the real handler in `smoke`,
  against a fixture that answers only the encoded URL.

  This holds for every `http.*` method, not only `http.get`: a `query` on an
  `http.post` effect was dropped the same way and is now sent, and the spec's
  `http-post` signature now lists `query` (put / patch / delete share its shape).

- f2a7d92: Report a 2xx whose body does not decode with its real status, and do not retry it

  `res.json()` ran inside the same `try` as `fetch`, so a parse error on a
  successful response landed in the connection-error catch and came back as
  `{status: 0, message: "SyntaxError: …", body: ""}`. The retry loop reads
  `status: 0` as a connection error, so a `retry=` POST that the server had
  accepted (201, answered with an HTML page or an empty body) was sent again on
  every attempt, which duplicated the order.

  The body is now read as text and parsed separately. A parse failure is an
  `HttpError` with the response's status, a `message` starting `decode failed:`,
  and the text in `body` (http.md §6.1.4). It is neither a 5xx nor status 0, so
  it is not retried (§6.5). A rejected fetch is still `status: 0` and still
  retried, and so is a 5xx.

- b33d62d: `check` / `switch` / `radio` honour `bind=`

  `check(bind=b)` and `switch(bind=b)` show the bound `Bool` and write the box's
  new state back when it is ticked; `radio(group=…, bind=f, value=V)` is selected
  exactly when `f == V` and writes `V` when chosen (forms.md §5.1.1, §5.5.2). The
  compiler accepted `bind=` on all three and codegen dropped it, so every box
  rendered unticked and clicking one wrote nothing. The write goes through the
  same path as `input` — refinement refusal, the `data-kumiki-bind` marker, SSR —
  and runs before the control's own `onClick` / `onChange`, so a handler reads
  the slot already written. A `check` / `switch` bound to something other than a
  `Bool` is E0201 at `kumiki check` time, a radio `value` of another union E0216.

  **New error, E0225 `radio-bind-without-value`**: a `radio` with `bind=` and no
  `value=` has nothing to write when chosen. It used to write `undefined` into
  the slot, then show itself chosen while every `match` on the slot fell through.

  **New warning, W0216 `selection-beside-bind`**: `value=` on a `check` /
  `switch`, or `selected=` on a `radio`, written beside a `bind=` is not read —
  the bound value decides the selection.

  Focus now stays on the radio a user chose. Every radio of a bound group
  carries the same `data-kumiki-bind` marker, and restoring focus after the
  re-render took the first control carrying it; a marker more than one control
  carries now falls through to the id and the DOM path.

- 39eb32b: Let a `ui.input` selector reach an `editable`

  `reducer edited on=ui.input(Ed)` with `tile Ed = editable(…)` compiled to
  nothing: the lift table listed `input` and `textarea` only, so codegen emitted
  no handler and the reducer never ran. The checker reported it — as W0212, with
  a reason that was not true, saying the tile has no descendant that fires
  `input`. It does: the `editable` renderer registers its own `input` listener
  and calls the tile's `onInput` from it, which is why writing the handler on the
  tile (`editable(onInput=edited)`) already worked.

  **A subscription that did nothing now runs.** An app carrying a
  `ui.input(<editable tile>)` reducer got the W0212 warning and no behaviour;
  after this it gets the behaviour and no warning.

  `change` is deliberately not extended the same way — a `contenteditable`
  element fires no `change` event, so that row's omission is the rule, not a gap.

  The scenario runner's `fill` verb now writes an `editable` through
  `textContent`, the property its renderer reads back, and dispatches `input`
  alone. Filling one used to set a `value` the element does not read, so the
  event carried the text the control held _before_ the step.

  `fill` also **fails the step** when its selector matches an element that holds
  no text — a `div`, a container — the way every other action already does with a
  target it cannot drive. Such a step used to set a property nothing reads,
  dispatch two events nothing hears, and pass.

- 0f4dc74: Evaluate a `latest-per-key` key once, at the `emit`

  With `policy=latest-per-key(noteKey)`, a reducer that wrote `noteKey := "b"` and
  then did `lastId := emit load(x)` kept `"load:a"`, built from the value the slot
  had _before_ the reducer ran. The dispatcher evaluated the key again after the
  reducer's writes were applied, so it registered the request as `"load:b"`.
  Handing `lastId` to `emit cancel(...)` then matched nothing in flight and did
  nothing, silently. The same happened the other way round when the body wrote the
  key slot _after_ the emit, and when the emit sat under `let … in` or in a `match`
  arm.

  `docs/spec/http.md` §6.4 now says when the key is evaluated: once, where the
  `emit` runs, seeing the reducer body's writes up to that statement and none
  after it. A reducer's emit carries that key to the dispatcher (`EmitSpec.key`,
  optional), which runs the request under it, and the `EffectId` the emit yields is
  built from the same value. An emit with no key of its own — an `app.init` entry,
  or a hand-written `apply` — is keyed at dispatch as before.

- 5072599: `==` / `!=`, `List.contains` and `List.unique` compare by value (language.md §1.9.4).

  `==` compared anything but a primitive or a variant with a primitive payload by JavaScript reference, so `xs == []` was false on an empty list, `p == {x: 1, y: 2}` was false for that same record, and `Some(Some(1)) == Some(Some(1))` was false. `contains` lowered to `Array.prototype.includes` and `unique` to `new Set`, so `[Admin, Editor].contains(Admin)` was false and `[Admin, Admin].unique` kept both. A property test comparing a List slot with `==` could never pass. `check` said `ok` to all of it.

  All three, and the test layer's own comparisons, now go through one helper, `valueEqual`: Lists and tuples compare element by element, records, variants and Maps by the same keys holding equal values, recursively; a DOM `File` or other non-plain object compares by identity, and `Bytes` by its bytes. A `Set` compares as the keys it is stored under, which depends on how it was built, so Set equality is not promised. `unique` keeps the first occurrence of each value in order, and `Text.contains` is still a substring test.

- 2adec5b: A `for` over a list that repeats a value re-renders in place

  Every tile a `for` renders gets an implicit key so the reconciler can match it
  across renders. The key was `show(x)` alone, so `[7, 3, 7]` gave two siblings
  the key `"7"`, and so did two `for` loops under one parent that shared a
  value. The first paint worked. Every later render, including one caused by an
  unrelated slot, then failed with `duplicate TileNode.key "7"` and rebuilt the
  whole tree. That replaced every element on the page, including an `<input>`
  beside the list, which lost its focus and caret on every keystroke.

  The same failure hit every list of records, the most common shape a `for`
  renders: a record shows as `[object Object]`, so `for t in todos text(t.title)`
  over two todos failed on its first re-render with
  `duplicate TileNode.key "[object Object]"`. A list of `None`s failed the same
  way, and an element whose shown value is empty was an empty key that `_wk`
  refused.

  The implicit key now has three parts, in this order: the loop, which
  occurrence of the element's shown value this is, and that shown value
  (`_s.loopKeys`). A loop is named by the tile it is written in and its ordinal
  there (`App_0`, `App_1`, …), so a blank line or an edit elsewhere in the file
  leaves the keys as they were. The key is unique among a parent's children,
  except when one loop in the source is expanded twice into one parent's
  children (`column(Items, Items)` for `tile Items = for …`), which keeps the
  duplicate-key panic; give each use its own container. A loop whose every tile
  call has its own `{key: …}` computes no implicit keys.

  A reorder of elements with distinct shown values keeps every key, so it moves
  the elements it already has, as before. Two limits (runtime.md §10.3.10): an
  insert or remove before a repeated value renumbers its later occurrences, so
  the elements of equal values may trade places; and where `show` is not
  injective (records, variants with a payload) the implicit key is the
  element's position, so a reorder patches rows in place instead of moving them.
  A reorderable list of records wants an explicit key, `{key: t.id}`.

  Explicit `{key: …}` keys are unchanged: the author promises they are unique
  among their siblings. When every child at that level is keyed, colliding
  explicit keys stay a reconcile panic (`duplicate TileNode.key …`) followed by
  a full rebuild, not a fallback to position, and a test pins it.

  The compiler's output now calls `_s.loopKeys`, so it needs a runtime from this
  release or later; both packages are bumped together.

- 6f38fd8: A form submits only while the fields bound inside it are valid

  forms.md §5.2.2 calls a form's `ui.submit` reducer only when every bound slot
  passes validation; the submit listener called it unconditionally. So a field
  showing a refused address beside "Invalid email format" still submitted, and
  the reducer read the slot's last accepted value rather than what the field
  showed. The form now judges every slot a control inside it binds on what the
  controls show — the judgement `error(field=…)` makes, through one shared
  `judgeShownField` — and does not call the reducer while any fails, whether the
  submit comes from a button or Enter.

- 1c1cb23: `<T>.fresh()` returns a uuid outside a secure context too

  `crypto.randomUUID` exists only in a secure context. On a page served over plain
  http the runtime fell back to a base-36 string that is not a uuid, so once the
  `uuid` refinement gates a keyed slot, every write of a fresh id was rejected.
  The fallback now builds a v4 uuid from `crypto.getRandomValues`.
  If `getRandomValues` is missing as well, the bytes come from `Math.random`,
  which is not cryptographically random; a fresh id only has to be distinct, never
  unguessable.

  **Replaying an old recording:** an episode journal or scenario recorded before
  this change holds the base-36 ids `fresh()` returned then, and replaying it into
  a slot whose ids are `uuid`-gated now refuses those writes — reported, not
  silent. Re-record it, or replace the ids with uuids.

- dbae0a7: Render `heading(level=n, …)` as `<h{n}>`

  stdlib.md §2.3 gives `heading` a `level` prop (1-6), and the compiler passes it
  through, but both renderers always drew an `<h1>`. A page written as an
  `h1` > `h2` > `h3` outline rendered as a flat run of `h1`s, which broke the
  document outline and the heading navigation screen readers use.

  The DOM renderer and the SSR renderer share one `headingTag`, so both draw
  `<h1>` … `<h6>` for the level, and `<h1>` when there is none. A fractional
  level drops its fraction, and one outside 1-6 is drawn at the nearer end. A
  level that changes between renders re-creates the element through the patcher's
  `PatchRequiresRebuild`, the path `list` takes when `ordered` flips. §2.3.2
  states this in both language tracks. `packages/examples/features/156-heading-level.kumiki`
  has an outline and a slot-driven level.

- 4cd6c29: `x.is-empty` and `x.is-empty()` now give the same, correct answer on a Map, a List and a Text (stdlib.md §2.2.3: the parenthesis-free shortcut is the same method).

  The two spellings had two unrelated lowerings. The bare one was `x.length === 0 || x === ""`, and a Map has no `length` and is not `""`, so an empty Map was not empty and `when(todos.is-empty, …)` on a `Map` never showed its empty state. The parenthesised one asked for a Map's size, which is 0 for anything that is not an object, so every non-object was empty — `"abc".is-empty()` was `true`. Both now lower to one runtime helper, `isEmpty`.

  Receivers outside those three change too: `n.is-empty()` on an Int, Float, Bool or Duration went from `true` to `false`, which is what the bare spelling already answered.

- 29aa08e: `m[k].f := v` writes nothing at an absent key, and `m[k]` read there is a panic

  language.md §1.6.3 expands `todos[id].done := true` to
  `todos := todos.update(id, $1.copy(done=true))`, and `update` does nothing when
  the key is absent. The setter behaved differently: it built the missing entry,
  so `todos` ended up as `{"t9": {"done": true}}`, an entry with no `title` that
  the declared type `Todo` does not describe.

  The setter could not tell a missing Map entry from a missing record field,
  because each is a string step that finds `undefined`. A reducer's index step now
  reaches the setter as `{at: key}`, separate from a field step, and a write
  through an absent key leaves the Map as it was. `m[k] := v` still inserts.

  The read had the matching gap. `todos["zz"].title` threw a JavaScript
  `TypeError`, which bypassed the panic model. `m[k]` at an absent key is now a
  panic (lifecycle.md §7.2.2), as an index past the end of a List already is:
  the reducer's writes roll back and `app.error` runs. `m.get(k)` is still the
  read that answers `None`.

  **Migration.** A tile that reads `m[k]` at a key that may be absent used to
  render `undefined` there; it now panics during render (the first render
  included), and the nearest `error-boundary` or the built-in panic display
  takes the page. Read such a key in a tile through `m.get-or(k, d)`, or through
  `m.get(k)` and a `match` on the Option.

  A write path whose index key is a record with a `get: true` field
  (`Map({get: Bool}, V)`) now writes the entry under that key. It used to be
  taken for a `.get` unwrap, so `m[{get: true}] := v` replaced the whole slot
  with `v`.

- 46d9dca: `Map(K, V).map(expr)` maps each entry

  `m.map($2 + "!")` did not go through the Map. The polymorphic `.map` helper
  knew about Lists, Options and Results, and passed anything else to the
  fragment whole, so a `Map(Int, Text)` slot ended up holding the string
  `"[object Object]!"`. Both `check` and `build` passed.

  `map` now returns a Map with the same keys, and each value becomes `expr`
  evaluated with `$1` set to the key and `$2` to the value (stdlib.md §2.2.1).
  The key is restored to its declared type the way `keys` and `Map.filter`
  restore it, so `m.map($1 * 10)` on a `Map(Int, Int)` is arithmetic, and a
  key that is itself a pair, such as a `Tuple(Int, Int)`, is still all of `$1`
  with `$2` the value. The
  checker binds `$1` / `$2` for `Map.map`, so a fragment that uses them with
  the wrong type is reported, and records its fragment as handed the key and
  the value, as it does a Map's `filter`: a `fn` of two named there
  (`m.map(label)`) takes the key and the value instead of being refused with
  **E0213**, and the E0103 / E0213 messages name a Map's map among the places
  a `$2` is bound.

- 4b126f4: A Set element or a Map key is one entry per value, whatever its type (stdlib.md §2.2.1 / §2.2.2).

  The Set and Map members disagreed about how a key becomes an object key. `add` / `has` / `toggle` wrote `String(x)`, `get` / `insert` / `m[k]` / `m[k] := v` used the raw value as a property name, and `remove` compared the stored string with the raw key. So every union value and every record was the one key `"[object Object]"`: `picked.add(Red).has(Blue)` was `true`, and `votes[Red]` and `votes[Green]` were one count. `remove` on an `Int`, `Float`, nominal-`Int` or `Bool` key removed nothing. `check` said `ok` to all of it.

  Every member now stores and looks a key up through one encoder, `entryKey`: `String(x)` for a primitive, as before, and for a record, variant, tuple or `Option` its JSON with each record's fields in sorted order. `to-list` / `keys` / `entries` and a `Map.filter` predicate read such a key back as the value it was written from: the checker records the new `"value"` key kind for it. The slot gate now walks a `Set` of records too (language.md §1.3.3), since its members come back out of their keys.

  A key written in a Map literal is stored through the same encoder, and a `Map.filter` predicate is handed each entry as one `(key, value)` pair, so `$2` is the value even when the key is itself a two-element tuple.

  **Persisted structured keys no longer read back.** A record or variant key stored before this change (as `"[object Object]"`), or a decoded `Map` whose structured keys are bare variant names, is not the JSON a structured key reads back from: `keys` / `entries` / `to-list` and a `Map.filter` over it now panic with a message naming the key, where they used to answer the wrong string. Rebuild such a container through its members to re-key it.

- 21dc29e: `Option(T).filter` answers an `Option` (#466).

  `.filter` is polymorphic, and an `Option` is an object at runtime, so the helper read `Some(3)` as a Map: the predicate was called with the Option's own fields (`"_tag"`, `"_0"`), and the result was an object built from whichever of them survived — neither a `Some` nor a `None`. `is-some` on it was false, `get-or` could not unwrap it, and `match` found no arm, while `check` and `build` both said `ok`.

  A `Some` whose value passes the predicate now stays that `Some`, one whose value fails it becomes `None`, and a `None` stays `None` without calling the predicate, as stdlib.md §2.2.4 gives it.

- 1b92331: The result type of a member the receiver decides is now resolved, so its value can no longer land in a slot of another type unreported (#383).

  A member whose result was built out of the receiver's own type argument had no type at all. So `xs.head` on a `List(Int)` resolved to nothing, and `n := xs.head` put an `Option(Int)` into a slot declared `Int` with `check` saying `ok`. From there every reader disagrees with the slot: `is-some` is false on a value that is present, and `match` finds no arm. `t := opt.is-some` and `n := xs.get(0)` were the same gap.

  All of them resolve now, and **both spellings answer the same type** — `xs.head` parses as a field access and `xs.head()` as a method call (`stdlib.md` §2.2.3's parenthesis-free shortcut). Where a member has two readings the argument count tells them apart, as it already did for `.get-or`.

  What resolves, from `stdlib.md` §2.2:

  - a fixed `Bool` — `is-empty`, `is-some`, `is-none`, `is-ok`, `is-err`, `has`, `contains`, `starts-with`, `ends-with`
  - a fixed `Int` — `length` on a `List` / `Text`, `size` on a `Map` / `Set`
  - an `Option` of the receiver's own element — `List.get(i)`, `head`, `last`, `find`
  - the receiver's own type back — `tail`, `push`, `prepend`, `concat`, `slice`, `reverse`, `sort`, `sort-by`, `unique`, `filter`, `insert`, `remove`, `update`, `merge`, `add`, `toggle`, `union`, `intersect`, `diff`, `or`, and `Text`'s `upper` / `lower` / `trim` / `replace`
  - a different container — `Map.keys` / `values` / `entries`, `Set.to-list`, `Option.to-list`, `Result.to-option`, `List.chunk`, `Text.split`
  - a `Text` — `List.join`
  - an `Option` of a parsed number — `Text.parse-int` / `parse-float`
  - `Result.get-err`, which answers the error type rather than the ok one

  `.get` on a `List` is among these: it resolved for `Map` / `Option` / `Result` and not for `List`, though §2.2 gives all four.

  `.get`'s argument count is now decided by its receiver too. `Map(K, V).get(k)` and `List(T).get(i)` take one; `Option(T).get` and `Result(T, E).get` take none and unwrap. A count that does not fit the receiver is reported (E0213) and names the reading the written count would have selected — where `o.get()` used to be told it "expects 1 argument(s)", which is the `Map` reading's count, and `o.get(1)` was reported by nothing.

  Left undecidable on purpose: `map`, `flat-map`, `fold` and `map-err`, whose result a lambda body decides rather than the receiver; `pow`, which has no fixed result at all (§2.2.7); and a receiver whose own type the checker cannot decide. An undecidable result is checked against nothing, while a wrong one reports a program that works.

  The `Time` (§2.2.8) and `Duration` (§2.2.9) members are a family of their own and are not included: they answer in each other's types rather than in a type argument, and `Duration` is a nominal over `Int` rather than a primitive.

  **Runtime**: `List(T).find(pred)` now returns `Option(T)`, as §2.2.3 has always said. It returned the raw element, or `undefined` when nothing matched — which is neither `Some` nor `None`, so `.is-some` on it was false whether or not an element was found and `match` found no arm. The spec's own example (`language.md` §1.8.4, `p.tags.find($1 == t).is-some`) was affected.

  Refs #383.

- 3573ca7: A `bind` into one field of a record slot is judged at that field

  With a refinement written inside a record type, `input(bind=form.age)` was
  refused whenever any field of the record failed — so a pristine form whose
  default fails several fields could only be filled in one order, silently. A
  bind write is now judged at the path it writes (forms.md §5.6): the predicates
  along it, the slot's own included, and everything below where it ends; a
  failing sibling no longer refuses it. The generated per-type explainer takes
  the bind path as an optional focus, and a refused field is remembered as its
  own value and laid over the slot as it now is, so `error(field=…)` judges
  what every field shows even after a sibling is written.
  A position no bind step can name (a container's element, key or entry, a
  union's payload) is checked whole whatever steps the focus has left, and a
  control bound to the whole slot is laid under the fields bound into it,
  whichever was refused first.

- d8ff739: Resolve a responsive `cols` / `rows` map, and use the theme's breakpoints

  style.md §4.5 shows `grid(A, B, C, D) { cols: {base: 1, md: 2, lg: 4} }`, but
  the grid's tracks accepted only a number or a string. A breakpoint map fell
  through to the default `repeat(3, 1fr)`, so the grid had three columns on a
  phone and three on a desktop. The SSR renderer carried its own copy with the
  same gap. Separately, the viewport pick hard-coded 640 / 768 / 1024 / 1280 px,
  so a theme that declared `md: "500px"` still switched at 768 px.

  The grid's `cols` and `rows` now go through the same responsive pick as
  `gap` / `pad`: the viewport's breakpoint on mount, `base` in SSR. The DOM and SSR
  renderers share one `gridTracks`, which lives in core beside `propStyleDecls`. The
  pick reads the active theme's `breakpoints` over the §4.2 defaults, so a theme can
  move a key or add one of its own, and tries them widest first by their px size
  (rem and em count 16px each), so `md: "48rem"` sits above `sm: "640px"`. A width
  that is not px, rem, em or a number is left out. §4.2 and §4.5 state this in both
  language tracks.
  `packages/examples/features/158-responsive-breakpoints.kumiki` uses a theme with
  moved and added breakpoints, and the e2e tier checks its grid in Chromium at
  four viewport widths.

- 3573ca7: Fire `route.error` once for a render that panics

  A `route.error` reducer's write re-rendered the page on the spot, and that page
  was the one that had just panicked. So it panicked again and fired the reducer
  again, one level deeper each time — about a thousand nested renders — until the
  stack overflowed. The overflow itself was then caught as a render panic with no
  tile to name, so which `$event` the reducer last saw depended on the frame it
  landed in: sometimes the route target (`"Boom"`), sometimes `"render"`. That is
  why a test pinning `$event.location` failed only some of the time.

  The handlers' writes no longer render on their own. The render that caught the
  panic already renders once more after they return, which is where a navigation
  they asked for takes effect; if that render still panics, the built-in panic
  display is shown and the handlers are not fired again.

- 58d3da3: Fire `route.leave` on every move to another path, even within one pattern

  Moving from `/todos/1/edit` to `/todos/2/edit` fired `route.enter` again with
  the new params, but skipped `route.leave`, because the leave chain only ran
  when the old and new patterns differed. The §3.5.2 unsaved-changes guard on
  `route.leave("/todos/:id/edit")` therefore never saw a "next item" link, and
  the edits were dropped without the `confirm`. A child switch under a
  `sub-routes` parent had the same gap: the parent's pattern was re-entered and
  never left.

  Leave now runs whenever the path or the pattern changes, before enter. It
  receives the old route as `$route`, and a `confirm` it emits holds a
  params-only move exactly as it holds a move between patterns. A query-only,
  hash-only or same-path navigation stays on the route: it runs no leave (so no
  guard asks) and re-runs enter, as before. When the guard's "No" reverts a held
  move, the URL now gets the old route's query and hash back along with its path.
  routing.md §3.4 states this in both language tracks.
  `packages/examples/features/155-leave-on-param-change.kumiki` walks the guard
  through a params-only move and a child switch.

- 8d4eb0c: fix(runtime): let `runScenario` dispose the mount it made.

  The handle `mount` returns was dropped on the floor, so the app the runner
  started never stopped. Two things followed from that, and only one of them was
  loud.

  A `timer` reducer kept its `setInterval` after the report was returned. Under a
  test runner that tears its DOM environment down between files — vitest with
  happy-dom, which is how this repository's scenario tier runs — the next tick
  renders into a world with no `document` and raises
  `ReferenceError: document is not defined` as an unhandled error, out of a run
  whose every test passed. Whether a tick lands before the process exits is a
  matter of timing, so it read as a flake: it failed CI twice during the v0.13
  release and passed on re-run both times.

  The quiet one: the shape stayed registered as mounted, so a second run of the
  same `AppShape` was not a second run. It became another _view_ of the first —
  `app.init` did not fire again, and the `onDiagnostic` this runner always passes
  was refused with a warning, leaving every step's `diagnostics` empty for the
  rest of that shape's life.

  `runScenario` now disposes in its `finally`, the same shape `runSmoke` already
  had. Each step's `state` and `domText` are captured as the step runs, so the
  report is unchanged — but the root is empty once the call returns. A caller
  that needs to query elements rather than read `domText` should mount the app
  itself, which `docs/spec/testing.md` now states under Scenario Execution.

- d3d6611: `sort-by` orders a `Text` key, and reports a key with no order

  `users.sort-by($1.name)` returned the list unchanged. The comparator subtracted
  the two keys, and two `Text`s subtract to `NaN`, which a JavaScript sort reads
  as "equal", so no element moved. It passed `check`. Numeric and `Time` keys
  worked, which is why it went unnoticed.

  The comparator now asks `<`, so a key is ordered the way `a < b` orders it
  (language.md §1.9.4): numbers and `Time` numerically, `Text` as two `Text`s
  compare. The sort stays stable. A key `<` does not order — a record, a variant,
  a `Bool`, an `Option`, a container — is E0201 at check time instead of a silent
  no-op, whether it is written as a fragment (`$1.kind`) or as a `fn` passed by
  name (`users.sort-by(kindOf)`), whose declared return type is the key's type.

  `Text` order is UTF-16 code-unit order, not a locale's collation: `"Z"` sorts
  before `"a"`, and kana and kanji by code point rather than by reading.

  One case orders differently from before. A key declared numeric or `Time` whose
  value arrives at runtime as `Text` — an HTTP JSON body is not converted to the
  declared types, so `{"age": "30"}` lands in an `Int` field as a string — used to
  be coerced by the subtraction and sorted numerically. It is now ordered as the
  `Text` it is, the way `<` would order it: `"10"` before `"9"`.

  A key with no value to order — absent, or `NaN`, which only a key the checker
  could not type can be — now sorts after every other key, keeping its order.
  Compared as "equal" to everything, a single one used to stop the rest of the
  list from sorting.

- d9d29ca: Apply the capability check on the server render pass

  `renderToString` invoked every effect an `init` emit or an effect reducer
  named, whether or not its capability appeared in `app.caps`. The live
  dispatcher has always refused those, so the effect ran once on the server and
  never again after hydration — for an HTTP or storage effect, the difference
  between a request issued from the prerender and no request at all.

  The server pass now applies the same rule as the live dispatcher, exempting
  standard presentation effects the same way (an empty `cap`), and consults the
  gate before any host provider so an undeclared capability cannot be answered by
  a host implementation.

  **This changes what a deployed app renders** if its `caps` omits a capability
  the server pass had been honouring silently: slots that used to arrive
  prefilled now serve at their declared defaults, which is what the client
  already showed once hydration replaced them. Declaring the capability restores
  the old behaviour on both sides.

  A refused emit is recorded on the bootstrap episode as an `effect-start`
  followed by an `effect-cancel` — the shape a replaced `debounce` timer leaves —
  so the pass is accounted for in the record the hydrated client reads and not
  only in the server's console. The live path records nothing for the same
  refusal under the default policy, where the gate returns before any token is
  claimed; the two logs therefore describe one refusal differently, and
  `runtime.md` §10.5.1.1 now says so.

- ead317d: Resolve `->>` redirects in `renderToString`, as `mount` does

  `mount` resolves a static redirect with `routing.findRedirect` before its first
  route sync. `renderToString` only called `parseLocation`, which skips redirect
  entries, so a redirected URL was served the `/404` tile. A redirect inside a
  `sub-routes` map was served the parent's default child instead. Hydration then
  replaced the page with the target. The shipped `apps/03-blog` declares
  `"/" ->> "/posts"`, so its server-rendered home page was "Page not found".

  The SSR pass now resolves the redirect first through the same
  `findRedirect` and renders the target. `route` reads the target while the
  tiles render, and `snapshot.route` and the bootstrap episode's
  `trigger.target` name it. The requested `route` may carry a query and a hash
  (`/old?ref=x` is redirected as `/old`); it is split the way the client's router
  reads a location, with the pathname kept as written, so `//foo` and `/a/../b`
  land where they land in a browser rather than being normalized. Without a routing module, a
  redirect written for exactly the requested path applies, matching the
  literal-string fallback used for routes. runtime.md §10.6.1 says this in both
  language tracks. `packages/examples/features/154-ssr-redirect.kumiki` has a
  top-level and a sub-route redirect.

- 7cedcce: `storage-remove` removes its key and `storage-clear` clears the storage

  http.md §6.7.2 declares three effects on `cap=storage.write`: a write
  (`{key, value}`), a remove (`{key}`) and a clear (`Unit`). The handler only
  knew `setItem`. A remove stored `JSON.stringify(undefined)`, which `setItem`
  writes as the string `"undefined"`, and reported ok, so every later read of the
  key failed to parse. A clear threw destructuring its `Unit` input and always
  erred. `session.write` shares the code (§6.7.4), so `session-remove` and
  `session-clear` did the same.

  A clear is now decided by the declaration: a `storage.write` / `session.write`
  effect declared `in=Unit` with no `map-request` calls the new `storageClear` /
  `sessionClear` handlers, which empty the whole origin's storage. Every other
  write reads the request: a record with no `value` field removes the key (a
  later read answers `None`), and a record with a `value` field writes it,
  whatever the value is. A request that is not a record (an empty one included,
  which a `Map` index that finds nothing also produces), a key that is not a
  non-empty text, or a value JSON cannot encode is an `err` that changes
  nothing, so a bad request can no longer wipe or corrupt the storage. A failed
  Web Storage call is an `err` whose message names the call and the key.

  Codegen passes the `map-request` record through as built, instead of
  rebuilding it as `{key, value}` and so always giving it a `value` field. This
  changes what a host provider for `storage.write` / `session.write` receives:
  the request as `map-request` built it (as stdlib.md §2.5 already says), not a
  `{key, value}` projection, and no request at all for a clear. A provider that
  only implemented `setItem` must now handle a remove and a clear as well.

- ad2c6f8: A submit button with a click reducer submits its form in a browser

  The button renderer cancelled every click it had a handler for, and
  cancelling a submit button's click cancels its activation: as soon as a
  `ui.click` reducer (or a lifted one, or `onClick=`) targeted a
  `type="submit"` button, its form never submitted — by click or by Enter —
  while the scenario tier, whose clicks were not cancelable, passed. The click
  is no longer cancelled (forms.md §5.2.2: the click reducer and the submit are
  independent; `type="button"` is what keeps a button from submitting), and the
  scenario and smoke tiers now dispatch cancelable clicks, as a user's click is.
  That includes a button inside a form that writes no `type`: it is `submit` by
  the HTML default, so its click reducer now runs and the form submits. The
  issue tracker example's Cancel button now says `type="button"`, as §5.2.2 asks
  of a button in a form that is not meant to submit it.

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

- 1a3b24c: Repaint every tile when `app.theme`'s slot switches the theme

  With `app … theme = themeName`, changing the slot re-applied only the body
  style and the base stylesheet. Token props (`bg`, `color`, `pad`, `gap`,
  `radius`, …) are resolved to literal values when a tile renders, and the
  reconciler leaves a tile untouched when its own props did not change. After a
  Light → Dark toggle the page background was dark, but every box kept Light's
  colours and spacing.

  Each view now records the theme its tree was painted under. A pass that finds
  the resolved theme changed builds the tree afresh instead of diffing it, so
  every tile, nested ones included, carries the new theme's values, the same as
  a fresh mount under that theme. That applies to a hydrated view too. Focus and
  selection come back the way they do after any rebuild. Enter animations
  (`transition`, `motion`) do not play again on the rebuilt elements: a one-shot
  animation shows its final frame and a repeating one keeps running. DOM state no
  slot holds starts over, including text a `bind` refused, whose field error goes
  with it. runtime.md §10.3.6 describes what a switch re-applies, in both
  language tracks. `packages/examples/features/157-theme-switch.kumiki` toggles
  between two themes.

- f9a999c: `Time.parse` reads ISO 8601 `YYYY-MM-DD` with an optional time and zone, and refuses everything else, including a date that is not on the calendar

  `Time.parse("2026-02-30")` was `Some` of March 2nd, and `"2026-13-01"` was
  January 1st of the next year. The text went to the platform's parser, which
  normalises an out-of-range field instead of refusing it, reads some non-ISO
  text with a legacy parser (`"0050-01-01 10:00"` was 1950), and accepts
  formats such as `"2026/02/30"` or `"Aug 14 2026"` that differ between engines.

  `Time.parse` now reads the text itself, as stdlib.md §2.2.8 states:
  `YYYY-MM-DD`, then optionally `T`, `t` or a space and `HH:MM`, `:SS` and a
  fraction, then optionally `Z`, `z` or `±HH:MM`. The date has to be on the
  calendar (leap years included) and the year is the one written. Without a
  zone the text is local time, as a date-only string already was; with one it
  is that instant. Anything else is `None`: a date off the calendar in any of
  these forms, the extended-year form `+002026-08-14`, a non-ISO date, and text
  with blanks around it (`" 2026-02-28"` was UTC midnight, not the local one).

- b9e5ca6: An `input` bound to an `Int` / `Float` / `Time` slot writes a value of that type

  `input(bind=age, type="number")` wrote the field's string into the `Int` slot,
  so `age + 1` rendered `51`; a `Time` slot bound with `type="date"` became the
  string `"2026-03-04"`. The field's text is now read the way `Int.parse` /
  `Float.parse` / `Time.parse` read text — by the bound position's base, through
  a record field or, with `.get`, an `Option` or `Result` payload, and through
  aliases and nominals — and text that spells no value of it is refused like a
  refinement violation: the slot keeps its value, the field what was typed, and
  `error(field=…)` says why ("Must be a whole number" / "Must be a number" /
  "Must be a date", overridable as `theme.errors.int` / `float` / `time`), on a
  slot with no refinement too and before any refinement's message. A `Time` is
  shown to a `type="date"` field as `yyyy-MM-dd` (a `type="datetime-local"` one
  as `yyyy-MM-ddTHH:mm`), and a field whose text already reads as the slot's
  value (`"2.50"` for 2.5) is not rewritten under the caret.

  `kumiki check` reports an `input` whose field kind does not go with the bound
  type (E0226): an `Int` / `Float` outside `type="number"`, a `Time` outside
  `type="date"` / `"datetime-local"` (a `type="time"` field was shown the
  millisecond count and could never write), and a type no field reads — a
  `Bool`, a record, or an `Option` bound whole rather than through `.get`.

## 0.13.0

### Minor Changes

- 85a792b: fix(runtime): a conditional branch that _adds_ `onFocus` / `onBlur` /
  `onKeyDown` / `onMouseEnter` now reaches the DOM.

  Those four are lifted onto every tile kind by the runtime rather than by a
  per-kind renderer, and they dispatch through one shared per-element slot. The
  native listeners that read the slot were registered only when the tile carried
  a handler at create time — so a branch introducing one on a later render had
  nowhere to land: the element is reused, the slot is refreshed with the new
  handler, and no listener was ever registered to read it. Nothing threw, and no
  diagnostic fired; the handler simply never ran.

  Registration now happens on the render that first fills the slot, at create
  time or on a patch. A tile that never carries one of the four still registers
  nothing, so the saving on the tiles that will never need them is kept.

  `onClick` was unaffected throughout — its listener is registered
  unconditionally by the button renderer.

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

- 080f358: feat(runtime): the scenario tier can fire keydown and mouseenter.

  `ui.key` and `ui.hover` lift to `onKeyDown` / `onMouseEnter`, which the runtime
  wires through the same per-element slot as `onFocus` / `onBlur`. `focus` and
  `blur` exist as scenario actions precisely so that `addEventListener →
applyUiEventHandlers → reducer` path could be asserted; the other two had no
  action, no example driving them and no reach from `smoke`, which dispatches only
  click, input, change and submit. The runtime's own tests fire all four directly,
  so a wiring regression was not invisible — but nothing in the example corpus
  could reach these two, so a program that renders and then ignores a key press
  passed check, build, smoke and every scenario.

  `{"key": "<selector>", "value": "<key>"}` dispatches a `KeyboardEvent` carrying
  that key, and `{"hover": "<selector>"}` dispatches a `mouseenter`. Both are
  dispatched on the element the selector matches, which is where the runtime
  attaches its listener. `keydown` bubbles from there — that is what lets
  `ui.key(Container)` be driven from a focusable descendant — while `mouseenter`
  does not, since a browser fires a separate one on each ancestor rather than
  propagating a single event.

  A `ui.key` reducer's payload carries `key` and `code`; only `key` is set from
  this tier, because a `code` names a physical key that a scenario asking for
  `"Enter"` has not chosen. `value` is required and must be non-empty: the event's
  `key` defaults to the empty string and the listener never reads it, so a step
  pressing nothing would fire the reducer and report success.

  The browser tier does not run these two yet, and now says so by name rather
  than reporting them as unknown actions.

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

- 79b221e: fix(runtime): serve the style the client paints, and make one `AppShape`
  mounted twice mean two views of one app.

  **SSR carried no styling at all.** `ssr-render.ts` did not contain the word
  `props`, so a served page laid every flex container out as a block and reflowed
  the moment hydration finished — the layout shift SSR exists to remove. The
  prop-to-style mapping is now data (`containerStyleDecls` / `textStyleDecls`),
  applied to an element by the renderers and serialised into a `style` attribute
  by the server. A kind's own base layout stays with the per-kind switch on each
  side, because the renderers are the per-app DCE unit; a test that renders one
  node per kind both ways and compares the element, its attributes and its
  CSSOM-normalised style is what keeps the two copies honest. It also found that
  the icon placeholder used a different attribute than the renderer writes, the
  spinner was a `div` where the client makes a labelled `span`, the skeleton had
  none of its frame, and a `label` dropped its `for`.

  A responsive value collapses to its base on the server — a breakpoint is a
  question about a viewport it does not have. Class-backed layers (`transition`,
  the `hover:` / `focus:` / `active:` blocks, motion) stay client-only.

  **Mounting one shape twice froze the earlier mount.** Each mount overwrote the
  shape's imperative seams, so the last one captured every event that resolved
  through the shape: the first host's own buttons re-rendered the second, and
  `el.setSlot` on the first element landed on the second. The spec says passing
  the compiled default export rather than the `createApp` factory "shares one
  instance across all elements of that tag", which is only worth saying if every
  element stays live.

  A shape carries the app's state, so a second mount is a second _view_. Where the
  app is painted is now per view (the mounted element, the tree behind it, the map
  the next reconcile diffs against) and what it says is shared, because the state
  is. What the app owns once belongs to the first mount — `app.init`, `app.start`,
  the timers, the router, the effect dispatcher — so a second view does not re-run
  initialization or double a timer's ticks. Disposing a view leaves the others
  interactive; the app is torn down with the last one, after which the shape starts
  over — initialization, timers and router run again, while `app.live` keeps
  whatever the app had written. Adding a view with `hydrate` throws rather than overlaying a server
  snapshot onto a state that is already live.

  Apps built with `createApp()` per instance are unaffected, and the multi-mount
  isolation guarantees are unchanged.

- b8bd5d9: fix: make the documented tile props reach the DOM.

  **A prop's name had two spellings.** The compiler lowers a Kumiki name to a
  JS-safe key (`test-id` → `test_id`, `max-w` → `max_w`), while `TileProps` is an
  open record — so a runtime that read `props["max-w"]` type-checked, rendered,
  and did nothing. Every app in the corpus set a page width that never applied.
  The lowered name is now the only spelling the runtime reads, and the guard is a
  table that starts from `.kumiki` source and ends at an attribute or a CSS
  declaration, on both rendering paths: a hand-built `TileNode` can agree with the
  runtime about a spelling the compiler never emits, which is how this survived a
  suite that compared the two paths to each other.

  **A named argument was dropped unless its kind lifted it.** The spec writes
  `button(text="Log in", loading=pending)` a few lines from `{variant: "ghost"}`,
  so the two forms have to arrive alike; instead, `image(alt="A cat")` satisfied
  the a11y check and rendered no `alt`. Every named argument now folds into the
  props — the generalization of the `id` fold that already existed for selector
  matching — so it reaches the renderers and the `$el` payload from either form.

  Now applied to **every kind**, client and server alike, because the mapping
  moved out of the per-kind renderers and into the one pass that sees every
  element: `class` (added to the runtime's own classes, not over them), `aria` and
  a bare `aria-*`, `test-id` as `data-kumiki-test`, `role`, `id`, the style
  shorthands (`bg`, `color`, `pad`, `pad-x` / `pad-y`, `gap-x` / `gap-y`,
  `radius`, `shadow`, `size`, `weight`) and the sizing props (`w`, `h`, `min-w`,
  `min-h`, `max-w`, `max-h`, `aspect`, `wrap`) — so a `max-w` on an `image` and a
  `bg` on a `button`, both of which the spec's own examples write, now land. A
  kind that maps a prop itself keeps it: a `spinner`'s and an `icon`'s `size`, a
  `skeleton`'s `h`. `radius` and `shadow` read the theme sections of those names
  rather than the spacing scale, and the SSR pass resolves the theme at all,
  which it did not: a themed page was served with the unthemed defaults.

  Per tile: a `button`'s `loading` (disabled, `aria-busy`, a spinner in front of
  the label), `disabled` and `variant`; an `image`'s `width` / `height` /
  `loading`; a `link`'s `external`; a `divider`'s `orientation`; and the input
  family's `disabled` / `readonly` / `auto-complete`, which forms.md §5.3 calls
  their common props. All of it is diffed on the reconcile's patch path, so a
  `class` bound to a slot swaps rather than accumulates and a `max-w` that goes
  away leaves.

  **New diagnostic `E0705` (`a11y-label-for`)**, under `--strict-a11y`: a
  `label {for: "x"}` whose literal target matches no `id="x"` anywhere in the
  program. Two of the example apps had five such labels between them.

  `style.md` §4.4.7 drops `"sm"` from `w`: there is no width scale in the theme,
  so it was a token name with nothing behind it. `testing.md` §8.8 now names the
  global that exists (`window.__kumikiApp.live`) instead of one that never did.

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

## 0.12.0

### Minor Changes

- 5fb6fb6: feat(runtime,compiler): identity-preserving reconciliation for changed-but-reused tiles (#190).

  Follow-up to #187 keyed diff and #188 stable tile identity. Extends the reconcile
  kernel so a same-kind tile whose data props diverge is mutated in place instead
  of torn down + rebuilt — browser-owned state (`<select>` open dropdown / value,
  `<video>` playback position, `<details>` open, contenteditable caret / IME
  composition) now survives a reducer-triggered re-render mid-interaction.

  - **Runtime** — every `tiles-*.ts` module exports a companion `{X}Patchers:
TilePatchers` alongside `{X}Tiles`. `reconcileNode` routes same-kind
    data-prop divergences through the per-kind patcher; kinds without a patcher
    fall back to the pre-#190 subtree rebuild. A per-element `WeakMap` handler
    slot on input / textarea / select / check / radio / switch / slider /
    editable / form / button / link / modal / drawer / popover reroutes
    `bind` / `onChange` / `onClose` / `to` closure changes without add/remove-
    listener churn. The `<select>` patcher does a keyed `<option>` diff by
    serialized value key so the dropdown / selection state stays intact when
    the options list shifts. Focus / caret snapshot layer is retained as the
    fallback for wholesale-swap paths (reconcile bailout, panic recovery,
    keyed reorder that moves a focused element between DOM positions), with
    `<select>` added to its tag-name filter.

  - **Compiler + runtime** — two new built-in tile kinds:

    - `details(summary=..., open=...)` — native `<details>` disclosure.
    - `editable(bind=..., text=...)` — `<div contenteditable="true">` with
      plain-text `textContent` write-back on `input`. The patcher skips text
      overwrites when the DOM already matches the target text (the common
      case during typing, where the bind loop keeps slot and DOM in sync)
      and skips them entirely while an IME composition is in flight so the
      candidate window is not dismissed mid-glyph.
    - `input`, `textarea`, and `editable` all install
      `compositionstart` / `compositionend` listeners at create time so
      JP/CN/KR IME users are not disrupted by a re-render mid-composition.

  - **Spec** — `docs/spec/runtime.md` gains §10.3.11 documenting the patch
    contract, handler-slot pattern, value-write guards, and the demoted role
    of §10.3.9's snapshot layer. `docs/spec/stdlib.md` §2.3 catalog lists
    `details` and `editable`.

  - **Verification** — new e2e fixtures under
    `packages/examples/features/{54,55,56,57}-*.browser.json` prove all four
    acceptance elements (`<select>` / `<video>` / `<details>` /
    `contenteditable`) survive a re-render mid-interaction under Chromium.
    `packages/runtime/test/reconcile.test.ts` adds per-kind
    identity-preserving unit coverage.

  - **Benchmarks** — `packages/benchmarks/reactivity/reactivity-cost.mjs`
    now reports `nodesCreatedPerUpdate: 0` for a leaf-only text change
    across every tile-count sample (down from the #187 baseline of 1 element
    per update): the mounted `<h1>` gets `.textContent = ...` in place.

  Compiler + runtime ship together — the new `details` / `editable` tiles
  require the matched runtime, and the runtime's `TilePatchers` registry is
  consumed by any built bundle.

- 353cd5c: fix(runtime): a keyed child with no element mapping now reaches the same panic
  whether it stays, leaves, or sits under a parent the keyed pass was about to
  decline for another reason.

  The keyed child pass treated one broken invariant three ways. A surviving child
  with no entry in the node → element map threw, and the reconcile bailout
  recorded a `location: "reconcile"` panic — loud without a diagnostic sink. A
  departing one hit `if (oldChildEl && …)` in the removal loop, where the failed
  lookup read as "nothing to remove": nothing thrown, nothing reported, and the
  element the renderer had hand-built left mounted for as long as the app runs.
  And under a parent whose renderer does not place every child directly, the
  `unplaceable-insert` decline came first, so the pass that would have thrown was
  never entered at all.

  That silence undercut the placement gate's stated reason for letting an unmapped
  child through. The gate declines the keyed pass for a child mounted below a
  renderer-owned wrapper, but steps over an unmapped one on the grounds that the
  pass throws on it — an invariant break, not a placement style. For a departure
  and for a later decline it did not, so the one arrangement the gate was
  reasoning about reached neither the panic nor `child-unmapped`. A renderer that
  builds a child outside `ctx.render` was invisible for exactly as long as that
  child was on its way out.

  The mapping is now resolved the moment the measured placement check comes back
  clean — ahead of the declared-placement check, and before anything is
  reconciled, mounted, or removed — and a missing one throws there. Neither what a
  child was about to be nor which reason the parent might have had to decline
  decides whether its broken invariant is heard, and the throw leaves the pass
  having applied nothing: the rule §10.3.10 already stated for the structural
  walk, now stated for this one. The panic's full rebuild is also what clears the
  stranded element, which the silent skip never did.

  Two guards went with it. The removal loop's `parentNode === parentEl` could not
  be false once the gate had passed, and nothing the pass itself does can undo
  that, so both it and the anchor scan's copy are gone and what guarantees them is
  named where they were. Should host code running in between ever move a departure
  out, `removeChild` surfaces it as a panic on the same path rather than as a
  skipped removal.

  No example accompanies this. It is reachable only from a host renderer that
  places a child without going through `ctx.render`, which is not something a
  `.kumiki` program can express at any tier the repo has — the same position as
  the keyed-placement fixes before it. The runtime unit tier covers all three
  arrangements.

- 46bee64: feat(runtime): reconcile the new tile tree against the mounted one instead of
  tearing the whole tree down on every state change (#187).

  Every slot write used to rebuild the entire tile tree and hand it to
  `target.replaceChild`, so a leaf-only change re-created every Element on the
  page. The walker now diffs the new `TileNode` tree against the mounted one and
  rebuilds only the subtrees that actually changed; an unchanged tile keeps its
  live DOM node, and with it focus, caret, `<select>` open state, and its event
  listeners. Identity is structural here — position plus `kind` — with explicit
  keys arriving in #188.

  Measured on the reactivity benchmark (`measure:reactivity`, happy-dom floor),
  waste ratio and median render for a single leaf change:

  | tiles | before          | after         |
  | ----- | --------------- | ------------- |
  | 10    | 13× / ~0.12 ms  | 1× / ~0.03 ms |
  | 50    | 53× / ~0.43 ms  | 1× / ~0.05 ms |
  | 200   | 203× / ~1.40 ms | 1× / ~0.14 ms |
  | 500   | 503× / ~3.88 ms | 1× / ~0.22 ms |

  Render time decouples from total tile count: one Element created per update,
  which is the semantic minimum. The focus/scroll snapshot layer stays as the
  fallback for tiles that did rebuild.

  Design: `docs/design/reactivity-v2.md` §2 Decision 1(a).

- 027a8af: fix(runtime): a keyed reorder now places only the children that have to move,
  so a focused child the reorder leaves alone keeps its cursor natively.

  The reorder phase of the keyed child pass replayed the whole target sequence
  with `appendChild`. That produces the right order for any permutation and is one
  line, but it detaches and re-attaches **every** child on every render that
  reaches the keyed path — including the ones already in their final position, and
  including renders where nothing moved at all.

  Re-attaching a node blurs it. Focus, the caret in a text field, an open
  `<select>` dropdown and an in-flight IME composition are exactly the state keyed
  matching exists to preserve, and the sweep spent it on children that had no
  reason to move. That was papered over by the render pass's focus restore
  (§10.3.9), which is a snapshot/restore fallback — the guarantee §10.3.11 makes
  is that the patch path does not need it. Underneath the correctness cost sat a
  throughput one: N DOM moves per render for a list that is stable, which is the
  common case.

  **The fix.** The survivors whose old positions already ascend stay untouched,
  taken as the longest such run so the fewest children are left over; everything
  else is inserted against its successor, right to left, so each anchor is final
  by the time it is used. Fresh mounts and removals slot into the same pass. A
  render that does not change the order performs no DOM placement at all, one item
  moving costs one, and the worst case — no two children keeping their relative
  order — costs N−1.

  Placement also stopped going through `appendChild`. The pass now inserts against
  the node the mounted child list ends on, read before any rebuild or removal can
  invalidate it, so a renderer that keeps content of its own after its children
  keeps it there. The sweep walked the children past it.

  **What is not covered, and why.** No example accompanies this. The difference is
  not observable from a `.kumiki` program at any tier the repo has: element
  identity was preserved before and after (a move is not a rebuild), and for the
  element kinds a browser fixture can inspect — `<input>`, `<textarea>`,
  `<select>` — the focus-restore layer puts focus and the selection range back,
  which is what made the bug survivable in the first place. What is observable is
  the DOM operations, and those are asserted in the runtime unit tier: the count
  per transition, and that a focused child which did not move is never passed to
  the container's `insertBefore` / `appendChild`. The accompanying `blur` listener
  states the consequence a user feels but does not enforce it there — happy-dom
  does not model a moved element losing focus.

  `measure:keyed-moves` reports the counts against both the hand-derived minimum
  and the sweep. At 500 rows the sweep moved 500 children for unchanged, one-item,
  insert and remove alike; the measured counts are now 0 / 1 / 0 / 0, and 499 for
  a full reversal.

- 3d89383: feat(runtime,compiler): replace the `__kumikiApp` global with a WeakMap mount-root registry for safe multi-mount.

  Several Kumiki apps on one page (multiple Web Components, micro-frontends, Storybook previews) previously shared one `window.__kumikiApp` reference — the last mount captured every other app's bind write-back, link navigation, icon lookup, and generated event dispatch (last-write-wins).

  **BREAKING (runtime)**

  - `mount` / `mountCore` no longer write `window.__kumikiApp`. App resolution is keyed off the mount target: each mount stamps its target element with `data-kumiki-root` and registers in a WeakMap; the new public `resolveApp(el)` walks up to the nearest mount root (hopping shadow boundaries) to find the owning app. Compiled bundles still assign `globalThis.__kumikiApp = App` at module evaluation — that assignment is now a tooling-only state oracle (smoke / scenario / e2e / benchmarks) and nothing in the runtime reads it.
  - `currentTheme()` returns the theme of the app whose render/mount pass is currently running, and `null` outside one (previously: the most-recently-mounted app's theme, at any time). Hosts that called `currentTheme()` outside a render pass must resolve the app themselves (e.g. via `resolveApp`).
  - Events fired on elements detached from any mount (e.g. a node replaced by a re-render) are now a no-op instead of being delivered to the most-recently-mounted app. The runtime emits a once-per-element `console.warn` so the drop is observable (the smoke tier watches console output); a `link` click outside any mount degrades to the browser's native `href` navigation instead of dying silently.

  **BREAKING (compiler)**

  - Generated event handlers call `App._dispatch(...)` (the enclosing `createApp()` instance) instead of `globalThis.__kumikiApp._dispatch(...)`. Public API is unchanged; tools that string-match the generated JS must follow.

  **New**

  - runtime: `resolveApp(el)` public export, returning the new `MountedApp` type (an `AppShape` whose imperative seams — `_dispatch` / `_setSlot` / `_navigate` / `_prefetch` — are attached by the mount).
  - `defineKumikiElement` instances are now DOM-event-safe under multi-mount for both `shadow: true` and `shadow: false`.
  - e2e: `runMultiOnPage(page, sources, scenario)` co-mounts several compiled apps on one page with a per-app-index state oracle (`"0.count"`).

  Out of scope: theme `<style>` node contention when several _themed_ apps share one style root (document head) — shadow DOM remains the isolation answer there.

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

- 4a58f8f: runtime: populate episode `signal-update` step's `binds-updated` field from the tiles/binds the keyed diff (#187) actually patched (#189, follow-up to #159 Decision 3).

  Turns "slots X, Y changed" in the episode log into "slots X, Y changed → tiles A, B / bind `todo.title` were re-rendered" — a causal chain that makes "slot changed but tile did not update" bugs directly visible in `kumiki run --episode-log` traces and the MCP episode reader. Identifier priority per patched subtree root: `bind` (joined with `bindPath`, matching `data-kumiki-bind`) → `TileNode.key` → `kind`.

  No schema change: the field was already declared on `EpisodeStep` and always emitted as `[]`; consumers that ignored it continue to work. SSR bootstrap episodes still emit `binds-updated: []` (no diff runs there).

- 32dd683: fix(runtime): the unkeyed child walk now decides the parent's fate before
  applying any of it, so a render that rebuilds a parent no longer reports the
  children it threw away.

  The structural child walk reconciled children one at a time, and two of its
  give-up conditions — a hole in the child list, and an old child with no element
  mapping — were discovered mid-list. By the time index `i` failed, children
  `0..i-1` had already been patched in place or had their subtrees rebuilt, and
  each had pushed an identifier onto the reconcile-touched set. The parent was
  then thrown away and rebuilt, discarding that work. The identifiers stayed.

  That set becomes the episode log's `signal-update.binds-updated` (§10.3.11).
  An episode is the author-facing causal record — "slot `X` changed → tiles `A`,
  `B` updated" is a claim the runtime makes about what happened, and here `A` and
  `B` did not survive the render. The same partial pass could emit a diagnostic
  (§10.3.12) for a subtree the very next line discarded: a `no-patcher` naming a
  rebuild that was undone before the render finished.

  Underneath sat an unstated assumption. The `newMap` entries those children
  wrote self-healed only incidentally — the parent's rebuild walks the same child
  nodes through `ctx.render`, which overwrites them. True of every renderer that
  goes through `ctx.render`, but a coincidence of the current codegen rather than
  a rule, and never something a host renderer was asked to honour.

  Both bail conditions are now resolved for the whole child list before the walk
  starts, so the pass either runs to the end or never begins. A bail leaves no
  trace of the subtree: no DOM change, no touched identifier, no `newMap` entry —
  and nothing left for the rebuild to overwrite, so the assumption is gone rather
  than restated. The evidence a bail carries is unchanged: the scan asks the same
  questions in the same order, and still reports the same `reason`, `index` and
  `childKind`.

  One consequence is worth stating rather than discovering: the diagnostics the
  abandoned siblings would have raised are no longer raised either — neither a
  `reconcile-fallback` nor a `stale-closure-risk` from a subtree the render threw
  away. That is the same rule `binds-updated` follows, and it has a cost. A
  `no-patcher` is a configuration fact, not a per-render one, so a child under a
  parent that rebuilds every render stays unreported for as long as that lasts;
  the parent's own reason is the one to fix first. §10.3.12 now says so.

  Reachable only from a host-built tile tree — Kumiki codegen flattens nils away
  and routes every child through `ctx.render` — so no authored app changes
  behaviour. What changes is that the log an author reads is true for the ones
  that do reach it.

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

- 92ca76d: fix(runtime): a child list crossing the empty boundary keeps its parent, and a
  keyed newcomer is no longer appended bare under a wrapping renderer.

  **Two bugs, one root.** The keyed child pass may only run when the parent
  element actually holds its children's slots, and until now the walker answered
  that by measuring where the mounted children sit. A measurement can only speak
  for slots that already exist, so it is unsound for any old list too short to
  have exercised the renderer's wrapping rule — and `overlay`, which places its
  first child in normal flow and wraps the rest, is exactly that renderer at both
  of the short lengths.

  - **At zero.** `allChildrenKeyed` returned `false` for an empty array, so a
    parent whose old child list was empty could never take the keyed path.
    `[] → [keyed…]` and `[keyed…] → []` both fell to the structural walk, which
    saw a length change, reported `child-count-change`, and rebuilt the parent
    subtree — discarding the container's element and whatever browser-owned state
    it held. That is the "empty state → first item" transition: an empty todo
    list, a result set before the first query, an empty cart. It is precisely
    where the author has already given every child a key, and the runtime
    declined to use it.
  - **At one.** With exactly one mounted child, `overlay` measures as placing its
    children directly — truthfully. Growing to two then took the keyed path and
    appended the newcomer straight onto the overlay, with no positioning layer
    around it and no diagnostic. Silent DOM damage.

  **The fix.** A child list that is empty on exactly one side is now decided
  before keys are consulted at all: there is nothing to pair, so the only question
  left is where the new children go, and the runtime asks the one component that
  knows — it re-enters the parent's renderer for a fresh interior and moves that
  into the mounted element. The parent keeps its element, the interior is what a
  full render would have produced (so a wrapping renderer stays correct), and
  neither `child-count-change` nor `wrapped-children` is reported. The decision is
  key-agnostic because keys had nothing to match, which also picks up the
  commonest unkeyed shape in real Kumiki, `column(when(open, X))`.

  Whether a _newcomer_ can be placed is now read from the renderer's declared
  placement instead of from the DOM, since nothing can measure a slot that does
  not exist yet. The declaration covers the built-ins that wrap — `overlay`, and
  `modal` / `drawer` / `popover`, which wrap all of theirs in a content div (§10.3.10
  previously named only `overlay`). It bites only when there is something to
  place, so a same-membership render of a one-child overlay still takes the keyed
  path. A decline is reported through `onDiagnostic` as a new `ReconcileFallback`
  reason, `unplaceable-insert` (with `index` and `childKind` of the newcomer).
  Host renderers are absent from the declaration on purpose: the spec asks them to
  place their children directly under the element they return, so an unknown kind
  is taken at its word.

  **Known limitation.** Re-entering the renderer rebuilds its non-child interior
  too — a `details`' `<summary>`, a surface's content wrapper and title. That is
  strictly less than the whole-parent rebuild it replaces, but not nothing; the
  complete answer is a `ctx` seam letting a renderer refill its own child slots.

  A test mounts every container kind and compares the DOM its renderer produced
  against the declared set, so the two cannot drift.

- 9ae4327: fix(runtime): the keyed diff no longer tears children out of a wrapping
  renderer, and the walker's placement contract is written down.

  **The bug.** The keyed child pass matches children by `key` and then moves the
  survivors with `parentEl.appendChild` and drops the departures with
  `parentEl.removeChild`. Both only address elements the parent element holds
  directly — and `overlay` does not: it wraps every child after the first in an
  absolutely-positioned layer, so those children's elements are mounted a level
  below the overlay. An overlay whose layers all carried a key (an
  `overlay(for l in layers Layer(l))`, where the `for` binding supplies an
  implicit key) therefore lost its stacking on the first reorder: children were
  appended straight onto the overlay and the emptied layer divs were left behind,
  one more per render. Nothing threw and nothing was reported. Host renderers hit
  the same shape by appending children to anything other than the element they
  return.

  **The fix.** Keyed matching now additionally requires that every child's mounted
  element be a direct child of the parent's element. When it is not, the walker
  declines the keyed pass and runs the structural walk, which never repositions
  anything and stays correct under a wrapping renderer. The decline is reported
  through `onDiagnostic` as a new `ReconcileFallback` reason,
  `wrapped-children` (with `index` and `childKind`) — the one reason that rebuilds
  nothing, since what it costs is reorder-stable element identity rather than a
  subtree. When the wrapped list also changed length, the structural walk reports
  `child-count-change` on top: two diagnostics naming two different facts.

  A child with no entry in the element map is deliberately left alone. That is a
  broken invariant rather than a placement style, and the keyed pass throws on it
  so the reconcile bailout records a panic — visible without a diagnostic sink.

  **Why the contract needed saying.** `reconcileNode` returns the element now
  occupying a node's slot, and who may place that element was implicit: a rebuilt
  subtree is spliced in by `replaceWithFreshTile`, anchored on the OLD element's
  own parent, precisely because the parent tile's _renderer_ decides where a child
  sits. A caller may only place the returned element itself once it has
  established that it owns the slots — which is now stated on `reconcileNode`,
  enforced by the gate above, and spelled out at the one call site that discards
  the return value on purpose.

  Documented in spec §10.3.10 (keyed matching's placement precondition) and
  §10.3.12 (the new reason), with a runnable example at
  `packages/examples/features/59-overlay-keyed-layers.kumiki`.

- 49cafdb: feat(reactivity): stable tile identity — `TileNode.key` end-to-end (#188).

  Finishes the coordinated release started in #187. `TileNode` gains an optional `key?: string`, the compiler emits it, and the reconciler consumes it — so keyed children survive insert/remove/reorder without rebuilding the parent subtree, and `<select>` value, `<input>` focus and caret, and event listeners are preserved natively across those mutations.

  - **runtime** (`packages/runtime/src/core.ts`): `TileNode` type extended additively via intersection with `{ readonly key?: string }`. `TILE_SKIP_TOP` now includes `"key"` so a key change alone does not trigger `replaceWithFreshTile`. `reconcileNode` gains an all-or-nothing keyed child-list path: when every child on both sides carries a key, `reconcileKeyedChildren` matches by key, recurses on paired children, mounts fresh children for new keys, drops the unmatched old children from the DOM, and reorders in place via `appendChild` moves. When any child is missing a key, the pre-#188 structural walk (position + `kind` + data-prop equality, rebuild-on-length-change) is preserved verbatim.
  - **compiler** (`packages/compiler/src/codegen/`): `selector.keyFor` extracts an author-supplied `{key: <expr>}` from a tile call's props block (kept out of both `props.el` and top-level props). `emit-tile.tileExprJs` threads an `implicitKeyExpr` through `TileFor` / `TileWhen` / `TileIf` / `TileMatch`; `TileFor` sets it to `_s.show(<loopVar>)`, and user-tile boundaries reset it. `tileCallJs` wraps every emitted node with a new `_wk(node, key)` runtime helper when either an explicit or implicit key is available. Nested `for` correctly rebinds to the inner loop variable; non-iterated tiles emit no wrap.
  - **spec**: new §10.3.10 in `docs/spec/runtime.md` (and JA mirror) documents the additive `TileNode.key` field, the all-or-nothing per-parent matching rule, compiler-emission rules, and the matched-pair migration story.

  Old bundles (no keys) still mount cleanly on the new runtime — they just fall back to the structural walk. New compiler output still mounts on an old runtime — the field is ignored. Both packages must be upgraded together to get the reorder-stable-reuse guarantee.

### Patch Changes

- 6f3f3e3: fix(runtime): the reconcile prop-equality kernel no longer reuses a tile across
  two different `Date` / `Map` / class instances, and its rules are written down.

  **The bug.** `tileValueEqual` ends in a key-wise object comparison, which is
  complete only for values whose entire state IS their own enumerable properties.
  `Object.keys(new Date())` is `[]` — so two different `Date`s (and `Map`, `Set`,
  `RegExp`, DOM nodes, class instances) compared _equal_, and a tile carrying one
  kept its mounted element when the value behind it had changed. Nothing threw and
  nothing was reported: the element simply stayed stale. The code comment already
  claimed these were conservatively treated as unequal; now they actually are.
  Kumiki codegen emits only plain data, so this was unreachable from a `.kumiki`
  source — it protects renderers supplied through `MountOptions.tiles`. The same
  instance passed twice still compares equal through `===`.

  **The rules, now normative.** Spec §10.3.13 states what "the tile's data props
  did not change" means, which §10.3.10 and §10.3.11 both hang on: which fields
  are compared (own fields except `kind`, `children`, `key`), that an absent key
  and an explicit `undefined` are equal, that comparison is `===`-based so `null`
  / `""` / `0` / `false` never collapse into each other, that two functions are
  always equal (closure identity is ignored on purpose — see the
  `stale-closure-risk` diagnostic), that `NaN` is not equal to itself, and that a
  non-plain object is never equal to anything but itself. It also states the two
  edges that stay outside the contract: "plain" is decided by realm-local
  prototype identity, so a cross-realm object rebuilds; and a cyclic value
  recurses until the stack runs out, landing in the reconcile bailout as a
  recorded panic plus a wholesale rebuild — unsupported, but contained.

  Pinned by `packages/runtime/test/reconcile-equality.test.ts`, which drives the
  real walker — `mountCore` with spy renderers and an empty patcher registry,
  where "props compared equal" and "the element survived the re-render" are the
  same fact — rather than exporting the predicate for tests.

## 0.11.0

### Minor Changes

- 07e9c6b: feat(runtime): keep debounce-deferred effects on their originating episode (#120).

  Previously, a debounced effect that fired long after its originating reducer would open a **new** episode, breaking the causal chain in the episode log. The dispatcher now retains the originating episode id across the debounce window so the deferred effect lands under the same episode as the reducer that scheduled it. `http.cancel` / missing-capability / dispose paths also drain their debounce timers and notify `onPolicyCancel` correctly, closing the previously observed leaks.

  - runtime: `packages/runtime/src/core.ts` dispatcher preserves episode id through `debounce` / `throttle` / `latest` / `latest-per-key`.
  - runtime: `packages/runtime/src/episode.ts` records the cancel notification with the originating episode context.
  - spec: `docs/spec/runtime.md` §policy expanded with the continuity guarantee.

- 07e9c6b: feat(runtime,compiler,cli): episode logger (§10.5) + `episode-test` (§8.6) (#90).

  - runtime: new `createEpisodeLogger` (in-memory ring buffer + opt-in localStorage mirror) plus `MountOptions.episodeLogger` hooked into every reducer / effect-start / effect-end / signal-update / panic seam. Mounted apps expose `app.episodes()` (§10.7). Volatile slots are excluded from `slot-diffs` per language.md §175.
  - runtime/testkit: new `_stdlibTest.runEpisodeTest` — replays the logged trigger → reducer chain, resolves effects via `from-log` / `ignore` / `ok(v)` / `err(e)` mocks, and asserts `slots-equal: from-log` / `no-panics` / `no-errors`.
  - compiler: `episode-test` added to AST / parser / typecheck / codegen. The log fixture is read at compile time via the injected `readEpisodeLog` (Node helper `nodeEpisodeLogReader`) so the runtime never touches the filesystem.
  - cli: `kumiki run --episode-log <file>` now emits real per-trigger §10.5.1 episodes instead of the placeholder one-scenario-step records. `kumiki test` wires `readEpisodeLog` automatically when an `episode-test` is present.
  - examples: new `packages/examples/features/44-episode-test.kumiki` + fixture.

- 07e9c6b: feat(compiler,runtime): close three language-core gaps in language.md (#91).

  - compiler: `ui.key` and `ui.hover` (§1.6.1) are now accepted by parser/AST/codegen; codegen lifts them to `onKeyDown` (input/textarea/button) and `onMouseEnter` (any tile) on the enclosing tile.
  - compiler: tuple patterns `(p1, p2, …)` (§1.9) are now parsed, typechecked, and lowered. The match-arm separator heuristic was extended so `| (p, q) -> …` is recognised as an arm boundary rather than a bool-OR expression.
  - compiler: literal patterns (`| "foo" -> …` / numeric / bool) are removed from the implementation to match §1.9.1's prohibition — they were already an error in the docs but the AST node and codegen path quietly accepted them. `parser` now fails with `Expected pattern`, matching `spec-gaps.test.ts` Gap 1.
  - runtime: `TileProps` gains `onKeyDown` / `onMouseEnter`; the universal render hook wires `keydown` (passing `el.key` / `el.code`) and `mouseenter` once for every tile so no per-renderer plumbing is needed.
  - examples: new `packages/examples/features/45-ui-key-hover-tuple.kumiki` + scenario covers all three.

- 07e9c6b: feat(routing): nested routes — `sub-routes` declaration on tiles + `route-outlet` child rendering (#85).

  `docs/spec/routing.md` §3.6 has described nested routes from day one, but the parser was discarding the `sub-routes` block and `route-outlet()` rendered as an empty `<div>`. Both halves are now wired end-to-end so a layout tile can host a `/parent/*` wildcard, declare its own child route map, and select which child renders inside its `route-outlet`.

  - **compiler**: `TileDef.subRoutes` is a real AST field; the parser stores the parsed route map and codegen emits a nested `subRoutes:` array on the parent's route entry. Typecheck validates child tile existence (E0105), wildcard-parent integrity (E0110), orphan sub-routes (E0111), and duplicate sub-route paths (E0112).
  - **runtime**: `parseLocation` re-matches the path inside the matched parent's `subRoutes`. `pickRootTile` injects the matched child into the first `route-outlet` of the parent's render tree, and the `route-outlet` renderer now mounts whatever children it has been given. If no sub-route matches under a wildcard parent, the runtime falls through to the global `/404` per §3.6.3.
  - **examples**: `packages/examples/features/40-nested-routes.kumiki` + scenario (`/settings/*` with three sub-routes, including the default and the `/404` fallthrough).

- 07e9c6b: feat(cli,runtime): `kumiki replay` — interactive episode replay (§10.5.3) (#117).

  - cli: new `replay` verb. `kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]` replays a recorded episode log against a compiled app and streams the per-step trace (reducer / effect-start / effect-end / signal-update). `--mock` is repeatable; values follow §8.6's `from-log | ignore | ok(<json>) | err(<json>)` grammar. `--until-step` halts after the Nth observed step (1-indexed, global across episodes) and prints the slots at that moment.
  - runtime/testkit: extracted the per-episode executor that already powered `runEpisodeTest` into a shared `executeEpisode` and exposed it through a new `replayEpisodes` export. Both the assert-based test runner and the CLI trace formatter call the same engine — `from-log` cursor, refine ward, and unhandled-error accounting can no longer drift between them.
  - compiler: `parseEpisodeLogText` is now exported from `@kumikijs/compiler/node` so CLI tooling can consume `kumiki run --episode-log` output without going through codegen.

- 07e9c6b: feat(runtime,compiler): SSR + hydration with bootstrap episode (#119).

  Kumiki apps can now be pre-rendered on the server and hydrated on the client without losing the reactive graph or replaying the initial reducers. The hydration path opens a **bootstrap episode** so any HTTP / storage prefetch performed during SSR shows up in the client-side episode log as the first coherent step, rather than as untracked side-effects before the app "starts".

  - runtime: `mountCore` gains a hydrate path that adopts the server-rendered DOM as the initial tile tree (v1 shape: `replaceChildren` overwrite — identity-preserving hydration tracked separately). Per-request `app.live` initialisation prevents cross-request signal leakage.
  - runtime: SSR version check bails **non-silently** if the runtime version embedded in the SSR payload disagrees with the client bundle.
  - compiler: codegen threads the bootstrap-episode shape through so SSR-side effects land in the hydrated log.
  - examples: new `packages/examples/apps/10-ssr-hydration`.
  - spec: `docs/spec/runtime.md` §SSR expanded to cover the bootstrap-episode contract.

- 07e9c6b: feat(compiler,runtime): wire static `TileName#id` selector end-to-end (#131).

  The `TileName#id` selector in `reducer r on=ui.click(NewBtn#save)` is now honoured all the way from parse to dispatch. The compiler emits the id filter into the generated handler, and the runtime `_dispatch` skips reducers whose `selector.id` does not match the dispatched element's `el.id` — a defence-in-depth layer that keeps working even when the tile's `{id}` is computed at runtime.

  - compiler: `packages/compiler/src/codegen.ts` threads `selector.id` through the tile dispatcher.
  - runtime: `_dispatch` (`packages/runtime/src/core.ts`) filters by `el.id` before invoking the reducer.
  - spec: `docs/spec/language.md` §1.6.2 formalises the selector shape; `docs/spec/errors.md` adds `E0211 undef-tile-in-selector`.

- 07e9c6b: feat(compiler,runtime): wire `ui.focus` / `ui.blur` (§1.6.1).

  The parser and AST already accepted these two `ui-kind`s alongside `ui.key` / `ui.hover`, but the codegen never lifted them and the runtime had no DOM listeners — so `reducer r on=ui.focus(InputX) do= …` silently did nothing.

  - compiler: `propsFor` now lifts `ui.focus(EnclosingTile)` / `ui.blur(EnclosingTile)` into `onFocus` / `onBlur` on focusable tiles (`input` / `textarea` / `button` / `select`). Non-focusable tiles are deliberately skipped so the runtime never installs a listener the DOM cannot fire. The explicit-prop passthrough lists (`{onFocus: someReducer}` etc.) also gain `onFocus` / `onBlur`.
  - runtime: `TileProps` gains `onFocus` / `onBlur`; the same universal render hook that handles `onKeyDown` / `onMouseEnter` now wires `focus` / `blur` on every tile, passing the tile's `el` payload.
  - examples: new `packages/examples/features/49-ui-focus-blur.kumiki` + scenario covers both events.

### Patch Changes

- 07e9c6b: feat(runtime): scenario DOM focus / blur primitives (#142).

  The scenario testkit now exposes `focus` and `blur` primitives that drive real DOM focus events end-to-end, so a scenario can verify that `addEventListener("focus", …)` wiring actually reaches the reducer — not just that the compiler emitted the handler. This closes the "compiles but never fires" gap for `ui.focus` / `ui.blur`.

  - runtime: `packages/runtime/src/scenario.ts` gains `focus(selector)` and `blur(selector)` steps.
  - e2e: `packages/e2e/src/browser.ts` mirrors the primitives for Playwright fixtures.
  - examples: `packages/examples/features/49-ui-focus-blur.scenario.json` exercises both.

- 07e9c6b: feat(compiler): `W0212 ui-event-subscription-mismatch` — warn on `ui-event` subscriptions that cannot fire (#143).

  When a reducer subscribes to a `ui-event` on a tile that cannot emit it (e.g. `ui.submit(DivTile)` or `ui.focus(NonFocusableTile)`), the compiler now emits `W0212` instead of silently generating a handler the DOM will never invoke. The rule consults the ui-event implicit-lift table (single source of truth in `packages/compiler/src/ui-lifts.ts`) to decide whether the subscription is admissible.

  - compiler: `checkReducer` cross-references the target tile's kind against the ui-event's admissible tile set.
  - runtime / cli / vite: no behavioural change; the diagnostic surfaces through the standard `check` gate and Vite overlay.
  - spec: `docs/spec/errors.md` and `docs/spec/stdlib.md` document `W0212`; `docs/spec/language.md` cross-links to the ui-event lift table.

## 0.10.0

### Minor Changes

- 47bc7aa: feat(app.http): wire `app.http = { base-url, headers, on-401/-403/-5xx, timeout, credentials }` end-to-end (#78).

  - compiler: parser captures `app.http` instead of silently discarding it; codegen emits `_http` and threads it through every `httpFetch` call.
  - runtime: `httpFetch` now prepends `base-url`, merges global headers (precedence: auto < global < input), enforces a 30s default timeout via `AbortController`, and passes `credentials` (default `same-origin`).
  - runtime: status-coded HTTP errors (401/403/5xx) automatically dispatch to the reducer named by `on-401` / `on-403` / `on-5xx`, in addition to any per-effect `.err` handler (spec §6.3.2).
  - examples: new `packages/examples/apps/07-app-http`.

- 47bc7aa: feat(indexed-db): wire `app.indexed-db` config + `indexed-read` / `indexed-write` / `indexed-delete` / `indexed-query` effects (#79).

  `indexed.*` capabilities were spec'd but had no runtime; effects compiled but fell through to "no provider". This change ships the full path.

  - compiler: parser/AST capture `app.indexed-db = { name, version, stores: [{ name, key, indexes? }] }`; codegen emits `_idb` and threads it to the `indexed-*` builtins.
  - runtime: `effects-indexed.ts` opens the IndexedDB lazily and dispatches `indexed.read` by input shape (point lookup vs range query). Unavailable backends keep returning a clean `err` (the no-silent-failure contract from #37).
  - examples: new `packages/examples/features/36-effect-indexed-db.kumiki`; parser/codegen/runtime regression tests; check + build + smoke green.

- 47bc7aa: feat(app): wire `app.meta` and `app.analytics` end-to-end (#80).

  Previously the parser accepted these blocks and threw away the value; both now flow from source to runtime.

  - **compiler**: `AppDef.meta` / `AppDef.analytics` are real AST fields with field-level validation. `meta` accepts the closed set `title`, `description`, `og-image`, `favicon` (all string literals). `analytics` takes `provider: "console" | "noop"` plus optional `app-id`. Codegen emits both as plain literals on the App object.
  - **runtime**: at mount, `app.meta` is reflected into `<head>` — `document.title`, `<meta name="description">`, `<meta property="og:image">`, `<link rel="icon">` — upserting existing tags rather than duplicating. `app.analytics` installs a default `analytics.send` provider (console / noop) unless the host registers one, so an app can declare measurement without depending on an SDK. `appId` is merged into every event payload.
  - **examples**: `packages/examples/apps/09-app-meta-analytics`.

- 47bc7aa: feat(lifecycle): `confirm` effect + `route.leave` guard callbacks (#82).

  Lifecycle §7.6 ships the built-in `confirm` effect as a real in-app modal (not `window.confirm`) that dispatches the supplied `onYes` / `onNo` reducer by name. Routing §3.5.2 ties this into navigation: when a `route.leave(pattern)` reducer emits `confirm`, the runtime holds the transition — the old route's tile stays visible underneath the modal; Yes commits the held route and fires `route.enter`, No reverts the router to the old path.

  - runtime: new `effects-confirm` module + installer, wired into the classic `mount` and exposed for the granular `mountCore` path.
  - runtime: `route.leave` reducers now run **before** the slot/route commit and before `route.enter`. Their emits are observed: if any is `confirm`, `pendingLeave` gates the transition until `_resolveLeave` fires.
  - compiler: `emit confirm({onYes: ref, onNo: ref})` encodes the reducer refs as string literals; usage analysis ships `effects-confirm` only when the app actually emits confirm; typecheck verifies the refs resolve to defined reducers.
  - scenario: `click` selector falls back to `document` so the modal (on `<body>`) is reachable by the scenario tier.
  - example + smoke + scenario + runtime integration tests cover the Yes / No / no-guard paths end-to-end.

- 47bc7aa: feat(http): execute `retry=linear(N, ms)` / `retry=exponential(N, ms, factor)` at runtime (#83).

  The compiler already parsed retry clauses; the runtime ignored them. This change wires the policy through:

  - compiler: `genEffect` now emits `retry: { kind, n, ms[, factor] }` on every `EffectSpec`.
  - runtime: `EffectSpec.retry` is read by the dispatcher's launch loop. Only 5xx responses and connection errors (status 0) are retried; 4xx is treated as a final failure (spec §6.5).
  - examples: `packages/examples/apps/08-http-retry`.

- 47bc7aa: feat(lifecycle): wire the remaining lifecycle events (#81).

  Until now only `app.start`, `app.error`, and `route.enter` / `route.leave` made it past the parser; the rest of the catalog from `docs/spec/lifecycle.md` §7.1 was reserved but inert. This change makes the full set behave at runtime.

  - **parser**: closed-set validation for `app.*` (`stop`, `visible`, `hidden`, `online`, `offline`, `http-401`, `http-403`, `http-5xx`), `tile.mount(X)` / `tile.unmount(X)` (the tile name is now preserved as part of the event identity, like `route.enter("/p")`), and `route.error("/p")`. Unknown variants are a parse error.
  - **runtime**: mount installs `beforeunload` → `app.stop`, `visibilitychange` → `app.visible` / `app.hidden`, and `online` / `offline` → `app.online` / `app.offline` listeners — only for the events the app actually subscribes to. All listeners are removed on `dispose`.
  - **runtime**: `tile.mount(X)` / `tile.unmount(X)` fire when a user-defined tile enters or leaves the rendered tree. Codegen marks each user-tile call site with a `_tile` prop; the runtime diffs the marker set across renders so the events only fire on transition. Built-in tiles (`button`, `page`, …) are not tracked.
  - **runtime**: a render panic under a routed tile dispatches `route.error("<pattern>")` with `$event = { message, location, pattern }` before falling back to the top-level panic UI (lifecycle.md §7.5.2).
  - **examples**: `packages/examples/features/37-lifecycle-events.kumiki`.

- 47bc7aa: feat(session): `session-read` / `session-write` effects over `sessionStorage` (#84).

  Spec §6.7.4 says `session-*` shares the same shape as `storage-*`, but the runtime only exported the localStorage handlers, so `cap=session.*` effects compiled but had no provider and fell through to the "no provider" error.

  - runtime: add `sessionRead` / `sessionWrite` next to the localStorage handlers (one helper does the JSON / Option round-trip for both backends), wire them into `builtinEffects`.
  - compiler: dispatch `session.read` / `session.write` to the new handlers in codegen.
  - runtime: unavailable backends keep returning a clean `err` (#37 contract), exercised by a SecurityError test.
  - examples: new `packages/examples/features/39-effect-session.kumiki` models both `.ok` and `.err` branches end-to-end.

## 0.9.0

### Minor Changes

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

- c4833bd: `spinner` renders an animated, accessible loading ring instead of a static "…" placeholder.

  The previous renderer set `textContent = "…"`, so `Loading` states (e.g. the
  `stdlib §2.3.8` feedback tile used by the HTTP showcase) never showed an actual
  spinner. The tile now renders a rotating `currentColor` ring with
  `role="status"` / `aria-label="Loading"`; the `@keyframes kumiki-spin` rule
  lives in the shared animation stylesheet, so it works in any style root
  (document or shadow) and is disabled under `prefers-reduced-motion`. The `size`
  prop accepts the `sm` / `md` / `lg` / `xl` tokens (spec now states this);
  without it the ring scales with the surrounding text.

## 0.8.0

### Minor Changes

- 3ee1a9a: Implement every documented built-in tile and close three spec gaps (#61, #62).

  **Built-in tiles (#61).** The parser/typechecker accepted the full `stdlib §2.3`
  tile set while codegen implemented only a subset, so documented tiles passed
  `check` but threw `Tile "<name>" not found` at `build`. The registry is now
  single-sourced (`builtins.ts`, shared by parser/typecheck/codegen) and codegen +
  runtime implement every tile: `code`, `video`, `list`/`list-item`,
  `table`/`table-head`/`table-body`/`table-row`/`table-cell`, `modal`, `drawer`,
  `tooltip`, `popover`, `toast`, `progress`, `error`, `route-outlet`, plus `slider`
  and `switch` (previously in-set but unimplemented). `error(field=…)` resolves its
  message from the slot's refinement predicate, honoring `theme.errors` overrides.

  **Spec clarifications (#62).** Three constructs that looked legal from the spec
  are now stated as rules: literal `match` patterns are unsupported (variant /
  `Variant(binds)` / tuple / `_` only); `$1` in a tile requires an `in=` argument
  (E0103 now hints at this); and `()` is the args/children list while `{}` is the
  `key: value` props block. `link` now accepts the canonical `text=` argument
  (consistent with `button`); the existing `{text: …}` prop form still compiles.

## 0.7.0

### Minor Changes

- afe1b15: v0.6 M2 (#50) — effect-result mocks inside `reducer-test` (`spec/testing.md` §8.5). `given.mocks = {effect: ok(v) | err(e) | delay(ms, ok(v))}` drives a multi-step flow headlessly: a mocked effect is delivered to its `.ok`/`.err` reducer and consumed; a non-mocked emit is residual (asserted via `expect.effects`). `delay` is virtualized (immediate). A mock key must name a declared effect (E0104); a mocked `err` with no `.err` reducer fails the test.
- e92f5df: v0.6 M3 (#51) — `property-test` (`spec/testing.md` §8.3). Generative testing of reducer invariants: `property-test for-all={n: T} given={…} invariant=<bool> (count=N)? (shrink=bool)?` generates `count` (default 100) cases per type (primitives, List/Map/Set/Option/Result, records, unions; refinements fold into the generator as bounds), checks the invariant, and shrinks a failing case to a minimal counterexample. `run-reducer(name)` chains apply reducers to the running state. Generation is seeded (reproducible). The runner reports `(N cases)`. `run-reducer` targets must be declared reducers (E0102).
- 33fc749: v0.6 M4 (#52) — `kumiki test` runner polish (`spec/testing.md` §8.7). Per-test timings on every line (`(1ms)`; property-tests add `(100 cases, 23ms)`); `--coverage` reports per reducer/effect/tile what the suite exercises and lists the uncovered (computed statically by codegen into `globalThis.__kumikiCoverage`); `--watch` re-runs the filtered suite on `.kumiki` change (debounced, clean Ctrl-C exit). Completes the v0.6 testing-DSL milestone.

## 0.6.0

### Minor Changes

- cd1e88a: v0.6 M1 (#49) — `reducer-test` `expect` wildcards (`spec/testing.md` §8.2.2). `<any-id>` matches any generated value (and, as a map key, pairs with exactly one otherwise-unmatched entry), and `<slots.X>` matches slot X's post-execution value (e.g. `effects: [persist(<slots.todos>)]`). Matching is otherwise exact — wildcards only blank out non-deterministic holes. A wildcard outside a `reducer-test` `expect` is a compile error (new E0109 `test-wildcard-misuse`).

## 0.5.0

### Minor Changes

- 20c8601: feat: no-silent-failure contract for unhandled effect errors (v0.5 M2, #37)

  An effect `err` result that no `.err` reducer consumes is now surfaced via
  `console.error` (`[kumiki] effect "<name>" returned an error with no .err
reducer: …`) instead of being dropped silently — so the verification tiers
  (`smoke` / `runScenario`, which capture `console.error`) flag it, consistent
  with the v0.3 live-panic model. This fixes the storage-unavailable case (sandbox
  preview / private mode) that previously looked like the app did nothing.

  The default contract is `err` + a surfaced report; a program opts into handling
  (or deliberately ignoring) the error by wiring an `.err` reducer (even an empty
  one). An in-memory storage fallback is explicitly not the silent default.
  Backward-compatible (additive surfacing; defaults unchanged).

- 20c8601: feat: virtual / memory router mode for embedded contexts (v0.5 M3, #36)

  `mount(app, el, { router: "memory", initialPath?: "/" })` resolves the initial
  route from `initialPath` (not the ambient `location`) and routes `navigate` /
  link clicks / `navigate-back` through an in-memory path with no `history.*` —
  so path-based routing works inside the playground `<iframe srcdoc sandbox>` and
  any embedded host (Web Component, embed) that owns the top-level URL, where the
  ambient origin is opaque and `history.pushState` throws.

  `router: "history"` stays the default (apps at a real origin are unaffected).
  The auto-mounting bundle spreads `globalThis.__kumikiMount` into mount options
  (compiler), and `defineKumikiElement(tag, app, { router, initialPath })`
  forwards the option to the Web Component. `runScenario` gained a
  `{ router, initialPath }` option. Backward-compatible (additive; defaults
  unchanged).

## 0.4.0

### Minor Changes

- c51b7b8: feat: host capability providers — the inbound ecosystem seam

  Custom capabilities (registered via `kumiki.caps.json`) can now be backed by a
  host-supplied implementation, so a Kumiki app can use any npm library / SDK
  without language-level FFI.

  - `mount(app, target, { providers })` accepts a `Record<string, CapabilityProvider>`
    keyed by capability name. New runtime exports: `CapabilityProvider`,
    `MountOptions`; `CapabilityRegistry` gains `provider(cap)`.
  - Codegen now lowers a custom-capability effect to a provider lookup at the
    capability boundary (`caps.provider(cap)`) instead of an always-failing
    "not implemented" stub. With no provider registered it resolves to
    `err {message: "Capability <name> has no provider"}`.
  - The auto-mounted bundle threads `globalThis.__kumikiProviders` so an embedding
    host can register providers before the module loads.

  Standard capabilities keep their built-in implementations (not provider-overridable),
  and scenario mocks still override providers at the same boundary. See
  docs/spec/stdlib.md §2.5.

- c51b7b8: feat: multiple independent instances via a `createApp()` factory

  A compiled app previously bound its render closures to one module-level live
  state, so mounting the same app twice (or two Web Component instances) shared
  state. Codegen now wraps the per-instance pieces (slots, live, reducers, routes,
  effects, tiles) in a `createApp()` factory whose closures bind to that call's own
  `live`. Each `createApp()` returns a fully independent `AppShape`; no runtime
  change is needed.

  - Compiled modules expose `createApp` (and `export { createApp }` under
    `exportApp` / the Vite plugin); the default export remains a single shared
    instance for back-compat.
  - `defineKumikiElement(tag, appOrFactory, …)` accepts a factory — pass the
    module's `createApp` so each `<tag>` element gets its own state; passing an
    `AppShape` keeps the shared single-instance behavior.
  - `@kumikijs/vite/client` ambient types now declare the `createApp` export.

- c51b7b8: feat: standard capabilities are now host-provider-overridable

  Every effect invoke (standard and custom) consults `caps.provider(cap)` before
  its built-in implementation. A host can therefore register a provider for a
  _standard_ capability — `http.*`, `storage.*`, `nav.*`, `notification.show`,
  `log.write` — to swap the HTTP transport (axios / ofetch), inject auth headers,
  integrate a framework router, or replace the toast UI, without touching the
  Kumiki source. The provider receives the effect's (already `map-request`-mapped)
  request; with no provider registered the built-in behavior runs unchanged.

  - `codegen` now lowers every effect to the uniform shape _map → provider check →
    built-in fallback_ (custom caps fall back to the existing "no provider" error).
  - The runtime built-ins (navigate / toast / log) defer to a registered provider
    for their capability before running the default behavior.

- c51b7b8: feat: `defineKumikiElement` — embed a compiled app as a Web Component (outbound seam)

  Wrap a compiled Kumiki app as a standard custom element so it drops into any host
  page or framework (React/Vue/Svelte/plain HTML) without a Kumiki-specific
  integration. The element owns the mount lifecycle (mount on connect, dispose on
  disconnect) and bridges the host both ways:

  - **Inbound** — `options.providers` forward to `mount` (the custom-capability
    seam); `options.attributeSlots` map observed attributes to slots; imperative
    `setSlot`/`setSlots`/`getSlot`/`slots` read & write live state (refinements
    enforced).
  - **Outbound** — `options.events` surface custom-capability effects as DOM
    `CustomEvent`s on the element; a `providers[cap]` entry overrides the
    passthrough for that capability.

  New exports: `defineKumikiElement`, `KumikiElementOptions`, `AttributeSlotBinding`.
  Renders into light DOM; single-instance per imported app module. See
  docs/spec/runtime.md §10.9.1.

- c51b7b8: feat: `defineKumikiElement({ shadow: true })` — shadow-DOM style isolation

  The Web Component wrapper can now render into an open shadow root for full style
  encapsulation. The app's motion / theme / state `<style>` nodes are injected into
  the shadow root (not the document head) and theme background/foreground/font are
  applied to an in-shadow container, so host-page CSS does not bleed in and
  Kumiki's CSS does not leak out. Light DOM (the document-level styling that
  matches a standalone page) remains the default.

  `mount` gains `styleRoot?: Document | ShadowRoot` and `styleHost?: HTMLElement`
  options that route every Kumiki `<style>` injection (animations, motion, theme,
  state styles) to the chosen root — the seam the shadow element uses. Style
  injection no longer references the global `Document` constructor, keeping non-DOM
  imports of the runtime safe.

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

## 0.2.1

### Patch Changes

- c0c1708: Fix issue #7 — implement the argument-less spec stdlib methods (`spec/stdlib.md` §2.2): `head` / `tail` / `last` / `to-list` / `get-err` / `to-option` / `parse-int` / `parse-float` / `abs` / `neg` / `to-float` / `to-int`.

  Previously the parenthesis-free form the spec recommends (`list.head`) compiled clean but evaluated to `undefined` at runtime, and the parenthesized form (`list.head()`) was rejected with E0801. Both shapes now lower to runtime helpers and are recognized in `KNOWN_METHODS`. Follow-up to #5.

  Known limitation (deferred, needs receiver type inference): dispatch is name-only, so the no-paren form shadows a record/map field of the same name (e.g. `node.head` on a record `{head, tail}`).

## 0.2.0

### Minor Changes

- 77938ee: v0.2 — close the five spec-deferred features (M1–M5)

  - **M1 `stop-timer(name)`** — explicit named-timer stop; errors E0002 / E0106.
  - **M2 `overlay` builtin** — z-axis stacking (modals / toasts / dropdowns), `align` prop, composes with `when`.
  - **M3 plugin capability registration** — `kumiki.caps.json` manifest; unlisted caps are now a compile error (E0302).
  - **M4 `test` layer + `kumiki test` runner**, and **`kumiki fix --auto-patch <test-name>`** — in-language reducer-test / tile-test with PASS/FAIL + diff output, plus deterministic repair from a failing test.
  - **M5 `motion` layer** — reusable, closed-grammar, scoped animations referenced from a tile's `motion` prop; honors `prefers-reduced-motion`; errors E0107, E0401–E0403.

  See CHANGELOG.md for the full detail.
