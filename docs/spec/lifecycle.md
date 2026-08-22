# Lifecycle, Error Boundaries, and Suspense

## 7.1 List of Lifecycle Events

| Event | Timing |
|---|---|
| `app.start` | Immediately after app startup (when initial slot values are fixed and the runtime is mounted) |
| `app.stop` | Just before app termination (before closing the browser / closing the tab) |
| `app.error` | When an uncaught error occurs |
| `app.http-401` | When an HTTP 401 is received (arrives via `app.http.on-401`) |
| `app.http-403` | Same, for 403 |
| `app.http-5xx` | Same, for 5xx |
| `app.visible` | When the tab becomes visible |
| `app.hidden` | When the tab becomes hidden |
| `app.online` | Network restored |
| `app.offline` | Network disconnected |
| `route.enter(pattern)` | Immediately after entering a route |
| `route.leave(pattern)` | Just before leaving a route |
| `route.error(pattern)` | An error during the tile rendering of that route |
| `tile.mount(name)` | First mount of a specific tile |
| `tile.unmount(name)` | Unmount of a specific tile |
| `timer(duration)` | Repeats at the specified interval |

### 7.1.1 app.start

Fires exactly once at app startup. It arrives **after** the effect list declared in `app.init = [...]` has been emitted.

```kumiki fragment
reducer boot
    on=app.start
    do= emit loadSession()
        emit loadTodos()
        emit identify(currentUser())
```

Effects emitted inside the `app.start` reducer are **passed synchronously to the dispatcher** (as the reducer's return value). The dispatcher checks capabilities and executes them according to policy.

### 7.1.2 app.stop

The timing at which the browser fires `beforeunload`. Only processing that completes in a short time can be executed (browser specification).

```kumiki fragment
reducer cleanup
    on=app.stop
    do= emit persist(todos)         # only synchronous storage.write is practical
```

### 7.1.3 app.visible / app.hidden

Corresponds to the `visibilitychange` event. When you want to pause state on tab switching:

```kumiki fragment
reducer pause on=app.hidden  do= timerPaused := true
reducer resume on=app.visible do= timerPaused := false
                                 emit syncFromServer()
```

### 7.1.4 app.online / app.offline

```kumiki fragment
reducer onlineSync   on=app.online   do= emit retryQueued()
reducer showOffline  on=app.offline  do= emit toast({kind: "warn", text: "Offline"})
```

### 7.1.5 timer

```kumiki fragment
reducer poll
    on=timer(5s)
    do= emit fetchUpdates()
```

`timer(d)` fires repeatedly at intervals of `d` from the app's mount time. The runtime implementation is `setInterval`-based and is automatically cleared on the `app`'s `dispose`.

**duration literals**: can be written as an integer + unit (`ms` / `s` / `m`), as in `1ms`, `500ms`, `1s`, `30s`, `5m`.

#### Named timers and `stop-timer`

A timer can be given a name so that a reducer can stop it explicitly:

```kumiki fragment
slot remaining : Int = 10

reducer tick on=timer(1s, name=countdown) do= remaining := remaining - 1
reducer stop on=ui.click(StopBtn)         do= stop-timer(countdown)
```

- `timer(d, name=N)` registers the interval under the identifier `N`. Timer names share a single namespace and must be unique across the app (a duplicate is [E0002](./errors.md#e0002-duplicate-timer-name)).
- `stop-timer(N)` is a reducer statement that clears the interval named `N`; after it runs, that timer fires no more. Referencing an undeclared timer name is a compile error ([E0106](./errors.md#e0106-undef-timer)).
- `stop-timer` is purely a control statement — it neither reads nor writes a slot nor emits an effect, so the reducer stays pure. The runtime clears the interval when it applies the reducer's result.
- A stopped timer is **not** restarted automatically; it starts again only on remount. On `app` dispose, all timers (running or stopped) are cleared.

```kumiki fragment
reducer tick on=timer(1s)   do= elapsed := elapsed + 1
reducer poll on=timer(30s)  do= emit fetchUpdates()
reducer fast on=timer(100ms) do= emit syncCursor()
```

### 7.1.6 tile.mount / tile.unmount

The timing at which a specific tile appears in / disappears from the DOM.

```kumiki fragment
reducer trackPageView
    on=tile.mount(SettingsPage)
    do= emit track({event: "settings_view", props: {}})
```

When you want to target multiple tiles at once, define multiple reducers with the same name (executed in definition order).

---

## 7.2 Error Handling

Kumiki **does not permit try/catch**. Errors are handled via the following routes:

### 7.2.1 Expected Errors

Expressed via the `Result(T, E)` type. When an effect's return value is `Result.Err`, it is delivered to the `effect-name.err($e, $k)` reducer.

### 7.2.2 Unexpected Errors (panic)

- `Option.get` returned None inside a reducer
- `List.get(i)` was out of range
- `Result.get` was an Err
- An explicit call to `panic(msg)`

These are exceptions called **panics**. A panic is recorded in the episode log, and the current reducer is interrupted. `slot` changes are **transactionally rolled back**.

### 7.2.3 The app.error reducer

```kumiki fragment
slot lastError : Option(PanicInfo) = None

reducer onPanic
    on=app.error
    do= lastError := Some($event)
        emit log({level: "error", message: $event.message, data: {}})
        emit toast({kind: "error", text: "Something went wrong"})
```

The `PanicInfo` type:

```kumiki fragment
type PanicInfo = {
    message: Text,
    location: Text,         # e.g. `reducer "foo"` or `render`
    episode-id: Text,
    cause: Option(Text),
    category: Text          # "reducer" / "effect" / "capability" / "tile-render" / "hydrate" / "unknown"
}
```

`category` names the runtime catch site where the throw was intercepted. The reducer / tile-render / hydrate paths emit their own category today; `effect` / `capability` / `unknown` are reserved values so app code can exhaustive-match without a fallthrough as future callsites are wired in.

**Implementation gaps to close.** Today's runtime only populates `message`, `location`, and `category` on the `$event` payload. `episode-id` and `cause` are declared on the type for forward compatibility but are NOT supplied yet — reducers MUST treat both as `None`-equivalent. The `location` example in older revisions of this spec used a `"reducer:foo:line:42"` shape; the runtime actually emits `reducer "foo"` / `render`. These are pre-existing gaps tracked separately from the panic-info wire-through work.

The dev-tooling fields `stack` (JS `Error.stack`) and the machine-readable `Error.cause` chain are captured in the episode log (`docs/spec/runtime.md` §10.5.1) but are deliberately **not** exposed on the user-facing `$event` — leaking raw stacks to production UI would be a footgun. Use `kumiki replay` / `kumiki_episode_tail` to inspect them.

---

## 7.3 Error Boundaries (per tile)

Capture rendering errors under a specific tile and show a fallback:

```kumiki fragment
tile UserPage
    error-boundary = ErrorFallback
    = page(
        UserHeader,
        UserStats,
        UserActivity)

tile ErrorFallback
    in=PanicInfo
    = column(
        heading("Something went wrong"),
        text($1.message) {color: "danger"},
        button(text="Retry", onClick=retryUserPage))
```

When you write `error-boundary = X` in a tile definition, a panic during rendering under that tile calls the X tile with `in=PanicInfo` and shows the fallback.

> **Implementation status.** The live runtime implements the panic model of [Error Handling](#_7-2-error-handling): a panic during a reducer dispatch rolls back that episode's `slot` changes (no partial writes), is surfaced to the verification tiers (`smoke` / scenario), and fires the `app.error` reducer ([The app.error reducer](#_7-2-3-the-app-error-reducer)) with `PanicInfo` as `$event`. A panic during rendering is caught by the nearest enclosing `error-boundary` tile; a render panic with **no** enclosing boundary (e.g. under the root) falls back to a built-in top-level panic display instead of escaping the event handler uncaught. `panic(message)` and the polymorphic `.get` (which panics on `None` / `Err`, consistent with `.get-err`) raise this same controlled signal.

---

## 7.4 Suspense (loading display)

When you want to show a loading display while awaiting the result of an async effect. Kumiki recommends **explicitly using the `LoadResult(T)` type**:

```kumiki fragment
type LoadResult(T) = Idle | Loading | Loaded(T) | Failed(HttpError)

slot user : LoadResult(User) = Idle

tile UserView = match user with
                  | Idle      -> button(text="Load", onClick=fetchUser)
                  | Loading   -> spinner() {size: "lg"}
                  | Loaded(u) -> UserCard(u)
                  | Failed(e) -> ErrorView(e)
```

There is no dedicated `<Suspense>` mechanism (to avoid the React problem of "it's hard to track what suspends from where").

### 7.4.1 The match Expression

```
match-expr ::= 'match' expr 'with' match-arm+
match-arm  ::= '|' pattern '->' expr
pattern    ::= identifier                              ; variant name
             | identifier '(' bind (',' bind)* ')'     ; variant + binding
             | '_'                                     ; wildcard
bind       ::= identifier
```

Network code is almost always written with `match`. This is the canonical pattern for loading/error in Kumiki.

---

## 7.5 404 and error Pages

### 7.5.1 404

Reaching `/404` is the same as a normal route. When route matching fails, the runtime sends you to `/404` via `nav.replace`.

```kumiki fragment
tile NotFound = page(
                  heading("404"),
                  text("Page not found"),
                  link(to="/") {text: "Home"})
```

### 7.5.2 Per-Route Error Fallback

```kumiki fragment
reducer onRouteErr
    on=route.error("/todos/:id")
    do= toastError := Some("Failed to load todo")
        emit navigate-replace({path: "/todos", params: {}, query: {}})
```

---

## 7.6 Confirmation Dialogs

Kumiki **provides the equivalent of `window.confirm` as an effect**:

```kumiki snippet
effect confirm cap=notification.show
               in={title: Text, message: Text, onYes: ReducerRef, onNo: ReducerRef}
               out=Unit

reducer askDelete
    on=ui.click(DeleteBtn)
    do= emit confirm({
            title: "Delete?",
            message: "This action cannot be undone",
            onYes: doDelete,
            onNo:  noop
        })

reducer doDelete on=ui.click(_) do= ...     # Note: in practice it's cleaner to create a separately named reducer
reducer noop     on=ui.click(_) do= ()
```

In the runtime implementation, this is rendered as a **modal dialog tile** (not the native `confirm`). This keeps the UI style consistent and makes testing easier.

---

## 7.7 Toasts

```kumiki fragment
effect toast cap=notification.show
             in={kind: Text, text: Text, duration: Option(Duration)}
             out=Unit

reducer notifySave
    on=persist.ok(_, _)
    do= emit toast({kind: "success", text: "Saved", duration: Some(Duration.s(3))})
```

`kind` is one of `info` / `success` / `warn` / `error`, and reaches the DOM as `data-level` — the runtime attaches no appearance to it. If `duration` is unspecified, the default per kind applies (info 3s, success 3s, warn 5s, error 0 = stays until dismissed); `Some(Duration.ms(0))` asks for the same thing explicitly.

The runtime has a built-in tile that manages a toast stack at the bottom-right of the screen.

---

## 7.8 Minimal Accessibility Conventions

| Convention | Application |
|---|---|
| `button` must always have `text` or `aria-label` | [E0701](./errors.md#e0701-a11y-button), under `--strict-a11y` |
| `image` must always have `alt` | [E0702](./errors.md#e0702-a11y-image), under `--strict-a11y` |
| `link` must always have inner text or `aria-label` | [E0703](./errors.md#e0703-a11y-link), under `--strict-a11y` |
| A `label {for: "x"}` must name an `id="x"` that exists | [E0705](./errors.md#e0705-a11y-label-for), under `--strict-a11y` |
| Keyboard operations (Tab/Enter/Esc) are automatic in the runtime | Runtime guarantee |
| Focus management: `modal` traps focus | Runtime guarantee |
| `aria-live` regions: automatic for `toast` (`role="status"`, polite) and `error` (`role="alert"`, assertive) — the tiles and the `toast` effect's banner alike, client and server | Runtime guarantee |

The checked rows are **off by default and errors when on**: without `--strict-a11y` the compiler filters them out entirely rather than reporting them as warnings, so a build is silent about them; with the flag they fail the build. The runtime guarantees hold either way.

---

## 7.9 State on Hot Reload

Whether to keep or discard slot values on a development hot reload:

| slot modifier | On reload |
|---|---|
| none | Kept |
| `transient` | Discarded (returns to the initial value) |
| `volatile` | Excluded from persistence (not written to the log either, discarded on reload) |

```kumiki fragment
slot draft : Text             = ""        # kept on reload
slot toast : Option(Toast)    transient = None  # discarded on reload
slot password : Text          volatile  = ""    # not written to the episode log either
```

---

## 7.10 Design Decision Record

| Decision | Rationale |
|---|---|
| Don't permit try/catch | Error propagation becomes implicit; make it explicit with Result |
| Roll back slots on panic | Don't leave half-finished state |
| No dedicated Suspense mechanism | Being explicit via the LoadResult type is easier for the AI to track |
| Provide confirm as an effect | UI consistency and testability |
| Enforce a11y at the warning level | Items that can be checked mechanically are protected structurally |
| Make error boundaries a tile attribute | Aligns the tile hierarchy with the error hierarchy |

---

## 7.11 Next

- How to write tests → [Testing](./testing.md)
- AI editing API → [AI Editing](./ai-edit.md)
