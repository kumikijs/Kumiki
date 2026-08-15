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
| `Bytes` | byte sequence | no literal; `Bytes.from-text()` / `Bytes.from-base64()` / `Bytes.from-bytes()` (see §2.2.10) |
| `Time` | UNIX nanoseconds | no literal; `now` or `Time.parse()` |
| `EffectId` | opaque handle returned by `emit` (see §2.1.1.1) | no literal; `EffectId.none` |

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
| `HttpStatus` | `nominal Int where between(100, 599)` |
| `HttpError` | `{status: HttpStatus, message: Text, body: Option(Text)}` |
| `Url` | `nominal Text where url` |
| `Email` | `nominal Text where email` |
| `Uuid` | `nominal Text where uuid` |
| `Duration` | `nominal Int` (nanoseconds) |
| `Route` | `{path: Text, params: Map(Text, Text), query: Map(Text, Text)}` |
| `FormData` | `Map(Text, FormValue)` |
| `FormValue` | `TextV(Text) \| NumberV(Float) \| BoolV(Bool) \| FileV(File)` |
| `File` | `{name: Text, size: Int, type: Text, content: Bytes}` |
| `PanicInfo` | `{message: Text, location: Text, episode-id: Text, cause: Option(Text), category: Text}` — the payload of `app.error` and of an `error-boundary` tile's `in=` |

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

`.entries` returns a **sequence of 2-element arrays** as `List(Tuple(K, V))`. A subsequent `map` / `sort-by` / `filter` lambda can handle them as `$1=key, $2=value` via runtime destructuring:

```kumiki
fn sortedByCreatedAt(m: Map(Id, Item)) -> List(Id)
   = m.entries.sort-by($2.createdAt).map($1)
```

`get-or` is a polymorphic method that **can also be used for Option**:

```kumiki
m.get-or(k, default)         ; Map: default if there is no value
opt.get-or(default)          ; Option: default if None, v if Some(v)
```

`.filter` **can be used on both List and Map**, and the runtime dispatches automatically by looking at the receiver's type (polymorphic dispatch):
- Receiver is List → evaluate `pred($1)` for each element, keep only elements that are `true`
- Receiver is Map  → evaluate `pred($1, $2)` (key, value) for each entry, keep only entries that are `true`

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
sort-by(expr)               : List(T)
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

**Parenthesis-free shortcut**: argument-less methods (`is-empty` / `length` / `reverse` / `sort` / `unique` / `head` / `tail` / `last`) **can omit `()` and be written like a field**:

```kumiki
slot todos : List(Todo) = []
fn count() -> Int = todos.length              ; parenthesis-free OK
fn empty?() -> Bool = todos.is-empty          ; same as above
fn norm() -> List(Todo) = todos.reverse       ; same as above
```

> **Dispatch rule.** `recv.m` is dispatched by the **inferred type** of `recv`, not by name: if `recv` is a record with a field `m`, it reads the field; if `recv` is a stdlib type with method `m`, it uses the shortcut. So a record field literally named like a method (`node.head` on `{head, …}`) is read as the field — not shadowed. When the receiver type is **known** and `m` is neither a field nor a member, it is a compile error ([errors E0108](./errors.md#e0108-undef-member)). When the receiver type can't be inferred (e.g. an untyped reducer payload), the name-based dispatch is used unchanged.

**The lambda arguments of `map` / `filter` / `sort-by`**:
- For a List element, `$1` is bound; for the `[k, v]` pair after `.entries`, `$1=key, $2=value` are bound (the runtime destructures automatically)
- Example: `m.entries.sort-by($2.createdAt).map($1)` with `$1=key`, `$2=value`

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
show, to-float (Int), to-int (Float, truncated)
```

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

The fields are **local** ones. The result carries no timezone in it, so it is read as the reader's wall clock — rendering UTC fields would show the previous day to everyone whose evening is the next UTC day.

`Time.parse` yields the instant as a millisecond number, the same representation §2.2.9 gives every `Time`; text that names no instant is `None`.

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

```kumiki
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

### 2.3.3 Media Elements

| Element | Role | Main props |
|---|---|---|
| `image` | image | `src`, `alt`, `width`, `height`, `loading` |
| `icon` | icon | `name`, `size` |
| `video` | video | `src`, `controls`, `autoplay` |

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
| `modal` | modal | `open`, `onClose`, `title` |
| `drawer` | drawer | `open`, `onClose`, `side` |
| `tooltip` | tooltip | `text`, `placement` |
| `popover` | popover | `open`, `onClose`, `placement` |
| `toast` | toast notification | `kind` (info/success/warn/error), `text` |
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

| prop | Type | Meaning |
|---|---|---|
| `class` | `Text` | style class name |
| `style` | `Map(Text, Text)` | inline style (minimal use recommended) |
| `aria` | `Map(Text, Text)` | ARIA attributes |
| `key` | `Text` | uniquely identifies an element within a for |
| `test-id` | `Text` | ID for testing |

---

## 2.4 Built-in Functions

### 2.4.1 ID Generation

```
TypeName.fresh()           : T            ; a new ID for a nominal type (UUIDv7)
```

### 2.4.2 Time

```
now                        : Time          ; the current time
```

### 2.4.3 Type Conversion

```
TypeName.parse(text)       : Option(T)    ; string parsing of a nominal type
TypeName.show(value)       : Text         ; the string representation of a value
```

### 2.4.4 Math

```
math.abs, math.min, math.max, math.clamp
math.floor, math.ceil, math.round
math.sqrt, math.pow, math.log, math.exp
math.random                : Float        ; callable only inside a reducer (treated as an effect)
```

### 2.4.5 String Formatting

```
fmt(template, ...args)     : Text         ; "Hello {0}, you have {1}"
```

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

A project can extend the accepted set with a **`kumiki.caps.json`** manifest placed in the same directory as the `.kumiki` file:

```json
{
  "capabilities": [
    { "name": "telemetry.track", "description": "..." }
  ]
}
```

Each entry is a capability name in `group.action` form (lowercase, dot-separated) — either a bare string or an object with a `description`. A registered name is then accepted in `app.caps`, and an effect bound to it (`effect track cap=telemetry.track …`) becomes emittable and is dispatched at the capability boundary — and is mockable in scenarios exactly like a standard effect. A name already in the standard set must not be re-declared.

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

→ For the detailed specification, see [HTTP / Storage](./http.md).

### 2.6.1 Navigation

```kumiki
effect navigate    cap=nav.push     in={path: Text, params: Map(Text, Text)}  out=Unit
effect navigate-replace cap=nav.replace in={path: Text, params: Map(Text, Text)} out=Unit
effect navigate-back   cap=nav.back  in=Unit  out=Unit
```

### 2.6.2 Toast

```kumiki
effect toast       cap=notification.show  in={kind: Text, text: Text}  out=Unit
```

### 2.6.3 Log

```kumiki
effect log         cap=log.write    in={level: Text, message: Text, data: Map(Text, Text)}  out=Unit
```

### 2.6.4 Scroll

```kumiki
effect scroll-to   in={x: Int, y: Int}  out=Unit
```

The one standard effect with no capability: it moves the viewport of the page the user is already looking at, and reaches nothing outside it. → [Routing §3.9](./routing.md#_3-9-scroll-restoration).

### 2.6.5 Confirm

```kumiki
effect confirm     cap=notification.show  in={title: Text, onYes: Reducer, onNo: Reducer}  out=Unit
```

Rendered as a modal dialog tile rather than the native `confirm`, and it delivers its answer to a reducer rather than returning one. → [Lifecycle §7.6](./lifecycle.md#_7-6-confirmation-dialogs).

---

## 2.7 Frequently Wanted Types Such as Numeric/Currency Are Intentionally Not Provided

Types such as `Money`, `Percent`, and `Decimal` are defined on the application side using `nominal`. Kumiki is unopinionated.

```kumiki
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
```
