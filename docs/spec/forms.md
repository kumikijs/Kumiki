# Forms and Validation

Kumiki forms come in two styles: "bind individual inputs directly to a slot via `bind`," and "receive via `ui.submit` on a dedicated tile." The former is for reactive, incremental reflection; the latter is for transactional, committed submission.

Event selectors are **always written as tile names** (CSS attribute selectors are abolished). If you want to receive events directly on a built-in element (`form`, `input`, etc.), create a small tile that wraps that element.

---

## 5.1 Two-Way Binding of Individual Inputs

```kumiki fragment
slot draft : Text where len-lt(280) = ""

tile Compose = column(
                 textarea(bind=draft, placeholder="What's on your mind?") {rows: 3},
                 text(draft.length.show + "/280") {color: "muted"},
                 button(text="Post", onClick=post) {disabled: draft.is-empty})
```

- `bind=draft` two-way binds the slot `draft`
- User input updates the slot → the tile re-renders
- Type and refinement are **checked on each input**

### 5.1.1 Elements That Support `bind`

| Element | Acceptable types |
|---|---|
| `input` | `Text` (`type=text/email/password/url/search/tel`), `Int`/`Float` (`type=number`), `Time` (`type=date/datetime`) |
| `textarea` | `Text` |
| `select` | Any (same type as the `value` of `options`) |
| `slider` | `Int` / `Float` |
| `check` / `switch` | `Bool` |
| `radio` | One of a union type |

### 5.1.2 Handling of refinement

For `slot draft : Text where len-lt(280)`, when the input exceeds 280 characters:

- **Default**: the input is rejected (the slot is not updated)
- **`strict=false`**: the slot is updated, but the form's `valid` flag becomes false

```kumiki snippet
input(bind=draft, strict=false)
```

Both shapes are specific to `bind`, and both are deliberately quiet: a half-typed value is expected, not a defect. A refinement violation on the **assignment** path (`draft := …` inside a reducer) is the opposite case — it discards the whole reducer batch and is reported, see [batching](./runtime.md#a-batch-commits-all-or-nothing).

---

## 5.2 Form Elements

When you want to commit-submit multiple inputs together, create a **tile that wraps the form**:

```kumiki fragment
slot loginEmail    : Text                = ""
slot loginPassword : Text     volatile   = ""
slot loginError    : Option(HttpError)   = None
slot loginPending  : Bool                = false

tile LoginForm
    = form(
        column(
          label(text="Email") {for: "loginEmail"},
          input(bind=loginEmail, type="email", id="loginEmail", required=true),
          label(text="Password") {for: "loginPw"},
          input(bind=loginPassword, type="password", id="loginPw", required=true,
                auto-complete="current-password"),
          when(loginError.is-some,
            text(loginError.get.message) {color: "danger"}),
          button(text="Log in", type="submit", loading=loginPending) {bg: "primary"}
        ) {gap: "sm"}
      )

reducer doLogin
    on=ui.submit(LoginForm)
    do= loginError := None
        loginPending := true
        emit login({email: loginEmail, password: loginPassword})

effect login    cap=http.post
                in={email: Text, password: Text}
                out=Result(SessionId, HttpError)
                policy=latest
                map-request={url: "/api/auth/login", body: Json($1), decode: Decoder.Json(SessionId)}
```

### 5.2.1 form props

| prop | Type | Meaning |
|---|---|---|
| `auto-complete` | `Bool` | Browser autocomplete |
| `novalidate` | `Bool` | Suppress HTML5 standard validation |

Do not write `onSubmit` on the form itself. For the submit handler, write `ui.submit(WrapperTile)` in the reducer's `on=`, using **the name of the tile that wraps the form**.

### 5.2.2 Submit Behavior

- If all `bind`ed slots pass validation, the `ui.submit(WrapperTile)` reducer is called
- If even one fails, it is not called (individual error displays do appear)
- If strict-mode switching is needed, apply `strict=false` to the relevant input
- Fires by clicking `button(type="submit")`, or by pressing the Enter key in an `input`
- `type` is one of `submit` / `button` / `reset`, written through to the DOM verbatim, and is only meaningful inside a form. A button that does **not** write one keeps the HTML default, which is `submit` — so a button inside a form that is not meant to submit it must say `type="button"`. A literal outside the three is [E0201](./errors.md#e0201-type-mismatch): an invalid `type` attribute resolves to `submit`, so the typo submits

---

## 5.3 Common props for Input Elements

| prop | Type | Meaning |
|---|---|---|
| `bind` | slot name | Two-way binding |
| `value` | expr | One-way value (instead of `bind`; updated in a reducer) |
| `onChange` | reducer name | Reducer called when the value changes |
| `onInput` | reducer name | Called on the input event (more frequent than onChange) |
| `placeholder` | `Text` | Placeholder |
| `disabled` | `Bool` | Disable |
| `readonly` | `Bool` | Read-only (a control that has no read-only state, such as a `select`, ignores it) |
| `required` | `Bool` | Required |
| `auto-focus` | `Bool` | Focus on mount |
| `auto-complete` | `Text` | `email` / `current-password` / `new-password` / `off`, etc. |
| `strict` | `Bool` | Whether to reject input on a refinement violation (default true) |
| `id` | `Text` | HTML id (referenced by a label's `for`) |

### 5.3.1 By input type

```kumiki snippet
input(bind=email, type="email", auto-complete="email")
input(bind=password, type="password", auto-complete="current-password")
input(bind=age, type="number", min=0, max=120)
input(bind=birthday, type="date", min="1900-01-01")
input(bind=search, type="search")
input(bind=phone, type="tel", pattern="[0-9-]+")
```

---

## 5.4 Delivering Individual Input Events to a reducer

When `bind` is not enough (e.g., you want to run custom processing on every input), wrap that input in a **dedicated small tile** and receive `ui.input` / `ui.change`:

```kumiki fragment
slot pw  : Text                   = ""
slot pw2 : Text                   = ""
slot pwError : Option(Text)       = None

tile Pw1Input = input(bind=pw,  type="password")
tile Pw2Input = input(bind=pw2, type="password")

reducer validatePw
    on=ui.input(Pw2Input)
    do= pwError := if pw == pw2 then None else Some("Passwords don't match")
```

`ui.input(TileName)` receives events from the **root element** rendered by the TileName tile. For a composite tile, to target something other than the root element, split it into finer tiles.

---

## 5.5 select / radio

### 5.5.1 select

```kumiki fragment
type Filter = All | Active | Done
slot filter : Filter = All

tile FilterSelect = select(
                      bind=filter,
                      options=[
                        {label: "All",    value: All},
                        {label: "Active", value: Active},
                        {label: "Done",   value: Done}
                      ],
                      placeholder="Filter")
```

#### Three value/state Binding Forms

| Form | Example | Purpose |
|---|---|---|
| `bind=<slot>` | `bind=filter` | Directly tied to a single slot. Updates the slot automatically on change |
| `bind=<slot.field>` | `bind=draft.priority` | Bind to a record's field path. Immutable update via `_setPath` |
| `value=<expr>` | `value=issues[id].status` | **Read-only display**. Handle change yourself in a `ui.change(SelectTile)` reducer |

In the `value=` form, on a change event the reducer subscribing to `ui.change(<SelectTile>)` is called, and you can receive the selected variant value via `$event.value`:

```kumiki fragment
tile StatusSelect = select(value=issues[iid].status,
                           options=statusOptions(),
                           placeholder="Status")

reducer updateStatus
    on=ui.change(StatusSelect)
    do= match routeIssueId(route) with
          | Some(iid) -> { issues[iid].status := $event.value;
                           issues[iid].updatedAt := now }
          | None      -> ()
```

#### Change Detection for `input` / `textarea`

In addition to updating a slot via `bind=`, input/textarea can also fire via the `ui.change(InputTile)` / `ui.input(InputTile)` reducers. `$event.value` holds the current text.

### 5.5.2 radio

radio has a `group` prop for grouping (corresponding to CSS's `name` attribute):

```kumiki fragment
tile FilterRadioAll    = radio(group="filter", value=All,    selected=(filter == All))    {label: "All"}
tile FilterRadioActive = radio(group="filter", value=Active, selected=(filter == Active)) {label: "Active"}
tile FilterRadioDone   = radio(group="filter", value=Done,   selected=(filter == Done))   {label: "Done"}

tile FilterRadioGroup = column(FilterRadioAll, FilterRadioActive, FilterRadioDone)

reducer setFilterAll    on=ui.change(FilterRadioAll)    do= filter := All
reducer setFilterActive on=ui.change(FilterRadioActive) do= filter := Active
reducer setFilterDone   on=ui.change(FilterRadioDone)   do= filter := Done
```

Alternatively, if you receive a union type directly via `bind`, a single reducer is unnecessary:

```kumiki fragment
tile FilterRadioGroup = column(
                          radio(group="filter", bind=filter, value=All)    {label: "All"},
                          radio(group="filter", bind=filter, value=Active) {label: "Active"},
                          radio(group="filter", bind=filter, value=Done)   {label: "Done"})
```

This is the recommended approach.

---

## 5.6 Validation Strategy

Kumiki validation has **three layers**:

| Layer | Responsible for | Example |
|---|---|---|
| Type | Compiler | You cannot put a string into `slot age : Int` |
| refinement | Runtime | `age : Int where between(0, 120)` |
| Cross-form | reducer / fn | "password and password-confirm match" |

### 5.6.1 Cross-Form Example

```kumiki snippet
slot pw  : Text  = ""
slot pw2 : Text  = ""
slot pwError : Option(Text) = None

fn validatePassword(p1: Text, p2: Text) -> Option(Text)
   = if p1 == p2 then None else Some("Passwords don't match")

tile Pw2Input = input(bind=pw2, type="password")

reducer onPw2Change
    on=ui.input(Pw2Input)
    do= pwError := validatePassword(pw, pw2)

tile SignupForm
    = form(
        column(
          input(bind=pw, type="password"),
          Pw2Input,
          when(pwError.is-some,
            text(pwError.get) {color: "danger"}),
          button(text="Sign up", type="submit", disabled=pwError.is-some)))

reducer doSignup on=ui.submit(SignupForm) do= ...
```

---

## 5.7 Error Display

### 5.7.1 refinement Violation of an Individual Field

Display via the `error` element:

```kumiki snippet
input(bind=email, type="email")
error(field=email)
```

`error(field=...)` is a built-in tile that renders the target slot's current validation error.

### 5.7.2 Standard Messages

| Predicate | Default |
|---|---|
| `email` | "Invalid email format" |
| `url` | "Invalid URL" |
| `nonempty` | "Required" |
| `len-eq(N)` | "Must be exactly N characters" |
| `len-lt(N)` / `len-gt(N)` | "Must be less than / more than N characters" |
| `between(A, B)` | "Must be between A and B" |
| `regex(P)` | "Does not match pattern" |
| `one-of(...)` | "Must be one of: ..." |

Override custom messages via `theme.errors`:

```kumiki snippet
theme MyTheme = {
    ...,
    errors: {
        email: "Please enter a valid email address",
        nonempty: "This field is required"
    }
}
```

---

## 5.8 UI During Submission

```kumiki fragment
slot loginPending : Bool = false

reducer doLogin
    on=ui.submit(LoginForm)
    do= loginPending := true
        emit login({email: loginEmail, password: loginPassword})

reducer loginOk
    on=login.ok($s, _)
    do= loginPending := false
        session := Some($s)
        emit navigate({path: "/app", params: {}, query: {}})

reducer loginErr
    on=login.err($e, _)
    do= loginPending := false
        loginError := Some($e)
```

`button.loading` automatically shows a spinner and disables the button.

---

## 5.9 Multi-step Forms

```kumiki fragment
type Step = Account | Profile | Confirm

slot step : Step = Account
slot acct : {email: Text, pw: Text}     = {email: "", pw: ""}
slot prof : {name: Text, bio: Text}     = {name: "", bio: ""}

fn nextStep(s: Step) -> Step = match s with | Account -> Profile | Profile -> Confirm | Confirm -> Confirm
fn prevStep(s: Step) -> Step = match s with | Profile -> Account | Confirm -> Profile | Account -> Account

tile NextBtn = button(text="Next") {bg: "primary"}
tile PrevBtn = button(text="Back") {variant: "ghost"}

reducer next on=ui.click(NextBtn) do= step := nextStep(step)
reducer prev on=ui.click(PrevBtn) do= step := prevStep(step)

tile Wizard = column(
                ProgressIndicator(step),
                match step with
                  | Account -> AcctStep
                  | Profile -> ProfStep
                  | Confirm -> ConfirmStep,
                row(PrevBtn, NextBtn) {gap: "sm"})
```

Splitting each step into an independent tile makes it easier for the AI to track as well.

---

## 5.10 File Upload

```kumiki fragment
slot avatar : Option(File) = None

tile AvatarPicker = input(type="file", accept="image/*")

reducer pickFile
    on=ui.change(AvatarPicker)
    do= avatar := $event.files.head

tile UploadBtn = button(text="Upload")

reducer upload
    on=ui.click(UploadBtn)
    do= match avatar with
            | Some(f) -> emit uploadFile({file: f})
            | None    -> ()

tile AvatarUpload = column(
                      AvatarPicker,
                      when(avatar.is-some,
                        image(src=file-url(avatar.get)) {w: 100, h: 100, aspect: "1/1"}),
                      UploadBtn)

effect uploadFile  cap=http.post
                   in={file: File}
                   out=Result({url: Url}, HttpError)
                   policy=latest
                   map-request={url: "/api/upload", body: Multipart({file: FileV($1.file)}), decode: Decoder.Json({url: Url})}
```

`file-url(file)` is a built-in equivalent to `URL.createObjectURL` (with automatic release).

`accept` and `multiple` are only valid when `type="file"`. Used on any other `type` — or with `type` omitted (which defaults to `"text"`) — the typecheck rejects them with [E0206](./errors.md#e0206-file-only-prop).

---

## 5.11 Design Decision Record

| Decision | Rationale |
|---|---|
| Tie slots directly via `bind` | Eliminates the dual controlled/uncontrolled model |
| Event selectors are tile names only | Removes dependence on CSS knowledge; consistent with Kumiki's layer separation |
| Bind the form's submit handler to the wrapper tile, not the form itself | "Which reducer receives it" is visible in one place in the tile tree |
| Type-level validation via refinement | "If the type passes, the value is valid" |
| Centralize error messages in the theme | i18n and consistency |
| Express multi-step via slots | Avoids adding a dedicated wizard DSL |
| Files are a `File` type rather than `Bytes` | Structures size, MIME, and name |
| `radio`'s `group` prop | Wraps the HTML name attribute, kept self-contained within Kumiki |

---

## 5.12 Next

- HTTP details → [HTTP / Storage](./http.md)
- Lifecycle → [Lifecycle](./lifecycle.md)
