# Routing

Kumiki routing **assumes an SPA**. It is based on the **History API**, not hash routing. The server statically returns the same HTML, and the client runtime resolves the route.

## 3.1 Declaring Routes

Routes are declared in the `routes` field of `app`.

```kumiki fragment
app TodoApp
    caps   = [nav.push, nav.replace, nav.back]
    routes = {
        "/"                -> Home,
        "/todos"           -> TodoList,
        "/todos/:id"       -> TodoDetail,
        "/todos/:id/edit"  -> TodoEdit,
        "/settings/*"      -> Settings,
        "/404"             -> NotFound
    }
    init   = []
```

### 3.1.1 Path Segment Types

| Syntax | Meaning |
|---|---|
| `/static` | Static segment |
| `/:name` | Parameter (one segment) |
| `/*` | Wildcard (everything remaining) |
| `/?query` | Note: queries are handled separately. Do not write them in the path |

### 3.1.2 Match Order

1. More specific routes take precedence (static > parameter > wildcard)
2. At equal specificity, **definition order** wins (so behavior does not change under parallel development)

### 3.1.3 `/404` Is Reserved

`/404` is the fallback used **when no route matches**. Including `/404 -> X` in `app.routes` is mandatory (omitting it is a compile error).

---

## 3.2 Current Route State

The runtime provides the standard slot `route`:

```kumiki fragment
slot route : Route = Route.empty       # managed by the runtime
```

The `Route` type is [provided by the standard library](./stdlib.md#213-domain-types-provided-by-the-standard-library):

```kumiki fragment
type Route = {
    path: Text,                # "/todos/abc-123"
    pattern: Text,             # "/todos/:id"
    params: Map(Text, Text),   # {"id": "abc-123"}
    query: Map(Text, Text),    # ?foo=bar&baz=1 → {"foo":"bar","baz":"1"}
    hash: Option(Text)         # #section
}
```

Referencing it from a tile:

```kumiki snippet
tile TodoDetail = column(
                    heading("Todo " + route.params.get-or("id", "?")),
                    ...)
```

---

## 3.3 Route Transitions

### 3.3.1 The link Element (recommended)

```kumiki fragment
tile Nav = row(
             link(to="/")        {text: "Home"},
             link(to="/todos")   {text: "Todos"},
             link(to="/settings"){text: "Settings"})
```

`link` automatically uses the `nav.push` capability (implicitly). Unlike `<a href>`, it does not trigger a full reload.

### 3.3.2 Writing It as an effect

To transition from a reducer, emit an effect:

```kumiki fragment
reducer save  on=ui.click(SaveBtn)
              do= emit persist(todos)
                  emit navigate({path: "/todos", params: {}})
```

Built-in effects:

```kumiki fragment
effect navigate         cap=nav.push     in={path: Text, params: Map(Text, Text)}    out=Unit
effect navigate-replace cap=nav.replace  in={path: Text, params: Map(Text, Text)}    out=Unit
effect navigate-back    cap=nav.back     in=Unit                                     out=Unit
```

### 3.3.3 Dynamic Path Construction

```kumiki snippet
emit navigate({path: "/todos/{id}", params: {"id": todo.id.show}})
```

`{name}` is substituted from params. An unspecified `{name}` produces a compile-time warning.

### 3.3.4 Router source: `history` vs `memory`

By default the runtime reads and writes the **ambient document** location/history: `mount(app, el)` resolves the initial route from `location.pathname` and `navigate` / link clicks call `history.pushState` / `replaceState`. This is correct for an app served at a real origin.

In an **embedded or sandboxed host** — the docs playground `<iframe srcdoc sandbox="allow-scripts">`, a Web Component, any embed where the Kumiki app does not own the top-level URL — there is no real path (initial matching would fall to `/404`) and the origin is opaque (`history.pushState` throws `SecurityError`). For those, mount with the **memory router**:

```js
mount(app, el, { router: "memory", initialPath: "/" }); // initialPath optional, defaults to "/"
```

The memory router holds the current path in memory: the initial route resolves from `initialPath` (not `location`), and `navigate` / `navigate-replace` / `navigate-back` / link clicks update that in-memory path and re-render without touching `history.*`. Path params, query, redirects (`->>`), and the `/404` fallback all behave identically — only the *source* of the location changes. `router: "history"` remains the default, so apps served at a real origin are unaffected. The embedding seams expose it: the auto-mounting bundle reads `globalThis.__kumikiMount` (e.g. `{ router: "memory" }`) before mounting, and `defineKumikiElement(tag, app, { router: "memory" })` forwards it to the Web Component.

---

## 3.4 Route Lifecycle

Events fired on route switches:

| Event | Timing |
|---|---|
| `route.leave(pattern)` | Just before leaving the old route |
| `route.enter(pattern)` | Just after entering the new route |
| `route.error(pattern)` | A tile of that route threw while rendering ([Lifecycle](./lifecycle.md#_7-1-list-of-lifecycle-events)) |

```kumiki fragment
reducer loadTodoOnEnter
    on=route.enter("/todos/:id")
    do= todos[$route.params.get-or("id", "")] := Loading
        emit loadTodo($route.params.get-or("id", ""))

reducer cleanupOnLeave
    on=route.leave("/todos/:id")
    do= editing := None
```

`$route` is a bind representing the new (or old) route.

**`$route` is bound on the route lifecycle path and on the prefetch path, and nowhere else.** The runtime fills it into the payload of a `route.enter` / `route.leave` / `route.error` reducer, and into the payload it fires the reducer a link names as its [prefetch](#_3-8-prefetch) target with. Reading it from any other reducer is [E0119](./errors.md#e0119-route-bind-out-of-scope): the payload has no route in it, so every field off it reads `undefined` rather than failing. What a reducer outside those wants is the [`route` slot](#_3-2-current-route-state) — the runtime maintains it, it holds the current route, and every layer can read it.

The check reads that as a property of the *reducer*, because a reducer has one trigger: a prefetch target is exempt by name. So a reducer that is both a prefetch target and triggered some other way may read `$route` on either path, and gets an empty one on the trigger the prefetch did not fire. Naming a reducer in `prefetch` is what turns the check off for it.

---

## 3.5 Guards

Cases where you want to block a route transition (unsaved changes, not logged in, etc.).

### 3.5.1 enter Guard

Emitting `emit navigate-replace(...)` inside a `route.enter(pattern)` reducer is treated as a redirect.

```kumiki fragment
reducer requireAuth
    on=route.enter("/admin/*")
    do= if session.is-none
        then emit navigate-replace({path: "/login", params: {}})
        else ()
```

### 3.5.2 leave Guard

When you want to stop a transition if there are unsaved changes:

```kumiki fragment
slot dirty : Bool = false

reducer guardEdit
    on=route.leave("/todos/:id/edit")
    do= if dirty
        then emit confirm({title: "Discard changes?", onYes: continueLeave, onNo: stayHere})
        else ()
```

`confirm` is a standard effect (→ [Standard Library](./stdlib.md)) that delivers the answer to a separate reducer. See [Lifecycle](./lifecycle.md) for details.

---

## 3.6 Nested Routes

Using `/*` in a pattern lets you delegate sub-routes to a separate tile.

### 3.6.1 Parent Route

```kumiki fragment
app App
    caps   = [nav.push]
    routes = {
        "/settings/*" -> SettingsLayout,
        "/404"        -> NotFound
    }
```

### 3.6.2 Child Route Map

The child route map is written in the tile definition via `sub-routes`:

```kumiki fragment
tile SettingsLayout
    sub-routes = {
        "/settings/account" -> AccountSettings,
        "/settings/billing" -> BillingSettings,
        "/settings"         -> SettingsHome
    }
    = page(
        heading("Settings"),
        row(
          column(
            link(to="/settings/account") {text: "Account"},
            link(to="/settings/billing") {text: "Billing"}),
          route-outlet()))           # child routes are rendered here
```

`route-outlet()` is a primitive that specifies where children are rendered within the parent route tile.

### 3.6.3 Matching Rules

- Child routes are re-matched within the parent pattern `/settings/*`
- If no child route matches, the parent's `/settings` (default) is used
- If that also fails, fall through to the global `/404`
- Multiple `route-outlet()` calls inside a single parent tile are **undefined** — the runtime renders the matched child into the first outlet it encounters and leaves the rest empty. Design tiles with exactly one outlet.

---

## 3.7 Query Parameters

Queries are read from `route.query`. For writing, they are not included in `navigate`'s `params` but passed via a separate `query` field.

```kumiki snippet
emit navigate({
    path: "/search",
    params: {},
    query: {"q": searchTerm, "page": "1"}
})
```

The `in` type of the `navigate` effect is an extended version that allows this:

```kumiki fragment
effect navigate cap=nav.push
                in={path: Text, params: Map(Text, Text), query: Map(Text, Text)}
                out=Unit
```

`params` and `query` default to `{}` when unspecified.

---

## 3.8 Prefetch

When you want to fetch data ahead of time once a link enters the viewport:

```kumiki snippet
link(to="/todos/abc-123") {
    text: "Todo abc-123",
    prefetch: loadTodo,           # name of the reducer to emit
    prefetch-args: {"id": "abc-123"}
}
```

`prefetch` is a standard feature that fires on viewport entry via `IntersectionObserver`. The reducer is called with the same argument binding as for `route.enter`.

---

## 3.9 Scroll Restoration

Restores the scroll position when navigating back through history. Enabled by default.

A tile where you want to disable it:

```kumiki snippet
tile Chat
    scroll-restoration = false
    = scroll(...)
```

Scroll to the top on entering a specific route:

```kumiki fragment
reducer scrollTop on=route.enter("/*") do= emit scroll-to({x: 0, y: 0})
```

`scroll-to` is a standard effect.

---

## 3.10 Redirects (static)

```kumiki fragment
app App
    routes = {
        "/old-path"  ->> "/new-path",     # ->> is a redirect
        "/new-path"  -> NewPage,
        "/404"       -> NotFound
    }
```

`->>` is a **static redirect**. The moment it matches, it performs the equivalent of `navigate-replace`.

---

## 3.11 Example: Routing with Authentication

```kumiki fragment
type SessionId = nominal Text

slot session : Option(SessionId) = None
slot loginRedirect : Option(Text) = None

effect loadSession cap=storage.read in=Unit out=Option(SessionId) policy=once

reducer boot
    on=app.start
    do= emit loadSession()

reducer sessionLoaded
    on=loadSession.ok($s, _)
    do= session := $s

reducer requireAuth
    on=route.enter("/app/*")
    do= if session.is-none
        then { loginRedirect := Some(route.path)
               emit navigate-replace({path: "/login", params: {}, query: {}}) }
        else ()

reducer afterLogin
    on=ui.submit(LoginForm)
    do= session := Some(SessionId.fresh())
        let back = loginRedirect.get-or("/app")
        emit navigate-replace({path: back, params: {}, query: {}})
        loginRedirect := None

app SecureApp
    caps   = [storage.read, nav.push, nav.replace]
    routes = {
        "/"        -> Landing,
        "/login"   -> LoginPage,
        "/app/*"   -> AppShell,
        "/404"     -> NotFound
    }
    init   = []
```

---

## 3.12 Design Decision Record

| Decision | Rationale |
|---|---|
| Made `/404` mandatory | Structurally prevents the bug of shipping to production without a 404 |
| Match order is specificity → definition order | With hash order, behavior would vary under parallel development |
| Made `link` an element | Forcing "a button that emits nav.push" every time wastes tokens |
| Do not write queries in the path | Structurally prevents confusion between path and query |
| Write nested routes in the tile | Aligns route structure with the view hierarchy |
| Made prefetch a link prop | Writing it in a reducer scatters the intent |
| Write guards in reducers | Avoids adding a dedicated DSL (minimizes what must be learned) |

---

## 3.13 Next

- Form submit handlers → [Forms](./forms.md)
- HTTP fetch → [HTTP / Storage](./http.md)
- Error pages / suspense → [Lifecycle](./lifecycle.md)
