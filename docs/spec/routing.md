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

Specificity is compared segment by segment from the left: at the first segment where two patterns differ in kind, the static one beats the parameter, and the parameter beats the wildcard. `"/todos/new"` therefore takes `/todos/new` even when `"/todos/:id"` is written above it, and `"/todos/:id"` takes `/todos/42` ahead of an earlier `"/todos/*"`. Redirect entries ([§3.10](#_3-10-redirects-static)) are ranked in the same table as the routes that render: the first entry in this order that matches the path owns it, so `"/todos/new" -> NewTodo` renders even when `"/todos/*" ->> "/"` is written above it. The same order picks the entry inside a `sub-routes` map ([§3.6.3](#_3-6-3-matching-rules)), redirects included. Server rendering (`renderToString`) picks the rendered route by this order only when it is handed the routing module; without it, the path is compared to the declared patterns verbatim. It never follows a `->>`.

### 3.1.3 `/404` Is Reserved

`/404` is the fallback used **when no route matches**. Including `/404 -> X` in `app.routes` is mandatory (omitting it is a compile error).

### 3.1.4 A Route Target Takes No Argument

A route entry names a tile and gives it nothing, so **the tile it names may not declare `in=`** — one that does is [E0213](./errors.md#e0213-call-arity-mismatch), reported at the entry.

```kumiki invalid
tile Panel in=Text = column(text($1))
app M caps=[] routes={"/" -> Panel, "/404" -> Panel} init=[]
```

The same holds for a sub-route target ([§3.6.2](#_3-6-2-child-route-map)), and therefore for whatever `route-outlet` renders — the outlet shows the matched sub-route target, which is entered the same way.

There is nothing a target would need the argument for: the route being rendered is in the standard `route` slot ([§3.2](#_3-2-current-route-state)), which every tile can read. A tile that takes an input stays callable from a tile body — `column(Panel("a"))` is unaffected; it is the route position alone that supplies none.

---

## 3.2 Current Route State

The runtime provides the standard slot `route`:

```kumiki fragment
slot route : Route = Route.empty       # managed by the runtime
```

The `Route` type is [provided by the standard library](./stdlib.md#_2-1-3-domain-types-provided-by-the-standard-library):

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

`to` names a path **this app serves**. A target on another origin — `https://example.com/docs`, or a `mailto:` / `tel:` URL — is one the router cannot serve: only a same-origin URL can reach `history.pushState`. Such a link is not intercepted at all; the browser keeps the click and navigates it exactly as an `<a href>` would. `external` ([stdlib §2.3.2](./stdlib.md#_2-3-2-text-elements)) is how a link *says* it leaves the app, and additionally opens it in a new browsing context — it is not what makes an off-origin link work. An absolute URL to this origin (`http://localhost:3000/todos`) is same-origin, so the router takes it rather than the browser.

A `to` that is not a path — `?page=2`, `#faq`, `install`, `../guide`, or `""` — is relative. It resolves against the current location the way a browser resolves an `href` against the page it is on: on `/docs/intro`, `?page=2` goes to `/docs/intro?page=2`, `#faq` to `/docs/intro#faq`, `install` to `/docs/install`, `../guide` to `/guide`, and `""` to `/docs/intro` itself. A `path` given to `navigate` / `navigate-replace` (§3.3.2) resolves the same way. A path (`/docs`) is taken as written. `#faq` on the page already shown is an in-page jump, which scrolls to the element it names rather than switching routes ([§3.9](#_3-9-scroll-restoration)).

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

`{name}` is substituted from params. A `{name}` with no matching entry is left in the path as written — nothing checks the pair today.

### 3.3.4 Router source: `history` vs `memory`

By default the runtime reads and writes the **ambient document** location/history: `mount(app, el)` resolves the initial route from `location.pathname` and `navigate` / link clicks call `history.pushState` / `replaceState`. This is correct for an app served at a real origin.

In an **embedded or sandboxed host** — the docs playground `<iframe srcdoc sandbox="allow-scripts">`, a Web Component, any embed where the Kumiki app does not own the top-level URL — there is no real path (initial matching would fall to `/404`) and the origin is opaque (`history.pushState` throws `SecurityError`). For those, mount with the **memory router**:

```js
mount(app, el, { router: "memory", initialPath: "/" }); // initialPath optional, defaults to "/"
```

The memory router holds the current path in memory: the initial route resolves from `initialPath` (not `location`), and `navigate` / `navigate-replace` / `navigate-back` / link clicks update that in-memory path and re-render without touching `history.*`. Path params, query, redirects (`->>`), the `/404` fallback, and a relative target ([§3.3.1](#_3-3-1-the-link-element-recommended)), which resolves against the in-memory location, all behave identically — only the *source* of the location changes. `router: "history"` remains the default, so apps served at a real origin are unaffected. The embedding seams expose it: the auto-mounting bundle reads `globalThis.__kumikiMount` (e.g. `{ router: "memory" }`) before mounting, and `defineKumikiElement(tag, app, { router: "memory" })` forwards it to the Web Component.

---

## 3.4 Route Lifecycle

Events fired on route switches:

| Event | Timing |
|---|---|
| `route.leave(pattern)` | Just before leaving the old route |
| `route.enter(pattern)` | Just after entering the new route |
| `route.error(pattern)` | A tile of that route threw while rendering ([Lifecycle](./lifecycle.md#_7-1-list-of-lifecycle-events)) |

A navigation to another path is a switch, and fires both events in that order: `route.leave` for the route being left, then `route.enter` for the one being entered. That holds when the two share a pattern. Moving from `/todos/1/edit` to `/todos/2/edit` leaves todo 1 and enters todo 2, and switching child under a `sub-routes` parent leaves and re-enters the parent's pattern. A navigation that changes only the query or the hash, or that goes to the path already shown, is not a switch: it stays on the route, so `route.leave` does not run and a leave guard (§3.5.2) never asks. It still updates the `route` slot and runs `route.enter` again with the new `$route`, so a reducer that loads from `$route.query` sees the new query. The initial route fires only `route.enter` as well, since there is nothing to leave. An in-page jump ([§3.9](#_3-9-scroll-restoration)) — a target with a hash, on the path and query already shown (`#faq` on `/docs`) — runs neither event; it updates `route.hash`.

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

- A parent's `sub-routes` map applies only when [§3.1.2](#_3-1-2-match-order) selects that parent for the path; a more specific sibling (`"/settings/:section"` beside `"/settings/*"`) takes the path and renders its own target, without the parent
- Child routes are re-matched within the parent pattern `/settings/*`
- If no child route matches, the parent's `/settings` (default) is used
- If that also fails, fall through to the global `/404`
- Multiple `route-outlet()` calls inside a single parent tile are **undefined** — the runtime renders the matched child into the first outlet it encounters and leaves the rest empty. Design tiles with exactly one outlet.
- The child renders **under** the parent: an `error-boundary` on the parent covers it, and a boundary the child declares itself wins ([Lifecycle §7.3](./lifecycle.md#_7-3-error-boundaries-per-tile)).

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

A navigation whose target has a hash and keeps the path and query already shown — `#faq` on `/docs`, or `/docs#faq` there — is an **in-page jump**, as following a fragment is in a browser. It updates `route.hash`, runs neither `route.leave` nor `route.enter` ([§3.4](#_3-4-route-lifecycle)), and does not scroll to the top. It scrolls the element whose `id` is that hash into view instead, looked up in the document (or, for a Web Component, its shadow root) by the hash as written and then percent-decoded, as a browser finds a fragment's target; `scroll-restoration = false` does not turn this off. When no element has that id, the scroll position is left alone. Following the same hash again jumps again.

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

`->>` is a **static redirect**. The moment it matches, it performs the equivalent of `navigate-replace`. It applies only when it is the entry that owns the path under [§3.1.2](#_3-1-2-match-order): a more specific rendering route declared anywhere in the table wins over it.

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
