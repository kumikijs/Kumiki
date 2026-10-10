# @kumikijs/compiler

## 0.14.0

### Minor Changes

- 276089b: Read a bare `Duration` / `Bytes` constructor as the call it is

  `Duration.s` written without parentheses was not a call at all. It was a field
  read on a freshly built variant — `{_tag: "Duration"}["s"]` — so it evaluated to
  `undefined`, and nothing objected:

  ```
  $ kumiki check a.kumiki
  ok
  ```

  A `setTimeout(undefined)` is a `setTimeout(0)`, so a timer written with that
  duration fires immediately and forever. That is the same failure the argument
  count was added for — `Duration.s()` lowered to `((0) * 1000)` — reached by the
  one spelling that never went through the count.

  `Duration` and `Bytes` now read the way `Decoder` and `EffectId` already did, so
  every namespace with built-in constructors answers a bare member by count and by
  name, in the same words as its parenthesised form:

  > `Function "Duration.s" expects 1 argument(s) but got 0` — **E0213**
  >
  > `Call to undefined function "Duration.nope"` — **E0116**

  Leaving the two out was never a guard, only that field read. The reason for it
  was that reading them as calls traded one silence for another — a missing
  argument was defaulted to `0` — and that reason is gone, because the count is
  checked and the default throws.

  `Decoder.Json` is the same rule from the other side and is unchanged: a member
  with an argument in an otherwise constant namespace, so it is the one `Decoder`
  member with no paren-less spelling.

  Two consequences worth knowing before upgrading:

  - **`Duration.fresh()` and `Bytes.fresh()` are now E0116**, and so is a
    zero-argument `Duration.parse()` — including the parenthesised spellings,
    which previously passed. `fresh` / `parse` / `show` are lowered on any
    capitalised qualifier and ignore the one they are written on, so
    `Duration.fresh()` minted a UUID straight into a `Duration` slot with nothing
    reported. Inside these four namespaces those three members now resolve to
    nothing, which is the rule `Decoder` and `EffectId` already carried; it is
    documented under E0117.
  - A program that declares its own `type Duration` is unaffected. Only the
    `Duration.<member>` position is claimed — tags written as bare names, values
    read through a receiver, and `Duration` matched as a pattern all still work.

- f36269f: Reject an effect bind list that names one identifier twice (E0123)

  `on=ping.ok(dup, dup)` bound two of the payload's positionals to one name.
  Codegen emits one `const` per bind, so the reducer body declared it twice:

  ```js
  const dup = _payload["$1"];
  const dup = _payload["$2"];
  ```

  The module threw `SyntaxError: Identifier 'dup' has already been declared` at
  load and nothing rendered, with `check` and `build` both clean.

  A bind list names the payload's positionals **in order**, so two binds naming
  one thing is not an abbreviation for anything — whichever value the name
  resolved to, the other positional would have no name to read it by. That is
  **E0123 `duplicate-effect-bind`** now, reported at the second bind and naming
  both positionals: E0122's rule at the trigger rather than at a pattern, and
  E0121's collision from the other side.

  `_` stays exempt however often it is written, and occupies a position rather
  than skipping one, so `on=load.ok(_, x, x)` is a collision between `$2` and
  `$3`. A repeated name that is _also_ a reserved one collects E0121 per bind
  and no E0123: those reports already say to rename the bind, and renaming it
  settles the duplicate too.

- 8eca379: An `error-boundary` fallback that declares an `in=` must declare one `PanicInfo` fits, and one that reads `$1` must declare one — anything else is **E0220 `boundary-fallback-input`** at the clause (#394).

  A fallback is applied to the panic: codegen binds its `$1` to the `PanicInfo` the runtime builds, whatever the fallback declares (`lifecycle.md` §7.3). Nothing checked that it declared one, so the type the checker gave `$1` was not the value the runtime bound:

  ```kumiki
  tile Fb in=Text = column(text("recovered: " + $1))
  tile Risky error-boundary=Fb = column(text("v: " + secret.get))
  ```

  passed `check` and `smoke`, and rendered `recovered: [object Object]`. A fallback declaring no `in=` could not name the panic it read — its `$1` drew E0103's generic hint to declare an `in=`, which led straight to the shape above.

  Both are now E0220, with a message that names `PanicInfo`. `PanicInfo` has to be assignable to what the fallback declares: `PanicInfo` itself, an alias of it, a `nominal` over it, or a record with exactly its five fields — not a narrower record. The report is attached to the clause, not to the tile: two clauses naming the same fallback are two reports. A fallback that declares no `in=` and never reads `$1` is not reported, so it can still be a route or `sub-routes` target, where an `in=` is E0213.

- b2b14c4: A handler written on a user-tile call site now joins the handlers already on the nodes that tile renders, instead of overriding them (#407). This changes what runs:

  - `row(Btn {onClick: btnOwn})` with `reducer rowClick on=ui.click(Row)` ran `btnOwn` alone. Codegen lifted both reducers onto the button, then spread the call site's props over the finished node, and `{...node.props, ...props}` replaced the lifted `onClick` with the call site's. `check` said ok and `rowClick` never ran. Both run now.
  - A call-site handler no longer overrides one the tile's body writes itself. With `tile Btn = button(text="x", onClick=dflt)` and `Btn {onClick: custom}`, `custom` used to replace `dflt`; now both run. A program that relied on the override has to drop the body's handler or pick another tile.
  - Every reducer on one handler runs once, in definition order (language.md §1.6.4 Invariant 3), wherever it was wired. `propsFor` used to put a handler written on the element before the lifted ones; that rule is gone, so where a handler is written no longer decides what runs first.

  A call site's handlers are handed down to the nodes its tile renders at its root — through nested call sites, into every branch of an `if` / `when` / `match`, and onto each node a `for` renders — and each node's `propsFor` joins them with its own handlers and the lifted subscriptions into one memoised `_h(...)`, so handler identity stays stable across renders. Only data props are left for `_attachProps` to merge.

  A tile whose body is a `for` renders again. `_attachProps` merged the call site's props into the list itself, even when there were none, and produced an object of its indices with no `kind`, which the runtime has no renderer for. It merges onto each node of a list now, and leaves a node alone when there is nothing to merge.

  Joining exposed an over-broad subscription in `02-todomvc` and the four `size-comparison` scenarios: `reducer toggle on=ui.click(TodoRow)` reached every button in the row, so the delete button ran `toggle` before `remove`, and the archive button flipped `done`. `toggle` subscribes to a `TodoCheck` tile holding the checkbox alone now, and language.md §1.6.2 says to subscribe to the narrowest tile the event means.

- a69f7f4: Bind a handler to a capitalised reducer name

  `onClick=Bump` on a defined `reducer Bump` was rejected, by a message that was
  false of the input it rejected:

  ```
  E0201 type-mismatch: Event handler arg "onClick" must be a reducer name
  ```

  `Bump` is exactly a reducer name. What was in the way is the shape the parser
  gives a capitalised one: a tile call as a named argument of a builtin that
  takes tiles, a variant tag in a props block, on a value-arg builtin such as
  `link` and on a user tile — never a reference, which is all the handler branch
  accepted. So a reducer whose own name was capitalised could not be bound to a
  handler at all.

  The handler position resolves in the reducer namespace, and capitalisation is
  not something the author is saying there, so all three shapes are now read as
  the name they carry. One resolver serves the three consumers that have to
  agree — the checker, codegen and the reference walker — because deciding it
  per consumer is what left the name accepted by one and invisible to the others:
  before this, the reference walker recorded a _tile_ edge for a handler
  argument, so `refs` listed a tile no definition declares and `rename` on the
  reducer left the wiring behind.

  What E0201 reports here is now a value that is no name — a literal, a variant
  tag carrying a payload (`onClick=Some(1)`), a tile call carrying arguments. A
  bare name that names no reducer is E0102 whatever its capitalisation, which is
  what a lowercase one already answered; a tile name written in a handler
  (`onClick=Card`) moves from E0201 to E0102 accordingly.

- 0a8762c: Report a comparison across two `nominal` types, as an assignment already was

  Two `nominal` declarations over one base are two types (language.md §1.3.5), and
  putting one where the other is required has been E0201 since the assignability
  work. Comparing them was not reported at all:

  ```
  type PostId = nominal Text where uuid
  type UserId = nominal Text where uuid
  slot p : PostId = "a"
  slot u : UserId = "b"
  slot n : Int = 0

  reducer cmp on=ui.click(B) do= n := if p == u then 1 else 2   # was ok
  reducer ord on=ui.click(B) do= n := if p <  u then 1 else 2   # was ok
  ```

  The two operators got there by different routes and neither passed through the
  rule. `==` was left total on the grounds that it is defined on every type, and
  ordering asks `orderingFamily`, which unaliases — so two nominals over `Int` are
  both "number" and two over `Text` are both "text".

  So the check that existed caught the rarer spelling. `p == u` is the same
  mistake as `p := u`, reads more naturally, and is the shape a router or a lookup
  is written in: `for t in todos if t.id == selectedProjectId`.

  Both now report once, at the comparison expression, naming both types as
  written — where the old ordering check already reported, and where
  `requireNumeric` would have reported once per offending side:

  ```
  E0201 type-mismatch at 7:38: Operator "==" cannot compare PostId with UserId
  ```

  The rule is the assignment rule read symmetrically — a comparison has no
  destination, so there is no side to call the actual one. A type carrying no
  nominal name of its own still compares with any nominal over it, so `cents == 0`
  and `postId == ""` compare exactly as they assign, and a `Deep` declared
  `nominal Cents` compares with a `Cents` in either order. Refused only when both
  sides carry a name and neither was declared as the other.

  Nothing else about the operators moves. `==` stays total over every _shape_,
  including across an `Option` and its `None`; ordering still answers its family
  question first, and a pair failing both — `flag < mark` on two `nominal Bool`
  declarations — reports once.

  The identity is read at the top level only, which an assignment does not do:
  `List(Cents) := List(Yen)` is E0201 because `relate` descends into the type
  argument, while `lc == ly` on the same pair stays silent. That is the one-sided
  reading the whole relation keeps — a missing diagnostic, not a wrong one — and
  §1.9.4 now says so rather than leaving it to be discovered.

  This makes `==` non-total, which language.md §1.9.4 claimed it was. The spec
  moves with it: §1.9.4 excepts the nominal identity rather than the rule
  excepting the operators, and errors.md E0201, which said the operators were
  outside the rule, now says they are inside it.

  A program relying on the old silence stops compiling, and it was already wrong:
  the two values were never the same type. Convert through the base the two share,
  written as a `fn` whose return type names the destination — the same repair an
  assignment across the pair needs.

- e96eba6: A `fn` name written without its parentheses is reported as E0127, and a `fn` name passed as a higher-order fragment is applied to the fragment's positionals (#390).

  A `fn` is not a value, but its bare name was accepted wherever a value goes and lowered to the generated function itself. `emit load(label)`, where `label()` was meant, dispatched a _function_ to an effect declaring `in=Text`. A storage key stringified to the function's source, an HTTP body serialised to `undefined`, and `check`, `smoke` and the browser all stayed silent. `init = [load(label)]` did the same before the app mounted.

  It is now **E0127 `fn-as-value`**, and the message names the call: `"label" is a fn, and a fn is not a value — write the call: label()`. A parameter, a `let` or a slot of the same name shadows the `fn` and is not reported.

  The one position where a bare name is right is the fragment argument of a higher-order method (`language.md` §1.8.6): `filter`, `map`, `find` and `sort-by`, `fold`'s second argument, `flat-map`, `map-err`, and `update`'s second argument. That position was broken as well. `items.map(double)`, the spec's own example, lowered to a list of functions, and `items.filter(isActiveOnly)` kept every element. It now lowers to the call it stands for: `double($1)`, and `add($1, $2)` in a `fold`. A `fn` there must take at least one positional and no more than the method binds; anything else is E0213. `fold`'s `fn` takes exactly two, the accumulator and the element. A list method's `fn` takes two only over a `Map` or a `List` of pairs (`.entries`), where `$2` is the value; over any other receiver the checker can decide, a second parameter would get the JS index or the element again, and is E0213.

  A `fn` named there runs wherever the method does, so the pre-mount route checks follow it: `slot names = [1, 2].map(here)` with a `here` that reads `route` is E0304, through a chain of `fn`s as well, and the same in an `app.init` argument is E0120.

- 62cc960: A `filter` / `map` / `find` / `sort-by` fragment binds `$1` / `$2` from the receiver's type, not from the length of each value (`stdlib.md` §2.2.3).

  The lowering used to take apart any value that was an array of exactly two items, so a two-item `List` element, or an `Option` holding one, bound `$1` to its first item:

  | Expression                                              | Was                  | Is             |
  | ------------------------------------------------------- | -------------------- | -------------- |
  | `Some([1, 2]).filter($1.length > 1)`                    | `None`               | `Some([1, 2])` |
  | `Some([1, 2]).map($1.length)`                           | `{"_tag":"Some"}`    | `Some(2)`      |
  | `[[1, 2], [3, 4, 5]].map($1.length)`                    | `[null, 3]`          | `[2, 3]`       |
  | `[[1, 2], [3, 4, 5]].find($1.length == 2)`              | `None`               | `Some([1, 2])` |
  | `[[1, 2], [3, 4, 5]].map(len)`, `fn len(xs: List(Int))` | `[null, 3]`          | `[2, 3]`       |
  | `[1, 2].map($1.min($2))`                                | `[0, 1]` (the index) | E0103          |

  The checker now records how each fragment binds and codegen follows it: a `Tuple(A, B)` (what `.entries` produces) is taken apart into `$1` / `$2`, a `Map`'s filter is handed the key and the value, and any other value is `$1` whole. Such a fragment binds no `$2`: `Some(7).filter($2 > 5)` quietly read `$1` again, and `xs.map($2)` read the index; both are now **E0103** with a message saying the fragment is handed one value. A `fn` named as the fragment (`xs.map(len)`) binds the same way as the call it stands for (`xs.map(len($1))`).

  That also holds for a `$2` nested in another method's argument inside such a fragment. Only the fragment argument binds positionals now, so `nums.map($1.min($2))` is E0103 rather than reading the JS index, and an enclosing pair's `$2` inside an `update` / `flat-map` / `map-err` fragment is that value rather than an unbound name that threw at run time.

  The run-time fallback remains where the checker cannot decide the element type (a type parameter, an untyped payload), and where the receiver's type is known but §2.2.3 gives the method no binding on it: a `Set`, `Map.map` / `find` / `sort-by`, `Option.find` / `sort-by`, `Result.filter` / `find` / `sort-by`, and any receiver that is not a collection. A `fn` of two named as the fragment there is **E0213** unless the receiver is one the checker cannot decide.

  With `$1` bound to the element whole, the checker types it too, so an element that is itself a `List` or `Set` is checked like any other value, and a key reader on it restores its keys.

- 2dfc73f: Report a handler on a user tile that fires nothing (W0213)

  `Inner() {onClick: bump}` over `tile Inner = box(text("clickme"))` renders,
  wires no listener, and reported nothing at all — `check`, `build` and `smoke`
  were all clean, and the click did nothing:

  ```
  $ kumiki check a.kumiki
  ok
  $ kumiki smoke a.kumiki
  ok — mounted, rendered, 0 interaction(s), no runtime errors
  ```

  Written directly on the `box`, the same binding was already **W0213
  `handler-on-inert-tile`**. `checkHandlerTarget` returned early for any name
  outside `BUILTIN_TILES`, which is a statement about where the answer is _easy_
  — a builtin's renderer is known — rather than about where the problem is. The
  outcome is identical either way: the element renders, no listener is attached,
  and nothing says why. W0213 exists precisely because this is the failure
  `smoke` cannot see.

  A user tile is now asked the same question, by walking its render tree with
  `collectTileBuiltinKinds` — the walk W0212 already uses — and the message names
  what the tile does render:

  > `"onClick" on Inner() is dropped — Inner renders nothing that fires it (observed in body: box, text). Put it on button / check / radio / switch, or subscribe with a reducer's on=ui.<event>(<Tile>)`

  Only a tree with no firing kind anywhere in it is reported, which under-reports
  rather than over-reports: the prop lands on the tile's **root** node, so
  `box(button(…))` drops the handler too and stays silent, because the walk does
  not yet tell a root from a descendant. Everything it does report is a certain
  drop, so the working shape — a tile whose tree contains a firing kind — draws
  nothing and the warning does not become noise. When the walk finds no kind at
  all — the tile's own root is a name that resolves to neither a builtin nor a
  declared tile, or a cycle — nothing is reported, matching how W0212 declines
  the same empty answer; those shapes have E0105 / E0005 already. Nested, the
  kinds around the unresolvable part are still a true answer about the root, so
  the warning stands beside the code that names it.

- 027cf25: A non-`Text` key reads back as its declared type from `Set(T).to-list`, `Map(K, V).keys`, `Map(K, V).entries`, and as the `$1` of a `Map(K, V).filter` predicate (#467).

  A Set is stored as `{ [key]: true }` and a Map as a plain object, so their keys are JavaScript object keys — strings. The readers returned them as they were stored, so a `Set(Int)` built with `add` answered `["7", "8"]` under a `List(Int)` type. Every later reader disagreed with it: `contains(7)` was false, `sort` ordered text, `fold(0, $1 + $2)` concatenated, a `for k in m.keys` over a `Map(Int, V)` bound strings, and `m.filter($1 == 3)` kept nothing. `check` and `build` both said `ok`.

  The checker now records, on each of those members, how the receiver's key type is represented — a number for `Int` / `Float` / `Time` (and a `nominal` / `where` over one), a boolean for `Bool` — and codegen passes it to the runtime helper, which restores the keys it reads. A `Text` key lowers exactly as before. The storage and `add` / `remove` / `toggle` / `has` are unchanged, and already agree: they key by `String(x)`. stdlib.md §2.2.2 states the rule.

  For the receiver's type to be known in more places, two things the checker left untyped now have types:

  - **`$1` / `$2` in a fragment** are bound to what the lowering hands it, read off the receiver: the element of a `List` or `Option`, the halves of a `.entries` tuple, a Map's key and value under `filter`, `fold`'s element, `Map.update`'s value. So `rs.map($1.ids.to-list)` restores keys, and a value passed on through them is checked like any other: `xs.map(loud($1))` with `loud(t: Text)` over a `List(Int)` is now E0201. Where the lowering's reading is not certain (an element that is itself a `List` or `Set`, `fold`'s accumulator) nothing is bound, as before.
  - **`run-reducer(r)` in a property-test invariant** answers `{slots: {…}}` typed with the program's slots, so `run-reducer(add).slots.st.to-list.contains(7)` no longer reports a counterexample against a correct program, and a slot name the program does not declare is E0108.

  **`T.fresh()` on a type a `Text` does not go into is now E0802.** `fresh` mints a uuid `Text` whatever `T` says; on a `nominal Int` the string used to pass silently, and with keys now restored by type a `Set` of such ids read them back as `NaN`. Declare the id `nominal Text`. The E0124 message for `fresh` on a type constructor names that half of the repair too.

- b74e05a: A `match` used as a value is checked against where it lands (#435).

  Each arm's pattern bound its payload with the right type, so `| Some(id) -> p := id` was reported — but the value the arms produced was never compared with the destination. `p := match ou with | Some(id) -> id | None -> p` put a `UserId` into a `PostId` slot and `check` said `ok`, while `p := ou.get-or(p)`, the same mistake spelled the other way, was E0201.

  Now a declared destination (a slot assignment, a `fn`'s return type, an argument) checks every arm the way it already checked both branches of an `if`, reporting at the arm that does not fit. Where nothing declares a type — a `let`, a comparison operand — the `match` has its arms' common type, the same one an `if` gets. When the arms disagree, that is the base they share with the nominal dropped (`UserId` and `PostId` arms give `Text`). The `match` has no type only when the arms share no base or one arm's type cannot be decided, so nothing new reports on a `match` the checker cannot read.

- fe62177: A stdlib member is now a member only of the receivers stdlib.md §2.2 lists it for. `res.filter(…)` on a `Result`, `opt.keys` / `.size` / `.entries` on an `Option`, `res.values`, `st.map(…)` on a `Set`, `xs.size` on a `List`, `n.copy(…)` on an `Int` and `d.ms` on a `Duration` are **E0108 `undef-member`**, in both spellings (`recv.m` and `recv.m(…)`) and on both sides of `:=`. The message names the receivers that do have the member: `Type "Result" has no member ".filter" — it is a member of Map / Set / List / Option`. A `Duration` keeps its own row through an alias, a `where` and a `nominal` over it (`d.to-ms` on a `Duration where between(0, 1000)` is fine), and is named `Duration` in the message rather than the `Int` beneath it.

  These used to pass `check` because the checker asked whether the runtime knew the name on _any_ receiver. The runtime then answered with another container's reading: `Ok(3).filter($1 > 2)` was read as a `Map` and gave `{}`, and `Some(3).keys` gave the Option's own `_tag` / `_0` as data. The members come from one per-receiver table (`stdlib-members.ts`), which the result types the checker infers are keyed by as well, and a test holds it equal to the §2.2 signature blocks on both spec tracks. A receiver whose type the checker cannot decide keeps the name-based dispatch, as before.

  `Time.to-ms` (milliseconds since the epoch), which the apps already used, is now listed in §2.2.8, and `Set(T).filter(pred) : Set(T)`, which the apps also use, in §2.2.2: its predicate is handed each element.

- eb5215c: A stdlib member written as an assignment target is now a check-time error instead of a write that replaces the slot (#370).

  `name.length := 9` on a `Text` slot passed `check`, built, and left the slot holding `{"length": 9}` — not a `Text`, not a value any expression reading it can use, and reported by nothing until a render tripped over it. The lvalue was flattened into a plain field path, so every member name became a literal key.

  The read side has always resolved `recv.member` by the receiver's type: a record's own field wins, otherwise the name is a member. The write side asked that question only for a record, and for every other receiver it recorded "shortcut" and said nothing. Both sides now ask one classifier, so "what is this name on this receiver" has a single answer; the write side adds only the question it alone needs on top of it — whether what the name resolves to can be written _through_.

  `language.md` §1.6.3's step set is stated as closed: a field, an index, and `.get` on an `Option` / `Result`. A member is none of those, and is **E0602 `unassignable-member`**, naming the member and the receiver type. `.get` stays legal only where §1.6.3 defines it — on a `Map` or a `List` it is a member like any other, and was the same corruption, since the runtime's setter falls through an unwrap segment on a value carrying no `_tag`.

  The name is still dispatched rather than reserved: a record that declares a field named `length` is written through it as before, and conversely a record does not declare `.show`, so `rec.show := "x"` is E0602 like any other member. A receiver whose type the checker cannot decide — a union, an opaque type parameter — reports nothing, as on the read side.

  E0602 asserts that the name **is** a member of this receiver, so it is raised only where that is true. A name a known receiver does not have is **E0108** on the write side too, which is the read side's own answer and what the write side was missing entirely: one the receiver simply lacks (`name.frist`), and one belonging to another receiver — `.abs` is a method of `Int` / `Float`, so on a `Text` it is undefined rather than unassignable.

  Refs #370. The `List` index write the example notes as out of scope is #462.

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

- 1bc3e8a: Refuse a route target that declares `in=`

  A route entry names a tile and gives it nothing — the route table lowers to
  `tile: () => …`. A target that declared `in=` therefore left `$1` unbound:

  ```kumiki
  tile Panel in=Text = column(text($1))
  tile Host  = column(Panel("a"))
  app M caps=[] routes={"/" -> Panel, "/404" -> Host} init=[]
  ```

  `check` said ok, `build` said ok, and the mount died in render with
  `_d_1 is not defined`. The app rendered nothing at all, and the first sign of
  it was at the smoke tier.

  That is E0213 now, reported at the entry — the same code a call site already
  gives for a tile applied to the wrong number of arguments, because a route
  entry is one such application. A sub-route entry, and therefore whatever
  `route-outlet` renders, is checked the same way.

  Nothing is lost by refusing it: the route being rendered is in the standard
  `route` slot, which every tile can read without an argument. A tile that takes
  an input stays callable from a tile body — it is the route position alone that
  supplies none.

- c858728: A Set literal is a Set (stdlib.md §2.2.2).

  A list literal written where a `Set` is declared lowered to a JavaScript array, while every Set member reads a Set as `{ [key]: true }`. So `slot s : Set(Int) = [5]` answered `s.has(5)` with `false`, `[5, 5]` had size 2, `s.add(5)` made the mix `{"0": 5, "5": true}`, and a reducer-test whose `given` / `expect` slots held Set literals compared an array with an object. `check` said `ok`.

  The checker marks a list literal it checks against a `Set` type, and codegen builds it with `_s.setOf` (new in the runtime), the same value `add` builds from those members. That is every position the checker reads against a type: for example a slot, a record field, a `fn` parameter or return value, a reducer write, a `let … in` body, an element of a `List(Set(T))` or a value of a `Map(K, Set(T))`, the argument of `List.contains` / `push` / `prepend` and the value of `Map.insert` / `update`, and a test's slot values, expected effect arguments and mocked results. A `<any-id>` member of a Set literal in a reducer-test `expect` pairs with one generated member. Where the checker cannot type the receiver — `$1` in a fragment over a `List(Set(T))` — a literal argument stays an array.

  New diagnostics on programs `check` used to accept:

  - The argument of `union` / `intersect` / `diff` is checked against the receiver's `Set(T)`: a `List`, a `Set` of another element type or an `Option(Set(T))` there is E0201.
  - The argument of `List.contains` / `push` / `prepend` is checked against the element type, and the value of `Map.insert` / `update` against the value type (E0201).
  - A test's slot values are checked against the slot's type, an expected effect's argument against its `in=` type, and a mock's payload against its `out=` type (E0201 / E0214 / E0215), as a slot initializer already was.

  A Set literal of records or variants now holds what the `add` chain of the same members holds: today those members are keyed by their string form, so `[{x: 1}, {x: 2}]` has one member where the array had two. How structured members are keyed is tracked in #658.

- 3043987: A slot's initial value that reads `route`, directly or through a `fn` call, is now `E0304 derived-slot`

  `route` is a slot, and an initial value may not read one — but it is not in
  the definition index, so the E0304 pass never saw it. The read lowered to
  `_live["route"]` inside the `_slots` literal, above `const _live`, so

  ```kumiki
  slot at : Text = route.path
  slot at2 : Text = here()
  fn here() -> Text = route.path
  ```

  compiled clean and threw `Cannot access '_live' before initialization` while
  the module was being imported: nothing mounted.

  Both shapes are now reported — the direct read at the read, the hop at the
  call with the chain that reaches the route (`here → route`), exactly the way
  `E0120` reports an `app.init` argument. The two positions ask the same gate and
  the same chain resolver, so a local bind or a `fn` parameter named `route` is
  that binding in both, and the message sends the author to a `route.enter`
  reducer rather than E0304's usual "compute it in a fn". `now` stays legal in an
  initializer (it is a module import, not something the mount installs), and a
  `fn` that reads the route stays legal everywhere it runs after the mount.

- 6925c32: A standard effect's argument is now checked against the `in=` stdlib.md §2.6
  gives it, as a declared effect's already was — at an `emit`, an `app.init`
  entry and an `expect.effects` argument alike.

  ```
  emit navigate("/about")                      # was ok, and navigated nowhere; now E0202
  emit navigate-back(1)                        # was ok; now E0213 (in=Unit takes none)
  emit log(42, 43)                             # was ok, the 43 dropped; now E0213
  emit toast("Saved")                          # was ok; now E0202
  emit toast({kind: "info"})                   # was ok; now E0214 (no `text`)
  emit confirm({title: "t", onYes: 42, onNo: no})  # was ok; now E0202 (not a reducer)
  ```

  `checkEmitTarget` stopped after the capability check for a standard effect,
  because there is no `effect` declaration to read an `in=` off. The capability
  and the input now live in one table (`BUILTIN_EFFECTS`, exported, from which
  `BUILTIN_EFFECT_CAPS` is derived), so an entry cannot have one without the
  other, and a test holds that table to the `effect` lines in §2.6 and routing.md
  §3.7, in both tracks.

  A record argument may leave out an `Option(T)` field, which the effect treats
  as `None` (`toast({kind: "info", text: "notified"})`), and the fields §2.6 gives
  a default: `navigate` / `navigate-replace`'s `params` and `query` (`{}`,
  routing.md §3.7) and `confirm`'s `message`. What is left out is read at each
  leaf, so an `if` whose branches write different fields, a `let` body and a
  value of a narrower record type (`slot cfg : {path: Text}`, `emit
navigate(cfg)`) all pass. The relaxation is the standard effects' alone; a
  declared effect's record `in=` still takes every field.

  §2.6 now states that rule, writes `query` into `navigate`'s `in=`, adds
  `confirm`'s `message`, which lifecycle.md §7.6 and the runtime already had, and
  spells `confirm`'s `onYes` / `onNo` as `ReducerRef` (§7.6's spelling, defined
  in §2.6.5): a reducer's name written bare, and E0202 for any other value.

- fbbec02: A failed storage / session / indexed effect now delivers the `Text` its `out=Result(T, Text)` declares to `.err`, `$e` there is typed `Text`, and declaring any other `E` on these effects is the new E0306 `err-type-not-text` (#504).

  The spec declares these effects' failure as `Text`, but the handlers delivered a `{message: …}` record. A reducer written to the declaration, `problem := $e`, rendered `[object Object]`; one written to the runtime, `$e.message`, contradicted the declared type, so `$e` had to stay unchecked.

  The handlers in `effects-storage.ts` and `effects-indexed.ts` now deliver the failure's message itself (`"Error: storage blocked"`, `"app.indexed-db is not declared"`), and read the storage global and the request inside their own `try`, so a `SecurityError` from the `localStorage` getter or a missing request is that `Text` too. Codegen runs everything in such an effect's invoke inside a `try` — the `map-request`, the host provider and the built-in handler, awaited — and reads every err value, returned or thrown, through one normalizer: a `Text` is itself, an `Error` is `Name: message`, a record with a `Text` `message` is that `message`, anything else is its JSON text. A throw caught there is marked `final`, so `retry=` makes one attempt for it, as it did when the throw reached the dispatcher.

  `.err($e, _)` on one of these effects binds `$e : Text`, so `$e.message` is E0108 and `n := $e` into an `Int` slot is E0201. A program that read `$e.message` must read `$e`, and one that declared `out=Result(T, {message: Text})` must declare `Result(T, Text)`. A host provider for `storage.*` / `session.*` / `indexed.*` should return its failure as a `Text`. HTTP effects are unchanged: they still deliver the `HttpError` record, and `.err` on HTTP and custom capabilities stays unchecked.

- e709ac7: Report a test-body section name the test kind does not have

  A test body's sections are read by name — `slots`, `event`, `mocks`, `panic`,
  `slots-equal` — and a name outside that set was read by nothing and reported by
  nothing. The section simply did not happen, which does not weaken the test, it
  replaces it:

  ```kumiki
  test typo-section =
      reducer-test inc
          given  = {slot: {count: 41}, event: {type: ui.click, target: B}}
          expect = {slots: {count: 1}, effects: []}
  ```

  ```
  check: ok
  kumiki test: PASS  typo-section (1ms)
  ```

  `slot` instead of `slots`, so the 41 never happens: `count` starts at its
  declared `0`, `inc` makes it `1`, and the assertion holds against a state the
  author did not choose.

  That is E0714 now, at the key's own position, with the accepted set named and
  the nearest of them offered when one is close enough:

  ```
  E0714 test-section-unknown at 9:19: Unknown section "slot" in a reducer-test
  `given` — did you mean "slots"? (accepted: slots, event, mocks)
  ```

  A name that belongs to the test's _other_ clause is reported as that rather
  than as a misspelling — `effects` written in a `given` is spelled right and
  placed wrong, which no distance rule can say. Two equally close names offer
  nothing, because the accepted set is already in the message.

  The accepted set is one table per kind and clause (`src/test-sections.ts`), and
  both halves of the compiler now read sections through it: `emit-test.ts` names
  one with a type derived from the table, and the checker dispatches on a name
  the table gives it, so a section either side knows about and the other does not
  fails to compile.

  **The camelCase spellings go.** `episodeExpectJs` also read `slotsEqual` /
  `noPanics` / `noErrors`, which the spec never documented and no Kumiki source
  in this repo writes. A vocabulary only a code comment knows about is the shape
  this change exists to remove, and an alias also let one section be written
  twice (`{no-panics: true, noPanics: false}`) with the second silently winning.
  They are E0714 now; write the hyphenated names §8.1.1 has always specified.

  An `episode-test` `expect` section codegen does not recognise now throws rather
  than lowering to `{}`, which is what the runtime reports as a passing test that
  asserted nothing — the same rule `expect.effects` and an episode mock already
  follow for a caller that skips `check`.

- 6b334a4: Refuse a `tile-test` whose `given.in` disagrees with its target

  A `tile-test` applies its target: the lowering applies `App._tilesById["<T>"]`
  to `given.in`. Nothing checked that the argument matched the target's
  declaration, so a test that omitted the `in` its tile declares passed
  `undefined`:

  ```kumiki
  tile Card in={label: Text} = text($1.label)

  test t =
      tile-test Card
          given  = {slots: {count: 0}}
          expect = text("x")
  ```

  `check` said ok, and `kumiki test` died with

  ```
  TypeError: Cannot read properties of undefined (reading 'label')
  ```

  — no test name, no position, no code. Nothing catches that, so it reached the
  CLI and every other test in the file lost its result with it. The mirror case —
  an `in` given to a target that declares none — was dropped, so the test asserted
  a render that never saw the value it was written for.

  The count is E0213 now, in the sentence the tile-call form already uses, because
  a `tile-test` is one such call: `Tile "Card" expects 1 argument(s) but got 0`.
  An `in` the target does not declare is reported at the section, which is the
  text to delete; a missing one at the test. A `given` carrying a section name
  outside the vocabulary is left to E0714 alone — an input written under such a
  name is that mistake rather than a missing argument.

  The count alone was not enough, because the type is what separates a loud
  failure from a silent one: `show` renders a wrongly typed value as the empty
  string just as it renders an absent one, so `in: 42` against `in=Text` compared
  the snapshot against something indistinguishable from an empty label and
  _passed_, asserting a shape no tile call can produce. So `given.in` is now
  compared with the target's `in=` through the same rules a tile call's argument
  goes through — E0201 for the value, E0214 / E0215 for a record's fields — at the
  value's own position.

  A `tile-test` naming a **built-in** tile is E0105: `_tilesById` is built from the
  user tiles alone, so `tile-test text` passed `check` and then died with
  `App._tilesById.text is not a function`, taking the file's other results with it.
  It could not work whatever it was given, so the count is not what is wrong with
  it.

  Codegen throws rather than emitting the `undefined`, for a caller that skipped
  `check`. The throw names the code and repeats the checker's sentence under its
  own prefix: `E0213 tile-test "t": Tile "Card" expects 1 argument(s) but got 0`.

  **Migration.** Three `tile-test` shapes that passed before now fail `check`:
  `given.in` written against a target declaring no `in=` — including `in: ()`, the
  spelling `docs/spec/testing.md` §8.4 taught until this release — should be
  deleted; a missing `in` against a target that declares one should be written;
  and an `in` of the wrong type should be corrected to the declared one. A
  `tile-test` naming a built-in tile should name the tile that renders it.

- 0aff1de: Give `T.fresh()` and `T.parse(t)` the types stdlib §2.4 gives them

  `stdlib.md` §2.4 says `TypeName.fresh()` is a `T` and `TypeName.parse(text)` an
  `Option(T)`. `inferType` implemented neither. Its `Call` case looked the callee
  up in `CALL_RESULT`, answered the `Duration.` and `Bytes.` qualifiers, and
  otherwise fell through to `sym.fns.get(callee)` — which holds no dotted name. So
  `TodoId.fresh()` was undecidable, and an undecidable expression is accepted
  wherever it lands:

  ```
  type PostId = nominal Text where uuid
  type UserId = nominal Text where uuid
  slot p : PostId = "a"

  reducer mk on=ui.click(B) do= p := UserId.fresh()              # was ok
  slot found : Option(PostId) = UserId.parse("x")                # was ok
  ```

  That left the nominal identity telling `PostId` and `UserId` apart everywhere
  _except_ at the call that mints one — and `.fresh()` is how an id is normally
  created, so the unchecked position was the one that mattered most. `.parse` is
  the same gap one level in.

  Both are now reported:

  ```
  E0201 type-mismatch at 6:36: Expected PostId but got UserId
  E0201 type-mismatch at 7:31: Expected Option(PostId) but got Option(UserId)
  ```

  The qualifier is **resolved** rather than matched. A primitive answers as a
  `TypePrim`, a `type` definition that needs no arguments as a `TypeRef`, and
  anything else — a name with no definition, or a constructor still wanting its
  arguments like `List` or a `type Box(T)` — answers nothing at all. The arity
  half is the load-bearing one: an unapplied `TypeRef` to `Box` unaliases into an
  unsubstituted body and mismatches against real types, so it would report a type
  nobody wrote. An unresolvable name costs nothing by comparison — the relation
  short-circuits on a `TypeRef` it cannot unalias — and
  [E0117](https://kumiki.dev/spec/errors#e0117-undef-type) is the single report
  there either way.

  `fresh` is narrower still, because its lowering discards the qualifier: every
  `T.fresh()` is the same `_s.freshId()`, a uuid `Text`. So it answers only for a
  type a `Text` inhabits, which is what §2.4.1 scopes `fresh` to. Read without
  that test the inference asserted types the lowering never produces —
  `slot s : Text = Int.fresh()` became E0201 on a program whose value really is a
  `Text`, a record type was believed of a string, and a `nominal Int` id answered
  its own base. All three answer nothing, exactly as before this change.

  `Duration` and `Bytes` keep their own answers, ahead of this rule: their members
  are constructors rather than these two. `parse` is the one spelling they share
  with it, and both get it wrong the same way — `Duration.parse(t)` and
  `Bytes.parse(t)` answer a bare `Duration` / `Bytes` where the spec gives them
  `Option(…)`, so writing the call as documented is E0201 and writing it wrongly
  is clean. That is #424, left as it was rather than widened into this fix and now
  pinned in both directions in `spec-divergences.test.ts`, so a fix that moves only
  one of them is caught. The qualified `show` is unchanged: it is `v.show` under
  another spelling and always a `Text`.

  The corpus was measured rather than assumed. Every `.kumiki` file under
  `packages/` and `docs/` — 126 of them, the examples, the benchmarks, and the
  `packages/mcp`, `packages/cli` and `packages/vite` fixtures — produces a
  byte-identical diagnostic list before and after, and the ```kumiki blocks under
`docs/spec/`are covered by`packages/tests/spec-blocks.test.ts`. Nothing in the
  corpus gains a report.

  A program that put one type's fresh id into another type's slot stops compiling,
  and it was already wrong: the two were never the same type. The repair is the
  one every other nominal mismatch takes — mint at the type the position declares,
  or convert through the base the two share, written as a `fn` whose return type
  names the destination.

- 14522b7: Report a `type` whose alias chain resolves to itself

  The definition-cycle check covered a tile that expands into itself (E0005), a
  slot initializer that reads a slot (E0304) and a `fn` that calls itself (E0006).
  A `type` written in terms of itself was not one of them:

  ```
  type A = A
  slot x : A = 1        # was ok

  type A = B
  type B = A
  slot x : A = 1        # was ok
  ```

  Neither type has a meaning — there is no body to reach — so a slot declared with
  one silently got no type at all and every value-level check on it went quiet.
  That is the same silence a misspelled type name produced before E0117. The
  normalisation helpers already survived the shape by returning "undecidable" on
  re-entry, so the cycle was handled by every consumer declining to answer rather
  than by anyone reporting it.

  Both are now **E0009 `type-cycle`**, named and positioned the way the other two
  cycle codes are — once per cycle, at the loop's first edge, inside the
  definition the message names:

  ```
  E0009 type-cycle at 1:10: type "A" resolves to itself (A → B → A)
  ```

  The chain followed is the one normalisation follows, and it stops where
  normalisation stops. An alias, a `nominal` wrapper, a `where` refinement and a
  generic that hands one of its parameters straight back all lead on to the next
  name; a record, a union, a primitive and a container are types in their own
  right, so no name written inside one is an edge. **Recursive types stay legal**,
  which is the point of drawing the line there:

  ```
  type Node  = {value: Int, next: Node}
  type Tree  = {children: List(Tree)}
  type Shape = Leaf | Branch(Shape, Shape)
  type A     = Option(A)
  ```

  Each reaches a structural type before it reaches itself. Comparing two of them
  terminates because the relation is read co-inductively over the types _as
  written_ — not because their values are finite: `Node` above has none at all,
  its `next` being neither optional nor a container, and is the spec's own lead
  example of a legal recursive type.

  The forwarding generics are the case where substitution decides what comes next,
  so the chain follows the argument written at that position:

  ```
  type Alias(T) = T
  type A = Alias(A)        # E0009, and was `ok` — it built and it ran
  type B = Alias(Option(B))  # legal: the argument is a container
  ```

  A name denoting no `type` definition ends the chain rather than closing it, so a
  generic constructor (`List`, `Option`, `Map`) is not an edge and an undeclared
  name stays E0117's alone. A standard-library _domain_ type is a definition like
  any other, so redeclaring one (`type Route = Route`) closes a loop through the
  program's own. A parameter is read as the parameter and never as a global of the
  same spelling (`type Alias(Cents) = Cents` is its argument).

  `unaliasType` also stops answering with a type that cannot be compared: a
  `TypeApp` re-entered on its own chain now returns "no normal form" like a
  `TypeRef` already did, so `type A = Alias(B)` / `type B = Alias(A)` reports the
  cycle instead of `Expected A but got Int` against the literal.

  `unaliasType` and the nominal-chain walk keep their own re-entry guards
  regardless: normalisation has to terminate on a program the checker is still in
  the middle of reporting.

  The rule this adds is normative in `language.md` §1.3.6 (Type Layer Invariants)
  on both tracks, where the sibling cycle codes have theirs, and `errors.md` E0009
  links there.

  A program relying on the old silence stops compiling, and it was already wrong —
  nothing was being checked against the type in question. Give one name on the
  chain a body: a type meant to be recursive wants a record or a union where it
  names itself, and a type meant to be an alias wants the definition it was
  aliasing.

- 7ed2e94: A value written as a child tile is now **E0128 `value-as-child`**, at the value (#522).

  A builtin other than the value builtins (`text`, `heading`, `markdown`, `code`, `editable`, `label`, `link`, `image`, `icon`) renders a positional argument only when it is a tile — a `tile-expr` or the name of a tile the program defines (language.md §1.7.1). Codegen dropped any other value there, and `check`, `build` and `smoke` all passed:

  ```
  tile Card in={label: Text} = text($1.label)
  tile Home = column(text("a"), 42)              # rendered only "a"
  tile Home = column(text("a"), n)               # n a slot: a null in the child list
  tile Home = column(let x = 42 in Card(x))      # mounted an empty root
  ```

  A `let` also hid a tile from the checker: `Card`'s argument under it was not compared with its `in=`, and a builtin under it was looked up as a `fn` (E0116) — so `column(let x = 42 in text(x.show))` reported E0116 rather than the real problem. Nothing inside the value is checked now; a diagnostic in there shows once the value is moved.

  A value where a value belongs is unaffected: a value builtin's content (`text(let x = 1 in x.show)`), a user tile's input (`Card(let x = "a" in {label: x})`), a named argument. Show the value with a tile (`text(n.show)`), write it where it is used, or compute it in a `fn`.

  The recorded Codex output for the v3 learning-cost task writes a tile's `Text` input as a child (`column(HeaderBar, $1)`), so it now fails `check`; the benchmark summary is re-scored.

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

- 528c9d3: Reject an effect bind named after a positional binding (E0121)

  `on=ping.ok($el, _)` bound the payload's first positional to `$el`, which the
  compiler already declares in every reducer body. The emitted reducer then
  declared `const _d_el` twice, so the module threw `SyntaxError: Identifier
'_d_el' has already been declared` at load and the app never rendered — with
  `check` and `build` both clean. `$event` and `$route` were the same.

  The bind is now **E0121 `reserved-bind-name`**, reported at the bind rather
  than at the effect it follows or at a read in the body. `$route` reports this
  and nothing else: the bind still enters the reducer's scope, so the body's
  reads resolve to it rather than collecting an `E0119` apiece for a name the
  author chose themselves.

  Three names are checked, not a prefix — `$1`, `$m` and `$now` stay bindable,
  because nothing else declares one. Codegen emits its three declarations from
  the same table the gate reads, so a name added to one side arrives on the
  other. A `let` in a reducer body can still take one of the names; that is a
  scoping bug in the lowering rather than a rule about names, and is tracked on
  its own.

- 29e24c1: Check the expression inside `policy=latest-per-key(...)`

  Every expression rule the checker has — `checkCallee`, `checkAgainst`, the
  undefined-name report — runs from `checkExpr`, and an effect's
  `latest-per-key` key was not one of the places that called it. The key was
  never checked at all.

  Two failures came out of that. A misspelled name lowered to a bare identifier
  inside the key lambda, so `check` and `build` were clean, the app imported,
  mounted and rendered, and the first dispatch of the effect died on an
  undefined global. A built-in call missing its argument reached codegen
  instead, which threw a plain `Error` — no code, and a position only in the
  message text — rather than a diagnostic. Before built-in calls were counted
  at all, that same program built cleanly and keyed the effect on
  `bytesFromText("")`, one key for every request, so `latest-per-key` silently
  behaved as `latest`.

  The key is now walked like any other expression, in the scope it is written
  in: `$1` is the effect's input and the only bind, the same one `map-request`
  is given. A misspelled name is **E0103** and a built-in call missing its
  argument is **E0213**, both at the key's own line and column rather than at
  the effect. A slot and a `fn` stay readable there — codegen lowers a slot read
  in the key through the live slot map — and `$route`, which the key is never
  applied with, is an undefined name.

  `map-request`, `app.http`'s fields and the key all want the same pure,
  payloadless scope and each built its own; they now share one `pureScope`
  helper, so a change made for one reaches the others.

  Upgrade note: a program whose key names something undefined now fails
  `check`. It was already broken — it threw the first time that effect
  dispatched — but the failure has moved from run time to check time. The
  examples and benchmark corpus produce no new diagnostic.

- 8f7b051: An index write into a `List` leaves a `List`, an index into a `List` is an `Int`, and an index write into a `Set` is refused (#462).

  `xs[i] := v` on a `List` replaced the list with an object keyed by its indices: the setter shared by reducer assignments and `bind=` write-back ended every step with an object spread, and `{...[1, 2, 3]}` is `{"0": 1, "1": 2, "2": 3}`. `check` said `ok`, and every reader after the write — `.length`, `.head`, a `for`, the state a scenario asserts — saw something other than a List.

  The setter now copies a List and replaces the element at the index, at any depth, so `rows[1].n := 9` and `grid[1][0] := 0` keep every level's shape. An index that names no element — past the end, or negative — is a panic, as lifecycle.md §7.2.2 already listed: the reducer's writes roll back, the episode log records it and `app.error` runs. The read `xs[i]` panics at the same indices instead of reading `undefined`, so both sides of `:=` agree; `xs.get(i)` still answers `None`. An index that meets no List at all — a missing value, or a missing element to write through — panics too, rather than building `{"0": v}` or a partial record. The `Map` and record paths are unchanged.

  A `List` index is checked against `Int` on both sides of `:=`, so `xs[k]` with `k : Text` or `k : Float` is E0201 rather than an index that names nothing at run time.

  A `Set` has membership and no places, so `tags[x] := v` is now E0602, the code a member write already gets, and the message points at `.add` / `.remove` / `.toggle`.

- 1ed9ec0: Follow an `app.init` argument through the `fn` calls it makes, and report the route it reaches

  `E0120` looked at how an argument was spelled, so one `fn` hop walked straight
  past it — and landed worse than the direct read it replaces. `route` is not in
  the live-value table until a mount installs it, so

  ```kumiki
  fn here() -> Text = route.path
  app A … init = [load(here())]
  ```

  lowered to `function here() { return (_live["route"])["path"]; }` reached from
  `init:`, which is evaluated while the app object is being built. The direct
  form throws at mount; this one throws while the module is still being
  **imported**, so nothing loads at all. `check` and `build` both said ok.

  The restriction is now on what an argument reaches. The call is followed
  through as many hops as it takes, and the chain is in the message — a report
  naming only the called `fn` sends the author to a definition that is not itself
  wrong. A `fn` that reads the route stays legal everywhere else: a tile, a
  reducer and an effect's `map-request` all run after the mount that installs it.

  Whether a `route` in a `fn` body is the runtime's is decided by the same gate
  that answers it for a direct read, asked of that body in an `app.init`
  position — so a name a `let` or a parameter shadows is that binding, on both
  paths alike, and `fn safe() -> Text = let route = "x" in route` keeps
  compiling. The search is breadth-first and iterative: a `fn` graph is a
  program's to declare, so a chain may be longer than the call stack and a cycle
  may exist, and this pass terminates whether or not the cycle report is there.

- 4e52e29: `app.http`'s `headers` is now checked as a `Map(Text, Text)`, the type of a
  request's own `headers`, like `base-url`, `timeout` and `credentials` already
  were (#511).

  ```
  http = { headers: 42 }              # was ok; now E0201 Expected Map(Text, Text) but got Int
  http = { headers: "x" }             # was ok; now E0201
  http = { headers: {"X-A": 1} }      # was ok; now E0201 Expected Text but got Int, at the value
  ```

  The runtime spreads the value into every request's headers: a number spreads to
  nothing and a string to headers named `0`, `1`, … — either way not one intended
  header reached the request, and each of these compiled, built and smoked.
  `headers: {"Authorization": fmt(…)}` and a `Map(Text, Text)` slot are
  unaffected. http.md §6.3.1 (en + ja) states the type.

  A program that used to compile and run no longer compiles if it writes the
  header names bare: `headers: {Content-Type: "application/json"}` is a record,
  not a map, and is now E0201 at the field. Quote the names —
  `{"Content-Type": "application/json"}` — to make it a map.

- 178199f: `app.http`'s `base-url`, `timeout` and `credentials` are now checked against their types (#386).

  Only the names in those fields were checked, so a value of the wrong type ran and did the wrong thing: `base-url: 42` sent the request to `42/ping`, `timeout: "soon"` reached `setTimeout` as `NaN` and aborted every request before it could answer, and `credentials: "bogus"` is a `fetch` init a browser refuses. Each is now **E0201** at the field, so a program that used to compile with one of these values no longer does.

  - `base-url` takes anything assignable to `Text` (a type built on `Text`, such as `Url`, included).
  - `timeout` takes anything assignable to `Int`, read as milliseconds: an `Int`, a `Duration`, a user `nominal Int`. The spec table said _duration_ while every example wrote a bare `Int`; both are milliseconds at run time, so both are accepted and `http.md` §6.3.1 now says so. A `Float` is refused.
  - `credentials` takes anything assignable to `Text`, and each literal that reaches the field, including a literal branch of an `if`, must be `omit`, `same-origin` or `include`.

  A value computed at run time (a slot, a call) of the right type stays clean: the fields are evaluated per request, and reading a slot is the point.

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

- fbd7685: Let a `ui.key` / `ui.focus` / `ui.blur` selector reach an `editable`

  `reducer entered on=ui.focus(Ed)` with `tile Ed = editable(…)` compiled to
  nothing, and the same for `ui.key` and `ui.blur`: the lift table's three rows
  listed `input` / `textarea` / `button` (/ `select`), so codegen emitted no
  handler and the reducer never ran. The checker reported it as W0212, with a
  reason that was not true — that the tile has no descendant firing the event.

  It does. A `<div contenteditable="true">` is an editing host, so it is
  focusable without a `tabindex` and `focus`, `blur` and `keydown` all reach it
  — which is why writing the handler on the tile (`editable(onFocus=entered)`)
  already worked. What those rows list is where a _selector_ lands, so an
  omission there is a gap in the table rather than a fact about the DOM, the
  same shape as #287's `ui.input`.

  This change moves `editable` only. The same three rows also left out
  `slider` and `link`, and `select` under `key`, and `check` / `radio` /
  `switch` under `key` (their `<label>` sees a bubbled `keydown`, though not
  `focus` / `blur`). Those kinds are closed in this release as well, in a
  separate entry (#456).

  **A subscription that did nothing now runs.** An app carrying a
  `ui.key` / `ui.focus` / `ui.blur` reducer aimed at an `editable` got the W0212
  warning and no behaviour; after this it gets the behaviour and no warning.

  `change` is still deliberately not extended, and `errors.md` now says why in
  both language tracks, alongside the code comment that already did: a
  `contenteditable` element fires no `change` event at all, so `ui.change` on an
  `editable` is W0212 for a reason that is true.

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

- 88effc6: `ui.key` / `ui.focus` / `ui.blur` selectors now reach `slider` and `link`, and `ui.key` now reaches `select` and `check` / `radio` / `switch` (#456). `ui.focus` / `ui.blur` already reached `select`.

  These are the same gap #367 closed for `editable`. The runtime attaches the three listeners to the element each tile renders, and these kinds receive the events there. Before this change the lift table left them out: codegen dropped the handler, and W0212 reported the tile as having "no descendant that fires" the event. That was untrue for an `<input type="range">`, an `<a href>` and a `<select>`.

  The three rows are now built from two named lists in `ui-lifts.ts`, so they cannot drift apart:

  - **Focusable roots** (`input`, `textarea`, `button`, `select`, `slider`, `editable`, `link`) are in `key`, `focus` and `blur`.
  - **Label-wrapped controls** (`check`, `radio`, `switch`) are in `key` only. Their listener sits on a `<label>`. A `keydown` from the inner `<input>` bubbles up to it, but `focus` and `blur` do not bubble, so W0212 is still correct to emit for those two events. Its message says no descendant fires them, which overstates it; the wording is tracked separately (#526).

  On a link, `ui.key` runs before the browser acts on the key. On Enter, the link is then activated and the router navigates as usual, so the reducer cannot cancel the navigation. `click` on a link stays reserved for navigation.

  **A subscription that did nothing now runs.** The rows only grow. A `ui.key` reducer aimed at a container (`ui.key(Form)` over `tile Form = column(…)`) used to wire only to an `input` / `textarea` / `button` descendant. It now also wires to a `link` / `slider` / `select` / `check` / `radio` / `switch` descendant. The same holds for `ui.focus` / `ui.blur` with `link` / `slider`. A reducer aimed directly at one of those kinds used to get W0212 and no behaviour; it now gets the behaviour and no warning. Check such reducers for keys or focus changes they did not expect.

  `video` (with `controls`) and `details` are not in these rows yet (#525).

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

- b2ee6a6: Inside a `fn`, `$1`, `$2`, ... are its arguments in order (language.md §1.6.5). `fn plus(a: Int, b: Int) -> Int = $1 + $2` returns `a + b`.

  The checker accepted `$1` and `$2` in every fn body, untyped and whatever the arity, and codegen never bound them, so the first call threw `ReferenceError: _d_1 is not defined` and rolled back the reducer. Each positional now stands for the parameter at its position, with that parameter's type: `fn first(x: Int) -> Text = $1` is **E0201**, and a positional past the arity (`$1` in `fn noargs()`, `$2` in a one-parameter fn) is **E0103**. There is one per parameter, so a three-parameter fn can read `$3`. A fragment inside the body (`$1.map($1 * 2)`) keeps its own `$1` / `$2`.

- d0b334d: Resolve what `.get-or` answers, and check its fallback against the same type

  Nothing said what `.get-or` returns, so the unwrapped value was assignable back
  to the container it came out of: `opt := opt.get-or(x)` on a slot declared
  `Option(T)` passed `check` and left the slot holding a bare `T`.

  Every reader then disagreed with the slot, and none of them said so. A bare
  record carries no `_tag`, and every reader tests for one — `is-some` and
  `is-none` are both false, so a `when(is-some, …)` / `when(is-none, …)` pair
  renders neither arm, and a `match` whose arms are all variant patterns falls
  through to nothing. A blog example shipped that way: its nav dropped both the
  session row and the "Log in" link for a reader whose session had been restored.

  `.get-or` now answers from its receiver's type argument, the way `.get` already
  did: `Option(T)` and `Result(T, E)` answer `T`, and `Map(K, V).get-or(k, d)`
  answers `V`. The fallback is checked against that same type, which is the
  report that names the mistake rather than its consequence —
  `opt.get-or(None)` is reported at the argument as well as at the assignment.

  Which of the two readings a call takes is decided by its argument count, so a
  count that does not fit its receiver still resolves to nothing here. No verdict
  changed across the example and benchmark corpora.

  **What this does not reach.** The blog's own line was
  `session := $s.get-or(None)` in a reducer on an effect's ok event, and that
  still passes `check`: an effect payload bind carries no type at all, so the
  receiver decides nothing — an assignment straight out of one is accepted
  whatever the slot declares. What this catches is the shape whose receiver has a
  declared type: a slot, a `fn` parameter, or a `let` of either.

- aa8ce0b: `o.get()` and `r.get()` — the unwrap on an `Option` / `Result`, written with its optional parentheses — now build, and lower to the same unwrap as the paren-free `o.get` (stdlib.md §2.2.4 / §2.2.5).

  The checker accepted them, since `.get`'s argument count is decided by its receiver, but the lowering only knew the keyed reading (`Map.get(k)` / `List.get(i)`) and read an argument the call did not have: `check` said ok, then `build` and `smoke` died with `TypeError: Cannot read properties of undefined (reading 'kind')`, naming no file or line. A `.get()` on a receiver the checker cannot decide lowers to the unwrap too, and on `None` / `Err` it panics exactly as `.get` does.

  A `bind=` target is a path, whose steps are written without parentheses, so a call in one — `bind=d.get().title`, `bind=name.upper()` — is now **E0602 `unassignable-member`** at the call. It used to pass `check` and `build` and drop the whole bind: the control rendered empty and wrote nowhere. The unwrap step in a bind is `.get` (`bind=d.get.title`), as it is on the left of `:=`, where `d.get().title := …` is already a parse error.

- dbf5258: Read `app.http`'s base-url, timeout and credentials when a request is made

  `headers` was lowered into a thunk, so a slot reference in it worked and was
  re-read per request. The other three were lowered as values into
  `const _http = { … }`, which the module emits before `_live` — so
  `http = {base-url: endpoint}` on a slot came out as `baseUrl: _live["endpoint"]`
  reading a binding still in its temporal dead zone. `check` and `build` passed
  and the app threw `ReferenceError: Cannot access '_live' before initialization`
  at **import**: nothing mounted, and no diagnostic named the field.

  All three are now getters, so each is read when the runtime consults it — which
  is per request, matching `headers`. A reducer that writes the slot changes what
  the next request is made with, with no remount: `base-url: endpoint` switches
  host the moment `endpoint` is assigned. A literal is emitted the same way, so
  the shape of the config never depends on what the author wrote.

  Deferring moves where an unresolved name lands, so `check` now walks these
  four expressions — nothing did before, and a misspelt slot in one of them used
  to be a `ReferenceError` at import. It would have become a throw inside the
  first request instead, which the dispatcher turns into an `err` result and an
  `.err` reducer absorbs completely. It is E0103 at the field now, before a
  build. The values are still untyped: a name resolves or it does not, and
  nothing compares what a field is given against what it needs.

  `docs/spec/http.md` (both tracks) now states the evaluation time of every
  `app.http` field, since "once at construction" and "per request" are
  observably different and nothing said which applied. `credentials` was missing
  from that table entirely and is in it now.

  The other expression positions lowered outside a closure were audited rather
  than assumed: an `app.init` argument lands in the app object literal, which is
  built after the slot table, and a slot initialiser that reads another slot is
  already rejected (E0304). Everything else — route tiles, effect bodies, policy
  keys, reducer bodies — is inside a closure and was never eager.

- c1df514: `T.parse(text)` now reads its text by the base `T` is declared over, holds the value to `T`'s refinement, and `Duration.parse` / `Bytes.parse` have the `Option` type the spec gives them.

  The lowering branched on the qualifier's _name_: `Int`, `Float` and `Time` converted, and every other qualifier wrapped the raw text in `Some`. A `nominal` is named for itself, not for its base, so with `type Cents = nominal Int`, `total + Cents.parse("12").get-or(0)` concatenated — `check` said `ok`, and the slot held a string. `Duration`, the standard library's `nominal Int` of milliseconds, did the same, and `Bool.parse("false")` answered `Some("false")`, a non-empty string that every `if` reads as true.

  What `parse` produces is now decided by the base the qualifier unaliases to (`stdlib.md` §2.4.3):

  - `Int` — an optional sign and decimal digits, `None` for anything else. `Number()` used to read the text, so `"0x10"` was `Some(16)`, `"1e3"` `Some(1000)`, `" 12 "` `Some(12)` and `"1.5"` `Some(1)`; each is `None` now. `Duration.parse("1.5")` is `None` for the same reason.
  - `Float` — an optional sign, decimal digits, an optional fraction and an optional exponent, spelling a finite number; `None` for hex, `.5`, `1.`, `Infinity` and surrounding blanks.
  - `Time` — the instant as a millisecond number, as before
  - `Bool` — `true` for `"true"`, `false` for `"false"`, `None` otherwise
  - `Text` — the text, `None` when it is empty, as before
  - `Bytes` — the UTF-8 bytes of the text, `None` when it is empty

  The value read is then checked against every `where` refinement `T` carries, and one it fails is `None`: with `type Cents = nominal Int where positive`, `Cents.parse("-5")` is `None`, not `Some(-5)`. An `Option(Cents)` never passes through a slot-write guard, so `parse` could hand the program a `Cents` its own type refuses.

  The argument of `T.parse` is checked to be a `Text` (E0201); `Int.parse(true)` used to be `Some(1)`.

  A type whose base has no reading — a record, a union, `File`, `EffectId`, `Unit`, or a `nominal` over one of them — is now reported by `check` as [E0802](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0802-unimplemented-function), with the message `"<T>" has no reading of a text — parse into Int, Float, Time, Bool, Text or Bytes and build it in a fn`. It used to lower to the raw string under an `Option(T)` type. A type constructor written without its arguments (`List.parse(t)`, `Box.parse(t)`) is not a type at all and is reported as E0124 instead. A qualifier whose own definition resolves to nothing (an alias of an undefined name, a cycle) gets only the report at that definition.

  `Duration.parse(t)` and `Bytes.parse(t)` were typed as a bare `Duration` / `Bytes`, because the qualifier's constructor namespace caught them first. So the documented `o : Option(Duration) := Duration.parse(t)` was E0201 and `d : Duration := Duration.parse(t)` was clean. They are `Option(Duration)` / `Option(Bytes)` now, like every other qualifier.

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

- 0a7ae12: `()` has the type `Unit`, so it is refused where another type is declared (#427).

  The unit literal had no type in the checker, and a value with no type is accepted everywhere. So `Card(())` against `tile Card in={label: Text}` passed `check` while `Card(42)` was E0201, and the tile mounted with a `null` it then read `.label` from. A `tile-test`'s `given = {…, in: ()}` got the same pass and died in `kumiki test` with a bare `TypeError`.

  `()` is now a `Unit`. It is E0201 at the `()` in a tile call, a `fn` call, a slot's value or an assignment, and E0202 in an `emit` argument. It is still accepted wherever `Unit` is declared: a `Unit` slot, the ok side of a `Result(Unit, E)`, a `Unit` parameter. `emit e(())` on an `in=Unit` effect is unchanged: that effect takes no argument, which is already E0213.

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

- 739cd7a: A type-member call qualified by a type constructor is now reported, as the new [E0124 `type-constructor-qualifier`](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0124-type-constructor-qualifier) (#432).

  `List`, `Map`, `Tuple` and a `type Box(T) = …` name types but are not types on their own: they still want their type arguments. So `Box.fresh()`, `List.fresh()` and `Option.show(v)` have no type to work with. For `fresh` and `show`, each existing check declined them on its own terms. E0117 did not fire because the name _is_ a type's, E0116 did not fire because the callee resolves, and E0201 had nothing to compare. `slot n : Int = Box.fresh()` stored a uuid string in an `Int` slot with nothing reported. `parse` was already reported, as E0802 "has no reading of a text". That message is wrong for `type Tagged(T) = nominal Text`, whose `type OrderId = Tagged(Int)` parses fine.

  The call is now E0124 for `fresh`, `parse` and `show` alike, and `Tuple` is covered: variadic is still not zero. On `parse` it replaces the E0802, which now covers only a complete type with no reading. The repair is to name the application as a type, as in `type IntBox = Box(Int)` then `IntBox.fresh()`. On `parse` the message also says that the applied type needs a base with a reading of a text (Int, Float, Time, Bool, Text or Bytes), so `List.parse` is not sent to `type IntList = List(Int)` only to meet E0802 on the next round. A qualifier that is already a complete type answers exactly as before.

  **CLI**: `kumiki fix` records the skip reason `e0124-type-arguments-unknown` for it. Which arguments to apply is the author's choice, so it proposes no patch.

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

- 72ff1df: A builtin's content is its first positional argument, so a named argument written before it stays a prop instead of replacing it (#393).

  `heading(level=2, title)` rendered `2` and dropped `title`; `text(test-id="x", n.show)` rendered `x`. Lowering read `args[0]` for the content of `text`, `heading` and `markdown` whatever that argument's name was, while `code` and `editable` already took the first positional one. All five now read it through one helper, the same one the user-tile call takes its input through (#330), so the checker's count of positional arguments and what codegen renders are one rule. A call with no positional argument still renders `""`.

- 68b27a1: A generic applied inside itself now has a type the checker compares against.

  ```
  type NonEmpty(T) = T where nonempty
  type Short       = Text where len-lt(7)
  slot a : NonEmpty(NonEmpty(Short)) = "ku"

  reducer setA on=ui.click(BtnA) do= a := 5   # was ok; now E0201
  ```

  Normalisation substituted the argument into the generic's body and walked the
  result under the body's re-entry guard, so the inner `NonEmpty` met its own name
  and the type normalised to nothing. With nothing to compare against, every write
  into the slot was accepted and the runtime held an `Int` in a `Text` slot. The
  same happened when a generic was reached again through another generic's
  argument: `NonEmpty(Named(Short))` with `type Named(T) = nominal NonEmpty(T)`
  lost its nominal, so a different nominal over `Text` went in silently.

  An argument is now read under the guard in force where it was written, which is
  what codegen's `refinementsOf` already does. A generic that reaches itself
  through its own body (`type Loop(T) = Loop(T)`, `type A = NonEmpty(A)`) still
  stops where it stopped, and is still E0009's to report.

  The same normal form is what the rest of the checker reads, so the fix reaches
  further than a slot's own writes: the elements of a `List(NonEmpty(NonEmpty(Short)))`,
  a fn's argument and return value typed that way, and a `match` on a scrutinee
  typed `Alias(Alias(LR(Int)))` — where the payload a pattern binds now has its
  type, and a variant the union does not have is E0209.

  A generic nominal applied inside itself keeps its whole chain. With
  `type Tag(T) = nominal T`, a `Tag(Tag(Cents))` is accepted where a `Cents` is
  required and compares with one (`c := n`, `n == c`), exactly as a `Tag(Cents)`
  is, and is still refused where a different nominal is.

  A generic that hands its parameter back is taken in one step rather than by
  expanding its body, so a chain of definitions that each apply the one below
  twice (`type D1(T) = D0(D0(T))`, …) is checked in linear time instead of
  walking the bottom definition 2^k times. The same classification now sees
  through such a generic when it looks for an alias that is its own argument:
  `type A = D1(A)` is E0009, as `type A = D0(A)` already was.

- bf86b16: A key on a call to a user tile whose body is a `for` keys each node the list renders, instead of rendering nothing (`runtime.md` §10.3.10).

  ```kumiki
  slot xs : List(Text) = ["a", "b"]
  tile Items = for x in xs text(x)
  tile App = column(Items {key: "k"}, text("end"))
  ```

  passed `check` and failed `smoke` with `no renderer registered for tile kind "undefined"`: the key was spread into the list itself, an object of its indices with no `kind`. The implicit key a surrounding `for` stamps on a call (`for id in ids Items(id)`) reached the same path, and that form also left each iteration's list nested inside the child list, which drew the same nothing.

  Each node now takes the pair of the call site's key and its own key — the one its own `for` gave it, however deeply nested, or its position when it has none — encoded as `[callKey, nodeKey]`, so the nodes stay distinct in the keyed reconciler and a reorder moves their elements rather than rebuilding them. A container's children are flattened however deeply the `for`s that produced them nest.

  A `for` nested in a `for` — directly, or in an arm of a branch there — keys each node by the pair of the outer and inner loop variables, so siblings from different outer iterations that share an inner value no longer collide and crash the reconcile with `duplicate TileNode.key` on the first reorder.

- 9a2965f: A name pattern in a `match`, and each name inside a tuple pattern, now binds the
  type as written, `nominal` included.

  ```
  type PostId = nominal Text where uuid
  type UserId = nominal Text where uuid
  slot p  : PostId                = "a"
  slot u  : UserId                = "b"
  slot tt : Tuple(UserId, PostId) = ("b", "a")

  p := match u with | x -> x              # was ok; now E0201 Expected PostId but got UserId
  p := match tt with | (a, b) -> a        # was ok; now E0201
  match u with | x -> p := x              # was ok; now E0201
  ```

  The binder's nominal reaches every reader of it, not only a declared
  destination: `let v = match u with | x -> x; p := v` now reports the same
  `E0201`, and an `==` between the binder and another nominal now reports
  `E0201 Operator "==" cannot compare UserId with PostId`, as `u == p` does.

  Only a variant pattern's payload kept its nominal before: a bare name bound the
  scrutinee's base type (`Text`), which goes into any nominal over `Text`, so the
  `UserId`-into-`PostId` mistake that `nominal` exists to catch passed `check`.
  language.md §1.9 already says each arm is read with the types its pattern binds;
  the checker now does. Binds that fit (`u := match u with | x -> x`,
  `x.length` on the binder) are unaffected.

- 4f7e35b: A slot read inside a reducer body sees what the body has already written, in every nested position (`language.md` §1.6.4).

  ```kumiki
  reducer go on=ui.click(B) do= noteKey := "b"
                                out1 := match 1 with | n -> noteKey
                                out2 := let k = "x" in noteKey
                                hits := names.filter($1 == noteKey).length
  ```

  Before this fix, each of those reads saw `noteKey` as it was before the click: in a `match` binding, variant or tuple arm, in a `let … in` body, and in a method's predicate or element lambda. Each of those lowerings rebuilt its scope without the reducer's view of the slots, so the read lowered to `_live[...]`; a wildcard arm and a top-level read already saw the write.

  Every nested scope is now opened through one helper that carries the view down. A tile's nested forms have no reducer view to carry and still read the live slots.

  A read after a write whose value is JS `undefined` (a `match` with no arm for its scrutinee) also sees that write, the value the batch commits, instead of the value from before the reducer ran: a read checks whether the body wrote the slot, not whether the written value is `undefined`.

- 1e90ba3: Report a refinement predicate written over a base type it cannot test

  ```kumiki
  slot name : Text where positive = "ada"
  ```

  passed `check` and `build`, and at runtime refused every value — `positive`
  tests a number, and a text answers it with `false` — so every write to the slot
  discarded its reducer's batch. It is now **E0804**:

  > `Refinement "positive" tests a number but is written over Text, so no value satisfies it`

  The text family (`nonempty`, `len-*`, `email`, `url`, `uuid`, `regex`) needs
  `Text`; `between`, `positive` and `negative` need `Int`, `Float` or `Time`.
  `one-of` compares strictly, so each of its literals has to be a value of the
  base: `Text where one-of(1, 2)` and `Bool where one-of("x")` are E0804 too.
  The base is read through aliases, `nominal` wrappers and earlier `where`s. A
  generic's own type parameter says nothing on its own, so
  `type NonEmpty(T) = T where nonempty` is not reported; its application is,
  with the arguments substituted into the body — `NonEmpty(Int)`, directly or
  behind `type N = NonEmpty(Int)`, reports at the application. `len-lt(0)` — a
  legal count that no text is shorter than — is E0804 as well.

- b53ae7f: Infer `Text` for `T.show(v)` on every qualifier, `Duration` and `Bytes` included

  `T.show(v)` is the qualified spelling of `v.show`. Codegen lowers it with one
  regex and one helper — `_s.show(v)`, the qualifier discarded — so it is a `Text`
  for every capitalised `T`. The checker did not agree for two of them:

  ```
  slot ms    : Int  = 1500
  slot shown : Text = ""
  reducer go on=ui.click(B) do= shown := Duration.show(ms)

  E0201 type-mismatch at 3:40: Expected Text but got Duration
  ```

  `Int.show`, `Time.show`, `Url.show` and a user type's `.show` were all accepted
  into that slot. `Duration.show` and `Bytes.show` were not, which is the
  expensive direction of a wrong diagnostic: the program runs, and the author has
  nothing to write instead — `ms.show` is the method, a different expression, not
  a repair for this one.

  `inferType`'s `Call` case answered `Duration.*` with `Duration` and `Bytes.*`
  with `Bytes` before it looked at the member at all, so the two qualifiers that
  also name constructors returned the constructor's type for a call that
  constructs nothing. It now reads the member first, the way the lowering does.

  `fresh` and `parse` are unchanged and stay answered by the qualifier. For
  `fresh` that is correct — its result is the qualifier's own type. For `parse` it
  is not: the spec gives it `Option(T)` of the qualifier, and the branch returns a
  bare `T`, so an `Option(Duration)` slot refuses `Duration.parse(t)` while a
  `Duration` slot accepts it. That is a separate defect, filed as #424 and
  untouched here.

  The spec said `TypeName.show(value) : Text` throughout (stdlib §2.4.3), so this
  is the implementation moving to it, not a language change.

  One shape does stop checking, and it is this same reordering seen from the other
  side. A `Duration` or `Bytes` slot used to accept a `show` call, because the
  call was read as a constructor:

  ```
  slot n : Int = 1
  slot d : Duration = Duration.ms(0)
  reducer r on=ui.click(B) do= d := Duration.show(n)
  ```

  That was `ok` and is now `E0201 type-mismatch: Expected Duration but got Text`.
  The value is a string at runtime, so the slot never held what it was declared to
  hold — the program was already wrong and is now told so. Repair it by dropping
  the `show`, or by declaring the slot `Text` if the string was what was wanted.

- 9237208: Gate a slot on the refinement its generic alias carries

  A generic that hands its parameter back with a `where` on it was read as
  carrying no refinement at all:

  ```kumiki
  type NonEmpty(T) = T where nonempty
  slot name : NonEmpty(Text) = "ada"
  ```

  The slot was emitted with no `refine`, so `name := ""` landed, and `check` and
  `build` were both silent. The checker already read `NonEmpty(Text)` as
  `Text where nonempty` — a generic applied to its arguments is an edge of the
  chain a type denotes (spec/language.md §1.3.6, inv. 2) — and codegen now reads
  it the same way. The argument's own predicates come first: `NonEmpty(Short)`
  over `type Short = Text where len-lt(7)` names `len-lt(7)` for a value too long
  and `nonempty` for an empty one. An argument is read where it is written, so a
  generic applied inside itself keeps every predicate too:
  `NonEmpty(NonEmpty(Short))` is gated on `len-lt(7)`, `nonempty`, `nonempty`.

- 8f2d978: A test's `slots` section that is not a record is now **E0713**, like the clause
  around it.

  ```
  test t =
      reducer-test inc
          given  = {slots: 41, event: {type: ui.click, target: B}}   # was ok; now E0713 at `41`
          expect = {slots: 41}                                         # was ok; now E0713 at `41`
  ```

  The test seeded no slot and asserted no slot, and `kumiki test` passed it. The
  rule now covers a `given`'s `slots` (every kind that has one), a
  `reducer-test` `expect`'s `slots`, and an `episode-test`'s `slots-equal`, which
  also accepts `from-log`:

  ```
  `given.slots` must be a record, `{<slot>: …}`
  `expect.slots` must be a record, `{<slot>: …}`
  `expect.slots-equal` must be a record, `{<slot>: …}`, or `from-log`
  ```

  `{}` is still the empty record. The lowering throws the same sentence instead of
  evaluating the value, for a caller that skips `check`.

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

- e2b8d2d: Let a reducer's top-level `let` shadow the name it takes

  A `let` at the top level of a reducer body lowered to a `const` in the same JS
  block as the trigger's binds and the positional-binding declarations, so a
  `let` that took a name already declared there emitted a second declaration of
  it:

  ```kumiki
  reducer boot on=app.start do= let $route = "x"
                                seen := $route
  ```

  `check` and `build` were both clean, and the module then threw
  `SyntaxError: Identifier '_d_route' has already been declared` at load — so
  nothing rendered at all. A `let` over one of the trigger's own binds
  (`on=ping.ok(p, _)` / `let p = …`) and a `let` repeating an earlier `let`'s
  name failed the same way.

  The language's answer to a name written twice is that the inner binding
  shadows the outer one, which is what `errors.md` already promised for E0119
  ("a name an enclosing `let` or pattern binds is that binding, not the
  payload") and what the nested forms — `for`, match arms — already did. Codegen
  now gives a declaration over a name already in scope an identifier of its own,
  and every read resolves through the scope that declared it, so the shadow
  holds in the one place the language's nesting does not reach. The rule is
  written down as [Language §1.6.7](https://kumiki.dev/spec/language#_1-6-7-scoping-and-shadowing).

  A declaration's right-hand side is generated before the name enters scope, so
  `let n = n + 1` reads the binding it shadows. That also fixes the expression
  form, where `let $m = $m + "!" in $m` used to throw
  `ReferenceError: Cannot access '_d_m' before initialization`: the shadow was
  declared inside the same closure that evaluated its own value.

  Shadowing stops at binds written side by side, which is the new **E0122**
  `duplicate-pattern-bind`: a pattern binding one name twice (`Both(a, a)`,
  `(dup, dup)`) is reported at the pattern. Nothing nests those two binds, so
  there is no scope between them for the second to shadow the first, and one of
  the two values the pattern names is left with no name to read it by. It used
  to be a module that threw `SyntaxError` at load with `check` clean; a shadowing
  rule that reached it would have made the arm read the _later_ value in silence
  instead. `_` is exempt however many times it is written, two arms binding one
  name are unaffected, and a bind that shadows a name from outside the pattern is
  the rule working as intended.

- e0ce4ed: Take a user tile's input from the positional argument the checker counts

  `checkTileInput` counts the positional arguments; codegen took `args[0]`,
  whatever its name. So a named argument written first was consumed as the
  tile's `$1`:

  ```kumiki
  tile Btn = button(text="go")
  tile App = column(Btn(onClick=bump), text(n.show))
  ```

  `check` reported ok — a call with no positional argument to a tile that wants
  none is correct — while codegen bound `$1` to the handler and emitted a bare
  `bump` that nothing declares. The mount died in render with
  `bump is not defined`. A tile that _does_ declare `in=` failed the same way and
  lost its input as well: `Row(onClick=tap, label)` passed the handler as `$1`
  and dropped `label`.

  The two halves read the same set now. What a named argument means is
  unchanged, and it is not an input: it is a prop, merged onto the node the tile
  renders, so `Btn(onClick=tap)` and `Btn() {onClick: tap}` are one wiring.
  Whether it fires is a question about what the tile renders, and W0213 asks it
  at a user-tile call site too — a handler on one that renders nothing able to
  fire it is reported rather than dropped in silence.

  A tile written as a _named_ argument is reported (E0201) rather than dropped:
  a builtin container skips named arguments, the builtins that read one by name
  all want a value, and a user tile takes its input from the positional one — so
  after this change nothing rendered it at all.

- 67a6ea1: An effect's `.ok` payload bind now has the type the effect's `out=` declares, so reads of it are checked (#385).

  `load.ok($s, _)` binds the effect's result, and the effect says what a success is in `out=`. Nothing carried the type to the bind: the name entered the reducer's scope with no type, so every read of it was undecidable and every assignment out of it was accepted. `label := $s` put an `Option(Session)` into a `Text` slot, and `session := $s.get-or(None)` — the shape the `.get-or` defect (#294) actually shipped in — passed although the same call on a slot receiver is a pair of E0201s.

  `$1` on `.ok` now has the Ok payload of `out=Result(T, E)`, or the whole value of any other `out=`. `$1` on `.err` stays unchecked: the built-in handlers deliver a `{message: …}` record there whatever `E` declares, so `$e.message` keeps passing. The request key, a built-in effect's result and a `Result` of the wrong arity (already E0210) stay unchecked too.

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

- 5945a3e: A kebab-case prop reaches a reducer's `$el` under the name the tile declared it with: `{item-name: $1}` (or `button(item-name=$1)`) is read back by `$el.item-name` (language.md §1.6.5).

  The `$el` payload keyed each prop the way names the runtime defines are keyed, with `-` rewritten to `_`, while `$el.item-name` read the source spelling. The reducer read `undefined`, and the slot it wrote dropped out of the state. The payload's keys and every field read now come from one encoding, the source spelling, the one records already used.

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

- 0f93dda: A `.get-or` call whose argument count does not fit its receiver is now an arity error instead of a silent lowering to the other reading (#382).

  `.get-or` is one name with two readings, told apart by the argument count: `Option(T).get-or(d)` and `Result(T, E).get-or(d)` against `Map(K, V).get-or(k, d)` (`stdlib.md` §2.2.1 / §2.2.4). The count selects the lowering, so a count that did not fit its receiver passed `check` and reached the _other_ helper on the receiver it was given.

  `m.get-or("k")` lowered to `_s.getOr(m, "k")`, whose last line hands the value back unchanged when it carries no `_tag` — so a slot declared `Int` received the whole map. The mirror shape is worse: `opt.get-or("k", 0)` lowered to `_s.mapGetOr(opt, "k", 0)`, which indexes the `Option` object by a key it does not have and answers the fallback on a `Some` as well. That is a wrong value of the right type, so nothing downstream trips over it.

  Neither existing check could see it. `METHOD_MIN_ARGS` states a minimum, which one argument meets, and no maximum. `getOrResultType` takes the receiver and the count together and resolves to nothing when they disagree — the right answer for an inference table, since a wrong result type rejects working programs, but it leaves inference silent by construction. The report belongs in the arity check, where the receiver is what decides the count, and it is **E0213 `call-arity-mismatch`**: the message names the receiver, the count that fits it, and the reading the written count would have selected, because both counts are legal for the name.

  A receiver whose type the checker cannot decide reports nothing about _which_ reading was meant: the count selects one but decides nothing about whether it is the right one. A count past **both** readings is reported on any receiver — no reading takes more than two arguments, and the lowering reads exactly two, so a third was being dropped silently even where the receiver was unknown.

  Refs #382.

- a489ee1: A `let` declared in an `if` branch ends with that branch, in `check` as in the built code (#398).

  Each branch of an `if` is a scope of its own (`language.md` §1.6.7), and the emitted reducer has always treated it as one. `check` did not, so a program that read a branch's `let` after the `if` — or in the other branch — was reported `ok`, built, mounted, and then threw `n is not defined` the first time the reducer ran.

  That read is now **E0103** at the read. A `let` declared before the `if` is still readable in both branches and after it, a branch can still shadow it for itself, and which slots count as written after the `if` (E0601) is unchanged.

  The type a branch gives a name now ends with the branch too. Before, a branch that shadowed an outer `let` left its type behind for the statements after the `if`, while the value they read was still the outer one:

  - a valid program was rejected: with `let n = 5` before the `if` and `let n = "s"` in a branch, `total := n` into an `Int` slot after the `if` reported **E0201** `Expected Int but got Text`; it is now `ok`;
  - a wrong one was accepted: the same program writing `note := n` into a `Text` slot reported `ok`, so an `Int` went into a `Text` slot; it is now **E0201** `Expected Text but got Int`.

  A `let $route = …` in a branch now ends with the branch as well: reading `$route` after the `if` is **E0119**, where it used to be reported `ok`.

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

- 43ccd6e: A test's `given`, `expect` or `mocks` that is not a record is now reported as **E0713**, instead of being read as empty and letting the test pass (#420).

  Every reader of these clauses asks them for their fields. A name or a literal has none, so the whole clause silently did nothing:

  - `given = setup` set no slots, so the reducer ran from the declared defaults.
  - `expect = 41` asserted nothing.
  - An `episode-test`'s `mocks = 41` scripted nothing. It also skipped the undefined-effect and mock-policy checks, which only looked inside a record.

  `check` passed all of these, and each test passed against a state or outcome nobody chose.

  The same rule covers the `mocks` and `event` sections of a `given`, which the lowering reads the same way. `{}` is still accepted as the empty record. A `tile-test`'s `expect` (a tile expression) and a `property-test`'s `invariant` are unaffected.

  E0713 is reported once, at the clause, and no name inside it is resolved as a section, so a `tile-test` does not also report its argument as missing. A wildcard there is still E0109, and an undefined `<slots.X>` in a `reducer-test`'s `expect` is still E0103. The lowering now throws the same message instead of answering `{}`, so a caller that skips `check` gets a named failure.

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

- da4069f: A user tile's body no longer sees its caller's `for` / `match` bindings. A slot the body reads stays the slot wherever the tile is called from (language.md §1.7.2 Invariant 1).

  The call is inlined, and the body was lowered with the caller's local bindings copied in, so a slot read that shared its name with a binding around the call site read that binding instead. In `row(for filter in filters FilterBtn(filter))`, where `FilterBtn` marks `$1 == filter` against the `filter` slot, every button was marked current. The body is now lowered in a scope of its own. The caller's bindings still reach the call's argument and props, so `FilterBtn(filter)` passes the loop variable as `$1`.

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
