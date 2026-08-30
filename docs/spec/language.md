# Language Core Specification

The seven kinds of definition a Kumiki program is made of, plus the expressions, statements and patterns they share. [§1.1](#_1-1-overall-program-structure) gives the shape of a whole program; after that, read the layer you are about to write.

## 1.1 Overall Program Structure

A Kumiki program is a **set of 7 kinds of definitions**. There are no physical file boundaries; each definition is stored in a content-addressable graph as the following 4-tuple:

```
(layer, name, body, content-hash)
```

The textual representation is a projection from the graph and can be retrieved with `kumiki view` when needed (→ [AI Editing](./ai-edit.md)).

```
program     ::= definition*
definition  ::= type-def | slot-def | effect-def | reducer-def | tile-def | fn-def | app-def
```

Definitions are unordered and may be forward-referenced. The compiler performs a topological sort.

### 1.1.1 List of Layers

| Layer | Role | Purity |
|---|---|---|
| `type` | Types / schemas | Pure |
| `slot` | Named global state | Pure initial value |
| `effect` | Pure record value representing a side effect | Pure (execution is separate) |
| `reducer` | message → slot change + effect emit | Pure (over the slot set) |
| `tile` | Pure projection from slot → UI tree | Pure |
| `fn` | Auxiliary pure functions | Pure |
| `app` | Application entry | Declaration |

These seven are the **logic/data/UI core** — what an author must learn to express behavior. Kumiki also has **auxiliary presentational/meta definitions** that sit alongside the seven without expanding that core: `theme` ([Design Tokens](./style.md#_4-2-design-tokens)), `motion` ([The motion definition](./style.md#_4-9-1-the-motion-definition)), and `test` ([Testing](./testing.md)). They are real top-level definitions but are not counted among the seven layers; the production-grammar EBNF above lists only the core.

---

## 1.2 Lexical

```
identifier  ::= [a-zA-Z][a-zA-Z0-9_-]*           ; max 32 characters, longest munch
qname       ::= identifier ('.' identifier)*     ; dot-separated fully qualified name
cap-name    ::= identifier ('.' cap-segment)*    ; a capability, whose segments name nothing in this language
cap-segment ::= identifier | keyword             ; so `telemetry.out` is a capability, not a syntax error
literal     ::= number | string | bool | unit
number      ::= int | float
int         ::= '-'? [0-9]+
float       ::= '-'? [0-9]+ '.' [0-9]+           ; the digits after the point are required
string      ::= '"' (escape | non-quote-char)* '"'
escape      ::= '\\' ('n' | 't' | 'r' | '"' | '\\' | 'u{' hex+ '}')
bool        ::= 'true' | 'false'
unit        ::= '()'
tuple       ::= '(' expr ',' expr (',' expr)* ')'  ; the value a Tuple types
comment     ::= '#' until-eol                    ; single-line comment only
```

**`-` is both an identifier character and subtraction, and longest munch decides.** `page-size`, `base-url`, `on-401` and `count-1` are one name each, which is why subtraction between a name and a literal is written `count - 1`.

::: details Every spacing of `count-1`, and what an unresolved one reports
A `-` continues the identifier when an identifier character follows it, and ends it otherwise. `count- 1` is also subtraction, because there the `-` has nothing to continue into; `count -1` is subtraction because the space ended the name before the `-` was reached at all. A name written `count-1` that resolves to nothing is [E0103](./errors.md#e0103-undef-ref-undef-slot), and its message says so.
:::

**A `#` with whitespace on either side of it always starts a comment.** It is the selector operator ([§1.6.1](#_1-6-1-syntax)) only in the tight form `SaveBtn#new`.

::: details The exact condition, and where a `#` still comments
A `#` is the selector operator only when the character before it ends a value — an identifier character, or a closing `)` / `]` / `}` — *and* the character after it begins an identifier. Everywhere else, including `#TODO` at the start of a line and `= 0# how many`, it runs to the end of the line. A `#id` fragment therefore begins with a letter or `_`, which is what `tile-ref` already required.
:::

::: details Positions — line terminators, UTF-16 columns, and the BOM
A line is terminated by `\n` or `\r\n`; a lone `\r` is whitespace inside a line. A column counts UTF-16 code units, so an astral character advances it by two — the same convention the Language Server Protocol uses, and the one every consumer of a Kumiki position needs, since a patch splices a source line at `column - 1`. A leading byte-order mark is whitespace for the same reason: it is not part of the text, but it is part of the string being spliced, so it takes a column.
:::

### 1.2.1 Operators

```
:=  =  ==  !=  <  >  <=  >=
+  -  *  /  %  ->
&&  ||  !            ; bool operators
&                    ; alias of `&&` (for ease of porting from other languages)
|                    ; type union / match arm separator (not bool OR — use `||`)
(  )  {  }  [  ]  ,  ;  :  .  #
```

**Notes on bool operators**:
- Short-circuit AND: `&&` (recommended) or `&` (alias, internally identical)
- Short-circuit OR : `||` (recommended) or `|` (alias, but with a heuristic to avoid collision with match arms)
- When writing `|` as bool OR, if the following token is the combination "**`Variant`/`_` + `->`**" (i.e. the start of a match arm), the parser prefers to treat it as an arm separator. If any other expression follows, it is interpreted as bool OR. As a safe measure, use `||` when in doubt.

### 1.2.2 Reserved Words

```
type  slot  effect  reducer  tile  fn  app
nominal  where  when  for  in  let  if  then  else  match  with
on  do  emit  cap  out  policy  retry
true  false
fresh  self  now  null
```

`null` is reserved but **prohibited in programs** (type error).

### 1.2.3 Design Decisions

- **Indentation-independent**: leading whitespace is ignored
- **Newline is the statement separator**: only inside `do=` can `;` join multiple statements
- **Identifiers are at most 32 characters**
- **An expression, type, pattern or tile tree is at most 256 levels deep**: past that the parser reports a positioned error. No program in the examples or benchmarks comes near it.
- **Multi-line comments prohibited**
- **Macros prohibited**

::: details What the 256-level limit is measured against
A construct that contains itself — a parenthesised expression, a list, a record, an `if`, a statement body, a tile call, a tuple pattern, a type application, a theme record — may not nest further, and neither may a left-associative chain build more than that many nodes (`1 + 1 + 1 + …`, `x.trim().trim()…`, a run of `not` or `-`). The limit is on the resulting tree, not on how the parser reached it: every stage after the parse walks that tree by recursion, so a chain parsed by a loop still exhausts the stack downstream.
:::

---

## 1.3 Type Layer (`type`)

### 1.3.1 Syntax

```
type-def    ::= 'type' identifier ('(' type-param (',' type-param)* ')')? '=' type-expr
type-param  ::= identifier
type-expr   ::= primitive
              | nominal-type
              | record-type
              | union-type
              | generic-type
              | refinement-type
              | identifier
              | type-app

primitive   ::= 'Text' | 'Int' | 'Float' | 'Bool' | 'Unit' | 'Bytes' | 'Time'
nominal-type ::= 'nominal' type-expr
record-type ::= '{' field (',' field)* '}'
field       ::= identifier ':' type-expr
union-type  ::= variant ('|' variant)+
variant     ::= identifier ( '(' type-expr (',' type-expr)* ')' )?
generic-type ::= identifier '(' type-expr (',' type-expr)* ')'
type-app    ::= identifier '(' type-expr (',' type-expr)* ')'
refinement-type ::= type-expr 'where' pred-expr
pred-expr   ::= identifier ('(' literal (',' literal)* ')')?
```

### 1.3.2 Built-in Generic Types

```
Map(K, V)
Set(T)
List(T)
Option(T)         ; None | Some(T)
Result(T, E)      ; Ok(T) | Err(E)
Tuple(T1, ..., Tn)
```

### 1.3.3 Registered Refinement Predicates

```
nonempty
len-eq(N)         len-lt(N)         len-gt(N)
between(A, B)
positive          negative
email             url               uuid
regex("pattern")
one-of(v1, v2, ...)
```

Arbitrary Boolean predicates are prohibited. Reason: if the AI is forced to write proofs, the debugging loop breaks down.

### 1.3.4 Examples

```kumiki fragment
type UserId    = nominal Text where len-eq(36)
type Email     = nominal Text where email
type Url       = nominal Text where url
type Percent   = nominal Float where between(0.0, 100.0)
type User      = {id: UserId, name: Text where nonempty, email: Email}
type HttpError = {status: Int where between(400, 599), message: Text}
type LoadResult(T) = Idle | Loading | Loaded(T) | Failed(HttpError)
```

### 1.3.5 Type Canonicalization

Structurally identical types have the same content-hash. Only `nominal` produces a new hash.

A `nominal` type is identified by **the name it is declared under**, so two declarations over one base are two types even when their bodies are identical:

```kumiki fragment
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
```

`Cents` and `Yen` do not accept each other — putting one where the other is required is [E0201](./errors.md#e0201-type-mismatch), and so is `postId := userId` on two `nominal Text where uuid` declarations. An alias to a nominal names the same type (`type Money = Cents`), and a `nominal` written inline at a use site declares no name at all, so it is compared structurally like any other type expression.

A type that carries **no nominal name of its own** meets any nominal declared over it, in both directions. That is what makes `slot c : Cents = 1` legal without a construction form, and arithmetic yields the base ([§1.9](#_1-9-expression-language)), so `c := c + 1` stands.

A nominal declared over another nominal is a **narrowing**, and goes one way only:

```kumiki fragment
type Deep = nominal Cents
```

Every `Deep` was declared a `Cents`, so a `Deep` is accepted where a `Cents` is required; a `Cents` where a `Deep` is required is [E0201](./errors.md#e0201-type-mismatch). `Int` still meets both.

Converting between two unrelated nominals goes through the base they share, and a `fn` is where that is written down — the return type documents the destination, and the body has to have **reached the base**:

```kumiki fragment
fn toYen(c: Cents, rate: Int) -> Yen = c * rate
fn toUser(p: PostId) -> UserId       = p + ""
```

The arithmetic in the first lands on `Int`; the `+ ""` in the second lands on `Text`. The identity body does not compile — `fn toUser(p: PostId) -> UserId = p` is E0201, because `p` is still a `PostId`. Nothing checks that such a `fn` converts anything; it records the intent, and the type of its body is all that is enforced.

A `where` refinement carries no identity of its own — `type Positive = Int where positive` is `Int` — and remains a runtime check ([Forms §5.6](./forms.md#_5-6-validation-strategy)) rather than a compile-time one: on `type Volume = nominal Int where between(0, 11)`, `volume := 50` is well typed, and the range is what validation decides.

---

## 1.4 Store Layer (`slot`)

### 1.4.1 Syntax

```
slot-def    ::= 'slot' identifier ':' type-expr modifier? '=' init-expr
modifier    ::= 'transient' | 'volatile'
init-expr   ::= literal | record-literal | collection-literal | builtin-call
```

| modifier | Meaning |
|---|---|
| (none) | Retained on hot reload; subject to persistence |
| `transient` | Discarded on hot reload |
| `volatile` | Not written to the episode log; discarded on hot reload |

At most one modifier: `volatile` already does everything `transient` does, so writing both says nothing `volatile` alone does not.

The initial value is required. A slot with no `=` would have to hold something before the program first writes to it, and the language has no value for that — no null, and no per-type zero.

### 1.4.2 Invariants

1. **All slots are global**
2. Mutation is **only from a reducer's `do=`**
3. The initial value is **a pure expression only** (effects cannot be executed)
4. **Derived slots are prohibited** (use the `fn` layer for derived computation)

### 1.4.3 Examples

```kumiki fragment
slot todos       : Map(TodoId, Todo)              = {}
slot filter      : Filter                         = All
slot draft       : Text where len-lt(280)         = ""
slot session     : Option(SessionId)              = None
slot password    : Text                volatile   = ""
slot toast       : Option(Toast)       transient  = None
```

---

## 1.5 Side Effect Layer (`effect`)

### 1.5.1 Syntax

```
effect-def  ::= 'effect' identifier
                'cap' '=' capability-name
                'in'  '=' type-expr
                'out' '=' type-expr
                ('policy'      '=' policy-expr)?
                ('retry'       '=' retry-expr)?
                ('map-request' '=' map-expr)?

capability-name ::= identifier ('.' identifier)+
policy-expr     ::= 'latest' | 'latest-per-key' '(' expr ')' | 'queue'
                  | 'debounce' '(' duration ')' | 'throttle' '(' duration ')'
                  | 'once'
retry-expr      ::= 'none' | 'linear' '(' int ',' duration ')'
                  | 'exponential' '(' int ',' duration ',' float ')'
duration        ::= int 'ms' | int 's' | int 'm'
map-expr        ::= record-literal       ; conversion from high-level effect → low-level form
```

### 1.5.2 Semantics

- An effect is a **value** (a pure record)
- A reducer emits it with `emit name(args)`
- Execution is performed by the **runtime's effect dispatcher**
- A **capability check** is performed before execution (if undeclared, **compile-time error**)
- The result is delivered to a reducer as `effect-name.ok($value, $key)` or `effect-name.err($error, $key)`

### 1.5.3 Examples

```kumiki fragment
effect loadUser  cap=http.get
                 in=UserId
                 out=Result(User, HttpError)
                 policy=latest-per-key($1)
                 retry=exponential(3, 200ms, 2.0)

effect persist   cap=storage.write
                 in=Map(TodoId, Todo)
                 out=Result(Unit, Text)
                 policy=debounce(300ms)
                 map-request={key: "todos", value: $1}
```

---

## 1.6 Reducer Layer (`reducer`)

### 1.6.1 Syntax

```
reducer-def ::= 'reducer' identifier
                'on' '=' event-pattern
                'do' '=' do-block

event-pattern ::= ui-event | effect-event | timer-event | lifecycle-event | route-event
ui-event      ::= 'ui' '.' ui-kind '(' selector ')'
ui-kind       ::= 'click' | 'submit' | 'change' | 'input' | 'focus' | 'blur' | 'key' | 'hover'
selector      ::= tile-ref
tile-ref      ::= identifier ('#' identifier)?    ; TileName or TileName#id
effect-event  ::= identifier '.' ('ok' | 'err') '(' bind (',' bind)* ')'
timer-event   ::= 'timer' '(' duration ')'   ; fires this reducer every intervalMs
lifecycle-event ::= 'app.start' | 'app.stop' | 'app.error'
                  | 'app.visible' | 'app.hidden' | 'app.online' | 'app.offline'
                  | 'app.http-401' | 'app.http-403' | 'app.http-5xx'
                  | 'tile.mount' '(' identifier ')'
                  | 'tile.unmount' '(' identifier ')'
route-event   ::= 'route.enter' '(' string ')'
                | 'route.leave' '(' string ')'
                | 'route.error' '(' string ')'
bind          ::= '$' identifier

do-block      ::= statement-list
statement-list ::= statement ((';' | newline) statement)*
statement     ::= assign | emit | let-stmt | if-stmt | match-stmt | for-stmt | block
assign        ::= lvalue ':=' expr
emit          ::= 'emit' identifier '(' (expr (',' expr)*)? ')'
let-stmt      ::= 'let' identifier '=' expr
if-stmt       ::= 'if' expr 'then' stmt-body ('else' stmt-body)?
match-stmt    ::= 'match' expr 'with' ('|' pattern '->' stmt-body)+
for-stmt      ::= 'for' identifier 'in' expr stmt-body
block         ::= '{' statement-list '}'
stmt-body     ::= block | statement-list   ; newline-based. Stops at `else` / `|` / `}`
lvalue        ::= path
path          ::= identifier
                | path '.' identifier        ; field path (Option/Result auto-unwrapped)
                | path '[' expr ']'          ; index/key path
```

**Forms of `stmt-body`**:
- Single statement: `if cond then x := 1 else x := 2`
- Multiple statements (block): `if cond then { x := 1; y := 2 } else x := 3`
- Multiple statements (newline): continues with newline/`;` separators until reaching `else` / `|` / `}` / EOF

In other words, you can mix one-line layout and block layout. When writing in newline-based style, you only need to insert newlines so that the following statements stop at the right position before the next keyword (such as `else`).

**Multiple subscriptions to the same event are allowed.** When two or more reducers
declare the same `on=` pattern (e.g. both subscribe to `ui.click(SubmitBtn)`), all
of them fire in definition order — see [§1.6.4](#_1-6-4-invariants) Invariant 3.

### 1.6.2 Selectors

A selector is **`TileName`** or **`TileName#id`** only (CSS attribute selectors have been removed).

```kumiki snippet
reducer add     on=ui.click(AddBtn)         do= ...
reducer toggle  on=ui.click(TodoRow)        do= ...
reducer login   on=ui.submit(form#login)    do= ... # ❌ 'form' is a built-in element, not a tile name
```

To bind events directly to built-in elements (`button`, `input`, `form`, etc.), **create a wrapper tile**:

```kumiki snippet
tile LoginForm = form(...) {id: "main"}

reducer doLogin
    on=ui.submit(LoginForm)         # reference by tile name
    do= emit login({...})
```

**`TileName#id`** narrows a subscription to dispatched elements whose `{id}` prop equals `id`. A bare `TileName` reducer still fires for every instance; an `#id`-scoped reducer fires **only** when the runtime sees a matching id. Use it to make intent explicit when several tiles wrap the same built-in element, so the wrong one cannot quietly trigger the wrong reducer:

```kumiki snippet
tile NewForm  = form(submit-text="add",  text=draft.new)  {id: "new"}
tile EditForm = form(submit-text="save", text=draft.edit) {id: "edit"}

reducer add  on=ui.submit(NewForm#new)   do= ...   # only the "new" form
reducer save on=ui.submit(EditForm#edit) do= ...   # only the "edit" form
```

The `{id}` prop is also rendered as the element's native HTML `id` attribute. Multi-reducer rules from [§1.6.4](#_1-6-4-invariants) Invariant 3 apply unchanged: a bare-`TileName` reducer and an `#id`-scoped reducer that both match the same event still run in definition order.

### 1.6.3 lvalue Semantics

An lvalue is a **path**, and you can directly mutate nested fields or the contents of an Option. The compiler expands this into an immutable update.

```kumiki snippet
# These reducer statements:
todos[id].done := true
editor.title := "New"
editor.get.body := "Body"        # via Option (compiler expands to Option.map)

# are internally expanded as:
todos := todos.update(id, $1.copy(done=true))
editor := editor.copy(title="New")
editor := editor.map($1.copy(body="Body"))
```

**Going via `.get` is safe**: assigning when the Option is `None` is a no-op (does not panic). If you want to explicitly panic, write `editor := Some(editor.get.copy(body="Body"))`. `.get` is the same polymorphic unwrap it is when read ([Standard Library §2.2.4](./stdlib.md#_2-2-4-option-t)), so a `Result` behaves alike: the write edits an `Ok` payload and skips an `Err`. Note that only the *assignment* is safe — a right-hand side that reads `editor.get` while the Option is `None` still panics.

The name is dispatched, not reserved: on a record that declares a field named `get`, `rec.get.title := v` writes that field. Both sides resolve `.get` by the same rule — a record's own field wins, otherwise it is the unwrap.

A `bind=` target reaching through `.get` is a **read** as well as a write, so it panics while the value is empty: `input(bind=draft.get.title)` with `draft = None` fails during the first render and the app does not mount. Reach such a control through a `match` on the Option, the way any other `.get` read is reached.

**`.copy(field=value, ...)`**: a shortcut for an immutable update of a record. It looks like a method call, but internally the named args are collected and expanded into `recordCopy(rec, {field: value, ...})`. You can update multiple fields at once:

```kumiki snippet
editor := editor.copy(title="New", body="Body", updatedAt=now)
issue.copy(status=Done, priority=High)
```

### 1.6.4 Invariants

1. **Pure function**: input = (slot set, event payload), output = (new slot values, emit set)
2. **Direct execution of effects is not allowed**. Only emission via `emit`
3. **Multiple reducers matching the same event run in definition order**
4. **Writing to the same lvalue path is allowed at most once within a single reducer** (path-shape granularity, E0601)
   - Duplicate detection is done by the **shape** of the path. `issues[k].status` and `issues[k].updatedAt` are different paths → can coexist
   - Writing the same shape twice is a violation: `x := 1; x := 2` ✗
   - In the **mutually exclusive branches** of `if/match`, each branch is counted independently. Writing the same shape in both the then and else is OK (at runtime only one of them runs)
   - Examples:
     - `issues[iid].status := s; issues[iid].updatedAt := now` ✓ (different field paths)
     - `if cond then x := 1 else x := 2` ✓ (mutually exclusive branches)
     - `x := 1; x := 2` ✗ (same path, sequential)
     - `if cond then x := 1 else x := 2; x := 3` ✗ (same path again after combining mutually exclusive branches)
   - Even with the same shape, different index values (`m[k1]` and `m[k2]`) cannot be statically decided, so they are treated as 1 write (the stricter side). If you want to update multiple keys, use a `for` loop
5. **Calling `fn` is allowed** (safe because it is pure)
6. **The batch commits all-or-nothing**: if any slot's new value violates its type's refinement, the entire reducer application is discarded — no slot write, no `emit`, no `stop-timer` — and the rejection is reported (see [batching](./runtime.md#a-batch-commits-all-or-nothing)). A reachable bound is the program's business: write the guard.
   - `volume := volume + 1` on `Volume = nominal Int where between(0, 11)` ✗ at 11 (rejected and reported)
   - `if volume < 11 then volume := volume + 1` ✓

### 1.6.5 Positional Binding

| Syntax | Meaning |
|---|---|
| `$1`, `$2`, ... | the bind order of an `effect-event`; within a `fn`, the argument order; **within a tile, the tile's `in=` argument** (`$1` only — a tile takes a single positional argument) |
| `$el` | the `{...}` props of the tile that fired the event |
| `$event` | the event payload |
| `$route` | the Route at route.enter / route.leave / route.error, and in a link's prefetch target — nowhere else ([Routing §3.4](./routing.md#_3-4-route-lifecycle)). Any other reducer reads the `route` slot |
| `$now` | the current time |

> **An `effect-event` trigger cannot bind these names.** The compiler declares `$el`, `$event` and `$route` in every reducer body, seeded from whatever the trigger's payload carries — so a bind that takes one of them is a second declaration of the same name, and `on=load.ok($el, _)` is **E0121**. The numbered binds stay bindable; nothing else declares one.

> **`$1` in a tile requires `in=`.** A tile may reference `$1` (e.g. `todos[$1]`) only if it declares an `in=` argument type — `tile TodoRow in=TodoId = … todos[$1] …`. Using `$1` in a tile with no `in=` is an undefined reference (**E0103**): there is no positional argument to bind. See [Examples](#_1-7-4-examples).

### 1.6.6 Examples

```kumiki fragment
reducer addTodo
    on=ui.submit(NewTodoForm)
    do= let id = TodoId.fresh()
        todos[id] := {id, text=draft, done=false, createdAt=now}
        draft := ""
        emit persist(todos)

reducer toggle
    on=ui.click(TodoRow)
    do= todos[$el.todoId].done := not todos[$el.todoId].done
        emit persist(todos)

reducer loaded
    on=loadUser.ok($user, $id)
    do= users[$id] := Loaded($user)

reducer editTitle
    on=ui.input(TitleInput)
    do= editor.get.title := $event.value
```

---

## 1.7 View Layer (`tile`)

### 1.7.1 Syntax

```
tile-def     ::= 'tile' identifier
                 ('in' '=' type-expr)?
                 ('sub-routes' '=' route-map)?
                 ('error-boundary' '=' identifier)?
                 ('scroll-restoration' '=' bool)?
                 '=' tile-expr

tile-expr    ::= tile-call
               | match-expr
               | control-flow

tile-call    ::= identifier '(' (tile-arg (',' tile-arg)*)? ')' ('{' prop (',' prop)* '}')?
tile-arg     ::= (identifier '=')? expr
prop         ::= identifier ':' expr

control-flow ::= when-expr | for-expr | if-expr
when-expr    ::= 'when' '(' expr ',' tile-expr ')'
for-expr     ::= 'for' identifier 'in' expr tile-expr
if-expr      ::= 'if' expr 'then' tile-expr 'else' tile-expr

match-expr   ::= 'match' expr 'with' match-arm+
match-arm    ::= '|' pattern '->' tile-expr
pattern      ::= identifier
               | identifier '(' bind (',' bind)* ')'
               | '_'
```

**`( … )` vs `{ … }` — arguments/children vs props**:
- `( … )` is the **argument & children list**: positional child tiles (`column(A, B)`), value arguments (`heading("Hi")`), and named arguments (`button(text="Save", onClick=r)`, `input(bind=draft)`). A child tile or another tile call goes **here**.
- `{ … }` is the **props block**: `key: value` pairs only — style/layout/ARIA props and event-handler bindings (`{pad: "lg", gap: "md"}`, `{todoId: $1}`, `{onClick: r}`). It contains **no tile calls and no children**. Writing a tile call inside `{ … }` (e.g. `link(to="/x") {text("Home")}`) is a parse error.
- A tile's **label/content** is passed in `( … )`: it is a positional value-arg for the text builtins (`text("Home")`, `heading("Hi")`, `code("…")`) and a **named** arg for the interactive builtins (`button(text="Save")`, `link(to="/x", text="Home")`). The canonical place for a label is the `text=` **argument**, consistent across `button` and `link`. (`link` additionally accepts the older `{text: "…"}` prop form, which most existing examples use; both compile to the same node.)

**Semantics of `when(cond, tile)`**:
- `cond` is true → render `tile`
- `cond` is false → **omit that child from the tree** (no effect on siblings)
- If the parent tile is `column(A, when(c, B), C)`, then with `c=false`, `[A, C]` is rendered
- Because the runtime skips null/undefined children, `when` is a safe way to produce a "blank"

**Value context vs tile context for `match`**:
- A `match` **within the positional arguments** of the `text/heading/markdown/label/link/image/icon` builtins is treated as a value expression (`MatchExpr`). Each arm returns a value (Text, Int, etc.)
- A `match` within any other tile argument (`column`, `row`, `card`, etc.) is treated as a tile expression (`TileMatch`). Each arm returns a tile
- Example: `text(match m with | A -> "a" | B -> "b")` ← value match
- Example: `column(match xs with | Loaded(ys) -> ... | None -> spinner())` ← tile match

### 1.7.2 Invariants

1. **Pure function**: input = (slot set, in argument), output = UI tree
2. Slot writes are not allowed
3. Effect emit is not allowed
4. **Direct recursion is prohibited**. Mutual recursion only when depth can be proven at the type level
5. The iteration target of `for` is only `Map.keys`, `Set.to-list`, or `List`
6. Within the value expressions of tile properties `{...}`, **reading slots is allowed** (for the purpose of fixed capture of event-handler arguments)
7. **Calling `fn` is allowed**

### 1.7.3 Event Handler props

An event handler **takes a reducer name**:

```kumiki snippet
button(text="Save", onClick=saveTodo) {todoId: $1}
```

With `onClick=saveTodo`, the reducer `saveTodo` is called on click. `{todoId: $1}` is delivered to the reducer as `$el.todoId`.

### 1.7.4 Examples

A tile that takes a positional argument declares its type with `in=` and reads
the argument as `$1`. **`$1` is available only when `in=` is declared** — using
`$1` in a tile with no `in=` is an undefined reference (E0103). Callers pass the
argument positionally: `TodoRow(id)`.

```kumiki fragment
tile TodoRow  in=TodoId
              = row(
                  check(value=todos[$1].done, onClick=toggle) {todoId: $1},
                  text(todos[$1].text) {strike: todos[$1].done},
                  button(text="x", onClick=remove) {todoId: $1})

tile TodoList = column(
                  for id in todos.keys
                    when(matchFilter(todos[id], filter),
                      TodoRow(id) {key: id.show}))

tile App      = page(
                  heading("Todos"),
                  NewTodoForm,
                  TodoList,
                  text(itemsLeft.show + " items left"))
```

---

## 1.8 Function Layer (`fn`)

### 1.8.1 Purpose

To reuse pure auxiliary computations under a name. Callable from tile / reducer / other fn.

### 1.8.2 Syntax

```
fn-def      ::= 'fn' identifier
                '(' (fn-param (',' fn-param)*)? ')'
                ('->' type-expr)?               ; return type (inferred if omitted)
                '=' expr

fn-param    ::= identifier ':' type-expr
```

### 1.8.3 Invariants

1. **Pure function**: input = arguments only, output = value only
2. **Reading/writing slots is prohibited** (receive them via `fn` arguments)
3. **Effect emit is prohibited**
4. **lvalue not allowed** (no assignment)
5. **Calling other fn is allowed**, **direct recursion is prohibited**, mutual recursion only when depth can be proven at the type level

### 1.8.4 Examples

```kumiki fragment
fn matchFilter(t: Todo, f: Filter) -> Bool
   = match f with
       | All     -> true
       | Active  -> not t.done
       | Done    -> t.done

fn itemsLeft(ts: Map(TodoId, Todo)) -> Int
   = ts.filter(not $2.done).size

fn visiblePosts(posts: Map(PostId, LoadResult(Post)), tag: Option(Text)) -> List(PostId)
   = posts.entries
          .filter(matchPostTag($2, tag))
          .sort-by(loadedAt($2))
          .map($1)

fn matchPostTag(lr: LoadResult(Post), tag: Option(Text)) -> Bool
   = match (lr, tag) with
       | (Loaded(p), Some(t)) -> p.tags.find($1 == t).is-some
       | (Loaded(_), None)    -> true
       | _                    -> false
```

### 1.8.5 Calling from tile / reducer

```kumiki fragment
tile TodoList = column(
                  for id in todos.keys
                    when(matchFilter(todos[id], filter), TodoRow(id)))

tile Counter  = text("Left: " + itemsLeft(todos).show)

reducer normalize
    on=ui.click(NormalizeBtn)
    do= todos := normalizeAll(todos)

fn normalizeAll(ts: Map(TodoId, Todo)) -> Map(TodoId, Todo)
   = ts.map($2.copy(text=$2.text.trim))
```

### 1.8.6 Partial Application and Higher-Order Functions

Since there are no lambdas, passing higher-order functions uses either a "fn name" or an "expression fragment":

```kumiki snippet
items.map(double)         # registered fn name
items.map($1 * 2)         # expression fragment ($1 is the element)
items.filter(matchFilter($1, filter))  # embed a fn call in an expression fragment
```

Partial application is **written explicitly** (no currying):

```kumiki snippet
fn isActiveOnly(t: Todo) -> Bool = matchFilter(t, Active)
items.filter(isActiveOnly)
```

---

## 1.9 Expression Language

The common expressions used in the right-hand side of a reducer's `do=`, inside a tile, and in the body of a fn.

```
expr        ::= literal
              | qname                          ; slot, let-binding, fn-arg, builtin reference
              | expr '.' identifier            ; field access
              | expr '[' expr ']'              ; index
              | expr binop expr
              | unop expr
              | 'if' expr 'then' expr 'else' expr
              | 'match' expr 'with' match-arm+
              | 'let' identifier '=' expr 'in' expr
              | call
              | record-lit
              | collection-lit
              | '(' expr ')'

call        ::= qname '(' (expr (',' expr)*)? ')'
record-lit  ::= '{' (field-init (',' field-init)*)? '}'
field-init  ::= identifier '=' expr | identifier
collection-lit ::= '[' (expr (',' expr)*)? ']'
                 | '{' (entry (',' entry)*)? '}'
entry       ::= expr ':' expr

match-arm   ::= '|' pattern '->' expr
pattern     ::= identifier                            ; a union variant, or a binding name
              | identifier '(' bind (',' bind)* ')'   ; variant with payload binds
              | '(' pattern (',' pattern)* ')'        ; tuple
              | '_'                                   ; wildcard

binop       ::= '+' | '-' | '*' | '/' | '%'
              | '==' | '!=' | '<' | '>' | '<=' | '>='
              | '&' | '|'
unop        ::= '-' | '!'
```

### 1.9.1 Prohibitions

- **Lambda expressions prohibited**
- **`try/catch` prohibited**
- **`null` / `undefined` prohibited**
- **`while` loops prohibited**
- **Assignment expressions prohibited** (`:=` is a statement and cannot be used within an expression)
- **Literal patterns prohibited.** A `match` pattern is a union variant, `Variant(binds)`, a tuple, or `_` — **only**. Patterns matching against a literal value (`match s with | "Overdue" -> … | "Today" -> …`, or numeric/bool literals) are **not supported** and fail to parse. `match` is for destructuring a *union/variant*, not for branching on a `Text`/`Int`/`Bool` value. To branch on a value, use `if/else` (or chained `if`), or model the cases as a union type and match on that:

```kumiki snippet
# ❌ literal patterns — not supported
match label with | "Overdue" -> red | "Today" -> amber | _ -> gray

# ✅ branch on a value with if/else
if label == "Overdue" then red else if label == "Today" then amber else gray

# ✅ or lift the cases into a union and match the variant
type Urgency = Overdue | Today | Later
match urgency with | Overdue -> red | Today -> amber | Later -> gray
```

### 1.9.2 Alternatives to Higher-Order Functions

```kumiki snippet
items.map($1 * 2)                          # expression fragment
items.map(formatPrice)                     # fn name
items.filter(matchFilter($1, filter))      # fn call
items.fold(0, $1 + $2.price)               # ($1: acc, $2: elem)
```

### 1.9.3 Short-Circuit Evaluation

`&` and `|` use short-circuit evaluation.

### 1.9.4 Operator Types

Every operator's operand and result types, which the compiler checks
([E0201](./errors.md#e0201-type-mismatch)):

| Operator | Operands | Result |
|---|---|---|
| `+` | `Text` on either side | `Text` — concatenation; the other side is stringified |
| `+` `-` `*` `%` | both numeric | `Float` if either operand is `Float`, else `Int` |
| `/` | both numeric | **`Float`, always** |
| `<` `>` `<=` `>=` | both numeric, both `Text`, or both `Time` | `Bool` |
| `&` `\|` | both `Bool` | `Bool` |
| `==` `!=` | any two values | `Bool` |
| unary `-` | numeric | the operand's type |
| unary `!` | `Bool` | `Bool` |

`/` is `Float` even between two `Int`s. It is JavaScript's `/` at runtime — `5 / 2`
is `2.5`, not `2` — so an `Int` result type would be a promise the runtime does not
keep, and `fn half(x: Int) -> Int = x / 2` is rejected. Take `.to-int` (truncating,
[stdlib §2.2.7](./stdlib.md#_2-2-7-int-float)) where a whole number is wanted, or
declare the `Float`.

`EffectId` is outside this table: only `==` and `!=` apply to it
([E0204](./errors.md#e0204-effect-id-misuse)).

---

## 1.10 Namespaces and Reference Resolution

- **A flat global namespace**
- A separate namespace per layer
- References are **written by name** and resolved to a content-hash when stored in the CRDT graph
- Rename = a CRDT op that creates a different hash under the new name and updates references

→ [AI Editing](./ai-edit.md)

---

## 1.11 content-hash Computation

```
hash(def) = blake3(
    canonical(def.body)
  ⊕ hash(direct-dependency-1)
  ⊕ hash(direct-dependency-2)
  ⊕ ...
)
```

---

## 1.12 Application Entry (`app`)

```
app-def    ::= 'app' identifier
               'caps'   '=' '[' (capability-name (',' capability-name)*)? ']'
               'routes' '=' route-map
               ('init'  '=' '[' emit-list ']')?
               ('theme' '=' identifier)?
               ('http'  '=' http-config)?
               ('meta'  '=' meta-config)?
               ('indexed-db' '=' idb-config)?
               ('analytics'  '=' analytics-config)?

route-map  ::= '{' route-entry (',' route-entry)* '}'
route-entry ::= string '->' identifier        ; to a tile name
              | string '->>' string           ; static redirect
emit-list  ::= effect-call (',' effect-call)*
```

→ [Routing](./routing.md), [HTTP / Storage](./http.md)

```kumiki fragment
app TodoApp
    caps   = [storage.read, storage.write, http.get]
    routes = {"/" -> TodoList, "/todo/:id" -> TodoDetail, "/404" -> NotFound}
    init   = [loadTodos()]
    theme  = DefaultTheme
```

### 1.12.1 When `init` arguments are evaluated

An `init` entry is an effect call, and its arguments are ordinary expressions — a slot reference included. They are evaluated **once**, when the app object is constructed, and the resulting values are never re-read: a later change to a slot is not reflected in an argument already captured.

What a slot reference sees at that moment is its **declared default**. `route` is the exception — it is maintained by the runtime and does not exist yet, so `init = [load(route.path)]` is a compile error ([E0120](./errors.md#e0120-route-in-app-init)), as is `$route`, which the runtime does not bind here either. Take the route from a `route.enter` reducer instead.

`now` is available and is captured the same way: it evaluates to the moment the app object was built, not to the moment the effect runs. An entry that needs the time of its own dispatch should take it in the reducer that handles the result.

There is no reducer around these arguments either, so an `emit` expression is not available in one ([E0305](./errors.md#e0305-fn-impurity)): the entry itself is the dispatch.

---

## 1.13 Counterexamples

```kumiki snippet
# ❌ local state
tile Foo = let x = 0 in button(text=x.show)   # assignment inside a tile is not allowed (let binds an expression, but is not a substitute for a slot)

# ❌ direct effect call
reducer r on=ui.click(B) do= http.get("/")   # emit required

# ❌ lambda
button(onClick=(() -> count + 1))            # not allowed, only a reducer name

# ❌ null
type User = {name: Text | null}              # use Option(Text)

# ❌ arbitrary predicate
type Even = Int where ($1 % 2 == 0)          # registered predicates only

# ❌ reading a slot inside a fn
fn current() = todos                          # receive it via a fn argument

# ❌ CSS attribute selector
reducer r on=ui.change(input[type=file]) do= ...   # write it by tile name

# ❌ literal match pattern
match status with | "open" -> ... | "closed" -> ...   # patterns are variant/_ only; use if/else or a union (Prohibitions)

# ❌ $1 in a tile with no in=
tile Row = card(text(issues[$1].title))               # E0103: declare `tile Row in=IssueId = …` (Positional Binding / Examples)

# ❌ a tile call inside the props block
link(to="/x") {text("Home")}                           # `{...}` is key:value props only; pass the label as text="Home" (Syntax)
```

---

## 1.14 Complete Example: Counter

```kumiki
type N      = nominal Int where between(0, 999)
slot count  : N    = 0

reducer inc   on=ui.click(IncBtn)   do= if count < 999 then count := count + 1
reducer dec   on=ui.click(DecBtn)   do= if count > 0   then count := count - 1
reducer reset on=ui.click(ResetBtn) do= count := 0

tile IncBtn   = button(text="+")
tile DecBtn   = button(text="-")
tile ResetBtn = button(text="reset")

tile App = column(
             heading("Count: " + count.show),
             row(DecBtn, ResetBtn, IncBtn) {gap: "sm"})

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

→ [Standard Library](./stdlib.md), [Routing](./routing.md), [apps/01-counter](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/01-counter/app.kumiki)
