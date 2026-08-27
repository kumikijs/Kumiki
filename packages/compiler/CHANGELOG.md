# @kumikijs/compiler

## 0.13.0

### Minor Changes

- 82cfa6c: fix(compiler): count a built-in call's arguments, and stop supplying the ones it left out.

  `checkCallee` resolved a builtin by name and then returned. The arguments were
  whatever the lowering happened to read, and every lowering that read one
  substituted a default when it was absent — so an omission became a plausible
  value rather than a diagnostic:

  | Written             | Lowered to                              |
  | ------------------- | --------------------------------------- |
  | `Duration.s()`      | `((0) * 1000)` — zero milliseconds      |
  | `Bytes.from-text()` | `_s.bytesFromText("")`                  |
  | `file-url()`        | `_s.fileUrl(undefined)`                 |
  | `panic()`           | `_s.panic("")` — a stop with no message |
  | `fmt()`             | `""`                                    |

  `Duration.s()` is the sharpest: a timer written with an empty duration fires
  immediately and forever, with `check`, `build` and `smoke` all green. Extra
  arguments were equally unchecked — `Duration.s(1, 2, "x")` dropped the tail.

  The callee tables now carry the count beside the name, so resolving a builtin
  and knowing its arity are one lookup and a builtin cannot be added without
  deciding it. A mismatch is `E0213` at the call site. What is checked is the
  count and not the argument's type: `Decoder.Json(User)` still lowers to a
  sentinel that ignores the type it was given.

  `fmt` is the only name with a range: its signature is `fmt(template, ...args)`,
  so the template is all that can be required and its message names a minimum.
  `now` is held to none, but no call can break that — it is a keyword, and the
  parser builds its zero-argument call itself.

  Codegen's defaults are gone rather than unreachable: a lowering that needs an
  argument and does not have one throws, with its position. That is not only a
  guard for callers who skip `check` — `checkCallee` runs where `checkExpr`
  walks, and an `app.http` field, a `test` body and an effect's
  `policy=latest-per-key(...)` key are not walked, so a call that omits its
  argument in one of those checks clean and fails the build.

  **Breaking**: a call that was accepted because nothing counted it is now
  rejected. `Duration.s()` and the rest of the table above are the ones that
  mattered, and `Int.parse()` / `Time.show()` join them — both defaulted to `""`
  and compiled. Two more are worth naming because they read as correct today —
  `Decoder.Json` written without its payload type (the type is what makes the
  decode type-safe, and a decoder that forgot it was indistinguishable from one
  that had it), and `Decoder.Text(Text)` / `Decoder.Bytes(…)` / `Decoder.None(…)`
  written _with_ an argument, which those three constants never had.

- 3b1f5e8: fix(compiler): a handler bound to a tile name is reported instead of dropped.

  `box(text("x"), onClick=Card)` passed `check` and compiled into an element
  with no listener. A capitalised name written as a named argument of a builtin
  that takes tiles parses as a tile call, and the checker asked what shape the
  argument had before it asked whether the argument was a handler — so the
  binding was checked as a nested tile and never reached the handler branch.
  Codegen made the same reading and captured nothing, and the handler-name skip
  that builds the element payload dropped it from the props as well. Both halves
  agreed, which is why nothing reported it: the tile rendered, the click did
  nothing, and no diagnostic anywhere said why.

  The handler is now asked about first, in both forms and for every handler name,
  and answers `E0201` — the same code `onClick=1` already gave. `W0213` comes
  with it when the tile does not fire that event, as it already did for the
  props-block form, which parses the same name as a variant tag and reported it
  all along.

  The cycle search made the same mis-reading one layer down: a handler naming an
  enclosing tile reported `E0005`, that the tile "expands into itself", about a
  tile that is never rendered there. It now skips handler arguments too. Only
  programs that this release starts rejecting can reach that path — a handler
  that names a reducer is a plain reference, which contributed no expansion edge
  before or now.

- 7cce9ce: feat(compiler): the arithmetic the spec documented now exists, as methods.

  `docs/spec/stdlib.md` §2.4.4 listed twelve names under a `math` namespace. None
  of them worked, and none could: a call qualifier is a capitalised name, so
  `math.abs(x)` parses as a reference to a name called `math` and every call
  reported `E0103`. Four of them — `abs`, `min`, `max`, `clamp` — already existed
  one section earlier as methods on the number.

  The rest are methods now: `floor`, `ceil`, `round`, `sqrt`, `log`, `exp` and
  `pow(n)`, in both the `x.m` and `x.m()` forms for the argument-less ones.
  `floor` / `ceil` / `round` are typed `Int` whatever they are given, `sqrt` /
  `log` / `exp` are typed `Float`, and `pow` has no result type at all — `2.pow(3)`
  is an `Int` and `2.pow(-1)` is `0.5` — so a `pow` expression is not checked
  against its target, as `min` / `max` / `clamp` never were.

  `math.random` becomes `random()`, a builtin call beside `now` and `fmt`. §2.4.4
  made it "callable only inside a reducer (treated as an effect)" — a purity rule
  no other builtin has, including `now`, which is just as non-deterministic. It is
  callable wherever an expression is. It takes no arguments, and unlike the other
  builtins says so: `random(1, 6)` is `E0213` rather than a silently ignored range
  and a die that always rolls 1.

  **Breaking**: `random` is now a reserved callee. A program that declares
  `fn random()` still compiles, but the builtin wins at every call site, so the
  calls take its `Float` result — reported at the call site rather than at the
  definition that lost.

  The arithmetic methods are also **members of a number only**. They were added to
  a receiver-blind table, where `someText.round` passed and lowered to
  `Math.round("hello")` — `NaN` into whatever it was assigned to. Every name in
  §2.2.7 now reports `E0108` on a receiver whose type is known and is not `Int` or
  `Float`, in both spellings; a receiver whose type is not known keeps the dynamic
  pass-through. This also reaches four names that predate this change (`abs`,
  `neg`, `to-float`, `to-int`), which had the same hole.

  Writing a method that takes arguments without them — `f.pow`, `f.min` — is
  `E0213` too. The parser produces a field access when there is no argument list,
  which the arity check never saw, so those reached codegen's bracket fallback and
  wrote `undefined` into the slot.

  An argument outside a function's domain produces what the platform produces:
  `(-1.0).sqrt` is `NaN` and `(0.0).log` is `-Infinity`, which `.show` renders as
  those words. `round`'s ties go up, toward +∞ — `(-2.5).round` is `-2`. The spec
  says both now rather than leaving them to be discovered.

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

- 3e33233: fix(compiler): tell two `nominal` types apart.

  `unaliasType` stripped `nominal` before comparing, and every caller of the
  assignability relation went through it — so a nominal type accepted any other
  nominal over the same base:

  ```kumiki
  type Cents = nominal Int where positive
  type Yen   = nominal Int where positive
  slot c : Cents = 1
  slot y : Yen   = 2
  reducer mix on=ui.click(B) do= c := y      # ok
  ```

  Which is the one mistake `nominal` exists to catch, and the shape it guards is
  everywhere: `packages/examples/apps/03-blog` declares `PostId` and `UserId` as
  `nominal Text where uuid`, and `05-project-management` declares three such ids.
  Confusing two of them was accepted by `check`, `build` and `smoke` alike, and
  showed up as the wrong row being loaded.

  A nominal type is now identified by **the name it is declared under**. Two
  declarations over one base reject each other with `E0201`, naming both types as
  written — `Expected Cents but got Yen`. An alias to a nominal names the same
  type, and a `nominal` written inline at a use site declares no name and is still
  compared structurally.

  A type carrying **no nominal name of its own** meets any nominal declared over
  it, in both directions, so nothing that compiled for the right reason stops
  compiling: `slot c : Cents = 1` needs no construction form, and arithmetic
  yields the base so `c := c + 1` stands. Every example, benchmark, spec block and
  fixture in the repo passes unchanged.

  A nominal declared over another nominal is a narrowing and goes one way:
  `type Deep = nominal Cents` accepts a `Deep` where a `Cents` is required and
  refuses a `Cents` where a `Deep` is. A deliberate conversion between two
  unrelated nominals goes through the base they share, written as a `fn` whose
  return type is the destination — `fn toUser(p: PostId) -> UserId = p + ""`. The
  identity body is the same E0201; nothing checks that such a `fn` converts
  anything, only that its body reached the base.

  **Breaking** for a program that mixed two nominals: the standard library's
  `Url`, `Email`, `Uuid`, `HttpStatus` and `Duration` are nominals too, so
  `slot e : Email = someUrl` is now an error where it used to compile.

  The refinement is unaffected: this check still never evaluates one, so
  `volume := 50` on `nominal Int where between(0, 11)` is still well typed and the
  range is still validation's question ([Forms §5.6](./forms.md)). So
  are the operators: `==` is defined on every type, and ordering asks only whether
  both sides share a family — number, text or time — which two nominals over a
  number, text or time base always do, so neither `cents < yen` nor
  `postId < userId` is reported. Over any other base the operator reports the
  missing family itself, as it always did.

  `docs/spec/language.md` §1.3.5 and `docs/spec/errors.md` E0201 disagreed about
  this — §1.3.5 said `nominal` makes a new type, E0201 said it was transparent —
  and both now state the rule above.

- f04b1c5: fix: read a stdlib constant written without its parentheses.

  `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` are values, and `http.md`
  §6.1.4 writes them bare. Only `EffectId.none` ever parsed that way — the parser
  carried a one-off for exactly that spelling — so every other constant fell
  through to a field read on a variant named after the qualifier and emitted
  `undefined`. `check` had no reason to object, and the emitted module was valid
  JavaScript.

  **It was not harmless.** The HTTP handler reads `decode ?? "json"`, so
  `undefined` means json: a body meant to be discarded was parsed, and a 204 with
  no body threw inside `res.json()` and took the `.err` branch. Two effects in the
  blog example shipped that way.

  The parser now reads a member of a constant namespace as a zero-argument call,
  which is the channel typecheck and codegen already share with
  `Decoder.Json(User)` — one decision site instead of three. A member these
  namespaces do not have is an **E0116** now rather than silence followed by
  `undefined`, and that includes the ones `TYPE_MEMBER_CALLS` used to resolve on
  any capitalised qualifier: `EffectId.fresh` passed `check` and lowered to
  `_s.freshId()`, minting a real id where the author wrote the empty sentinel, so
  a later `http.cancel` on it cancelled nothing. `EffectId.show(h)` — the
  qualified spelling of `h.show` — is unaffected; only the zero-argument form is
  refused.

  `Duration.*` and `Bytes.*` are deliberately not read this way: they take an
  argument, and codegen defaults a missing one to `0` / `""` / `[]`. Both
  outcomes are silent, so the choice is between two silences — a duration
  defaulted to zero reads as a plausible value and survives, while `undefined`
  fails the first thing that touches it.

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

- c11152b: Reject a direct route read in an `app.init` argument, and check init arguments in the scope they are lowered in.

  `route` and `$route` written in an init argument now report `E0120 route-in-app-init`. Those arguments are evaluated once, while the app object is built; the route is installed by the mount that follows, so the read captured `undefined` and the app threw at mount with `check` and `build` both clean. A read reached through a `fn` call is not covered — the check looks at the reference, not at the call graph.

  The checker walked init arguments in a reducer scope while codegen lowered them in the plain one. It now uses the same scope, which makes an `emit` expression there the purity error it always was (`E0305`) instead of a `_emits.push(…)` in the app object literal — a `ReferenceError` at import, so nothing mounted at all.

  A `let` or pattern binding named `route` or `$route` is that binding, in both the checker and codegen: neither report fires on a shadowed name. `$route` was already being reported that way outside `app.init`, and no longer is.

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

- Updated dependencies [85a792b]
- Updated dependencies [301b09a]
- Updated dependencies [080f358]
- Updated dependencies [d398cbc]
- Updated dependencies [79b221e]
- Updated dependencies [b8bd5d9]
- Updated dependencies [4de2473]
  - @kumikijs/runtime@0.13.0

## 0.12.0

### Minor Changes

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

- 46bee64: fix(compiler): `sub-routes-without-wildcard-parent` reports **E0114**, not E0110
  (#186).

  E0110 named two unrelated diagnostics — `unknown-token-group` in the style band
  and `sub-routes-without-wildcard-parent` in the routing band. One code standing
  for two kinds makes a search ambiguous and gives auto-patch two incompatible
  repairs to choose between. The routing diagnostic moves to the next free code in
  its own band (E0111–E0113), so every code names one kind again and the
  "kept as-is" caveat leaves the error index.

  Anything matching on the literal `E0110` for this case needs updating; the style
  diagnostic keeps the code.

- 49cafdb: feat(reactivity): stable tile identity — `TileNode.key` end-to-end (#188).

  Finishes the coordinated release started in #187. `TileNode` gains an optional `key?: string`, the compiler emits it, and the reconciler consumes it — so keyed children survive insert/remove/reorder without rebuilding the parent subtree, and `<select>` value, `<input>` focus and caret, and event listeners are preserved natively across those mutations.

  - **runtime** (`packages/runtime/src/core.ts`): `TileNode` type extended additively via intersection with `{ readonly key?: string }`. `TILE_SKIP_TOP` now includes `"key"` so a key change alone does not trigger `replaceWithFreshTile`. `reconcileNode` gains an all-or-nothing keyed child-list path: when every child on both sides carries a key, `reconcileKeyedChildren` matches by key, recurses on paired children, mounts fresh children for new keys, drops the unmatched old children from the DOM, and reorders in place via `appendChild` moves. When any child is missing a key, the pre-#188 structural walk (position + `kind` + data-prop equality, rebuild-on-length-change) is preserved verbatim.
  - **compiler** (`packages/compiler/src/codegen/`): `selector.keyFor` extracts an author-supplied `{key: <expr>}` from a tile call's props block (kept out of both `props.el` and top-level props). `emit-tile.tileExprJs` threads an `implicitKeyExpr` through `TileFor` / `TileWhen` / `TileIf` / `TileMatch`; `TileFor` sets it to `_s.show(<loopVar>)`, and user-tile boundaries reset it. `tileCallJs` wraps every emitted node with a new `_wk(node, key)` runtime helper when either an explicit or implicit key is available. Nested `for` correctly rebinds to the inner loop variable; non-iterated tiles emit no wrap.
  - **spec**: new §10.3.10 in `docs/spec/runtime.md` (and JA mirror) documents the additive `TileNode.key` field, the all-or-nothing per-parent matching rule, compiler-emission rules, and the matched-pair migration story.

  Old bundles (no keys) still mount cleanly on the new runtime — they just fall back to the structural walk. New compiler output still mounts on an old runtime — the field is ignored. Both packages must be upgraded together to get the reorder-stable-reuse guarantee.

### Patch Changes

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
- Updated dependencies [49cafdb]
  - @kumikijs/runtime@0.12.0

## 0.11.0

### Minor Changes

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

- 07e9c6b: feat(compiler): check `match` patterns against the scrutinee type (#123).

  `match` arms are now typechecked: each pattern must be compatible with the type of the scrutinee, and the arm set must be exhaustive over that type. Non-matching arms are rejected before codegen so a "runs but never fires" arm can no longer slip through.

  - compiler: `packages/compiler/src/typecheck.ts` gains a per-arm pattern check that unifies the pattern with the scrutinee type; nominal-type mismatches, tuple-arity mismatches, and record-key mismatches all report structured diagnostics.
  - examples: new `packages/examples/features/50-match-pattern-integrity.kumiki` exercises both the positive and negative cases.
  - spec: `docs/spec/errors.md` gains the new diagnostic codes for pattern-scrutinee mismatch.

- 07e9c6b: feat(compiler): dispatch every reducer matching the same `ui-event` in source order (#124).

  Previously, when two reducers subscribed to the same `ui.click(SameTile)` (with distinct `where=` guards, for example), codegen wired only one and silently dropped the other. Multiple reducers matching the same ui-event now **all** fire, in the source order they appear.

  - compiler: `packages/compiler/src/codegen.ts` emits a per-tile handler that iterates every matching reducer instead of overwriting the previous binding.
  - examples: new `packages/examples/apps/11-multi-subscribe` demonstrates fan-out subscription semantics.
  - spec: `docs/spec/language.md` §1.6 clarifies the "all matching, in source order" dispatch rule.
  - tests: `packages/tests/scenario.test.ts` gains a fan-out regression.

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

- 07e9c6b: feat(compiler): `W0212 ui-event-subscription-mismatch` — warn on `ui-event` subscriptions that cannot fire (#143).

  When a reducer subscribes to a `ui-event` on a tile that cannot emit it (e.g. `ui.submit(DivTile)` or `ui.focus(NonFocusableTile)`), the compiler now emits `W0212` instead of silently generating a handler the DOM will never invoke. The rule consults the ui-event implicit-lift table (single source of truth in `packages/compiler/src/ui-lifts.ts`) to decide whether the subscription is admissible.

  - compiler: `checkReducer` cross-references the target tile's kind against the ui-event's admissible tile set.
  - runtime / cli / vite: no behavioural change; the diagnostic surfaces through the standard `check` gate and Vite overlay.
  - spec: `docs/spec/errors.md` and `docs/spec/stdlib.md` document `W0212`; `docs/spec/language.md` cross-links to the ui-event lift table.

### Patch Changes

- 07e9c6b: refactor(compiler): consolidate ui-event implicit-lift table into a single source of truth (#144).

  `packages/compiler/src/ui-lifts.ts` is now the sole place that describes which DOM prop each `ui.*` event lifts to and which tile kinds can host it. Both `codegen.ts` (which emits the handlers) and `typecheck.ts` (which validates subscriptions for `W0212`) read from this table instead of duplicating the mapping. Downstream diagnostics stay in lockstep with codegen by construction.

  - compiler: `codegen.ts` and `typecheck.ts` de-duplicated against `ui-lifts.ts`.
  - tests: new `packages/compiler/test/ui-lifts.test.ts` guards the table shape.
  - spec: `docs/spec/errors.md` cross-references the lift table anchor.

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

### Patch Changes

- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
  - @kumikijs/runtime@0.10.0

## 0.9.0

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

- Updated dependencies [c40b121]
- Updated dependencies [7e589bc]
- Updated dependencies [c4833bd]
  - @kumikijs/runtime@0.9.0

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

### Patch Changes

- Updated dependencies [3ee1a9a]
  - @kumikijs/runtime@0.8.0

## 0.7.0

### Minor Changes

- afe1b15: v0.6 M2 (#50) — effect-result mocks inside `reducer-test` (`spec/testing.md` §8.5). `given.mocks = {effect: ok(v) | err(e) | delay(ms, ok(v))}` drives a multi-step flow headlessly: a mocked effect is delivered to its `.ok`/`.err` reducer and consumed; a non-mocked emit is residual (asserted via `expect.effects`). `delay` is virtualized (immediate). A mock key must name a declared effect (E0104); a mocked `err` with no `.err` reducer fails the test.
- e92f5df: v0.6 M3 (#51) — `property-test` (`spec/testing.md` §8.3). Generative testing of reducer invariants: `property-test for-all={n: T} given={…} invariant=<bool> (count=N)? (shrink=bool)?` generates `count` (default 100) cases per type (primitives, List/Map/Set/Option/Result, records, unions; refinements fold into the generator as bounds), checks the invariant, and shrinks a failing case to a minimal counterexample. `run-reducer(name)` chains apply reducers to the running state. Generation is seeded (reproducible). The runner reports `(N cases)`. `run-reducer` targets must be declared reducers (E0102).
- 33fc749: v0.6 M4 (#52) — `kumiki test` runner polish (`spec/testing.md` §8.7). Per-test timings on every line (`(1ms)`; property-tests add `(100 cases, 23ms)`); `--coverage` reports per reducer/effect/tile what the suite exercises and lists the uncovered (computed statically by codegen into `globalThis.__kumikiCoverage`); `--watch` re-runs the filtered suite on `.kumiki` change (debounced, clean Ctrl-C exit). Completes the v0.6 testing-DSL milestone.

### Patch Changes

- Updated dependencies [afe1b15]
- Updated dependencies [e92f5df]
- Updated dependencies [33fc749]
  - @kumikijs/runtime@0.7.0

## 0.6.0

### Minor Changes

- cd1e88a: v0.6 M1 (#49) — `reducer-test` `expect` wildcards (`spec/testing.md` §8.2.2). `<any-id>` matches any generated value (and, as a map key, pairs with exactly one otherwise-unmatched entry), and `<slots.X>` matches slot X's post-execution value (e.g. `effects: [persist(<slots.todos>)]`). Matching is otherwise exact — wildcards only blank out non-deterministic holes. A wildcard outside a `reducer-test` `expect` is a compile error (new E0109 `test-wildcard-misuse`).

### Patch Changes

- Updated dependencies [cd1e88a]
  - @kumikijs/runtime@0.6.0

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [20c8601]
- Updated dependencies [20c8601]
  - @kumikijs/runtime@0.5.0

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

- c51b7b8: feat: `@kumikijs/vite` build integration + typed provider helpers (build seam)

  New package **`@kumikijs/vite`** — a Vite plugin so any Vite/Next/Astro project can
  `import App from "./app.kumiki"`. Each source compiles to an ESM module that
  default-exports the compiled `AppShape` (the importer mounts it via `mount` /
  `defineKumikiElement`). Sibling `kumiki.caps.json` is resolved automatically.
  Options: `bundle` (inline the runtime, default true) and `types` (emit a sibling
  `<name>.kumiki.gen.ts` of typed `Slots`/`Providers` helpers). Ambient import
  typing via `@kumikijs/vite/client`.

  Compiler additions backing it:

  - `codegen` / `compile` gain `exportApp` — emit `export default App;` instead of
    auto-mounting to `#root` (module mode for importers).
  - New `generateDts(program)` API — maps the `type`/`slot`/`effect` layers to a
    TypeScript declaration (typed `Slots` and per-custom-capability `Providers`),
    so host provider adapters get real input/output types. Conservative mapping
    (`unknown` fallback for shapes whose runtime representation isn't promised).

### Patch Changes

- c51b7b8: fix(dts): `generateDts` emits precise runtime shapes for Map and Set

  `generateDts` now maps `Set(T)` to its actual runtime representation
  `Record<string, true>` (a stringified-key object) instead of `T[]`, and keeps
  `Map(K, V)` as `Record<string, V>` (Map keys are stringified at runtime). With
  this, every standard-library container type generated for provider authoring —
  List, Map, Set, Option, Result, unions — matches the values the runtime produces
  and consumes.

- c51b7b8: fix(dts): `generateDts` emits precise tagged unions for Option / Result / unions

  `generateDts` now maps `Option(T)`, `Result(T, E)`, and user `type` unions to
  their actual runtime representation — the tagged `{ _tag: "Some"; _0: T }` /
  `{ _tag: "Ok"; _0: T } | { _tag: "Err"; _0: E }` / `{ _tag: "Name"; _0: … }`
  forms — instead of `T | null` / `unknown`. Variant payloads are positional
  (`_0`, `_1`, …) and nest correctly through `List` / `Option` so generated
  provider types match the values the runtime produces and consumes.

- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
  - @kumikijs/runtime@0.4.0

## 0.3.1

### Patch Changes

- 81d0791: fix: parse builtin-tile-named user fns as values in value-arg position

  A user `fn` whose name shadows a builtin tile (`label`, `text`, `markdown`,
  `link`, `image`, `icon`) was mis-parsed as a nested tile when used in a
  value-arg position such as `heading(label(light))`. Codegen then emitted
  `_s.show(undefined)`, rendering an always-empty heading (surfaced by
  `03-union-and-match` in the playground). Value-arg positions now always parse
  their argument as an expression.

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
  - @kumikijs/runtime@0.3.0

## 0.2.1

### Patch Changes

- c0c1708: Fix issue #7 — implement the argument-less spec stdlib methods (`spec/stdlib.md` §2.2): `head` / `tail` / `last` / `to-list` / `get-err` / `to-option` / `parse-int` / `parse-float` / `abs` / `neg` / `to-float` / `to-int`.

  Previously the parenthesis-free form the spec recommends (`list.head`) compiled clean but evaluated to `undefined` at runtime, and the parenthesized form (`list.head()`) was rejected with E0801. Both shapes now lower to runtime helpers and are recognized in `KNOWN_METHODS`. Follow-up to #5.

  Known limitation (deferred, needs receiver type inference): dispatch is name-only, so the no-paren form shadows a record/map field of the same name (e.g. `node.head` on a record `{head, tail}`).

- Updated dependencies [c0c1708]
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
  - @kumikijs/runtime@0.2.0
