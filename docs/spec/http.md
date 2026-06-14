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
| `http.head` | HEAD |
| `http.options` | OPTIONS |

### 6.1.2 Standard effect

A high-level effect corresponding to each method is provided by the standard library:

```kumiki
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
                   body: HttpBody,
                   decode: Decoder
                 }
                 out=Result(Decoded, HttpError)

; put / patch / delete have the same shape
```

`http.get` and the like **cannot be used unless declared** (capability guard). They must be enumerated in `app.caps`.

### 6.1.3 The HttpBody Type

```kumiki
type HttpBody = Json(JsonValue)
              | Form(Map(Text, Text))
              | Multipart(Map(Text, FormValue))
              | Text(Text)
              | Bytes(Bytes)
              | Empty
```

### 6.1.4 The Decoder Type

```kumiki
type Decoder = Json(TypeRef)        ; decode JSON into a type
             | Text                  ; keep as a string
             | Bytes                 ; keep as a byte sequence
             | None                  ; discard the response body
```

Response decoding is type-safe. If you specify `Decoder.Json(User)`, the response JSON is decoded into the `User` type. Failures are stored in the `body` of `HttpError`.

### 6.1.5 Common props (auto-applied)

All HTTP effects automatically apply the following:

- `Accept: application/json` (when the Decoder is Json)
- `Content-Type: application/json` (when the HttpBody is Json)
- `Content-Type: multipart/form-data` (when Multipart)
- `User-Agent: Kumiki`

User-specified headers take precedence.

---

## 6.2 HTTP Usage Examples

### 6.2.1 GET

```kumiki
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

```kumiki
emit http-get({
    url:     apiBase + "/users/" + $1.show,
    headers: {},
    query:   {},
    decode:  Decoder.Json(User)
})
```

→ A high-level effect name (`loadUser`) **cannot** embed a URL template. For the templating mechanism, see [6.6 High-Level Wrappers](#66-high-level-wrappers) separately.

### 6.2.2 POST

```kumiki
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

```kumiki
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

| http field | Meaning |
|---|---|
| `base-url` | Base for relative URLs |
| `headers` | Applied to all requests (expressions allowed, slot references allowed) |
| `on-401` | Reducer that receives a 401 |
| `on-403` | Reducer that receives a 403 |
| `on-5xx` | Reducer that receives a 5xx |
| `timeout` | Default timeout (duration) |

### 6.3.2 Global Handling of 401

```kumiki
reducer handleUnauthorized
    on=app.http-401
    do= session := None
        emit navigate({path: "/login", params: {}, query: {}})
```

`app.http-401` is **automatically routed** to the reducer specified by `app.http.on-401`.

---

## 6.4 Cancellation

It is automatically canceled by `policy=latest` or `policy=latest-per-key(...)`. Manual cancellation is:

```kumiki
effect cancel cap=http.cancel in=EffectId out=Unit

reducer cancelSearch
    on=ui.click(CancelBtn)
    do= emit cancel(searchEffectId)
```

`EffectId` is returned at `emit` time.

---

## 6.5 Retry

```kumiki
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

Retries only target **5xx and connection errors**. 4xx is not retried (by specification).

---

## 6.6 High-Level Wrappers

When you want to write URL templates or path parameters, the user declares a wrapper effect:

```kumiki
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

### 6.7.1 capability

| capability | Corresponds to |
|---|---|
| `storage.read`, `storage.write` | localStorage |
| `session.read`, `session.write` | sessionStorage |
| `indexed.read`, `indexed.write`, `indexed.delete` | IndexedDB |

### 6.7.2 Standard effect (localStorage)

```kumiki
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

### 6.7.3 Example

```kumiki
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

`session-*` has the same shape. `indexed-*` is the same except that the key specification becomes `{store: Text, key: Text}`.

```kumiki
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

```kumiki
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

```kumiki
reducer boot on=app.start do= emit loadAll()
reducer loaded on=loadAll.ok($data, _) do= state := $data
```

### 6.8.2 Save Changes with debounce

```kumiki
effect save cap=storage.write
            in=Map(TodoId, Todo)
            out=Result(Unit, Text)
            policy=debounce(300ms)

reducer afterChange
    on=ui.click(TodoRow)
    do= todos[$el.id].done := not todos[$el.id].done
        emit save(todos)
```

### 6.8.3 Optimistic Update + Server Sync

```kumiki
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

```kumiki
app App
    ...
    http = {
        ...
        credentials: "include"
    }
```

### 6.10.3 Caution for Sensitive Information in slots

slots **are included** in the episode log. When placing a password or the like in a slot, specify `volatile=true`:

```kumiki
slot password : Text = ""
    volatile = true        ; not written to the episode log, cleared on reload too
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
