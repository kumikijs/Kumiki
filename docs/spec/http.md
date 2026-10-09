# HTTP / Storage Effects

All interaction with the outside world is done via **effects**. This section describes the detailed specification of the effects provided by the standard library.

## 6.1 HTTP Common

### 6.1.1 capability

| capability | Corresponding HTTP method |
|---|---|
| `http.get` | GET |
| `http.post` | POST |
| `http.put` | PUT |
| `http.patch` | PATCH |
| `http.delete` | DELETE |

### 6.1.2 Standard effect

A program declares its own effect against the capability. The shape below is the one the toolchain expects for each method — the name is yours, the `cap` and the record are what the runtime dispatches on:

```kumiki fragment
effect http-get cap=http.get
                in={
                  url: Url,
                  headers: Map(Text, Text),
                  query: Map(Text, Text),
                  decode: Decoder
                }
                out=Result(Decoded, HttpError)

effect http-post cap=http.post
                 in={
                   url: Url,
                   headers: Map(Text, Text),
                   query: Map(Text, Text),
                   body: HttpBody,
                   decode: Decoder
                 }
                 out=Result(Decoded, HttpError)

# put / patch / delete have the same shape
```

`query` is sent as the URL's query string, by every `http.*` method alike (get, post, put, patch and delete): each entry is URL-encoded (`URLSearchParams`, so a space becomes `+` and an `&` inside a value is escaped) and appended to `url`, after any query string `url` already carries and before a fragment. An empty `query` leaves `url` as written. The order of the entries in the query string is not guaranteed; do not rely on it.

`http.get` and the like **cannot be used unless declared** (capability guard). They must be enumerated in `app.caps`.

### 6.1.3 The HttpBody Type

```kumiki fragment
type HttpBody = Json(JsonValue)
              | Form(Map(Text, Text))
              | Multipart(Map(Text, FormValue))
              | Text(Text)
              | Bytes(Bytes)
              | Empty
```

Each variant is sent as what it names:

| variant | request body |
|---|---|
| `Json(v)` | `v` as JSON; `Json` of `Unit` is `null` |
| `Form(m)` | `m` URL-encoded (`a=1&b=2`) |
| `Multipart(m)` | a `FormData` of `m`; a `FileV` entry is sent as the file, and a `FileV` that holds no file (a file record restored from persistence) fails the effect with `HttpError{status: 0}` before any request |
| `Text(t)` | `t` as-is |
| `Bytes(b)` | the bytes of `b` |
| `Empty` | no body |

A `body` that is not an `HttpBody` variant (a record, a list, a bare `Text`) is sent as JSON, as `Json` would send it: `body: $1` with a `Text` input sends `"x"`, not `x`. To send raw text, write `Text($1)`.

`GET` and `HEAD` send no body, whatever `body` holds.

### 6.1.4 The Decoder Type

```kumiki snippet
Decoder.Json(User)   # decode the JSON body into a type
Decoder.Text         # keep it as a string
Decoder.Bytes        # keep it as a byte sequence
Decoder.None         # discard the response body
```

Response decoding is type-safe at compile time; at runtime the JSON syntax is checked, and so is every predicate the declared type carries. A 2xx body that does not parse as JSON is an `HttpError` with the response's own `status`, a `message` that starts with `decode failed:`, and the response text in `body`. A response arrived, so it is not a connection error (`status: 0`) and it is not retried ([6.5](#_6-5-retry)). A 2xx with no body (such as 204) needs `Decoder.None`; otherwise the default decoder reports `decode failed:` with that status.

The decoded value is also checked against `T`: every predicate `T` carries, at every position it is written at — the check a write to a slot of type `T` gets ([§10.3.3](./runtime.md#_10-3-3-batching)). A value it refuses is the same `HttpError`, with a `message` that names the predicate and where the value failed it (`decode failed: uuid at .id`). Only the predicates are checked: a position where `T` carries none is taken as it arrives, so a body that parses but does not match the declared shape is not detected at runtime. A host provider registered for a read capability (`http.*`, `storage.read`, `session.read`, `indexed.read`; [Standard Library §2.5](./stdlib.md#_2-5-standard-capabilities)) receives this check as the request's `decode`, a function: given the parsed value it returns `undefined` when `T` accepts it and the failed predicate (`{kind, args, path}`) when `T` refuses it. For a `T` that carries no predicate, `decode` is the string `"json"`.

### 6.1.5 Common props (auto-applied)

All HTTP effects automatically apply the following:

- `Accept: application/json` (when the Decoder is Json)
- `Content-Type: application/json` (when the HttpBody is Json, or the body is not an HttpBody variant)
- `Content-Type: application/x-www-form-urlencoded` (when Form)
- `Content-Type: multipart/form-data` (when Multipart; written by fetch itself, so that it carries the boundary)
- `User-Agent: Kumiki`

User-specified headers take precedence: `app.http.headers` over the defaults above, and the effect's own `headers` over `app.http.headers`. A header name is compared case-insensitively at every step, so an effect's `content-type` replaces a global `Content-Type` and exactly one value is sent.

The one exception is `Multipart`: a `Content-Type` the program sets on it is dropped, because the header must carry the boundary that only fetch knows. `multipart/form-data` without that boundary cannot be parsed by the server.

---

## 6.2 HTTP Usage Examples

### 6.2.1 GET

```kumiki fragment
type UserId = nominal Text where uuid
type User   = {id: UserId, name: Text, email: Email}

slot users     : Map(UserId, LoadResult(User)) = {}
slot apiBase   : Url                           = "https://api.example.com"

effect loadUser cap=http.get
                in=UserId
                out=Result(User, HttpError)
                policy=latest-per-key($1)
                retry=exponential(3, 200ms, 2.0)

reducer fetchUser
    on=ui.click(LoadBtn)
    do= users[$el.userId] := Loading
        emit loadUser($el.userId)
```

At implementation time, the Kumiki compiler expands `loadUser` into the following:

```kumiki snippet
emit http-get({
    url:     apiBase + "/users/" + $1.show,
    headers: {},
    query:   {},
    decode:  Decoder.Json(User)
})
```

→ A high-level effect name (`loadUser`) **cannot** embed a URL template. For the templating mechanism, see [6.6 High-Level Wrappers](#_6-6-high-level-wrappers) separately.

### 6.2.2 POST

```kumiki fragment
effect createTodo cap=http.post
                  in={text: Text}
                  out=Result(Todo, HttpError)
                  policy=queue

tile NewTodoForm = form(input(bind=draft))

reducer add
    on=ui.submit(NewTodoForm)
    do= emit createTodo({text: draft})
        draft := ""

reducer added
    on=createTodo.ok($todo, _)
    do= todos[$todo.id] := $todo
```

---

## 6.3 Authentication

### 6.3.1 Injecting Global Headers

In `app.http` you can declare headers that are automatically applied to all HTTP effects:

```kumiki fragment
app App
    caps   = [http.get, http.post, storage.read]
    routes = {"/" -> Home, "/404" -> NotFound}
    init   = [loadSession()]
    http   = {
        base-url: "https://api.example.com",
        headers: {
            "Authorization": fmt("Bearer {0}", session.get-or("anon"))
        },
        on-401: handleUnauthorized
    }
```

| http field | Meaning | Evaluated |
|---|---|---|
| `base-url` | Base for relative URLs — a `Text` or a type built on `Text` (`Url`, `Email`, `Uuid`, …) | per request |
| `headers` | Applied to all requests — a `Map(Text, Text)`, the type of a request's own `headers` | per request |
| `timeout` | Default timeout in milliseconds — anything assignable to `Int`: an `Int`, a `Duration`, a user `nominal Int` | per request |
| `credentials` | fetch credentials mode (default in [§6.9](#_6-9-default-settings)) — a `Text`, one of `omit` / `same-origin` / `include` | per request |
| `on-401` | Reducer that receives a 401 (resolved by the compiler — an unknown name is [E0102](./errors.md#e0102-undef-reducer)) | resolved at compile time |
| `on-403` | Reducer that receives a 403 (same) | resolved at compile time |
| `on-5xx` | Reducer that receives a 5xx (same) | resolved at compile time |

Every field that takes a value takes an **expression**, and may read a slot. All
four are evaluated **when a request is made**, not when the app is built: a
reducer that writes the slot changes what the next request is made with, and
nothing has to be remounted for it to take effect. So `base-url: endpoint`
switches host the moment `endpoint` is assigned, and
`headers: {"Authorization": fmt("Bearer {0}", session.get-or("anon"))}` carries
the session that is current at the request rather than the one that was current
at mount.

The three reducer names are the exception, and are not values at all: they are
resolved once, by the compiler, against the `reducer` definitions.

What is checked in the four expressions is the names and the values. A name
that resolves to nothing is [E0103](./errors.md#e0103-undef-ref-undef-slot), reported where it is
written. A value of the wrong type is [E0201](./errors.md#e0201-type-mismatch), reported at the
field unless a bullet below says otherwise:

- `base-url` takes anything assignable to `Text` — a type built on `Text`,
  such as `Url`, included.
- `headers` takes anything assignable to `Map(Text, Text)`, the type of a
  request's own `headers` ([§6.1.2](#_6-1-2-standard-effect)): a literal
  `{"Name": value}` whose every value is a `Text`, or any other expression of
  that type — a slot, a `fn` call. A key or value in the literal that is not a
  `Text` is reported where it is written, and anything that is not a map at the
  field, or at the `if` branch that yields it. The keys are quoted:
  `{Content-Type: "application/json"}` with bare keys is a record, not a map,
  and is E0201 at the field. The runtime spreads the value into each request's
  headers: a number spreads to nothing and a string to headers named `0`, `1`,
  … — either way not one intended header reaches the request.
- `timeout` takes anything assignable to `Int`, read as milliseconds. A
  `Duration` is one (it is milliseconds at run time), and so is a user
  `nominal Int`; a `Float` is not. A `Text` would reach `setTimeout` as `NaN`
  and abort every request before it can answer.
- `credentials` takes anything assignable to `Text`, and every literal that
  reaches the field — the field's own value, or a literal branch of an `if` —
  must be one of the three Fetch modes, since a browser refuses a request whose
  init names any other.

What is compared is the type, and for `credentials` the literals: a value
computed any other way — a slot, a call, a concatenation — is decided at run
time, so one of the right type is accepted whatever it will hold. `timeout: 0`
and a negative `Int` are an `Int`, and are accepted too.

### 6.3.2 Global Handling of 401

```kumiki fragment
reducer handleUnauthorized
    on=app.http-401
    do= session := None
        emit navigate({path: "/login", params: {}, query: {}})
```

`app.http-401` is **automatically routed** to the reducer specified by `app.http.on-401`.

---

## 6.4 Cancellation

It is automatically canceled by `policy=latest` or `policy=latest-per-key(...)`. Manual cancellation is:

```kumiki fragment
slot searchEffectId : EffectId = EffectId.none

effect cancel cap=http.cancel in=EffectId out=Unit

reducer startSearch
    on=ui.input(SearchBox)
    do= let id = emit fetchResults(query)
        searchEffectId := id

reducer cancelSearch
    on=ui.click(CancelBtn)
    do= emit cancel(searchEffectId)
        searchEffectId := EffectId.none
```

`emit` used as an expression returns the dispatched effect's `EffectId` (see [stdlib §2.1.1.1](./stdlib.md#_2-1-1-1-effectid)). The `EffectId.none` sentinel makes `emit cancel(EffectId.none)` a safe no-op.

The id is `<effect-name>:<key>`. `<key>` is `_` unless the effect declares `policy=latest-per-key(<expr>)`, and then it is that expression, **evaluated once, where the `emit` runs**: a slot it reads has the value the reducer body has written up to that statement, and a write later in the same body is not seen. The dispatcher runs the request under that same key, so the id an `emit` yields names the request it started even when the body goes on to write the slot the key reads. An `app.init` entry is emitted outside any reducer body; its key is evaluated when it is dispatched, against the slots' values at that moment. The key is written the way a Map key is stored ([stdlib §2.2.2](./stdlib.md#_2-2-2-set-t)) — a `Text` as itself, a record, tuple, `List` or variant as its JSON with each record's fields in sorted order — so two emits share an id exactly when their keys are `==`, and a key type for which that does not hold is [E0233](./errors.md#e0233-policy-key-type) ([language §1.5.2](./language.md#_1-5-2-semantics)).

An `effect ... cap=http.cancel` must declare `in=EffectId out=Unit`; any other shape is rejected at compile time ([E0303](./errors.md#e0303-invalid-cancel-target)).

### 6.4.1 Behavior

- A cancel against an unknown / already-completed `EffectId` is a silent no-op (cancellation is an idempotent intent, not a contract violation).
- The cancelled effect's `.err` reducer fires with `{status: 0, message: "aborted", body: ""}` so the same `HttpError`-shaped path covers both abort and network failure. This normalization also applies to the automatic cancellations triggered by `policy=latest` / `policy=latest-per-key`. `status: 0` means no HTTP response arrived — the same value a timeout and a network failure report — and it is a value of `HttpStatus`, which admits it ([stdlib §2.1.3](./stdlib.md#_2-1-3-domain-types-provided-by-the-standard-library)), so a slot holding the `HttpError` accepts it.
- A `debounce` timer scheduled for the same effect is cleared by cancel, so a pending-but-not-yet-issued request never lands.
- A `throttle` window marker is **left intact** by cancel — the original effect has already launched (cancel aborts that in-flight request), and clearing the marker would let an immediate next emit slip past the rate limit before the window closes.

---

## 6.5 Retry

```kumiki fragment
effect loadCritical cap=http.get
                    in=Text
                    out=Result(Text, HttpError)
                    retry=exponential(5, 500ms, 2.0)
```

| retry | Behavior |
|---|---|
| `none` | Do not retry (default) |
| `linear(N, ms)` | Up to N times, retried at ms intervals |
| `exponential(N, initial-ms, factor)` | Up to N times, initial-ms the first time, multiplied by factor each time |

Retries only target **5xx and connection errors**. 4xx is not retried (by specification), and neither is a 2xx whose body does not parse as JSON or whose value `T` refuses ([6.1.4](#_6-1-4-the-decoder-type)): the server already accepted the request, so a retry would duplicate its effect.

---

## 6.6 High-Level Wrappers

When you want to write URL templates or path parameters, the user declares a wrapper effect:

```kumiki fragment
slot apiBase : Url = "https://api.example.com"

effect loadUser cap=http.get
                in=UserId
                out=Result(User, HttpError)
                policy=latest-per-key($1)
                map-request={
                    url: apiBase + "/users/" + $1.show,
                    headers: {},
                    query: {},
                    decode: Decoder.Json(User)
                }
```

`map-request` is a pure function (expression fragment) that transforms into the input of the built-in effect. This **concentrates in one place** the relationship between the high-level effect name and the actual HTTP request.

---

## 6.7 Storage Effects

**The err value is the declared `Text`.** Every effect on the capabilities below declares `out=Result(T, Text)`; one that declares another `E` is **E0306**. A failed effect delivers the failure's message as a plain `Text` — `"SecurityError: …"` when a read finds the backend blocked, the message naming the call and the key when a write does (§6.7.2), `"app.indexed-db is not declared"` when an `indexed-*` effect runs without one — not a record wrapping it. A throw from the effect's `map-request`, from a host provider registered for the capability, or from the built-in handler is delivered as the same `Text`, and is delivered once: `retry=` ([6.5](#_6-5-retry)) does not retry it. So `.err($e, _)` binds `$e : Text` ([Positional Binding](./language.md#_1-6-5-positional-binding)): `problem := $e` stores the message, and `$e.message` is E0108. What a host provider's err value becomes is in [Standard Capabilities](./stdlib.md#_2-5-standard-capabilities).

### 6.7.1 capability

| capability | Corresponds to |
|---|---|
| `storage.read`, `storage.write` | localStorage |
| `session.read`, `session.write` | sessionStorage |
| `indexed.read`, `indexed.write`, `indexed.delete` | IndexedDB |

### 6.7.2 The declarations (localStorage)

```kumiki fragment
effect storage-read   cap=storage.read
                      in={key: Text, decode: Decoder}
                      out=Result(Option(Decoded), Text)

effect storage-write  cap=storage.write
                      in={key: Text, value: JsonValue}
                      out=Result(Unit, Text)

effect storage-remove cap=storage.write
                      in={key: Text}
                      out=Result(Unit, Text)

effect storage-clear  cap=storage.write
                      in=Unit
                      out=Result(Unit, Text)
```

A clear is decided by the declaration: an effect declared `in=Unit` (directly or through an alias) with no `map-request` empties the storage, and the storage is the **whole origin's** localStorage, not only the keys this app wrote. Every other `storage.write` is a write or a remove, told apart by the request (the effect's input, or what `map-request` builds): a record with a `key` and no `value` field removes that key (a later `storage-read` answers `Ok(None)`), and a record with a `value` field writes it. The value itself does not matter: `None`, `[]` and a record are all written.

A request that is none of these is `err` and changes nothing: one that is not a record (an empty request included), a `key` that is not a non-empty `Text`, or a `value` that JSON cannot encode. A failed Web Storage call (quota, `SecurityError`) is also `err`, and its message names the call and the key. A host provider for `storage.write` ([§2.5](./stdlib.md#_2-5-standard-capabilities)) receives the request as the effect's input or `map-request` built it, and receives no request for a clear.

A stored value is always parsed as JSON. When the read's `Decoder.Json(T)` refuses what it parsed, checked as [6.1.4](#_6-1-4-the-decoder-type) checks a response, the read is `.err` with a `Text` starting `decode failed:`, as it is for a value that does not parse. So storage that an older build wrote, or that was edited by hand, and that the type now refuses reaches the program as a failure its `.err` reducer handles. It is not an `.ok` whose writes the reducer's batch then refuses ([§10.3.3](./runtime.md#_10-3-3-batching)), which would leave an app that ends its loading state in that reducer on the loading screen.

**The err value is the declared `Text`.** A storage / session / indexed effect that fails delivers the failure's message as a plain `Text` — `"SecurityError: …"` when a read finds the backend blocked, the message naming the call and the key when a write does, `"app.indexed-db is not declared"` when an `indexed-*` effect runs without one — not a record wrapping it. A throw from the effect's `map-request`, or from a host provider registered for the capability, is delivered as the same `Text`. So `.err($e, _)` binds `$e : Text` ([Positional Binding](./language.md#_1-6-5-positional-binding)): `problem := $e` stores the message, and `$e.message` is E0108.

### 6.7.3 Example

```kumiki snippet
slot todos : Map(TodoId, Todo) = {}

effect saveTodos cap=storage.write
                 in=Map(TodoId, Todo)
                 out=Result(Unit, Text)
                 policy=debounce(300ms)
                 map-request={key: "todos", value: $1}

effect loadTodos cap=storage.read
                 in=Unit
                 out=Result(Option(Map(TodoId, Todo)), Text)
                 policy=once
                 map-request={key: "todos", decode: Decoder.Json(Map(TodoId, Todo))}

reducer boot
    on=app.start
    do= emit loadTodos()

reducer todosLoaded
    on=loadTodos.ok($maybeMap, _)
    do= todos := $maybeMap.get-or({})

reducer onChange
    on=ui.click(TodoRow)
    do= ...
        emit saveTodos(todos)
```

### 6.7.4 sessionStorage / IndexedDB

`session-*` has the same shape. `indexed-*` is the same except that the key specification becomes `{store: Text, key: Text}`. A refused `Decoder.Json(T)` is `.err` on `session-read` and `indexed-read` as on `storage-read`; IndexedDB holds structured values, so nothing is parsed there, but the check still runs.

```kumiki fragment
effect indexed-read cap=indexed.read
                    in={store: Text, key: Text, decode: Decoder}
                    out=Result(Option(Decoded), Text)

effect indexed-write cap=indexed.write
                     in={store: Text, key: Text, value: JsonValue}
                     out=Result(Unit, Text)

effect indexed-query cap=indexed.read
                     in={store: Text, index: Option(Text), range: Option(IndexRange)}
                     out=Result(List(JsonValue), Text)
```

The IndexedDB `store` is declared via `app.indexed-db`:

```kumiki snippet
app App
    ...
    indexed-db = {
        name: "myapp",
        version: 1,
        stores: [
            {name: "todos", key: "id"},
            {name: "drafts", key: "id", indexes: ["createdAt"]}
        ]
    }
```

---

## 6.8 Persistence Patterns

### 6.8.1 Load on Startup

```kumiki fragment
reducer boot on=app.start do= emit loadAll()
reducer loaded on=loadAll.ok($data, _) do= state := $data
```

### 6.8.2 Save Changes with debounce

```kumiki fragment
effect save cap=storage.write
            in=Map(TodoId, Todo)
            out=Result(Unit, Text)
            map-request={key: "todos", value: $1}
            policy=debounce(300ms)

reducer afterChange
    on=ui.click(TodoRow)
    do= todos[$el.id].done := not todos[$el.id].done
        emit save(todos)
```

### 6.8.3 Optimistic Update + Server Sync

```kumiki fragment
reducer addOptimistic
    on=ui.submit(NewTodoForm)
    do= let id = TodoId.fresh()
        todos[id] := {id, text=draft, done=false, pending=true}
        draft := ""
        emit createOnServer({text: draft, clientId: id.show})

reducer addOk
    on=createOnServer.ok($serverTodo, $clientId)
    do= todos := todos.remove(TodoId.parse($clientId).get-or(""))
        todos[$serverTodo.id] := $serverTodo

reducer addErr
    on=createOnServer.err($e, $clientId)
    do= todos := todos.remove(TodoId.parse($clientId).get-or(""))
        emit toast({kind: "error", text: "Failed to save"})
```

---

## 6.9 Default Settings

Defaults for all HTTP effects:

| Setting | Value |
|---|---|
| `timeout` | 30 seconds |
| `retry` | `none` |
| `Accept` | `application/json` |
| `Content-Type` (with Json body) | `application/json` |
| `User-Agent` | `Kumiki` |
| `credentials` | `same-origin` |

Defaults for storage effects:

| Setting | Value |
|---|---|
| `policy` | Parallel execution (unspecified) |
| `retry` | `none` |
| Behavior on error | Returns `Result.Err` (does not throw) |

---

## 6.10 Security

### 6.10.1 CSP / CORS

Since the Kumiki runtime uses standard fetch, CORS behavior is the same as the browser's fetch. CSP is configured on the server side (Kumiki is not involved).

### 6.10.2 Storing Tokens

Storing an access token in `localStorage` is an XSS vulnerability risk. As Kumiki documentation, we recommend **HTTP-only cookies + `credentials: "include"`**.

```kumiki snippet
app App
    ...
    http = {
        ...
        credentials: "include"
    }
```

### 6.10.3 Caution for Sensitive Information in slots

slots **are included** in the episode log. When placing a password or the like in a slot, specify `volatile=true`:

```kumiki fragment
slot password : Text   volatile   = ""   # not written to the episode log, cleared on reload too
```

A `volatile` slot is excluded from persistence.

---

## 6.11 Design Decision Record

| Decision | Rationale |
|---|---|
| Provide HTTP as a standard effect | So it isn't reinvented in every app |
| Allow-list via capability | Structurally prevents `delete` from being called in an app that lacks `http.delete` |
| Type-safe decode via Decoder | Eliminates the JSON.parse → as cast convention |
| Don't retry 4xx | 4xx is a client-side problem, so avoid pointless retries |
| Recommend HTTP-only cookies | Structurally reduces XSS risk |
| `volatile` slot | Structurally prevents the bug of a password remaining in the log |

---

## 6.12 Next

- Persistence lifecycle → [Lifecycle](./lifecycle.md)
- Mocking in replay → [Testing](./testing.md)
