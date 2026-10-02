# Standard Library

Kumiki's standard library is designed with the goal of being "**minimal and complete**". It does not provide multiple functions for the same purpose (so as not to make the AI's choice ambiguous).

## 2.1 Built-in Types

### 2.1.1 Primitives

| Type | Representation | Literal example |
|---|---|---|
| `Text` | UTF-8 string | `"hello"` |
| `Int` | 64-bit integer | `42`, `-7` |
| `Float` | 64-bit floating point | `3.14`, `-0.5` |
| `Bool` | boolean | `true`, `false` |
| `Unit` | single value | `()` |
| `Bytes` | byte sequence | no literal; `Bytes.from-text(text)` / `Bytes.from-base64(text)` / `Bytes.from-bytes(list)` (see [§2.2.10](#_2-2-10-bytes)) |
| `Time` | UNIX nanoseconds | no literal; `now` or `Time.parse(text)` |
| `EffectId` | opaque handle returned by `emit` (see [§2.1.1.1](#_2-1-1-1-effectid)) | no literal; `EffectId.none` |

#### 2.1.1.1 `EffectId`

`EffectId` is an opaque handle that identifies a single dispatched effect. It is returned by `emit` when used as an expression:

```
let id = emit fetchQuote()
```

The only operations defined on `EffectId` are equality (`==`, `!=`) and storage in a slot of type `EffectId`. Arithmetic, ordering, and `text(...)` rendering are rejected at compile time ([E0204](./errors.md#e0204-effect-id-misuse)).

`EffectId.none` is the sentinel value (empty handle). It is the safe initial value for a slot of type `EffectId` — passing it to `emit cancel(...)` is a guaranteed no-op rather than a runtime error. After a slot is overwritten with a real `EffectId`, the corresponding effect can be cancelled by passing the slot to `cap=http.cancel` (see [HTTP §6.4](./http.md#_6-4-cancellation)).

### 2.1.2 Generic Types

| Type | Use |
|---|---|
| `Map(K, V)` | keys are Eq, values are arbitrary |
| `Set(T)` | T is Eq |
| `List(T)` | ordered, index-accessible |
| `Option(T)` | `None` or `Some(T)` |
| `Result(T, E)` | `Ok(T)` or `Err(E)` |
| `Tuple(T1, ..., Tn)` | fixed length |

### 2.1.3 Domain Types (provided by the standard library)

| Type | Definition |
|---|---|
| `HttpStatus` | `nominal Int where between(0, 599)` — a response's status, or `0` for a request that got no response at all (an abort, a cancellation, a timeout, a network failure: [HTTP §6.4.1](./http.md#_6-4-1-behavior)). No predicate says "`0` or `100`–`599`", so the range is the tightest one the refinement layer can state |
| `HttpError` | `{status: HttpStatus, message: Text, body: Option(Text)}` |
| `Url` | `nominal Text where url` |
| `Email` | `nominal Text where email` |
| `Uuid` | `nominal Text where uuid` |
| `Duration` | `nominal Int` (nanoseconds) |
| `Route` | `{path: Text, pattern: Text, params: Map(Text, Text), query: Map(Text, Text), hash: Option(Text)}` — see [Routing §3.2](./routing.md#_3-2-current-route-state) |
| `FormData` | `Map(Text, FormValue)` |
| `FormValue` | `TextV(Text) \| NumberV(Float) \| BoolV(Bool) \| FileV(File)` |
| `File` | `{name: Text, size: Int, type: Text, content: Bytes}` |
| `PanicInfo` | `{message: Text, location: Text, episode-id: Option(Text), cause: Option(Text), category: Text}` — the payload of `app.error`, of `route.error(<pattern>)` (which adds `pattern`), and of an `error-boundary` tile's `in=` |

---

## 2.2 Collection Methods

### 2.2.1 Map(K, V)

```
keys                        : List(K)
values                      : List(V)
entries                     : List(Tuple(K, V))  ; an array of [[k, v], ...] in the implementation
size                        : Int
is-empty                    : Bool
has(k)                      : Bool
get(k)                      : Option(V)
get-or(k, default)          : V
insert(k, v)                : Map(K, V)        ; pure. Returns a new Map
remove(k)                   : Map(K, V)
update(k, expr)             : Map(K, V)        ; within expr, $1 is the current value
merge(other)                : Map(K, V)
filter(pred)                : Map(K, V)        ; within pred, $1=key, $2=value
map(expr)                   : Map(K, V')       ; within expr, $1=key, $2=value
```

A key handed back — by `keys`, by `entries`, and as the `$1` of `filter` — has the key type `K`, not the string it is stored under: see [§2.2.2](#_2-2-2-set-t) for how that is decided.

`.entries` returns a **sequence of 2-element arrays** as `List(Tuple(K, V))`. A subsequent `map` / `sort-by` / `filter` lambda takes each pair apart as `$1=key, $2=value` ([§2.2.3](#_2-2-3-list-t)):

```kumiki fragment
fn sortedByCreatedAt(m: Map(Id, Item)) -> List(Id)
   = m.entries.sort-by($2.createdAt).map($1)
```

`get-or` is a polymorphic method that **can also be used for Option**:

```kumiki snippet
m.get-or(k, default)         # Map: default if there is no value
opt.get-or(default)          # Option: default if None, v if Some(v)
```

`.filter` **can be used on a List, a Map, or an Option**, and the runtime dispatches automatically by looking at the receiver's type (polymorphic dispatch):
- Receiver is List → evaluate `pred($1)` for each element, keep only elements that are `true`
- Receiver is Map  → evaluate `pred($1, $2)` (key, value) for each entry, keep only entries that are `true`
- Receiver is Option → for `Some(v)`, evaluate `pred` with `$1=v` (or, when `v` is a `Tuple(A, B)`, with `v` taken apart into `$1` / `$2`, [§2.2.3](#_2-2-3-list-t)): `true` keeps that `Some(v)`, `false` gives `None`; a `None` stays `None` without evaluating `pred` ([§2.2.4](#_2-2-4-option-t))

For example, when you chain like `m.keys.filter(...)`, `m.keys` returns `List(K)`, so `filter` runs with the List signature. Even if you write a mixed chain, the behavior follows the type.

### 2.2.2 Set(T)

```
size                        : Int
has(x)                      : Bool
add(x)                      : Set(T)
remove(x)                   : Set(T)
toggle(x)                   : Set(T)
union(other)                : Set(T)
intersect(other)            : Set(T)
diff(other)                 : Set(T)
to-list                     : List(T)
```

**A Set literal is a Set.** A Set is written `{}` when empty, or as a list literal wherever a `Set` is declared: `slot s : Set(Int) = [5, 5]` is the Set of one member `5`. It is the same value `{}.add(5).add(5)` builds, so `s.has(5)` is `true`, `s.size` is `1`, and `s.add(5)` still has one member. "Declared" means any position the checker reads against a type — for example a slot, a record field, a `fn` parameter or return value, a reducer write, a `let … in` body, an element of a `List(Set(T))` or a value of a `Map(K, Set(T))`, the argument of `List.contains` / `push` / `prepend` or the value of `Map.insert` / `update` on such a container, and a test's slot values, expected effect arguments and mocked results. The argument of `union` / `intersect` / `diff` is another `Set(T)` of the receiver's type, so a `List`, a `Set` of another element type or an `Option(Set(T))` there is [E0201](./errors.md#e0201-type-mismatch).

Where the checker cannot decide the receiver's type, neither rule applies: the accumulator `$1` of `fold` — `nums.fold({}, $1.union([2]))` — has no type, so the argument is neither checked nor built as a Set, and stays an array. A fragment over a `List(Set(T))` is not such a place: there `$1` is the element, typed `Set(T)` ([§2.2.3](#_2-2-3-list-t)), so `groups.map($1.union([2]).to-list)` builds the argument as a Set and reads its keys back as `T`. That is a gap in what the checker resolves, not a rule a program may rely on. A member is keyed the way `add` keys it, so a literal of records or variants holds exactly what the `add` chain of the same members holds, keyed as the paragraphs below say.

**Keys read back as their declared type.** In the implementation a Set's elements and a Map's keys are stored as JavaScript object keys, which are strings, but the members that hand keys back — `Set(T).to-list`, `Map(K, V).keys`, `Map(K, V).entries`, and the `$1` a `Map(K, V).filter` predicate is given for each entry — answer the values the type says: a number when the key type is `Int` / `Float` / `Time` (or a `nominal` / `where` over one), a boolean for `Bool`, and the string itself for `Text`. So `tags.add(7).to-list` is `[7]`, a later `contains(7)`, `sort` or arithmetic agrees with the list's type, and `m.filter($1 == 3)` on a `Map(Int, V)` keeps the entry at `3`. A record, a variant, a tuple or an `Option` key is stored as its JSON, with each record's fields in sorted order, and reads back as the value it was written from. A key written in a Map literal (`{Some(1): "o"}`) is stored the same way. A `Map`'s `filter` hands its predicate each entry as one `(key, value)` pair, so `$1` is the whole key and `$2` the value whatever shape the key has: on `{(1, 2): 10, (3, 4): 0}`, `filter($2 > 0)` keeps `(1, 2)`. A stored key that is not the JSON a structured key type reads back from — a record key persisted before keys were encoded, a decoded `Map(Color, Int)` whose keys are bare variant names — is a panic when a reader reaches it. Two exceptions to reading back exactly: a non-finite `Float` inside a structured key (`NaN`, `Infinity`, `-Infinity`) is JSON `null`, so those share one key and read back as `null`, and a `Bytes` inside one reads back as a plain object; a `Float` key on its own keeps `NaN` and the infinities apart.

**One key per value.** Every member that writes, finds or removes an entry — `add` / `remove` / `toggle` / `has`, `get` / `get-or` / `insert` / `remove` / `update`, the index read `m[k]` and the index write `m[k] := v` — stores and looks up a key the same way, so two keys are one entry exactly when they are equal by `==` ([language §1.9.4](./language.md#_1-9-4-operator-types)). `picked.add(Red).has(Blue)` is `false`; `votes[Red] := 1` and `votes.insert(Green, 1)` write two entries; `m.remove(1)` on a `Map(Int, V)` removes the entry at `1`.

What is converted is decided from the receiver's type, wherever the receiver comes from: a slot, a `let`, a record field, a `fn` parameter, the `$1` / `$2` a fragment is handed (the element of a `List` or an `Option`, the key and value of a `.entries` tuple or of `Map.filter`, the value of `Map.update`), and the state a property-test invariant reads through `run-reducer` ([Testing §8.3](./testing.md#_8-3-property-tests)). Where the checker cannot decide the receiver's type the keys stay strings — the accumulator `$1` of `fold`, a `fn` result with no `->`. That is a gap in what the checker resolves, not a rule a program may rely on: it closes as those types become decidable.

### 2.2.3 List(T)

```
length                      : Int
is-empty                    : Bool
get(i)                      : Option(T)
head                        : Option(T)
tail                        : List(T)
last                        : Option(T)
push(x)                     : List(T)
prepend(x)                  : List(T)
concat(other)               : List(T)
slice(start, end)           : List(T)
reverse                     : List(T)
sort                        : List(T)          ; T is Ord
sort-by(expr)               : List(T)          ; ascending by expr, as < orders it; stable
unique                      : List(T)
map(expr)                   : List(T')
filter(pred)                : List(T)
contains(x)                 : Bool
find(pred)                  : Option(T)
fold(init, expr)            : Acc              ; within expr, $1=acc, $2=elem
join(sep)                   : Text             ; T is Text
chunk(n)                    : List(List(T))
zip(other)                  : List(Tuple(T, U))
```

`contains(x)` and `unique` compare elements with `==`, which is by value
([language §1.9.4](./language.md#_1-9-4-operator-types)): `[Admin, Editor].contains(Admin)`
is `true` and `[Some(1), Some(1), None].unique` is `[Some(1), None]`. `unique` keeps
the first occurrence of each value, in order.

**Parenthesis-free shortcut**: argument-less methods (`is-empty` / `length` / `reverse` / `sort` / `unique` / `head` / `tail` / `last`) **can omit `()` and be written like a field**:

```kumiki fragment
slot todos : List(Todo) = []
fn count() -> Int = todos.length              # parenthesis-free OK
fn empty() -> Bool = todos.is-empty           # same as above
fn norm() -> List(Todo) = todos.reverse       # same as above
```

> **Dispatch rule.** `recv.m` is dispatched by the **inferred type** of `recv`, not by name: if `recv` is a record with a field `m`, it reads the field; if `recv` is a stdlib type with method `m`, it uses the shortcut. So a record field literally named like a method (`node.head` on `{head, …}`) is read as the field — not shadowed. When the receiver type is **known** and `m` is neither a field nor a member, it is a compile error ([errors E0108](./errors.md#e0108-undef-member)). When the receiver type can't be inferred (e.g. an untyped reducer payload), the name-based dispatch is used unchanged.

**The lambda arguments of `map` / `filter` / `find` / `sort-by`** are decided by the receiver's **type**, not by the value at run time:
- An element that is a `Tuple(A, B)` — the `[k, v]` pair `.entries` produces — is taken apart: `$1` is its first half, `$2` its second. Example: `m.entries.sort-by($2.createdAt).map($1)` with `$1=key`, `$2=value`. An `Option` / `Result` holding a `Tuple(A, B)` is taken apart the same way.
- A `Map(K, V).filter` predicate is handed each entry: `$1=key`, `$2=value` ([§2.2.1](#_2-2-1-map-k-v)).
- Any other element of a `List`, and the value of an `Option` (`map` / `filter`) or of a `Result` (`map`), is `$1` **whole** — a `List` element with two items included: `[[1, 2], [3, 4, 5]].map($1.length)` is `[2, 3]`, and `Some([1, 2]).filter($1.length > 1)` is `Some([1, 2])`. Such a fragment binds no `$2`: writing one is [E0103](./errors.md#e0103-undef-ref-undef-slot) (`"$2" is not bound here — …`), rather than the index or a second copy of `$1`. That holds anywhere inside the fragment, a `$2` in another method's argument included: `nums.map($1.min($2))` is E0103 too, since only a fragment binds positionals and that argument reads the fragment's.
- Everywhere else the lowering falls back to reading the value: a 2-element array is taken apart into `$1` / `$2`; anything else is `$1`, with `$2` the index (`map` / `find`) or `$1` again (`filter` / `sort-by`). That is where the checker cannot decide the element type (a type parameter, an untyped payload — `nums.fold([], $1.push([$2, $2])).map(…)`), and where the receiver's type is known but this section gives the method no binding on it: a `Set`, whose `filter` is handed each element as an `[element, true]` entry; `Map.map` / `find` / `sort-by`; `Option.find` / `sort-by`; `Result.filter` / `find` / `sort-by`; and any receiver that is not a collection. A `fn` named as the fragment there takes a second parameter only over a receiver the checker cannot decide; over a known one it is [E0213](./errors.md#e0213-call-arity-mismatch). These are gaps, not rules a program may rely on, and they close as the types become decidable and the members get bindings of their own.

**`sort-by(expr)` orders by the key the way `<` orders two values** ([language §1.9.4](./language.md#_1-9-4-operator-types)): a number or a `Time` numerically, a `Text` as `<` compares two `Text`s. Elements whose keys are equal keep the order they had. A key with no order — a record, a variant, a `Bool`, an `Option`, a container — is [E0201](./errors.md#e0201-type-mismatch), as `a < b` on the same two values would be. The key may also be a `fn` passed by name (`xs.sort-by(keyOf)`); its declared return type is the key's type.

- **`Text` order is UTF-16 code-unit order**, not a locale's collation: `"Z" < "a"`, `"B" < "a"`, and kana and kanji sort by code point rather than in dictionary (reading) order.
- **A key is ordered as the value it is at runtime.** A field declared numeric or `Time` whose value arrives as `Text` — for example from an HTTP JSON body, which is not converted to the declared types — is ordered as `Text`: `"10"` before `"9"`.
- **A key with no value to order — absent, or `NaN` — sorts after every other key**, keeping its order. Only a key the checker could not type can be one; compared as "equal" to every key, a single one would otherwise stop the rest from sorting.

### 2.2.4 Option(T)

```
is-some                     : Bool
is-none                     : Bool
get                         : T               ; panics if None (allowed only inside a reducer)
get-or(default)             : T
map(expr)                   : Option(T')
flat-map(expr)              : Option(T')
filter(pred)                : Option(T)
or(other)                   : Option(T)
to-list                     : List(T)
```

### 2.2.5 Result(T, E)

```
is-ok                       : Bool
is-err                      : Bool
get                         : T               ; panics if Err
get-err                     : E               ; panics if Ok
get-or(default)             : T
map(expr)                   : Result(T', E)
map-err(expr)               : Result(T, E')
flat-map(expr)              : Result(T', E)
or(other)                   : Result(T, E)
to-option                   : Option(T)
```

> **Panic semantics.** `Option.get` / `Result.get` (the polymorphic unwrap, also written paren-free as `value.get`) panic on the empty case (`None` / `Err`); `Result.get-err` panics on `Ok`. All raise the one controlled panic signal handled by the live runtime — see [Error Handling](./lifecycle.md#_7-2-error-handling). Prefer `get-or(default)` outside a reducer.

### 2.2.6 Text

```
length                      : Int
is-empty                    : Bool
upper                       : Text
lower                       : Text
trim                        : Text
starts-with(s)              : Bool
ends-with(s)                : Bool
contains(s)                 : Bool
split(sep)                  : List(Text)
replace(from, to)           : Text
slice(start, end)           : Text
parse-int                   : Option(Int)
parse-float                 : Option(Float)
```

### 2.2.7 Int / Float

```
abs, neg, min(b), max(b), clamp(lo, hi)
floor, ceil, round                            ; -> Int
sqrt, log, exp, pow(n)                        ; log is the natural logarithm
show, to-float (Int), to-int (Float, truncated)
```

`floor` / `ceil` / `round` are *typed* `Int` whatever they are given, and `round`'s ties go up, toward +∞ — `(-2.5).round` is `-2`. `sqrt` / `log` / `exp` are typed `Float`. `pow` has no result type at all: `2.pow(3)` is an `Int` and `2.pow(-1)` is `0.5`, so the receiver does not decide it, and a `pow` expression is not checked against its target.

These are the arithmetic Kumiki has. There is no `math` namespace: a qualifier is a capitalised name, so `math.abs(x)` is a reference to a name called `math` and reports [E0103](./errors.md#e0103-undef-ref-undef-slot).

An argument outside a function's domain produces what the platform produces — `(-1.0).sqrt` is `NaN`, `(0.0).log` is `-Infinity` — and `.show` renders those as `"NaN"` and `"-Infinity"`. Kumiki has no separate not-a-number type, and the `Int` above is the type, not a promise about the value: `(-1.0).sqrt.floor` is typed `Int` and is `NaN`. A refinement (`where between(…)`) is how a slot refuses one.

`x.show` is the **common-to-all-types** stringification method. Int / Float / Bool / variant / nominal all return `.show : Text`. Kumiki has no name called `to-text`.

### 2.2.8 Time

```
Time.now                    : Time
Time.parse(text)            : Option(Time)    ; ISO8601
plus(duration)              : Time
minus(duration)             : Time
diff(other)                 : Duration
format(pattern)             : Text            ; "yyyy-MM-dd HH:mm"
```

`format` replaces each of these tokens with that field of the instant and copies the rest of the pattern through verbatim, so `"dd/MM/yyyy"` and `"[on] dd"` are both patterns:

| token | field |
|---|---|
| `yyyy` | year, 4 digits |
| `MM` | month, `01`–`12` |
| `dd` | day of month, `01`–`31` |
| `HH` | hour, `00`–`23` |
| `mm` | minute, `00`–`59` |
| `ss` | second, `00`–`59` |

Every occurrence of a token is replaced, including one inside a word: `format("summer dd")` renders `su05er 14`, because `mm` is a token wherever it appears. There is no escape — a pattern is tokens and separators (`-`, `/`, `:`, spaces), not prose.

The fields are **local** ones. The result carries no timezone in it, so it is read as the reader's wall clock; UTC fields would show the wrong day to every reader whose local date differs from the UTC one at that moment — after midnight east of Greenwich, and during the evening west of it.

`Time.parse` yields the instant as a millisecond number, the same representation [§2.2.9](#_2-2-9-duration) gives every `Time`; text that names no instant — including the empty string — is `None`. A **date-only** string is read as **local** midnight, not the UTC midnight the platform's own parser gives it: `format` renders local fields, so reading `"2026-08-14"` as UTC would hand back `2026-08-13` west of Greenwich, and a `type="date"` input produces exactly that string.

### 2.2.9 Duration

```
Duration.ms(n)              : Duration
Duration.s(n)               : Duration
Duration.m(n)               : Duration   ; min is also valid
Duration.h(n)               : Duration
Duration.d(n)               : Duration   ; days is also valid
to-ms                       : Int
```

Time / Duration are represented at runtime as a **raw number of milliseconds**. An operation like `time.plus(Duration.h(72))` is expanded into a simple ms addition.

Every constructor takes its magnitude, and dropping the parentheses does not make one a value: `Duration.h` is read as a call given no argument, which is the same [E0213](./errors.md#e0213-call-arity-mismatch) as `Duration.h()`. `Bytes.*` below is read the same way. Before that, the bare spelling was a field read that evaluated to nothing at all — and a duration of nothing is a duration of zero, which nothing reported.

```kumiki fragment
fn isSoon(due: Time) -> Bool = due < now.plus(Duration.h(72))
fn elapsed(start: Time) -> Duration = now.diff(start)
```

### 2.2.10 Bytes

`Bytes` is a raw byte sequence (`Uint8Array` at runtime). It has no collection-style methods in v0.x; only constructors are provided.

```
Bytes.from-text(text)       : Bytes        ; UTF-8 encode
Bytes.from-base64(text)     : Bytes        ; standard base64 decode
Bytes.from-bytes(list)      : Bytes        ; from List(Int) (each value masked to its low 8 bits)
```

---

## 2.3 Tile Primitive Elements

Kumiki's built-in tiles. They are **semantic tags** and are not literal translations of HTML tags.

### 2.3.1 Structural Elements

| Element | Role | Main props |
|---|---|---|
| `page` | the app's root screen | `title`, `class` |
| `region` | a named section | `aria-label`, `class` |
| `row` | horizontal layout | `gap`, `align`, `justify` |
| `column` | vertical layout | `gap`, `align`, `justify` |
| `stack` | overlapping placement | `align` |
| `grid` | grid | `cols`, `gap` |
| `box` | generic container | `class`, `style` |
| `card` | card | `class` |
| `panel` | panel | `class` |
| `divider` | divider | `orientation` |
| `scroll` | scroll container | `direction`, `max-height` |

### 2.3.2 Text Elements

| Element | Role | Main props |
|---|---|---|
| `text` | text display | `strike`, `bold`, `italic`, `size`, `color` |
| `heading` | heading | `level` (1-6) |
| `link` | link | `to`, `external` |
| `code` | code | `lang` |
| `markdown` | Markdown rendering | (content is the argument) |

Each value builtin reads its content from one place ([Language §1.7.1](./language.md#_1-7-1-syntax)): `text`, `heading`, `code` and `markdown` from their first positional argument; `link`, `label` and `editable` from their first positional argument, or `text=` when none is written; `image` and `icon` from `src=` and `name=`. An argument written as content that the builtin does not read — a second positional, a positional on `image` / `icon`, `text=` on a text builtin with no positional, `text=` beside a positional on `link` / `label` / `editable` — is never rendered and is [E0129](./errors.md#e0129-unrendered-arg).

`heading` renders `<h1>` … `<h6>` for its `level`, on the client and in server rendering alike, and `<h1>` when no `level` is given. A fractional `level` drops its fraction, and one outside 1-6 is drawn at the nearer end (`0` is an `<h1>`, `9` an `<h6>`). A `level` that changes between renders re-creates the element, since a tag cannot change in place.

`link` `external` opens the link in a new browsing context (`target="_blank"`, with the `rel="noopener noreferrer"` that has to accompany it) and leaves it to the browser rather than the router.

A `to` on another origin is left to the browser with or without it: the router can only serve a same-origin target ([routing §3.3.1](./routing.md#_3-3-1-the-link-element-recommended)). `external` chooses the new browsing context; it is not what makes such a link work.

### 2.3.3 Media Elements

| Element | Role | Main props |
|---|---|---|
| `image` | image | `src`, `alt`, `width`, `height`, `loading` |
| `icon` | icon | `name`, `size` |
| `video` | video | `src`, `controls`, `autoplay` |

`image` `width` / `height` are written as attributes, which is what reserves the box before the image arrives; `loading` takes `lazy` or `eager`.

### 2.3.4 Input Elements

| Element | Role | Main props |
|---|---|---|
| `button` | button | `text`, `onClick`, `variant`, `disabled`, `loading` |
| `input` | text input | `bind`, `placeholder`, `type` (text/email/password/...), `disabled` |
| `textarea` | multi-line input | `bind`, `rows`, `placeholder` |
| `check` | checkbox | `value`, `onClick`, `onChange`, `label` |
| `radio` | radio button | `name`, `value`, `selected`, `onClick`, `onChange` |
| `select` | select | `bind`, `options` (List of `{label, value}`), `placeholder`, `onChange` |
| `slider` | slider | `bind`, `min`, `max`, `step`, `onChange` |
| `switch` | toggle | `value`, `onClick`, `onChange` |
| `editable` | contenteditable text field (#190) — `<div contenteditable="true">` with plain-text `textContent` write-back on `input` | `bind`, `text` (positional or named), `id` |

`button` `loading` disables the button, marks it `aria-busy`, and puts a spinner in front of its label ([Forms §5.8](./forms.md#_5-8-ui-during-submission)); `disabled` disables it on its own. `variant` becomes the `data-kumiki-variant` attribute — a hook for a `class` or a theme stylesheet to select on. Kumiki ships no appearance for any variant name: what a "ghost" button looks like is a design decision, and inventing one here would make it a language feature.

### 2.3.5 Forms

| Element | Role | Main props |
|---|---|---|
| `form` | form (delivered to the tile wrapping the form via `ui.submit(WrapperTile)`) | `id`, `auto-complete`, `novalidate` |
| `label` | label | `for` |
| `fieldset` | field set | `legend` |
| `error` | validation error display | `field` |

### 2.3.6 Lists / Tables

| Element | Role | Main props |
|---|---|---|
| `list` | list | `ordered` |
| `list-item` | list item | |
| `table` | table | |
| `table-head` | table header | |
| `table-body` | table body | |
| `table-row` | table row | |
| `table-cell` | table cell | `colspan`, `rowspan` |

### 2.3.7 Overlays

| Element | Role | Main props |
|---|---|---|
| `overlay` | z-axis stack: the first child is the base layer, each later child is placed over it — the substrate the rest of this table is built on ([Style §4.4.3](./style.md#_4-4-3-stack)) | `align` |
| `modal` | modal | `open`, `onClose`, `title` |
| `drawer` | drawer | `open`, `onClose`, `side` |
| `tooltip` | tooltip | `text`, `placement` |
| `popover` | popover | `open`, `onClose`, `placement` |
| `toast` | toast notification | `kind` (info/success/warn/error — carried as `data-level`, with no built-in appearance), `text`, `duration` (see [Lifecycle §7.7](./lifecycle.md#_7-7-toasts) for the per-kind defaults) |
| `details` | native `<details>` disclosure (#190) — `summary` labels the header; children make up the collapsible panel | `summary`, `open` |

### 2.3.8 Feedback

| Element | Role | Main props |
|---|---|---|
| `spinner` | spinner | `size` |
| `progress` | progress bar | `value`, `max` |
| `skeleton` | skeleton | `kind` (text/box/circle) |

`spinner` renders an animated loading indicator (an accessible element with `role="status"`; the animation is disabled under `prefers-reduced-motion`). `size` takes one of the tokens `sm` / `md` / `lg` / `xl`; without it the spinner scales with the surrounding text.

### 2.3.9 Control Elements

| Element | Role |
|---|---|
| `when(cond, tile)` | display tile if cond is true |
| `if cond then tA else tB` | conditional branch |
| `for x in coll tile` | iteration |
| `route-outlet` | output position for nested routes |
| `link(to=...)` | route navigation link |

### 2.3.10 Common Specification of props

Every tile accepts the following common props (built-in):

| prop | Type | Becomes |
|---|---|---|
| `class` | `Text` | class tokens, **added** to the classes the runtime puts on the element |
| `style` | `Map(Text, Text)` | inline style declarations — each key is a CSS property, applied after the shorthands so it wins (minimal use recommended) |
| `aria` | `Map(Text, Text)` | one `aria-*` attribute per entry; a key already spelled `aria-…` is not prefixed twice |
| `key` | `Text` | tile identity across renders — lifted out of the props, never an attribute |
| `test-id` | `Text` | the `data-kumiki-test` attribute ([Testing §8.8](./testing.md#_8-8-integration-tests-browser-driven)) |
| `id` | `Text` | the element's `id`, and the `#id` half of a reducer's selector ([§1.6.2](./language.md#_1-6-2-selectors)) |
| `role` | `Text` | the `role` attribute, replacing whatever the tile kind assumes |
| `aria-*` | `Text` | that ARIA attribute, written on its own instead of through the `aria` map |

`class` / `style` are the escape hatch [Style §4.1](./style.md#_4-1-policy) describes. All of the above apply to **every kind**, and so do the style shorthands ([§4.3.1](./style.md#_4-3-1-shorthand-properties)) and the sizing props ([§4.4.7](./style.md#_4-4-7-sizing)): the runtime writes them outside the per-kind renderers, so a `max-w` on an `image` and a `bg` on a `button` land, and a tile a host registered ([Runtime §10.3.10](./runtime.md#_10-3-10-stable-tile-identity)) gets them too.

A kind that maps a prop itself keeps it: a `spinner`'s and an `icon`'s `size` picks the size of the thing rather than a typography token, and a `skeleton`'s `h` is its placeholder height.

Both rendering paths write them: what a mounted element carries, a served page carries. The exception is the class-backed layers (`transition`, the `hover:` / `focus:` / `active:` blocks, `motion`), which are injected CSS and exist only after hydration.

---

## 2.4 Built-in Functions

### 2.4.1 ID Generation

```
TypeName.fresh()           : T            ; a new ID for a nominal type (UUIDv7)
```

`TypeName` is a type that takes no arguments. A type constructor written without its arguments — `List`, `Map`, `Tuple`, or `Box` for a `type Box(T) = …` — names no type for `fresh` to mint, and `Box.fresh()` is [E0124](./errors.md#e0124-type-constructor-qualifier). Name the application first and qualify with that: `type OrderId = Tagged(Int)` for a `type Tagged(T) = nominal Text`, then `OrderId.fresh()`. The same holds for the qualifier of `parse` and `show` in [§2.4.3](#_2-4-3-type-conversion).

The id is a uuid `Text`, so `TypeName` is a type a `Text` goes into: `Text` itself, or a `nominal` / `where` over it — `PostId`, and the standard library's `Url` / `Email` / `Uuid`. Any other `TypeName` — `Int`, a `nominal Int`, a record, a union — is [E0802](./errors.md#e0802-unimplemented-function): there is no uuid that is a number, and a `nominal Int` id minted this way was a string wherever it went, which a `Set` of it read back as `NaN`.

### 2.4.2 Time

```
now                        : Time          ; the current time
```

### 2.4.3 Type Conversion

```
TypeName.parse(text)       : Option(T)    ; string parsing of a nominal type
TypeName.show(value)       : Text         ; the string representation of a value
```

As in [§2.4.1](#_2-4-1-id-generation), `TypeName` is a type that takes no arguments; a type constructor written without its arguments is [E0124](./errors.md#e0124-type-constructor-qualifier) on `parse` and `show` alike.

`TypeName.show(value)` is the qualified spelling of the `.show` method of [§2.2](#_2-2-collection-methods), and the qualifier is discarded: `Duration.show(d)` and `d.show` are the same expression and the same `Text`. That holds for every `TypeName`, [`Duration`](#_2-2-9-duration) and [`Bytes`](#_2-2-10-bytes) included — their other members are constructors, but `show` is not one of them, and reading it as one made a `Text` slot refuse the call with [E0201](./errors.md#e0201-type-mismatch). `parse` is the opposite case: its `Option(T)` *is* the qualifier's, which is why the two are written apart here.

`parse` reads its text by the **base** `T` resolves to, not by the name it is written with, so a `nominal` parses the way the type it is declared over does: with `type Cents = nominal Int`, `Cents.parse("12")` is `Some(12)`, and `Duration.parse("500")` is `Some(500)` because a [`Duration`](#_2-2-9-duration) is a `nominal Int` of milliseconds. The bases a text has a reading as:

| Base | `Some` of | `None` when the text |
|---|---|---|
| `Int` | the number it spells: an optional `+` / `-` and decimal digits | is anything else — a fraction, an exponent, a `0x` / `0b` prefix, surrounding blanks, empty |
| `Float` | the number it spells: an optional `+` / `-`, decimal digits, an optional `.` and digits, an optional `e` / `E` exponent | is anything else — `.5`, `1.`, `0x10`, `Infinity`, surrounding blanks, empty — or spells a number too large to be finite |
| `Time` | the instant, as [`Time.parse`](#_2-2-8-time) reads it | names no instant |
| `Bool` | `true` for `"true"`, `false` for `"false"` — the two spellings `.show` produces | is anything else |
| `Text` | the text itself | is empty |
| `Bytes` | its UTF-8 bytes, as `Bytes.from-text` builds them | is empty |

The readings are exact, like `Bool`'s: `Int.parse(" 12 ")` and `Int.parse("0x10")` are `None`, not `Some(12)` and `Some(16)`. Trim the text first when blanks are expected.

The value read is then held to every `where` refinement `T` carries ([Language §1.3.3](./language.md#_1-3-3-registered-refinement-predicates)), and a value that fails one is `None`: with `type Cents = nominal Int where positive`, `Cents.parse("-5")` is `None`. So `parse` never produces a value its own type refuses — an `Option(Cents)` never passes through a slot-write guard, so the parse is the only place that check can happen.

The argument is a `Text`; anything else is [E0201](./errors.md#e0201-type-mismatch).

Any other base — a record, a union, a container, `File`, `EffectId`, `Unit`, or a `nominal` over one of them — has no reading of a text, and `T.parse` on one is [E0802](./errors.md#e0802-unimplemented-function). A type constructor written without its arguments (`List`, or `Box` for a `type Box(T) = …`) is not a type at all, and `T.parse` on one is [E0124](./errors.md#e0124-type-constructor-qualifier) instead. Those used to answer the raw text wrapped in `Some`, which the call's own type claims is a `T`.

### 2.4.4 Randomness

```
random()                   : Float        ; 0 <= x < 1
```

The rest of the arithmetic is [§2.2.7](#_2-2-7-int-float), as methods on the number.

`random()` reads the environment the way `now` does, and like `now` it is callable wherever an expression is. Its answer is different every time it is read, so it takes its parentheses.

### 2.4.5 String Formatting

```
fmt(template, ...args)     : Text         ; "Hello {0}, you have {1}"
```

A **placeholder** is `{`, one or more decimal digits, `}`. Each one is replaced by the argument at that index — `{0}` is the first argument after the template — rendered the way `+` renders it (the `show` equivalent named below: a variant is its tag, a nullish is the empty string, anything else is its text form), so `fmt("{0}-{1}", "a", "b")` is `"a-b"`. An index may repeat, and the indices may appear in any order: `fmt("{1} {0} {1}", "a", "b")` is `"b a b"`. Substitution is a single left-to-right pass over the template: a `{0}` that appears *inside* a substituted value is text, not a placeholder to fill again.

The digits are read as one decimal index, so a leading zero is significant only as a digit: `{01}` is index 1.

Three cases are decided here rather than left to the implementation:

- **An index the arguments do not reach** — `fmt("{0} {1}", "a")` — leaves that placeholder as written: `"a {1}"`. It is neither an error nor the empty string. A template whose placeholders outran its arguments is a mistake, and the rendering that shows *which* index went missing is the one that puts the mistake where its author will see it.
- **An argument no placeholder names** — `fmt("{0}", "a", "b")` — is dropped, so the result is `"a"`. There is nowhere in the result to show it, which is exactly why the check below exists: an extra argument is the half of this pair that leaves no trace at all.
- **A `{` that does not open a placeholder** is copied through verbatim, and so is a `}` that closes nothing: `{}`, `{a}`, `{ 0 }` and the unclosed `{01` are all literal text. There is **no escape**, the same way `Time.format` ([§2.2.8](#_2-2-8-time)) has none: `fmt("{{0}}", "a")` is `"{a}"`, because the inner `{0}` is a placeholder and the outer braces are text. A template that has to show a literal `{0}` builds it with `+`.

Neither of the first two stops a program, and neither is silent where it can be seen: when the template is a **literal**, its placeholders are counted against the call's arguments and a disagreement in either direction is [W0214](./errors.md#w0214-fmt-placeholder-argument-mismatch-warning). A template that is an expression carries no count to check, and is answered by the rules above at runtime.

The call is counted ([E0213](./errors.md#e0213-call-arity-mismatch)) against the signature above — the template is all that is required, because a template with no placeholders takes no arguments.

When you concatenate `Text` with another type using `+`, the equivalent of `show` is called automatically.

### 2.4.6 Debugging Aids

```
trace(label, value)        : T            ; records to the episode log with a label, returns the value as is
panic(message)             : never        ; stops the program (inside a reducer only)
```

`trace` is **not implemented yet**: a lowered expression has no route to the mount's episode logger, so recording one needs a runtime seam that does not exist. `check` reports [E0802](./errors.md#e0802-unimplemented-function) for a call to it, rather than letting the name become an undefined global at evaluation time. `panic` is implemented.

---

## 2.5 Standard Capabilities

The standard set of capabilities that can be declared in `app.caps`:

| capability | Use |
|---|---|
| `http.get`, `http.post`, `http.put`, `http.patch`, `http.delete` | HTTP requests |
| `http.cancel` | Cancel an in-flight HTTP request by `EffectId` (see [Cancellation](./http.md#_6-4-cancellation)) |
| `storage.read`, `storage.write` | localStorage |
| `session.read`, `session.write` | sessionStorage |
| `indexed.read`, `indexed.write` | IndexedDB |
| `nav.push`, `nav.replace`, `nav.back` | route navigation |
| `clipboard.read`, `clipboard.write` | clipboard |
| `notification.show` | desktop notifications |
| `analytics.send` | sending measurement events |
| `log.write` | log output |
| `crypto.random`, `crypto.hash` | cryptography |
| `media.camera`, `media.microphone` | media devices |
| `geo.read` | location information |
| `socket.connect`, `socket.send` | WebSocket |

Writing a capability in `app.caps` that is neither standard nor registered is a compile error ([E0302](./errors.md#e0302-unknown-capability)).

#### Registering custom capabilities (`kumiki.caps.json`)

A project can extend the accepted set with a **`kumiki.caps.json`** manifest:

```json
{
  "capabilities": [
    { "name": "telemetry.track", "description": "..." }
  ]
}
```

Each entry is a capability name in `group.action` form (lowercase, dot-separated) — either a bare string or an object with a `description`. A registered name is then accepted in `app.caps`, and an effect bound to it (`effect track cap=telemetry.track …`) becomes emittable and is dispatched at the capability boundary — and is mockable in scenarios exactly like a standard effect. A name already in the standard set must not be re-declared.

**Where the manifest is looked for.** The manifest registers capabilities for a *project*, so it is searched for from the directory holding the `.kumiki` file upwards, one directory at a time, up to and including the project root — the nearest directory holding a `package.json`, or the filesystem root when there is none. The bound is the same for every tool: a host's own notion of a project root (Vite's `root`, which for `kumiki dev` is the `.kumiki` file's own directory) does not narrow it, because one file must resolve to one manifest whichever tool reads it. The **nearest** manifest is the one that is read; the rest are not consulted. A manifest on that path that exists but is malformed is an error naming the file, never a silent fall-through to one further up. When a name in `app.caps` is still unregistered, [E0302](./errors.md#e0302-unknown-capability) is reported, and `kumiki check` / `kumiki build` / the Vite plugin name the manifest they read, or the directories they searched.

This is a **capability-boundary registration: a declarative manifest, not new syntax or arbitrary code** — consistent with Kumiki's non-goal of macro/DSL extension. Working example: [27-custom-capability](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/27-custom-capability.kumiki) (+ its `kumiki.caps.json`).

#### Supplying the implementation (host capability providers)

A custom capability has **no built-in implementation** — the manifest only makes the name *declarable*. The host that mounts the app supplies the implementation at the capability boundary, via `mount`'s options:

```ts
import { mount } from "@kumikijs/runtime";
import { stripe } from "./stripe.ts"; // any npm library lives here, host-side

mount(App, root, {
  providers: {
    // keyed by capability name; receives the effect's (map-request-mapped) input
    "payments.charge": async (input) => {
      try {
        const r = await stripe.charges.create(input as ChargeReq);
        return { kind: "ok", value: { id: r.id } };
      } catch (e) {
        return { kind: "err", value: { message: String(e) } };
      }
    },
  },
});
```

A provider returns an `EffectResult` (`{kind:"ok"|"err", value}`), sync or async; a thrown error is normalized to `err`. This is **Kumiki's inbound ecosystem seam**: arbitrary JS / npm libraries are confined to the provider, behind a typed, mockable, episode-tracked boundary, so the language core needs no FFI. If an effect on a custom capability fires with no provider registered, it resolves to `err {message: "Capability <name> has no provider"}`. In a `kumiki run` scenario, the scripted effect outcome overrides the provider (the runner mocks at the same boundary), so tests stay hermetic.

The compiled bundle auto-mounts to `#root`; a host embedding the bundle can register providers by assigning `globalThis.__kumikiProviders` before the module loads.

**Overriding a standard capability.** A provider may also be registered for a *standard* capability (`http.*`, `storage.*`, `nav.*`, `notification.show`, `log.write`, …) — every effect invoke consults `caps.provider(cap)` before its built-in implementation. This lets a host swap the HTTP transport (axios / ofetch), inject auth headers, plug in a framework router, or replace the toast UI, without changing the Kumiki source. The provider receives the effect's (already `map-request`-mapped) request; when none is registered the built-in behavior runs unchanged.

**Unhandled effect errors are surfaced, never silent.** An effect that resolves to `err` is delivered to every matching `.err` reducer. If a program wires **no** `.err` reducer for that effect, the dropped error is reported via `console.error` (`[kumiki] effect "<name>" returned an error with no .err reducer: …`), so the verification tiers (`smoke` / `runScenario`, which capture `console.error`) flag it — consistent with the live-panic model ([Error Handling](./lifecycle.md#_7-2-error-handling)). A failed capability must never look like a no-op: the storage-unavailable case (opaque-origin sandbox, private mode) is exactly this — `storage.read` / `storage.write` return `err`, and an app handling only `.ok` would otherwise silently do nothing. The default contract is therefore **`err` plus a surfaced report**; a program opts into handling (or deliberately ignoring) the error by wiring an `.err` reducer — even an empty one. An in-memory storage fallback is **not** the default behavior (it would paper over this contract); a host that wants one supplies it explicitly via a `storage.*` provider.

---

## 2.6 Standard Effects

The standard effect corresponding to each capability. If the capability is in `app.caps`, it is automatically usable.

The converse is checked too: emitting one of these without its capability in `app.caps` is [E0301](./errors.md#e0301-missing-capability). They have no `effect` declaration to read a `cap=` off — the runtime registers them itself — so the requirement comes from the capability each is registered behind, written with each effect below. This section lists all of them, and it is the list the compiler holds.

The `in=` written with each is held the same way a declared effect's is: an `emit` passes one argument, or none when `in=` is `Unit` ([E0213](./errors.md#e0213-call-arity-mismatch)), and the argument is checked against the `in=` ([E0202](./errors.md#e0202-emit-arg-type-mismatch)) — `emit navigate("/about")` is a `Text` where a record is taken. A record argument may leave a field out when its type is `Option(T)`, which the effect then treats as `None` (`toast({kind: "info", text: "Saved"})`), and where this section or the one it points to gives a default: `navigate`'s and `navigate-replace`'s `params` and `query` default to `{}` ([Routing §3.7](./routing.md#_3-7-query-parameters)), and `confirm`'s `message` to none. Every other field is required — leaving one out is [E0214](./errors.md#e0214-missing-record-field), as in `toast({kind: "info"})` — and a field the `in=` does not have is [E0215](./errors.md#e0215-unknown-record-field).

What an argument leaves out is read where it is written: each branch of an `if` or `match` and the body of a `let` leave out their own fields, and a value whose record type leaves a defaulted field out (`slot target : {path: Text}`, `emit navigate(target)`) passes as the literal would. The argument is held the same way in every position an effect call is written — an `emit`, an `app.init` entry and an `expect.effects` argument ([Testing §8.2](./testing.md#_8-2-reducer-tests)).

These omissions belong to the standard effects alone. A declared effect's `in=` record is held to every field, `Option(T)` ones included, as any record literal is; and a declaration of the same name as a standard effect is the effect a program dispatches, so its `in=` is the one checked.

→ For the detailed specification, see [HTTP / Storage](./http.md).

### 2.6.1 Navigation

```kumiki fragment
effect navigate    cap=nav.push     in={path: Text, params: Map(Text, Text), query: Map(Text, Text)}  out=Unit
effect navigate-replace cap=nav.replace in={path: Text, params: Map(Text, Text), query: Map(Text, Text)} out=Unit
effect navigate-back   cap=nav.back  in=Unit  out=Unit
```

### 2.6.2 Toast

The banner the runtime renders carries `data-kumiki-toast` (the marker a test selects on) and `data-level`.

```kumiki fragment
effect toast       cap=notification.show
                   in={kind: Text, text: Text, duration: Option(Duration)}
                   out=Unit
```

### 2.6.3 Log

```kumiki fragment
effect log         cap=log.write    in={level: Text, message: Text, data: Map(Text, Text)}  out=Unit
```

### 2.6.4 Scroll

```kumiki snippet
effect scroll-to   in={x: Int, y: Int}  out=Unit
```

The one standard effect with no capability: it moves the viewport of the page the user is already looking at, and reaches nothing outside it. → [Routing §3.9](./routing.md#_3-9-scroll-restoration).

### 2.6.5 Confirm

```kumiki fragment
effect confirm     cap=notification.show  in={title: Text, message: Text, onYes: ReducerRef, onNo: ReducerRef}  out=Unit
```

`ReducerRef` is a reducer's name written bare (`onYes: doDelete`), which the runtime dispatches by name. It is not a type a program can write; it exists only in this `in=`. A bare name that is not a reducer's is [E0103](./errors.md#e0103-undef-ref-undef-slot), and any other value there is [E0202](./errors.md#e0202-emit-arg-type-mismatch).

Rendered as a modal dialog tile rather than the native `confirm`, and it delivers its answer to a reducer rather than returning one. → [Lifecycle §7.6](./lifecycle.md#_7-6-confirmation-dialogs).

---

## 2.7 Frequently Wanted Types Such as Numeric/Currency Are Intentionally Not Provided

Types such as `Money`, `Percent`, and `Decimal` are defined on the application side using `nominal`. Kumiki is unopinionated.

```kumiki fragment
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
```
