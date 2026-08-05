# フォームとバリデーション

Kumiki のフォームは「個別入力の `bind` で slot に直接束縛」する形と「専用 tile に `ui.submit` で受ける」形の 2 通りを提供する。前者はリアクティブな逐次反映、後者はトランザクション的な確定送信向け。

イベントセレクタは **常に tile 名**で書く（CSS 属性セレクタは廃止）。組み込み要素 (`form`, `input` 等) に直接イベントを受けたい場合は、その要素をラップする小さな tile を作る。

---

## 5.1 個別入力の双方向束縛

```kumiki
slot draft : Text where len-lt(280) = ""

tile Compose = column(
                 textarea(bind=draft, placeholder="What's on your mind?") {rows: 3},
                 text(draft.length.show + "/280") {color: "muted"},
                 button(text="Post", onClick=post) {disabled: draft.is-empty})
```

- `bind=draft` は slot `draft` を双方向束縛する
- ユーザー入力で slot が更新 → tile が再描画
- 型と refinement は **入力ごとに検査**される

### 5.1.1 `bind` の対応要素

| 要素 | 受け取れる型 |
|---|---|
| `input` | `Text` (`type=text/email/password/url/search/tel`), `Int`/`Float` (`type=number`), `Time` (`type=date/datetime`) |
| `textarea` | `Text` |
| `select` | 任意（`options` の `value` と同型） |
| `slider` | `Int` / `Float` |
| `check` / `switch` | `Bool` |
| `radio` | union 型のいずれか |

### 5.1.2 refinement の扱い

`slot draft : Text where len-lt(280)` の場合、入力が 280 文字を超えると：

- **デフォルト**: 入力を弾く（slot は更新されない）
- **`strict=false`**: slot は更新するが、フォームの `valid` フラグが false になる

```kumiki
input(bind=draft, strict=false)
```

このフィールド単位の拒否は `bind` に固有のもので、意図的に静かである。入力途中の値は欠陥ではなく想定内だからだ。**代入**経路（reducer 内の `draft := …`）での refinement 違反は逆のケースで、reducer のバッチを丸ごと破棄したうえで報告される。[batching](./runtime.md#バッチは全部通るか全部通らないかのどちらか) を参照。

---

## 5.2 フォーム要素

複数の入力をまとめて確定送信したい場合は、**form をラップする tile** を作る：

```kumiki
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

| prop | 型 | 意味 |
|---|---|---|
| `auto-complete` | `Bool` | ブラウザのオートコンプリート |
| `novalidate` | `Bool` | HTML5 標準バリデーションを抑制 |

form 自体には `onSubmit` を書かない。submit ハンドラは **その form をラップする tile 名**で `ui.submit(WrapperTile)` を reducer の `on=` に書く。

### 5.2.2 submit の挙動

- すべての `bind` された slot がバリデーションを通過していれば `ui.submit(WrapperTile)` reducer が呼ばれる
- 1 つでも失敗していれば呼ばれない（個別の error 表示は出る）
- 厳密モード切替が必要なら `strict=false` を該当入力に
- `button(type="submit")` をクリックするか、`input` で Enter キーで発火

---

## 5.3 入力要素の共通 props

| prop | 型 | 意味 |
|---|---|---|
| `bind` | slot name | 双方向束縛 |
| `value` | expr | 単方向値（`bind` の代わりに、reducer で更新） |
| `onChange` | reducer name | 値変更時に呼ばれる reducer |
| `onInput` | reducer name | input イベントで呼ばれる（onChange より高頻度） |
| `placeholder` | `Text` | プレースホルダ |
| `disabled` | `Bool` | 無効化 |
| `readonly` | `Bool` | 読み取り専用 |
| `required` | `Bool` | 必須 |
| `auto-focus` | `Bool` | マウント時にフォーカス |
| `auto-complete` | `Text` | `email` / `current-password` / `new-password` / `off` 等 |
| `strict` | `Bool` | refinement 違反時に入力を弾くか（デフォルト true） |
| `id` | `Text` | HTML id（label の `for` で参照） |

### 5.3.1 input type 別

```kumiki
input(bind=email, type="email", auto-complete="email")
input(bind=password, type="password", auto-complete="current-password")
input(bind=age, type="number", min=0, max=120)
input(bind=birthday, type="date", min="1900-01-01")
input(bind=search, type="search")
input(bind=phone, type="tel", pattern="[0-9-]+")
```

---

## 5.4 個別入力イベントを reducer に届ける

`bind` で十分足りない（例：入力の都度カスタム処理を走らせたい）場合は、その入力を**専用の小 tile**でラップして `ui.input` / `ui.change` を受ける：

```kumiki
slot pw  : Text                   = ""
slot pw2 : Text                   = ""
slot pwError : Option(Text)       = None

tile Pw1Input = input(bind=pw,  type="password")
tile Pw2Input = input(bind=pw2, type="password")

reducer validatePw
    on=ui.input(Pw2Input)
    do= pwError := if pw == pw2 then None else Some("Passwords don't match")
```

`ui.input(TileName)` は TileName tile が描画する**ルート要素**のイベントを受け取る。複合 tile の場合、ルート要素以外を狙うには更に細かい tile に分割する。

---

## 5.5 select / radio

### 5.5.1 select

```kumiki
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

#### 3 つの value/state バインディング形式

| 形式 | 例 | 用途 |
|---|---|---|
| `bind=<slot>` | `bind=filter` | 単一 slot に直結。change で slot を自動更新 |
| `bind=<slot.field>` | `bind=draft.priority` | record の field path に bind。`_setPath` で immutable update |
| `value=<expr>` | `value=issues[id].status` | **read-only 表示**。change は `ui.change(SelectTile)` reducer で自分でハンドル |

`value=` 形式の場合、change イベントで `ui.change(<SelectTile>)` を購読する reducer が呼ばれ、`$event.value` で選択された variant 値を受け取れる：

```kumiki
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

#### `input` / `textarea` の変更検出

input/textarea も `bind=` で slot を更新するほか、`ui.change(InputTile)` / `ui.input(InputTile)` reducer で fire できる。`$event.value` に現在の text が入る。

### 5.5.2 radio

radio はグループ化のため `group` prop を持つ（CSS の `name` 属性に対応）：

```kumiki
tile FilterRadioAll    = radio(group="filter", value=All,    selected=(filter == All))    {label: "All"}
tile FilterRadioActive = radio(group="filter", value=Active, selected=(filter == Active)) {label: "Active"}
tile FilterRadioDone   = radio(group="filter", value=Done,   selected=(filter == Done))   {label: "Done"}

tile FilterRadioGroup = column(FilterRadioAll, FilterRadioActive, FilterRadioDone)

reducer setFilterAll    on=ui.change(FilterRadioAll)    do= filter := All
reducer setFilterActive on=ui.change(FilterRadioActive) do= filter := Active
reducer setFilterDone   on=ui.change(FilterRadioDone)   do= filter := Done
```

または、`bind` で union 型を直接受ければ単一 reducer 不要：

```kumiki
tile FilterRadioGroup = column(
                          radio(group="filter", bind=filter, value=All)    {label: "All"},
                          radio(group="filter", bind=filter, value=Active) {label: "Active"},
                          radio(group="filter", bind=filter, value=Done)   {label: "Done"})
```

こちらが推奨。

---

## 5.6 バリデーション戦略

Kumiki のバリデーションは **3 層**：

| 層 | 担当 | 例 |
|---|---|---|
| 型 | コンパイラ | `slot age : Int` には文字列を入れられない |
| refinement | ランタイム | `age : Int where between(0, 120)` |
| フォーム横断 | reducer / fn | 「password と password-confirm が一致」 |

### 5.6.1 フォーム横断の例

```kumiki
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

## 5.7 エラー表示

### 5.7.1 個別フィールドの refinement 違反

`error` 要素で表示：

```kumiki
input(bind=email, type="email")
error(field=email)
```

`error(field=...)` は対象 slot の現在の検査エラーをレンダリングする組み込み tile。

### 5.7.2 標準メッセージ

| 述語 | デフォルト |
|---|---|
| `email` | "Invalid email format" |
| `url` | "Invalid URL" |
| `nonempty` | "Required" |
| `len-eq(N)` | "Must be exactly N characters" |
| `len-lt(N)` / `len-gt(N)` | "Must be less than / more than N characters" |
| `between(A, B)` | "Must be between A and B" |
| `regex(P)` | "Does not match pattern" |
| `one-of(...)` | "Must be one of: ..." |

カスタムメッセージは `theme.errors` で上書き：

```kumiki
theme MyTheme = {
    ...,
    errors: {
        email: "正しいメールアドレスを入力してください",
        nonempty: "入力してください"
    }
}
```

---

## 5.8 サブミット中の UI

```kumiki
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

`button.loading` で自動的にスピナー表示・無効化。

---

## 5.9 multi-step フォーム

```kumiki
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

各ステップは独立した tile に分割すれば AI も追跡しやすい。

---

## 5.10 ファイルアップロード

```kumiki
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

`file-url(file)` は `URL.createObjectURL` 相当の組み込み（自動解放）。

`accept` / `multiple` は `type="file"` のときのみ有効。他の `type` で使う場合 — あるいは `type` を省略した場合（デフォルトは `"text"`）— typecheck が [E0206](./errors.md#e0206-file-only-prop) で拒否する。

---

## 5.11 設計上の判断記録

| 判断 | 理由 |
|---|---|
| `bind` で slot 直結 | controlled/uncontrolled の二重モデルを排除 |
| イベントセレクタは tile 名のみ | CSS 知識依存を排除、Kumiki のレイヤ分離と整合 |
| form の submit ハンドラは form 自体ではなくラッパ tile に bind | 「どの reducer で受けるか」が tile ツリー上で 1 箇所に見える |
| refinement で型レベルバリデーション | 「型が通れば値が妥当」 |
| エラーメッセージを theme で集中管理 | i18n と一貫性 |
| multi-step は slot で表現 | 専用 wizard DSL を増やさない |
| ファイルは `Bytes` ではなく `File` 型 | サイズ・MIME・名前を構造化 |
| `radio` の `group` prop | HTML name 属性をラップ、Kumiki 内で完結 |

---

## 5.12 次

- HTTP の詳細 → [HTTP / Storage](./http.md)
- ライフサイクル → [ライフサイクル](./lifecycle.md)
