# HTTP / Storage Effects

外部世界とのやりとりはすべて **effect** で行う。ここでは標準提供される effect の詳細仕様を述べる。

## 6.1 HTTP 共通

### 6.1.1 capability

| capability | 対応 HTTP メソッド |
|---|---|
| `http.get` | GET |
| `http.post` | POST |
| `http.put` | PUT |
| `http.patch` | PATCH |
| `http.delete` | DELETE |

### 6.1.2 標準 effect

プログラムは capability に対して自分の effect を宣言する。以下は各メソッドでツールチェインが期待する形 — 名前は任意で、`cap` とレコードがランタイムの dispatch 先を決める：

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
                   body: HttpBody,
                   decode: Decoder
                 }
                 out=Result(Decoded, HttpError)

# put / patch / delete も同じ形
```

`http.get` 等は **未指定なら使えない**（capability ガード）。`app.caps` に列挙必須。

### 6.1.3 HttpBody 型

```kumiki fragment
type HttpBody = Json(JsonValue)
              | Form(Map(Text, Text))
              | Multipart(Map(Text, FormValue))
              | Text(Text)
              | Bytes(Bytes)
              | Empty
```

### 6.1.4 Decoder 型

```kumiki snippet
Decoder.Json(User)   # レスポンス JSON を型に decode
Decoder.Text         # 文字列のまま
Decoder.Bytes        # バイト列のまま
Decoder.None         # レスポンス本文を捨てる
```

レスポンスの decode は型安全。`Decoder.Json(User)` を指定すれば、レスポンス JSON が `User` 型に decode される。失敗は `HttpError` の `body` に格納される。

### 6.1.5 共通 props（自動付与）

すべての HTTP effect は次を自動付与：

- `Accept: application/json`（Decoder が Json のとき）
- `Content-Type: application/json`（HttpBody が Json のとき）
- `Content-Type: multipart/form-data`（Multipart のとき）
- `User-Agent: Kumiki`

ユーザー指定の headers が優先される。

---

## 6.2 HTTP 利用例

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

実装時、Kumiki コンパイラは `loadUser` を以下に展開する：

```kumiki snippet
emit http-get({
    url:     apiBase + "/users/" + $1.show,
    headers: {},
    query:   {},
    decode:  Decoder.Json(User)
})
```

→ 高レベル effect 名（`loadUser`）が URL テンプレートを内蔵することは**できない**。テンプレート機構は別途 [6.6 高レベルラッパ](#_6-6-high-level-wrappers) を参照。

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

## 6.3 認証

### 6.3.1 グローバル header の注入 {#_6-3-1-injecting-global-headers}

`app.http` で全 HTTP effect に自動付与する header を宣言できる：

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

| http フィールド | 意味 | 評価タイミング |
|---|---|---|
| `base-url` | 相対 URL のベース | リクエストごと |
| `headers` | 全リクエストに付与 | リクエストごと |
| `timeout` | デフォルトタイムアウト（duration） | リクエストごと |
| `credentials` | fetch の credentials モード（[§6.9](#_6-9-default-settings)） | リクエストごと |
| `on-401` | 401 を受けた reducer（コンパイラが解決する — 未知の名前は [E0102](./errors.md#e0102-undef-reducer)） | コンパイル時に解決 |
| `on-403` | 403 を受けた reducer（同上） | コンパイル時に解決 |
| `on-5xx` | 5xx を受けた reducer（同上） | コンパイル時に解決 |

値を取るフィールドはすべて**式**であり、slot を読んでよい。4 つとも評価されるのは
アプリの構築時ではなく**リクエストを行う時**である：slot を書く reducer は次の
リクエストの内容を変え、そのために再マウントする必要はない。したがって
`base-url: endpoint` は `endpoint` に代入した瞬間から接続先を切り替え、
`headers: {"Authorization": fmt("Bearer {0}", session.get-or("anon"))}` は
マウント時ではなくリクエスト時点のセッションを載せる。

reducer 名の 3 つだけは例外で、そもそも値ではない：コンパイラが `reducer` 定義に
対して一度だけ解決する。

4 つの式について検査されるのは**名前**である：解決されない名前は書かれた位置で
[E0103](./errors.md#e0103-undef-ref-undef-slot) になる。**値**は検査されない — フィールドが
要求する型と与えられた値を突き合わせるものが無いので、`timeout: "soon"` は
コンパイルを通って `fetch` まで届く。

### 6.3.2 401 のグローバル処理

```kumiki fragment
reducer handleUnauthorized
    on=app.http-401
    do= session := None
        emit navigate({path: "/login", params: {}, query: {}})
```

`app.http-401` は `app.http.on-401` で指定した reducer に**自動でルーティング**される。

---

## 6.4 キャンセル {#_6-4-cancellation}

`policy=latest` または `policy=latest-per-key(...)` で自動キャンセルされる。手動キャンセルは：

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

`emit` を式として使うと、dispatch された effect の `EffectId` が返る（[stdlib §2.1.1.1](./stdlib.md#_2-1-1-1-effectid) 参照）。`EffectId.none` センチネルにより `emit cancel(EffectId.none)` は安全な no-op になる。

`cap=http.cancel` の effect は `in=EffectId out=Unit` を満たさなければならず、それ以外の形はコンパイル時に拒否される（[E0303](./errors.md#e0303-invalid-cancel-target)）。

### 6.4.1 挙動

- 未知 / 既完了 `EffectId` への cancel は silent no-op（キャンセルは契約違反ではなく冪等な意図）。
- キャンセルされた effect の `.err` reducer は `{status: 0, message: "aborted", body: ""}` で起動する。`HttpError` 形が abort と通信失敗の両方を覆う。`policy=latest` / `policy=latest-per-key` による自動キャンセルにも同じ正規化が適用される。
- 同 effect に対する `debounce` タイマーは cancel でクリアされ、まだ発行されていない待機中リクエストは発生しない。
- `throttle` のウィンドウマーカーは **そのまま維持される**。元の effect はすでに launch 済み（cancel はその進行中リクエストを abort）であり、マーカーを消すと直後の emit がウィンドウ終了前にレート制限をすり抜けてしまう。

---

## 6.5 リトライ

```kumiki fragment
effect loadCritical cap=http.get
                    in=Text
                    out=Result(Text, HttpError)
                    retry=exponential(5, 500ms, 2.0)
```

| retry | 振る舞い |
|---|---|
| `none` | リトライしない（デフォルト） |
| `linear(N, ms)` | N 回まで、ms 間隔で再試行 |
| `exponential(N, initial-ms, factor)` | N 回まで、初回 initial-ms、毎回 factor 倍 |

リトライは **5xx と接続エラーのみ**対象。4xx はリトライしない（仕様）。

---

## 6.6 高レベルラッパ {#_6-6-high-level-wrappers}

URL テンプレートや path パラメータを書きたい場合は、ユーザーがラッパ effect を宣言する：

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

`map-request` はビルトイン effect の入力に変換する純粋関数（式断片）。これにより、高レベル effect 名と実 HTTP リクエストの関係が **1 箇所に集中**する。

---

## 6.7 Storage Effects

### 6.7.1 capability

| capability | 対応 |
|---|---|
| `storage.read`, `storage.write` | localStorage |
| `session.read`, `session.write` | sessionStorage |
| `indexed.read`, `indexed.write`, `indexed.delete` | IndexedDB |

### 6.7.2 宣言（localStorage）

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

### 6.7.3 例

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

`session-*` も同じ形。`indexed-*` はキー指定が `{store: Text, key: Text}` になる以外は同じ。

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

IndexedDB の `store` は `app.indexed-db` で宣言：

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

## 6.8 永続化のパターン

### 6.8.1 起動時ロード

```kumiki fragment
reducer boot on=app.start do= emit loadAll()
reducer loaded on=loadAll.ok($data, _) do= state := $data
```

### 6.8.2 変更を debounce で保存

```kumiki fragment
effect save cap=storage.write
            in=Map(TodoId, Todo)
            out=Result(Unit, Text)
            policy=debounce(300ms)

reducer afterChange
    on=ui.click(TodoRow)
    do= todos[$el.id].done := not todos[$el.id].done
        emit save(todos)
```

### 6.8.3 楽観的更新 + サーバ同期

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

## 6.9 デフォルト設定 {#_6-9-default-settings}

すべての HTTP effect のデフォルト：

| 設定 | 値 |
|---|---|
| `timeout` | 30 秒 |
| `retry` | `none` |
| `Accept` | `application/json` |
| `Content-Type` (Json body 時) | `application/json` |
| `User-Agent` | `Kumiki` |
| `credentials` | `same-origin` |

ストレージ effect のデフォルト：

| 設定 | 値 |
|---|---|
| `policy` | 並列実行（指定なし） |
| `retry` | `none` |
| エラー時の挙動 | `Result.Err` を返す（throw しない） |

---

## 6.10 セキュリティ

### 6.10.1 CSP / CORS

Kumiki ランタイムは standard fetch を使うので、CORS の挙動はブラウザの fetch と同じ。CSP はサーバ側で設定する（Kumiki は関与しない）。

### 6.10.2 トークンの保存

`localStorage` にアクセストークンを保存するのは XSS 脆弱性のリスク。Kumiki のドキュメントとしては **HTTP-only cookie + `credentials: "include"`** を推奨する。

```kumiki snippet
app App
    ...
    http = {
        ...
        credentials: "include"
    }
```

### 6.10.3 機微情報の slot 注意

slot は episode log に**含まれる**。パスワード等を slot に置く場合は `volatile=true` を指定する：

```kumiki fragment
slot password : Text   volatile   = ""   # episode log に書き込まれない、リロードでも消える
```

`volatile` slot は永続化対象から外れる。

---

## 6.11 設計上の判断記録

| 判断 | 理由 |
|---|---|
| HTTP は標準 effect として提供 | 全アプリで再発明されないように |
| capability で許可制 | `http.delete` を持たないアプリで `delete` が呼ばれるのを構造で防ぐ |
| Decoder で型安全 decode | JSON.parse → as でキャストする慣習を排除 |
| 4xx はリトライしない | 4xx はクライアント側の問題なので無意味な再試行を避ける |
| HTTP-only cookie 推奨 | XSS リスクを構造で減らす |
| `volatile` slot | パスワードが log に残るバグを構造で防ぐ |

---

## 6.12 次

- 永続化のライフサイクル → [ライフサイクル](./lifecycle.md)
- replay でのモック → [テスト](./testing.md)
