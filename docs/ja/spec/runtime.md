# ランタイム実装ガイド

ランタイム実装者向けに、コンパイルパイプラインと実行モデルを定義する。

## 10.1 コンパイルパイプライン

```
[CRDT graph store]
    ↓ project (selector)
[kumiki source (text view)]
    ↓ parse
[AST]
    ↓ name resolution
[resolved AST] ←─── error: undef-ref, dangling
    ↓ type check
[typed AST]   ←─── error: type-mismatch, refinement
    ↓ effect analysis
[effect-annotated AST] ←── error: cap-missing, direct-call
    ↓ purity check
[verified AST] ←── error: reducer-side-effect, tile-mutation
    ↓ lower
[IR (Kumiki Intermediate Representation)]
    ↓ codegen
[runtime artifacts]:
    • signal graph (JS or WASM)
    • effect dispatcher table
    • episode logger
    • dev-tool trace UI
```

各フェーズは独立した検査を行う。エラーは [AI 編集](./ai-edit.md) の構造化エラーで返す。

---

## 10.2 IR

中間表現は **Typed Dataflow Graph**。ノードは次のいずれか：

| ノード種 | 役割 |
|---|---|
| `slot-read` | slot からの読み取り |
| `slot-write` | slot への書き込み（reducer のみ） |
| `field-access`, `index` | record/collection 要素アクセス |
| `op`, `call` | 演算・関数呼び出し（`fn` 定義済み関数も含む） |
| `fn-body` | `fn` レイヤの本体（純粋計算、引数のみ依存） |
| `match` | union 分岐 |
| `if`, `when`, `for` | 制御 |
| `emit` | effect 放出 |
| `event-source` | event の入口 |
| `dom-node` | DOM 出力ノード |
| `dom-bind` | DOM ノードへの slot 紐付け |

エッジは依存関係（dataflow）。

### 10.2.1 IR シリアライズ形式

JSON でデバッグ可能、本番は CBOR（バイナリ）：

```json
{
  "version": "0.1",
  "slots": [
    {"name": "todos", "type": "...", "init": "...", "hash": "..."},
    {"name": "draft", "type": "Text", "init": {"text": ""}, "hash": "..."}
  ],
  "effects": [
    {"name": "persist", "cap": "storage.write", "in": "...", "out": "Unit", "policy": "debounce:300"}
  ],
  "reducers": [
    {
      "name": "addTodo",
      "on": {"kind": "ui.submit", "selector": {"tile": "NewTodoForm"}},
      "do": [
        {"op": "let", "name": "id", "value": {"op": "call", "fn": "TodoId.fresh"}},
        {"op": "slot-write", "lhs": {"slot": "todos", "key": {"var": "id"}}, "rhs": "..."},
        {"op": "slot-write", "lhs": {"slot": "draft"}, "rhs": {"text": ""}},
        {"op": "emit", "name": "persist", "args": [{"slot-read": "todos"}]}
      ]
    }
  ],
  "tiles": [
    {
      "name": "App",
      "body": {"kind": "page", "children": [...]},
      "deps": ["slot:todos", "slot:draft", "tile:TodoList", "fn:matchFilter"]
    }
  ],
  "fns": [
    {
      "name": "matchFilter",
      "params": [{"name": "t", "type": "Todo"}, {"name": "f", "type": "Filter"}],
      "ret": "Bool",
      "body": {"op": "match", ...},
      "hash": "..."
    }
  ],
  "app": {
    "name": "TodoApp",
    "caps": ["storage.read", "storage.write"],
    "routes": {"/": "App", "/404": "NotFound"},
    "init": [{"emit": "loadTodos", "args": []}],
    "theme": "DefaultTheme"
  }
}
```

---

## 10.3 Signal Graph

ランタイムは IR から **静的 signal graph** を生成する。Solid 風の fine-grained reactivity だが、Kumiki では**コンパイル時にグラフ構造が完全に決まる**（実行時にシグナル追跡しない）。

### 10.3.1 ノード種

| ノード | 入力 | 出力 |
|---|---|---|
| `SlotNode` | – | slot 値 |
| `ComputeNode` | 上流ノードの値 | 派生値 |
| `BindNode` | 上流ノードの値 | DOM 操作 |
| `EventNode` | DOM event | reducer 呼び出し |

### 10.3.2 更新アルゴリズム

```
on reducer execution:
    collect modified slots into Set<SlotId>
    for each modified slot:
        for each downstream ComputeNode/BindNode (precomputed):
            mark dirty
    process dirty queue in topological order:
        recompute ComputeNode
        apply BindNode → DOM mutation
```

依存関係はコンパイル時に静的に解析されているので、実行時の追跡コストは 0。

### 10.3.3 batching

1 つの reducer 実行内のすべての slot 変更は **1 つのバッチ**として扱う。`for` ループ内の連続変更も同一バッチ。バッチ確定後に signal graph を 1 度だけ更新する。

### 10.3.4 DOM レンダリングの不変条件

- **null/undefined 子ノードは skip される**。`when(false, X)` のような偽分岐は `null` を子に渡すが、`renderTile` はそれを無視して兄弟だけを描画する
- **`column` / `row` / `card` / `box` / `panel` / `stack` / `region` / `scroll` / `fieldset`** はすべて `<div>` ベースのコンテナ。`stack` は `column` 相当（vertical stack）
- **`grid`** は `display: grid` + `cols` prop で `grid-template-columns: repeat(N, 1fr)` （数値）または直接 CSS 値（文字列）
- **`divider`** は `<hr>` 単独要素（children なし）
- **timer reducer** は `setInterval` で発火、app の `dispose` 時に `clearInterval` で停止

### 10.3.5 input/textarea/select の bind path

`bind=draft.title` のように **nested lvalue path** に bind できる。ランタイムは：
- 表示: `_live[root][...path]` を辿って初期値を読む
- 変更: 入力イベントで `_setPath` を使い root slot を immutable に更新
- focus 復元: `data-kumiki-bind` 属性に full path 文字列 (`"draft.title"`) を入れて識別

### 10.3.6 動的 theme switching

`app theme = themeName` のように **slot 名で theme を指定**できる。ランタイムは：
- `app.themeName` が `app.themes` に存在しなければ、`_live[app.themeName]` を読んで theme 名を解決
- 各 `render()` の冒頭で `applyThemeDefaults` を再実行 → slot 値の変更が body スタイルに反映

```kumiki
slot themeName : Text = "Light"
theme Light = { colors: {bg: "#fff", fg: "#222"}, ... }
theme Dark  = { colors: {bg: "#222", fg: "#eee"}, ... }
reducer toggle on=ui.click(ThemeBtn) do= themeName := if themeName == "Light" then "Dark" else "Light"
app App ... theme = themeName    ; ← slot 名を渡す
```

### 10.3.7 polymorphic collection methods

`.filter` / `.map` / `.get-or` などはランタイムで型 dispatch:
- `.filter(pred)`: Array なら `Array.prototype.filter`、Object なら `mapFilter`
- `.map(fn)`: Array なら要素 map、Option/Result なら Some/Ok の中身に map (`mapOver`)
- `.flat-map(fn)`: Option/Result の Some/Ok を f に渡し、None/Err は素通り (`flatMapOption`)
- `.get-or(default)` (Option) / `.get-or(key, default)` (Map): 引数数で判別
- `m.entries` は `[[k, v], ...]` で返り、後続の list ops の lambda は `$1=k, $2=v` に自動 destructure される

### 10.3.8 select の値マッチング

`select(value=v, options=[...])` は option の選択状態を **構造的キー**で判定する:
- variant は `_tag` + payload を再帰的にシリアライズしてキー化する。`Some(Backlog)` と `Some(InProgress)` は別キーになる（フラットな `_tag` 比較だと両者が `"Some"` で衝突するため、payload まで含めることが必須）
- `Option(Status)` のような「variant でラップした variant」を option 値にできる

### 10.3.9 focus 復元

再レンダリング後も入力中の input/textarea の focus とカーソル位置を維持する:
- `bind=` がある要素: `data-kumiki-bind` 属性（nested path は full path 文字列）で再特定
- `id=` がある要素: id で再特定
- どちらもない（`value=` のみの検索ボックス等）: **DOM child-index path** で位置ベースに再特定

### 10.3.10 安定タイル identity

compiler↔runtime のタイル木コントラクトが keyed reconcile 用のインスタンス
identity フィールドを持つ（#187 で diff カーネルを、#188 で end-to-end 配線）:

```ts
type TileNode = (/* … kind variants … */) & { readonly key?: string };
```

**コントラクト**

- `key` は **additive で optional**。key を持たないタイルも合法な `TileNode`
  で、key を含まない旧コンパイル出力は新 runtime でそのまま mount し、逆に
  新コンパイラの keyed 出力も旧 runtime で（key を無視して）動く。
- reconciler は **親ごとに all-or-nothing** で keyed matching を判断する: ある
  レベルの全子が `key` を持つときのみ key で pairing し、reorder/insert/remove
  を親サブツリー再構築なしで乗り越える。1 つでも key を欠く子があれば、
  #187 以前と同じ構造 diff（位置 + `kind` + データプロップ等価、length 変化 →
  再構築）にフォールバックする。

**コンパイラの emit**

1. **作者が書いた `{key: <expr>}`** はタイル呼び出しのプロップから剥がされ、
   emit される `TileNode` のトップレベル `key` に置かれる。値は `_s.show(...)`
   で文字列化される。`props.el` には流れない。
2. **`for` 反復の内側** で `{key: ...}` を書いていないタイル呼び出しには、
   ループ変数から `_s.show(<loopVar>)` を暗黙 key として合成する。明示 key
   が常に優先。ネストした `for` は内側のループ変数で上書きされ、`for i in
   inner` 配下のタイルは外側の `for o in outer` の影響を受けず `_s.show(i)`
   になる。
3. **ユーザタイル境界** は外側の暗黙 key を body に持ち込まない。`_wk` は
   境界ノードそのものに巻かれ、body 側の identity は body が反復すれば
   body 自身で組む。
4. **`TileWhen` / `TileIf` / `TileMatch`** は透過。タイルを emit する分岐に
   暗黙 key を素通しで伝える。

**runtime の消費**  `packages/runtime/src/core.ts` の reconciler が
`oldNode.key` と `newNode.key` を子リストレベルで参照する。`key` は
`TILE_SKIP_TOP` に含まれ、key の変化だけでは親の `replaceWithFreshTile` を
起こさない — key は「どの旧子がどの新子と対応するか」を決めるだけで、
タイル自体が再構築されるかどうかを決めるものではない。

**Migration**  runtime とコンパイラは matched pair として同じ minor bump で
リリースする。片側だけでも壊れない（graceful degradation）が、`<select>`
value / `<input>` focus と caret / event listener が insert/remove/reorder を
またいで保持されるという保証は両方が揃って初めて成立する。

---

## 10.4 Effect Dispatcher

reducer から emit された effect を実行する責務。

### 10.4.1 受付

reducer が完了すると、emit された effect 集合がディスパッチャに渡される：

```
[{name: "persist", args: {...}, key: <derived>, policy: "debounce:300"}, ...]
```

### 10.4.2 capability check

各 effect の `cap` が `app.caps` に含まれるか検査。違反は実行せず `app.error` に通知。

### 10.4.3 policy 処理

| policy | 実装 |
|---|---|
| 並列 (default) | 即時 dispatch |
| `latest` | 同名の走行中 effect を cancel、新規を開始 |
| `latest-per-key(k)` | (effect-name, key) 単位で同上 |
| `queue` | FIFO で逐次実行 |
| `debounce(d)` | 同名の呼び出しを d ms 待って最後だけ実行 |
| `throttle(d)` | 同名で d ms 以内の追加呼び出しを破棄 |
| `once` | 同 in の呼び出しを破棄 |

### 10.4.4 retry

`retry=...` 指定がある場合、`Err` 結果かつ 5xx/network エラーで再試行。指数バックオフは jitter ±20% を加える。

### 10.4.5 結果の配送

effect 完了時、結果を `<effect-name>.ok($value, $key)` / `<effect-name>.err($error, $key)` イベントとしてランタイムに通知。マッチする reducer が実行される。

### 10.4.6 標準 capability の実装

| capability | 実装 |
|---|---|
| `http.*` | `fetch()` |
| `storage.*` | `window.localStorage` |
| `session.*` | `window.sessionStorage` |
| `indexed.*` | IndexedDB API |
| `nav.*` | History API |
| `clipboard.*` | Clipboard API |
| `notification.show` | 組み込み tile (toast/confirm/modal) |
| `analytics.*` | hook (アプリ起動時に `app.analytics` で実装注入) |
| `log.*` | `console.*` + 任意 hook |
| `crypto.*` | Web Crypto API |
| `media.*` | MediaDevices API |
| `geo.*` | Geolocation API |
| `socket.*` | WebSocket |

---

## 10.5 Episode Loop {#_10-5-episode-loop}

1 つのトリガから派生する因果列を 1 つの **episode** として記録する。

### 10.5.1 episode の構造

```json
{
  "id": "ep_01JC...",
  "trigger": {"kind": "ui.click", "target": "AddBtn", "payload": {...}, "ts": ...},
  "steps": [
    {"kind": "reducer", "name": "addTodo", "slot-diffs": [...], "emits": ["persist"], "ts": ...},
    {"kind": "effect-start", "name": "persist", "args": {...}, "ts": ...},
    {"kind": "effect-end", "name": "persist", "result": "ok", "value": "()", "ts": ...},
    {"kind": "signal-update", "dirty-slots": ["todos"], "binds-updated": ["TodoList.row.0", ...], "ts": ...}
  ],
  "status": "completed" | "panic" | "cancelled" | "ongoing"
}
```

**遅延 policy effect の帰属。** `policy=debounce(d)` で emit された effect は、トリガとなった reducer の episode が一旦閉じた *後* に `setTimeout` が満了する。そのため dispatcher は `effect-start` step (とその episode トークン) を *launch 時* ではなく *dispatch 時* に確保し、満了後の `effect-end` および `.ok` / `.err` reducer 連鎖が元 episode 上に着地するようにする — 因果連鎖は一本に保たれる。`debounce` timer が発火前に置換された場合、元 episode に `effect-cancel` step (`targetId = <effect-name>`) を残し、その episode は `effect-end` なしで `status="completed"` として commit する。`policy=throttle(d)` は先頭呼び出しを同期 `launch` するため (通常の同期パスで `effect-start` が attach される)、window 内の後続 dispatch は黙って抑制される — 元 reducer の `emits` には抑制された effect 名が残るが、続く `effect-start` は出ない。

### 10.5.2 episode store

- メモリに直近 N 件（デフォルト 100）
- localStorage に直近 M 件（デフォルト 20、サイズ上限 5MB）
- 開発時は `--episode-log /path/to/log.jsonl` でファイル書き出し

### 10.5.3 replay

```bash
kumiki replay <episode-id>                  # signal graph を初期状態から再生
kumiki replay --from-log <file>             # ファイルから読み込んで再生
kumiki replay --mock 'loadUser: from-log'   # effect mock 指定
kumiki replay --until-step 5                # 途中まで
```

---

## 10.6 SSR / Edge / Client 分割

### 10.6.1 SSR

- HTML 生成は **server-side** で初期 route の tile を 1 回描画
- slot 初期値は `app.init` で emit した effect の結果を含めても良い（hydration 時に再実行しない）
- レスポンス bundle 構成：
  - HTML（初期 tile 描画結果）
  - JSON（初期 slot snapshot）
  - JS（signal graph + effect dispatcher）

### 10.6.2 Hydration

- クライアント JS が起動
- 初期 slot snapshot を読み込んで signal graph に反映
- event handler を DOM に attach
- `app.start` reducer を発火（注意：SSR 中は実行しない、hydration 後のみ）

### 10.6.3 Edge

Cloudflare Workers / Vercel Edge 等での SSR：

- effect dispatcher の一部（`http.*`, `storage.kv.*`）を edge 側で実行
- 残りはクライアントに deferred
- bundle サイズ予算：runtime 30KB + app code（ターゲット）

---

## 10.7 開発サーバ

```bash
kumiki dev                          # 開発サーバ起動
kumiki dev --port 5173
kumiki dev --episode-log ./eps.log
kumiki dev --strict-a11y
```

機能：

- ホットリロード（コード変更時、slot は維持）
- error overlay（panic 時に詳細表示）
- episode timeline panel（最近の episode を視覚化）
- inspector（slot 値、tile ツリー、依存グラフ）

---

## 10.8 ビルド

```bash
kumiki build                        # 本番ビルド
kumiki build --target=spa           # SPA only
kumiki build --target=ssr           # Node.js SSR
kumiki build --target=edge          # Edge runtime
kumiki build --target=static        # 静的サイト
kumiki build --analyze              # bundle 分析
```

出力構成：

```
dist/
├── index.html
├── assets/
│   ├── app-<hash>.js
│   ├── app-<hash>.css         ← reset + theme トークン展開のみ
│   └── icons-<hash>.svg
├── server/                    ← SSR/Edge 時のみ
│   └── entry.js
└── manifest.json
```

---

## 10.9 ランタイム API（埋め込み用）

ホストアプリから Kumiki アプリを埋め込む場合：

```javascript
import { mount } from "kumiki/runtime"

const app = mount({
  target: document.getElementById("app"),
  bundle: "/assets/app.js",
  initialSlots: { /* ... */ },
  effectHandlers: {
    "analytics.send": (event, props) => myAnalytics.track(event, props)
  }
})

app.dispatch({ kind: "ui.click", target: "AddBtn", payload: {} })
app.slots.todos                       // read-only
app.episodes                          // 最近の episode
app.unmount()
```

---

## 10.10 標準ライブラリの実装責務

[標準ライブラリ](./stdlib.md) で列挙したビルトインは、ランタイム実装が次の挙動を保証する：

| 機能 | 保証 |
|---|---|
| `Map`, `Set`, `List` | 純粋（in-place mutation なし） |
| `Option`, `Result` | パターンマッチ網羅検査 |
| `Time.now`, `math.random` | reducer 内のみ呼び出し可、episode log に記録 |
| `*.fresh()` | UUIDv7 を生成 |
| `panic()` | episode を `panic` 状態にして slot をロールバック |

---

## 10.11 パフォーマンス予算

| 項目 | 予算 |
|---|---|
| ランタイム本体 | ~30KB gzip |
| 1 reducer 実行時間 | < 1ms (typical) |
| signal graph 更新 | < 16ms (60fps) |
| effect dispatch overhead | < 0.1ms |
| episode log 書き込み | < 0.5ms (memory) |

これらを満たすため、ランタイムは Rust → WASM（オプション）または手書き JS（デフォルト）。

---

## 10.12 設計上の判断記録

| 判断 | 理由 |
|---|---|
| signal graph は静的 | 実行時依存追跡を排除、性能と予測可能性 |
| バッチ更新 | 連続変更で 60fps を超えないよう |
| effect は dispatcher 経由 | capability ガードとログを構造で担保 |
| episode = trigger 単位 | デバッグ・テスト・audit を一つの単位に統合 |
| SSR と CSR は同じ IR を食う | ターゲット差は dispatcher の実装差のみ |
| ランタイム 30KB 目標 | モバイル / Edge での実用性 |

---

## 10.13 次

- 完全例 → [examples/](https://github.com/kage1020/Kumiki/tree/main/packages/examples)
