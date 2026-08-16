# ルーティング

Kumiki のルーティングは **SPA を前提**にしている。ハッシュルーティングではなく **History API** ベース。サーバから静的に同じ HTML を返し、クライアントランタイムがルートを解決する。

## 3.1 ルートの宣言

`app` の `routes` フィールドで宣言する。

```kumiki
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

### 3.1.1 パスセグメントの種類

| 構文 | 意味 |
|---|---|
| `/static` | 静的セグメント |
| `/:name` | パラメータ（1 セグメント） |
| `/*` | ワイルドカード（残り全部） |
| `/?query` | ※ クエリは別途。パスには書かない |

### 3.1.2 マッチ順序

1. より具体的なルートが優先（静的 > パラメータ > ワイルドカード）
2. 同じ具体度なら **定義順**（並列開発で挙動が変わらないように）

### 3.1.3 `/404` は予約

`/404` は **どのルートにもマッチしなかった場合**のフォールバック。`app.routes` に `/404 -> X` を含めるのは必須（未指定はコンパイルエラー）。

---

## 3.2 現在のルート状態

ランタイムは標準 slot `route` を提供する：

```kumiki
slot route : Route = Route.empty       ; ランタイムが管理
```

`Route` 型は[標準ライブラリ](./stdlib.md#213-ドメイン型標準提供)：

```kumiki
type Route = {
    path: Text,                ; "/todos/abc-123"
    pattern: Text,             ; "/todos/:id"
    params: Map(Text, Text),   ; {"id": "abc-123"}
    query: Map(Text, Text),    ; ?foo=bar&baz=1 → {"foo":"bar","baz":"1"}
    hash: Option(Text)         ; #section
}
```

tile から参照：

```kumiki
tile TodoDetail = column(
                    heading("Todo " + route.params.get-or("id", "?")),
                    ...)
```

---

## 3.3 ルート遷移

### 3.3.1 link 要素（推奨）

```kumiki
tile Nav = row(
             link(to="/")        {text: "Home"},
             link(to="/todos")   {text: "Todos"},
             link(to="/settings"){text: "Settings"})
```

`link` は自動的に `nav.push` capability を使う（暗黙）。`<a href>` と異なりフルリロードしない。

### 3.3.2 effect として書く

reducer から遷移するには effect を emit：

```kumiki
reducer save  on=ui.click(SaveBtn)
              do= emit persist(todos)
                  emit navigate({path: "/todos", params: {}})
```

ビルトイン effect:

```kumiki
effect navigate         cap=nav.push     in={path: Text, params: Map(Text, Text)}    out=Unit
effect navigate-replace cap=nav.replace  in={path: Text, params: Map(Text, Text)}    out=Unit
effect navigate-back    cap=nav.back     in=Unit                                     out=Unit
```

### 3.3.3 動的パス構築

```kumiki
emit navigate({path: "/todos/{id}", params: {"id": todo.id.show}})
```

`{name}` は params で置換される。未指定の `{name}` はコンパイル時警告。

### 3.3.4 ルータソース：`history` と `memory`

デフォルトでは、ランタイムは**周辺 document** の location/history を読み書きする：`mount(app, el)` は初期ルートを `location.pathname` から解決し、`navigate` / link クリックは `history.pushState` / `replaceState` を呼ぶ。実 origin で配信されるアプリにはこれが正しい。

**埋め込み／サンドボックスホスト**——docs プレイグラウンドの `<iframe srcdoc sandbox="allow-scripts">`、Web Component、Kumiki アプリがトップレベル URL を所有しない任意の埋め込み——では本物のパスが無く（初期マッチが `/404` に落ちる）、origin が opaque（`history.pushState` が `SecurityError` を投げる）。それらでは **memory ルータ**でマウントする：

```js
mount(app, el, { router: "memory", initialPath: "/" }); // initialPath は任意、デフォルト "/"
```

memory ルータは現在のパスをメモリに保持する：初期ルートは（`location` ではなく）`initialPath` から解決され、`navigate` / `navigate-replace` / `navigate-back` / link クリックはそのメモリ内パスを更新して再描画し、`history.*` には触れない。パスパラメータ・query・リダイレクト（`->>`）・`/404` フォールバックはすべて同一に振る舞う——変わるのは location の*ソース*だけ。`router: "history"` がデフォルトのままなので、実 origin で配信されるアプリは影響を受けない。埋め込みシームが公開する：自動マウントするバンドルはマウント前に `globalThis.__kumikiMount`（例 `{ router: "memory" }`）を読み、`defineKumikiElement(tag, app, { router: "memory" })` は Web Component へ転送する。

---

## 3.4 ルートライフサイクル

ルート切替時に発火するイベント：

| イベント | タイミング |
|---|---|
| `route.leave(pattern)` | 旧ルートを離れる直前 |
| `route.enter(pattern)` | 新ルートに入った直後 |
| `route.error(pattern)` | そのルートの tile が描画中に throw したとき（[ライフサイクル](./lifecycle.md#_7-1-ライフサイクルイベント一覧)） |

```kumiki
reducer loadTodoOnEnter
    on=route.enter("/todos/:id")
    do= todos[$route.params.get-or("id", "")] := Loading
        emit loadTodo($route.params.get-or("id", ""))

reducer cleanupOnLeave
    on=route.leave("/todos/:id")
    do= editing := None
```

`$route` は新（または旧）ルートを表す bind。

**`$route` が束縛されるのは、ルートライフサイクルの経路とプリフェッチの経路だけである。** ランタイムがこれをペイロードに入れるのは `route.enter` / `route.leave` / `route.error` の reducer と、link が[プリフェッチ](#_3-8-プリフェッチ)の対象に指名した reducer を発火させるときである。それ以外の reducer から読むと [E0119](./errors.md#e0119-route-bind-out-of-scope) になる：ペイロードにルートが無いので、失敗するのではなくフィールドがすべて `undefined` を返す。それらの外側の reducer が欲しいのは [`route` slot](#_3-2-現在のルート状態) — ランタイムが保守しており、現在のルートを保持し、どの層からも読める。

検査はこれを *reducer* の性質として読む（reducer のトリガは 1 つだから）：プリフェッチ対象は名前で免除される。したがって、プリフェッチ対象であり別のトリガでも発火する reducer は、どちらの経路でも `$route` を読めてしまい、プリフェッチが発火させなかった側では空のものを受け取る。`prefetch` に reducer を指名することが、その reducer に対する検査を切ることになる。

---

## 3.5 ガード

ルート遷移を阻止したいケース（未保存変更、未ログインなど）。

### 3.5.1 enter ガード

`route.enter(pattern)` の reducer 中で `emit navigate-replace(...)` を出すと、リダイレクトとして扱われる。

```kumiki
reducer requireAuth
    on=route.enter("/admin/*")
    do= if session.is-none
        then emit navigate-replace({path: "/login", params: {}})
        else ()
```

### 3.5.2 leave ガード

未保存変更があるなら遷移を止めたい場合：

```kumiki
slot dirty : Bool = false

reducer guardEdit
    on=route.leave("/todos/:id/edit")
    do= if dirty
        then emit confirm({title: "破棄してよい?", onYes: continueLeave, onNo: stayHere})
        else ()
```

`confirm` は標準 effect（→ [標準ライブラリ](./stdlib.md)）で、回答を別 reducer に届ける。詳細は [ライフサイクル](./lifecycle.md)。

---

## 3.6 ネステッドルート

`/*` をパターンに使うと、サブルートを別 tile に委譲できる。

### 3.6.1 親ルート

```kumiki
app App
    caps   = [nav.push]
    routes = {
        "/settings/*" -> SettingsLayout,
        "/404"        -> NotFound
    }
```

### 3.6.2 子ルートマップ

子ルートマップは tile 定義に `sub-routes` で書く：

```kumiki
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
          route-outlet()))           ; 子ルートがここに描画される
```

`route-outlet()` は親ルート tile 内で子の描画位置を指定するプリミティブ。

### 3.6.3 マッチング規則

- 子ルートは親パターン `/settings/*` の中で再マッチング
- 子ルートにマッチしなければ親の `/settings` (デフォルト) を使う
- それも無ければグローバル `/404` へ
- 親 tile 内に複数の `route-outlet()` を置いた場合の挙動は **未定義**。ランタイムは最初に見つかった outlet にのみ子を描画し、残りは空のまま放置する。tile 設計では outlet を 1 つに保つこと。

---

## 3.7 クエリパラメータ

クエリは `route.query` から読む。書き込みは `navigate` の `params` には含まれず、別フィールド `query` で渡す。

```kumiki
emit navigate({
    path: "/search",
    params: {},
    query: {"q": searchTerm, "page": "1"}
})
```

`navigate` effect の `in` 型はこれを許す拡張版：

```kumiki
effect navigate cap=nav.push
                in={path: Text, params: Map(Text, Text), query: Map(Text, Text)}
                out=Unit
```

`params` と `query` は未指定なら `{}`。

---

## 3.8 プリフェッチ

リンクがビューポートに入ったときに先にデータを取りたい：

```kumiki
link(to="/todos/abc-123") {
    text: "Todo abc-123",
    prefetch: loadTodo,           ; emit する reducer 名
    prefetch-args: {"id": "abc-123"}
}
```

`prefetch` は `IntersectionObserver` を経由してビューポート進入時に発火する標準機能。reducer は `route.enter` のときと同じ引数バインドで呼ばれる。

---

## 3.9 スクロール復元

履歴を戻ったときにスクロール位置を復元する。デフォルトで有効。

無効化したい tile：

```kumiki
tile Chat
    scroll-restoration = false
    = scroll(...)
```

特定ルート進入時にトップへ：

```kumiki
reducer scrollTop on=route.enter("/*") do= emit scroll-to({x: 0, y: 0})
```

`scroll-to` は標準 effect。

---

## 3.10 リダイレクト（静的）

```kumiki
app App
    routes = {
        "/old-path"  ->> "/new-path",     ; ->> はリダイレクト
        "/new-path"  -> NewPage,
        "/404"       -> NotFound
    }
```

`->>` は **静的リダイレクト**。マッチした瞬間に `navigate-replace` 相当を実行。

---

## 3.11 例: 認証付きルーティング

```kumiki
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
        then let _ = (loginRedirect := Some(route.path))
             in emit navigate-replace({path: "/login", params: {}, query: {}})
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

## 3.12 設計上の判断記録

| 判断 | 理由 |
|---|---|
| `/404` を必須にした | 404 未指定で本番に出るバグを構造で防ぐ |
| マッチ順は具体度→定義順 | 並列開発で hash 順だと挙動が変動する |
| `link` を要素にした | 「nav.push を emit するボタン」と毎回書かせるのはトークンの無駄 |
| クエリを path に書かない | パスとクエリの混同を構造で防ぐ |
| ネステッドルートを tile に書く | ルート構造とビュー階層を一致させる |
| prefetch を link prop にした | reducer に書くと意図が散る |
| ガードを reducer で書く | 専用 DSL を増やさない（学習対象を最小化） |

---

## 3.13 次

- フォームの submit ハンドラ → [フォーム](./forms.md)
- HTTP fetch → [HTTP / Storage](./http.md)
- エラーページ / suspense → [ライフサイクル](./lifecycle.md)
