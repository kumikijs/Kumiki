# ライフサイクル・エラー境界・サスペンス

## 7.1 ライフサイクルイベント一覧

| イベント | タイミング |
|---|---|
| `app.start` | アプリ起動直後（初期 slot 値が確定し、ランタイムがマウントされた時点） |
| `app.stop` | アプリ終了直前（ブラウザクローズ・タブ閉じる前） |
| `app.error` | 未捕捉エラー発生時 |
| `app.http-401` | HTTP 401 を受信したとき（`app.http.on-401` 経由で来る） |
| `app.http-403` | 同 403 |
| `app.http-5xx` | 同 5xx |
| `app.visible` | タブが表示状態になったとき |
| `app.hidden` | タブが非表示状態になったとき |
| `app.online` | ネットワーク復旧 |
| `app.offline` | ネットワーク切断 |
| `route.enter(pattern)` | ルート進入直後 |
| `route.leave(pattern)` | ルート離脱直前 |
| `route.error(pattern)` | 当該ルートの tile 描画中にエラー |
| `tile.mount(name)` | 特定 tile の初回マウント |
| `tile.unmount(name)` | 特定 tile のアンマウント |
| `timer(duration)` | 指定間隔で繰り返し |

### 7.1.1 app.start

アプリ起動時に 1 回だけ発火。`app.init = [...]` で宣言した effect 列が emit された**後**に届く。

```kumiki
reducer boot
    on=app.start
    do= emit loadSession()
        emit loadTodos()
        emit identify(currentUser())
```

`app.start` reducer の中で emit した effect は **synchronous に dispatcher へ渡される**（reducer の戻り値として）。dispatcher は capability を check し、policy に従って実行する。

### 7.1.2 app.stop

ブラウザが `beforeunload` を発火したタイミング。短時間で完了する処理のみ実行可能（ブラウザ仕様）。

```kumiki
reducer cleanup
    on=app.stop
    do= emit persist(todos)         # 同期 storage.write のみ実用的
```

### 7.1.3 app.visible / app.hidden

`visibilitychange` イベントに対応。タブ切り替えで状態をポーズしたい場合：

```kumiki
reducer pause on=app.hidden  do= timerPaused := true
reducer resume on=app.visible do= timerPaused := false
                                 emit syncFromServer()
```

### 7.1.4 app.online / app.offline

```kumiki
reducer onlineSync   on=app.online   do= emit retryQueued()
reducer showOffline  on=app.offline  do= emit toast({kind: "warn", text: "Offline"})
```

### 7.1.5 timer

```kumiki
reducer poll
    on=timer(5s)
    do= emit fetchUpdates()
```

`timer(d)` は app の mount 時から `d` 間隔で繰り返し発火する。ランタイム実装は `setInterval` ベースで、`app` の `dispose` 時に自動 clear される。

**duration リテラル**: `1ms`, `500ms`, `1s`, `30s`, `5m` のように整数 + 単位 (`ms` / `s` / `m`) で書ける。

#### 名前付きタイマーと `stop-timer`

タイマーに名前を付けると、reducer から明示的に停止できる：

```kumiki
slot remaining : Int = 10

reducer tick on=timer(1s, name=countdown) do= remaining := remaining - 1
reducer stop on=ui.click(StopBtn)         do= stop-timer(countdown)
```

- `timer(d, name=N)` は interval を識別子 `N` の下に登録する。タイマー名は単一のネームスペースを共有し、アプリ内で一意でなければならない（重複は [E0002](./errors.md)）。
- `stop-timer(N)` は reducer の文で、`N` という名前の interval を clear する。実行後、そのタイマーは発火しなくなる。未宣言のタイマー名を参照するとコンパイルエラー（[E0106](./errors.md)）。
- `stop-timer` は純粋な制御文である — slot の読み書きも effect の emit もしないので、reducer は純粋なまま。runtime は reducer の結果を適用するときに interval を clear する。
- 停止したタイマーは**自動では再開しない**。再開は再マウント時のみ。`app` の dispose 時に、全タイマー（稼働中・停止中問わず）が clear される。

```kumiki
reducer tick on=timer(1s)   do= elapsed := elapsed + 1
reducer poll on=timer(30s)  do= emit fetchUpdates()
reducer fast on=timer(100ms) do= emit syncCursor()
```

### 7.1.6 tile.mount / tile.unmount

特定の tile が DOM に現れた / 消えたタイミング。

```kumiki
reducer trackPageView
    on=tile.mount(SettingsPage)
    do= emit track({event: "settings_view", props: {}})
```

複数の tile を一度に対象にしたい場合は同名の reducer を複数定義する（定義順で実行）。

---

## 7.2 エラー処理 {#_7-2-error-handling}

Kumiki では **try/catch を許可しない**。エラーは次の経路で扱う：

### 7.2.1 期待されるエラー

`Result(T, E)` 型で表現する。effect の戻り値が `Result.Err` の場合は `effect-name.err($e, $k)` reducer に届く。

### 7.2.2 想定外のエラー（panic）

- reducer 内での `Option.get` で None を取った
- `List.get(i)` で範囲外
- `Result.get` で Err
- `panic(msg)` の明示呼び出し

これらは **panic** と呼ばれる例外。panic は episode log に記録され、現在の reducer は中断される。`slot` の変更は **トランザクション的にロールバック**される。

### 7.2.3 app.error reducer {#_7-2-3-the-app-error-reducer}

```kumiki
slot lastError : Option(PanicInfo) = None

reducer onPanic
    on=app.error
    do= lastError := Some($event)
        emit log({level: "error", message: $event.message, data: {}})
        emit toast({kind: "error", text: "Something went wrong"})
```

`PanicInfo` の型：

```kumiki
type PanicInfo = {
    message: Text,
    location: Text,         # "reducer:foo:line:42"
    episode-id: Text,
    cause: Option(Text)
}
```

---

## 7.3 エラー境界（タイル単位）

特定の tile 配下の描画エラーを捕捉して fallback を出す：

```kumiki
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

`error-boundary = X` を tile 定義に書くと、その tile 配下の描画中 panic は X tile を `in=PanicInfo` で呼び出して fallback 表示する。

> **実装ステータス.** live runtime は [エラー処理](#_7-2-error-handling) の panic モデルを実装する：reducer ディスパッチ中の panic はその episode の `slot` 変更を rollback し（部分書き込みなし）、検証 tier（`smoke` / scenario）へ surface し、`app.error` reducer（[app.error reducer](#_7-2-3-the-app-error-reducer)）を `PanicInfo` を `$event` として発火する。描画中の panic は最も近い `error-boundary` tile が捕捉する；囲う境界が**ない**描画 panic（例：ルート配下）は、イベントハンドラを未捕捉で突き抜ける代わりに組み込みのトップレベル panic 表示にフォールバックする。`panic(message)` と多相な `.get`（`None` / `Err` で panic、`.get-err` と整合）はこの同じ制御されたシグナルを送出する。

---

## 7.4 サスペンス（loading 表示）

非同期 effect の結果待ちで loading 表示したい場合。Kumiki は **明示的に `LoadResult(T)` 型を使う**ことを推奨する：

```kumiki
type LoadResult(T) = Idle | Loading | Loaded(T) | Failed(HttpError)

slot user : LoadResult(User) = Idle

tile UserView = match user with
                  | Idle      -> button(text="Load", onClick=fetchUser)
                  | Loading   -> spinner() {size: "lg"}
                  | Loaded(u) -> UserCard(u)
                  | Failed(e) -> ErrorView(e)
```

専用の `<Suspense>` 機構は持たない（Reactで起こった「どこから何が suspend するか追跡困難」を避けるため）。

### 7.4.1 match 式

```
match-expr ::= 'match' expr 'with' match-arm+
match-arm  ::= '|' pattern '->' expr
pattern    ::= identifier                              ; variant 名
             | identifier '(' bind (',' bind)* ')'     ; variant + 束縛
             | '_'                                     ; ワイルドカード
bind       ::= identifier
```

network コードはほぼ常に `match` で書く。これは Kumiki における loading/error の正規パターン。

---

## 7.5 404 と error ページ

### 7.5.1 404

`/404` への到達は通常のルートと同じ。ルートマッチに失敗するとランタイムが `nav.replace` で `/404` に飛ばす。

```kumiki
tile NotFound = page(
                  heading("404"),
                  text("Page not found"),
                  link(to="/") {text: "Home"})
```

### 7.5.2 ルート単位のエラー fallback

```kumiki
reducer onRouteErr
    on=route.error("/todos/:id")
    do= toastError := Some("Failed to load todo")
        emit navigate-replace({path: "/todos", params: {}, query: {}})
```

---

## 7.6 確認ダイアログ

Kumiki は **`window.confirm` 相当を effect として提供**する：

```kumiki
effect confirm cap=notification.show
               in={title: Text, message: Text, onYes: ReducerRef, onNo: ReducerRef}
               out=Unit

reducer askDelete
    on=ui.click(DeleteBtn)
    do= emit confirm({
            title: "削除しますか?",
            message: "この操作は取り消せません",
            onYes: doDelete,
            onNo:  noop
        })

reducer doDelete on=ui.click(_) do= ...     # ※ 実装上は別名 reducer を作る方が綺麗
reducer noop     on=ui.click(_) do= ()
```

ランタイム実装ではこれは **モーダルダイアログ tile** として描画される（ネイティブ `confirm` ではない）。これにより UI スタイルが揃い、テストも容易になる。

---

## 7.7 トースト

```kumiki
effect toast cap=notification.show
             in={kind: Text, text: Text, duration: Option(Duration)}
             out=Unit

reducer notifySave
    on=persist.ok(_, _)
    do= emit toast({kind: "success", text: "Saved", duration: Some(Duration.s(3))})
```

`kind` は `info` / `success` / `warning` / `error` のいずれか。`duration` 未指定なら kind 別のデフォルト（info 3s, success 3s, warning 5s, error 0=手動閉じ）。

ランタイムは画面右下にトーストスタックを管理する組み込み tile を持つ。

---

## 7.8 アクセシビリティの最小規約

| 規約 | 適用 |
|---|---|
| `button` には必ず `text` または `aria-label` | コンパイル時警告 |
| `image` には必ず `alt` | コンパイル時警告 |
| `link` には必ず内側テキストか `aria-label` | コンパイル時警告 |
| `form` 内の `input` には対応する `label` | コンパイル時警告 |
| キーボード操作 (Tab/Enter/Esc) はランタイムが自動 | ランタイム保証 |
| フォーカス管理: `modal` は trap focus | ランタイム保証 |
| `aria-live` 領域: `toast` と `error` で自動 | ランタイム保証 |

これらは「警告」レベルで、コンパイルは通る。`--strict-a11y` フラグで警告をエラーに昇格できる。

---

## 7.9 ホットリロード時の状態

開発時のホットリロードで slot 値を保持するか破棄するか：

| slot 修飾子 | reload 時 |
|---|---|
| なし | 維持 |
| `transient` | 破棄（初期値に戻る） |
| `volatile` | 永続化対象から外す（log にも書かれない、reload で破棄） |

```kumiki
slot draft : Text             = ""        # reload で維持
slot toast : Option(Toast)    transient = None  # reload で破棄
slot password : Text          volatile  = ""    # episode log にも書かれない
```

---

## 7.10 設計上の判断記録

| 判断 | 理由 |
|---|---|
| try/catch を許さない | エラー伝播が暗黙になる、Result で明示 |
| panic 時に slot をロールバック | 中途半端な状態を残さない |
| Suspense 専用機構を持たない | LoadResult 型で明示する方が AI に追跡しやすい |
| confirm を effect として提供 | UI 一貫性とテスト容易性 |
| a11y を警告レベルで強制 | 機械的にチェックできる項目は構造で守る |
| エラー境界を tile 属性に | tile 階層と error 階層を一致させる |

---

## 7.11 次

- テスト書き方 → [テスト](./testing.md)
- AI 編集 API → [AI 編集](./ai-edit.md)
