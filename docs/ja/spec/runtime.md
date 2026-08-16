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

#### バッチは全部通るか全部通らないかのどちらか {#a-batch-commits-all-or-nothing}

**書き込みごとに**、対象 slot の refinement（[登録済み refinement 述語](./language.md#_1-3-3-登録済み-refinement-述語)）に照らして検査する。バッチ最終値だけではない。**いずれか 1 つの書き込みでも**拒否された場合、その reducer 適用は丸ごと破棄される。slot は 1 つも書かれず、`emit` は 1 つも発行されず、`stop-timer` も走らず、再レンダリングも起きない。

バッチ単位ではなく書き込み単位なのは、バッチが map であり各 slot について最後に代入された値しか覚えていないからである。slot の範囲から出て戻ってくる `for` ループは合法な値で終わり、途中で通過した非合法な値 — 下記のとおり後続のすべての文から読める — は一度も検査されない:

```kumiki
reducer drift on=ui.click(Btn)
    do= for d in [1, 1, 1, 1, -1, -1, -1, -1] { count  := count + d    ; 4 に到達する
                                                mirror := mirror + count }
```

これは panic では**ない** — アプリは操作可能なまま、slot は無傷で、`app.error` も発火しない — が、決して沈黙しない。runtime は

```
[kumiki] reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3)). No slot was written and no effect was emitted.
```

を `console.error` に報告する。未処理の effect エラー（[標準 capability](./stdlib.md#_2-5-standard-capabilities)）と同じ経路・同じ契約であり、検証ティア（`smoke` / `runScenario` / e2e）がすべて拾う。

このルールがあるのは、もう一方の選択肢 — 拒否された slot だけを飛ばして残りを書く — が reducer を半分だけ適用し、さらに slot が一度も取らなかった値を隣の slot へ逃がしてしまうからである。body の後続文は構築途中のバッチを読むためだ:

```kumiki
type Small = nominal Int where between(0, 3)
slot count : Small = 0
slot mirror : Int  = 0

reducer bump on=ui.click(Btn)
    do= count  := count + 1      ; 上限では、この値は拒否される
        mirror := count          ; ...そしてここから読めてはならない
```

到達しうる境界はプログラム側の責任であって runtime の責任ではない。ガードは自分で書く:

```kumiki
reducer bump on=ui.click(Btn)
    do= if count < 3 then count := count + 1
```

refinement が門番を**しない**ものが 2 つある:

- **宣言時の初期値**。`slot email : Text where email = ""` は自身の refinement が拒否する値を最初から保持する。これこそが、手つかずのフォームで `error(field=email)` にメッセージを出させている仕組みである（[エラー表示](./forms.md#_5-7-エラー表示)）。
- **双方向 `bind`**。入力の拒否はフィールド単位で、報告も出ない（[refinement の扱い](./forms.md#_5-1-2-refinement-の扱い)）。入力途中の値は欠陥ではなく想定内だからである。デフォルトでは slot は以前の値を保つが、`strict=false` では新しい値を取り、代わりにフォームの `valid` フラグが false になる。

**この 2 つは組み合わさると罠になる**。宣言時の初期値が自身の refinement に違反している slot は、reducer からその初期値に*リセット*できない。`Text where nonempty` の slot に対する `name := ""` は他と変わらない書き込みなので、バッチを破棄する。slot の型を広げて境界で refine するか、空のケースを `Option` でモデル化すること:

```kumiki
slot name : Text where nonempty = ""    ; 不正な値で始まる — 許される
reducer clear on=ui.click(Btn) do= name := ""    ; 拒否される — 許されない
```

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

#190（要素同一性を保った reconciliation、§10.3.11）以降、runtime は同じ kind の
タイルを data prop 変更時に「その場で patch」するので、mount 中の `<input>` /
`<textarea>` / `<select>` は自然に browser focus を保つ。以下の snapshot / restore
層は、**丸ごと DOM を swap するパス（reconcile bailout、panic recovery、
focus 対象要素そのものを動かす keyed reorder）専用の fallback** として残す。
並べ替えで動かなかった focus 中の子はそもそもこの fallback に届かない。keyed
pass は動かす必要のある子だけを配置するので（§10.3.10）、カーソルはその要素を
離れない。

再レンダリング後も入力中の input/textarea の focus とカーソル位置を維持する:
- `bind=` がある要素: `data-kumiki-bind` 属性（nested path は full path 文字列）で再特定
- `id=` がある要素: id で再特定
- どちらもない（`value=` のみの検索ボックス等）: **DOM child-index path** で位置ベースに再特定
- `<select>` も snapshot 対象に含まれるので、reorder / bailout パスでもピッカーへの focus は復元される（open dropdown の状態は復元不能で、それは §10.3.11 の patch パス側の保証）

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
- **構造 diff も親ごとに all-or-nothing である。** 残る 2 つの離脱条件 —
  子リストの穴と、要素マッピングを持たない旧子 — は、**子を 1 件も適用する前に**
  リスト全体について決着させる。したがって親は「全ての子を reconcile する」か
  「1 件も触らずに再構築する」かのどちらかで、再構築が捨てるだけの中途半端な
  適用を残さない。これが買うのは報告の正直さである: `binds-updated`（§10.3.11）
  も診断（§10.3.12）も実際に起きたレンダを記述し、放棄されたサブツリーの
  `newMap` エントリは書かれない。
- **keyed pass は「要素マッピングの有無」を診断ではなく panic で答える。**
  要素マッピングを持たない旧子は keyed pass も止める。しかもリスト内の全ての子に
  対して同じ扱いである: reconcile / mount / remove を 1 件も行う前に旧子それぞれの
  要素を解決し、欠けていれば throw する。これは `location: "reconcile"` の panic
  として記録され、ツリーは丸ごと再構築される — `onDiagnostic` を opt-in して
  いないホストにも聞こえる。下の配置チェックのうち「実測」の側は未マップの子を
  「拒否する」のではなく意図的に「見送る」（未マップは配置スタイルではなく壊れた
  不変条件だから）ので、それを報告するのはこの panic だけである。だからこの panic は
  実測が問題なしと答えた直後、「宣言」側のチェックより前に上がる — そうしないと
  宣言側が先に降りて、不変条件違反が報告されないまま構造 diff へ流れてしまう。
  その子がこの後どうなる予定だったか — 再利用か削除か — も、報告されるかどうかを
  左右しない。
- **片側だけが空の子リストは、key を見る前に決着する。** 旧側が空なら
  対応付けるものが存在しない（新しい子は全てフレッシュマウント、古い子は
  全て退場）ので、key には照合する相手が無く、上の規則には言うことが無い。
  残るのは「新しい子をどこに置くか」だけで、それを知っているのは親の
  レンダラだけである。したがって runtime はそのレンダラを再入して内側を
  作り直し、マウント済みの要素へ移す。親は自分の要素（とそこに載っている
  ブラウザ所有の状態）を保ち、`child-count-change` も `wrapped-children` も
  報告されない。これは keyed でも unkeyed でも同じである。結果として 2 つ:
  子を包むレンダラでもこの経路は正しい（配置したのはレンダラ自身だから）、
  そしてレンダラの「子以外の内側」（`details` の `<summary>`、surface の
  content ラッパーとタイトル）は子と一緒に作り直される。
  これが「空状態 → 最初の 1 件」の遷移（空の todo リスト、初回クエリ前の
  結果セット、空のカート）である。ただしこの経路に入るのは、container の子が
  **ループだけ**の場合に限る。静的な兄弟と同居する `for` はその親の子リストを
  空にしない。
- keyed matching はさらに、**親のレンダラが子を自分の要素の直下に配置している**
  ことを要求する。key で対応付けるのは半分でしかなく、その後 reconciler は
  生存した子の移動・消えた子の削除・新入りのマウントを親要素に対して行う —
  これは親要素が保持しているスロットにしか働かない。判断は 2 つの独立した
  検査からなる。問うている内容が違うからである:
  - **マウント済みの子がどこに居るか** は DOM から実測する。レンダラ所有の
    ラッパーの下にマウントされた子があれば pass は届かないので、reconciler は
    辞退して `wrapped-children`（§10.3.12）を報告する。
  - **新入りがどこへ行くか** はレンダラの宣言された配置から読む。まだ存在
    しないスロットは実測できないからである。`overlay` は最初の子を直下に置き
    残りを包むので、1 レイヤーの overlay は「全て直下」と実測される — 成長する
    その瞬間までは。そのまま keyed pass に入れば 2 番目のレイヤーは裸で
    append されてしまう。こうした親の下で keyed リストが要素を得たとき、
    reconciler は辞退して `unplaceable-insert`（§10.3.12）を報告する。
    メンバーが変わらないレンダは置くものが無いので keyed パスのままである。

  現行の組み込みでは `overlay` が 2 番目以降の子を配置用レイヤーで包み、
  `modal` / `drawer` / `popover` は全ての子を content div で包む。ホスト製
  レンダラも「返した要素以外に子を append する」と同じ扱いになるが、宣言集合が
  カバーするのは組み込みだけなので、未知の kind は宣言どおり「直下に置く」と
  みなされる — ホストレンダラの子は root 要素の直下に置くこと。並べ替えたり
  伸ばしたりする keyed リストは素の container（`column` / `row` / `list`）の
  下に置くこと。
- 1 つの親について 2 つの diagnostic が同一レンダで出ることがある。包む親の
  keyed 子リストの長さも変わった場合、配置の辞退（`wrapped-children` または
  `unplaceable-insert`。key が使われなかった）に続いて `child-count-change`
  （結局構造 diff が親を再構築した）が出る。両者は別の事実を述べており、
  前者を直せば後者は問題にならなくなる。
- **keyed な並べ替えは最小しか動かさない。** key による対応付けが答えるのは
  「どの古い要素がどの新しい子のものか」だけで、「新しい並びを作るのに何個
  触る必要があるか」は答えない。reconciler は、古い位置が既に昇順に並んで
  いる生存子をその場に残し（残りが最小になるよう最長の並びを取る）、それ
  以外だけを後続要素の手前に挿入する。具体的には、並び順が変わらないレンダは
  DOM 配置を **1 回も行わず**、1 要素の移動は **1 回**、最悪ケース（どの 2 つも
  相対順を保たない）でも N−1 回である。
  これはスループットだけでなく正しさの保証でもある。ノードを付け直すと
  blur するので、動く理由の無かった子は focus・キャレット・開いている
  `<select>` のドロップダウン・変換中の IME を失う — keyed matching が守る
  ために存在する状態そのものである。したがって並べ替えで動かなかった
  focus 中の子は、§10.3.9 の snapshot / restore fallback に頼らずネイティブに
  それらを保つ。配置は必ず既存ノードの**手前**に対して行う。アンカーは
  新しい並びでその子の次に来る子であり、次が無い最後の子については
  「マウント済み子リスト全体の直後にある兄弟」（無ければ親の末尾）である。
  したがって子の後ろに自前の内容を置くレンダラでも、その内容は後ろに残る。

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

### 10.3.11 要素同一性を保った reconciliation (#190)

Keyed diff（§10.3.10）は「データ prop が変わらなかった」タイルの DOM 同一性を
保つ。#190 はさらに「**データ prop が変わった**が in-place で更新できる」タイル
まで保証範囲を広げ、browser 固有の状態（`<select>` の open dropdown、`<video>`
の再生位置、`<details>` の open、contenteditable のキャレット/IME composition）
がインタラクション中の再レンダーを生き残るようにした。

**コントラクト**  すべての tile-renderer モジュールは `TileRenderers`（create）
と `TilePatchers`（update）の 2 つを export する:

```ts
export type TilePatcher<K> = (
  el: HTMLElement,
  oldNode: TileNode & { kind: K },
  newNode: TileNode & { kind: K },
  ctx: TileCtx,
) => void;
```

reconcile が `oldNode.kind === newNode.kind` かつ自分自身のデータ prop に差分を
検出すると、その kind の patcher を引いて mount 中の要素を in-place で mutate
し、その後 children を通常どおり walk する（container タイルは属性変更と子
変更が同じ render で同居し得るため）。patcher がない kind は #190 以前と同じ
subtree rebuild にフォールバックするので、この機能は **段階的に採用可能**で、
runtime の全書き換えは要求しない。

**Handler-slot パターン**  再利用される要素にリスナーを多重登録してはならず
（runtime は `addEventListener` を使い、listener 参照を保持していない）、create
時に登録した listener はその時点の node クロージャに束縛される。`bind` /
`onChange` / `onClose` / `to` が render 間で変わり得るコントロールでは、各
renderer が `WeakMap<HTMLElement, Handlers>` に現在の handler を格納し、create
時に張った native listener はその slot 越しに dispatch する。`patch` は slot を
新しい node の handler で上書きするだけ。適用対象: `input`, `textarea`,
`select`, `check`, `radio`, `switch`, `slider`, `editable`, `form`, `button`,
`link`, `modal`, `drawer`, `popover`。`details` は動的 handler を持たず、
`toggle` は browser native なので slot 不要（意図的除外）。全 tile に対して
`applyUiEventHandlers` が張る `onKeyDown` / `onMouseEnter` / `onFocus` /
`onBlur` の 4 種は共通の `UI_HANDLER_STATE` slot を経由し、reconcile が patch
のたびに refresh するので、tile kind に関係なくクロージャ変更が次のイベントに
届く。

**value 書き込みのガード**  テキスト入力（`input`, `textarea`, `editable`）は
`.value === newNode.value`（`editable` は `textContent`）のときは代入を skip
（typing 中のキャレット reset を回避）。加えて `compositionstart` から
`compositionend` の間は書き込み自体を skip する — JP/CN/KR IME で候補ウィンドウ
表示中に上書きすると変換候補が中断され失われるため。slider は
`activeElement === el` のときは skip（ドラッグ中ガード）。reducer が明示的に
フィールドをクリアするケースは、外側の snapshot 層（§10.3.9）が patch 実行前に
selection range を捕捉するので、そこで復元される。

**episode log `binds-updated` への影響**  patch パスも subtree rebuild と同じ
ように `tileTouchedId(newNode)` を touched セットに push するため、
「slot `X` が変わった → タイル/bind `A`, `B` が patched」という因果は
rebuild/patch のどちらを通っても `signal-update.binds-updated`（#189）に載る。

**載るのはそのレンダを生き延びたものだけ。** 親を諦めて再構築したレンダは
その親だけを名指しし、配下は 1 つも載せない。walk は子を 1 件も適用する前に
親の運命を決めるので（§10.3.10）、自分が記述する作業より長生きする識別子を
残す「中途半端な適用」がそもそも存在しない。

### 10.3.12 reconcile の診断

keyed diff（§10.3.10）も in-place patch（§10.3.11）も、**静かに劣化する**。
subtree の identity を保てないと判断したら reconciler は再構築するか、より弱い
マッチング戦略に降りる — 常に正しく、例外も投げない。つまりアプリが毎レンダで
全ツリーを再マウントしていても、外から見る限りは健全に見える。
`MountOptions.onDiagnostic` はその判断を観測する opt-in。

```ts
mount(app, root, { onDiagnostic: (d) => console.warn(d) });
```

**契約**  sink を渡さないのが既定で、コストは fallback ごとの optional call 一段のみ。
何も計算せず何も出力しない。ビルド時フラグは存在しない — 本番マウントが無音なのは
バンドラが削ったからではなく、opt-in していないからである。

**観測は観測対象を変えない**  throw する sink は握り潰される。それを呼ぶ走査自体も
同様である — ホストタイルのフィールドを読む行為は `Object.keys` / プロパティ getter /
`Object.getPrototypeOf` をホスト所有の値に対して走らせることであり、等値カーネルは
最初の差分で短絡するので、カーネルが到達しなかった箇所で `Proxy` トラップや
アクセサが throw しうる。これらはすべて reconcile の bailout の内側で起きるため、
throw が漏れれば `location: "reconcile"` の panic として記録されツリー全体が
再構築される — このチャネルが報告するはずの identity 喪失を、報告自体が引き起こす
ことになる。走査が throw したタイルは診断されないまま、sink が無かった場合と同じ
ように描画される。sink 自身の失敗に気付くのはホストの責務である。

**報告される fallback**

全ての diagnostic は identity 保証を失ったタイルを特定する情報（`tileKind`、作者定義
タイル名があれば `tile`、および episode log と同じ `id`）を持つ。加えて reason ごとに、
その reason だけが知っている証拠を載せる — ソースを読み直さなくても対処できるように。

| reason | 証拠 | 失われたもの |
|---|---|---|
| `no-patcher` | — | タイルの data prop が変わったが、その kind に patcher が登録されていないため subtree ごと再構築した。その要素の focus / キャレット / `<select>` の open 状態 / `<video>` の再生位置が失われる。 |
| `child-count-change` | `oldCount`, `newCount` | キーの無い兄弟リストの長さが変わったため親を再構築した。全ての子に `key` を付ける（§10.3.10）とこの制限は外れ、keyed matcher が insert / remove / reorder を越えて無関係な兄弟に触れずに済む。片側が空になる変化では出ない — その境界は key の有無に関係なく親を保つ（§10.3.10）。 |
| `child-hole` | `index` | children 配列に空スロットがあった。Kumiki の codegen は nil を潰すので、これはホストが組んだタイルツリーからしか到達しない。兄弟を 1 件も適用する前に報告される（§10.3.10）ので、このレンダがしたことは親の再構築だけである。 |
| `child-unmapped` | `index`, `childKind` | 旧 child がノード → 要素マップに存在しなかった。つまり親のレンダラが `ctx.render` を通さずに子を組んでいる。見つからないものは再利用できないので、その親は毎レンダ再構築される。`child-hole` と同じく、兄弟を 1 件も適用する前に報告される。 |
| `wrapped-children` | `index`, `childKind` | 全ての子が `key` を持っていたが、親のレンダラが子を直下に置かず包んでいる（§10.3.10）ため、keyed matcher が辞退して構造 diff が走った。それ自体は何も再構築せず、失われるのは subtree ではなく「並べ替えを越えた要素同一性」である。 |
| `unplaceable-insert` | `index`, `childKind` | 全ての子が `key` を持ち、マウント済みの子は全て親の直下に居たが、`index` の新しい子は新入りで、この親のレンダラは全ての子を直下に置かない（§10.3.10）。keyed matcher が新入りをマウントできるスロットが無い。短いリストは成長するその瞬間まで「配置可能」と実測されるので、これは DOM ではなくレンダラ側から読む。それ自体は何も再構築せず、続く構造 diff が長さの変化を見れば `child-count-change` を出す。 |

再構築パスのうち 2 つは**意図的に報告しない**。`kind` の変化はその位置に別のものが
来たという意味なので、保つべき identity が無い。patcher が `PatchRequiresRebuild`
（§10.3.11）で in-place を辞退するのも正常で期待された結果であり、そのセンチネルは
まさにログを汚さないために存在する。

**再構築された親は自分の分しか報告しない。** 親を再構築する 4 つの理由 —
`no-patcher` / `child-count-change` / `child-hole` / `child-unmapped` — はいずれも
子を 1 件も reconcile する前に決まる（§10.3.10）ので、配下は検査されず、したがって
そのレンダで配下から報告されるものは何も無い（`reconcile-fallback` も
`never-equal-prop` も）。`binds-updated`（§10.3.11）と
同じ規則である — そのレンダが捨てたものは記述しない。（`wrapped-children` と `unplaceable-insert` は
何も再構築しないので、続く構造 diff は通常どおり報告する。）

代償は把握しておくこと。`no-patcher` は**設定**の事実であり — その kind に patcher が
登録されていない、そして次のレンダでも登録されていない — 毎レンダ再構築される親の
配下にある子は、その状態が続く限り見えないままになる。先に読むべきは親自身の理由で
ある。再構築を直せば、その subtree の診断は届き始める。

**ハンドラは identity で比較する**  かつて等値カーネルは任意の 2 つの関数を等値と
して扱っていた。codegen が毎レンダ新しいクロージャを作っていたため、identity で
比較すると全タイルが永久に「変化した」と判定されてしまうからである。しかしそれが
安全なのは両方のクロージャが同じ reducer へ dispatch している間だけだった。ハンドラ
**だけ**が異なる 2 つのインラインタイルを条件分岐で入れ替えると等値と判定され、要素は
そのまま再利用され、作成時の reducer へ dispatch し続けた — 無言で。

そこで codegen は reducer リストごとに 1 つのクロージャをアプリインスタンス単位で
memo 化し（§10.3.13）、カーネルは関数を他の値と同じように比較する。変わっていない
ハンドラは同一参照なので再利用パスをそのまま通り、変わったハンドラは差分になるので
patcher が走って §10.3.11 の要素ごとのハンドラスロットを更新する。

毎レンダ inline でハンドラを作り続けるホストレンダラは、自分自身とも等値にならない。
それは無言で再利用されるのではなく、後述の `function-identity` として報告される。

**決して等値になり得ない prop**  data prop が*毎レンダ*
必ず不等値になるタイルは、その kind に patcher が登録されていれば walker から見て
identity を保った成功パスそのものになる — patcher が走り、要素は生き残り、何も
degrade しない。したがって fallback は 1 件も報告されず、アプリは同じ属性を永久に
再適用し続けながら完全に健全に見える。不等値判断を読んで「2 つのレンダがどれだけ
同一でも等値になり得なかった値」を `never-equal-prop` として報告するのがこちらである。

| `cause` | ぶつかっている規則 |
|---|---|
| `non-plain-object` | `Date` / `Map` / `Set` / `RegExp` / DOM ノード / クラスインスタンス、および別 realm のオブジェクト。状態が自身の列挙可能キーの外にあるため、2 つを等値にできるのは `===` だけ（§10.3.13）— 毎レンダ作り直される値が満たすことはない。 |
| `nan` | `NaN`。定義上、自分自身と等しくない（§10.3.13）。 |
| `function-identity` | identity が変わった関数。走査は履歴を持たないので、条件分岐が memo 済みハンドラ同士を 1 回入れ替えた場合も含め、異なるクロージャ 2 つに対して発火する。常に言えるのは「この 2 つは等値になり得なかった」ことだけで、繰り返すかどうかはホストが毎レンダ作り直しているかによる。直す価値があるのはその場合で、memo 化すれば止まる。 |

対象範囲は `MountOptions.hostTileKinds` で決まり、パッケージエントリの `mount` は
`tiles` の上書きマップから導出する — built-in kind の上書きも含む。built-in の位置に
ホストのレンダラが入れば、ホスト自身の prop 慣習も一緒に持ち込まれるからである。
独自レンダラで `mountCore` を直接呼ぶホストは自分で渡す。走査対象はノード自身の
フィールドと `props` の 1 階層で、これは built-in レンダラが全て従っている慣習
（`props.onClick`, `props.onChange`）である。それより深くハンドラを埋めているホスト
タイル（`props.handlers.onClick`）は検査されない。どの cause も codegen からは出ない
ので、報告は常にホストが組んだツリーを指す。patcher の有無に関わらず
発火する — patcher があればタイルが churn していることを伝える唯一の信号であり、
無ければ再構築は既に `no-patcher` として報告されているので、こちらはその reason が
名指しできないフィールドを埋める。両方が出る場合の順序は「原因 → 結果」。

報告されるのは両側が同じ never-equal な形になってからである。plain な bag が
`Date` になった、数値が `NaN` になった、というのはそのレンダにおいては通常の変化で
あり、報告は次のレンダで出る。同一インスタンスを二度渡した場合は `===` で等値に
なるので決して報告されない。

2 つの diagnostic kind が異なるのは severity ではなくコストである。
`reconcile-fallback` はパフォーマンスとブラウザ所有の要素状態を失い、
`never-equal-prop` は毎レンダ分の diff と patch を払う。どちらもアプリは正しいまま
なので、`kumiki dev` は両方を `console.warn` に振り分ける。

**episode log との関係**  episode は「アプリが何をしたか」という作者向けの因果記録で、
subtree が再レンダされた**こと自体**は既に `signal-update.binds-updated`（§10.3.11）に
載っている。diagnostic が伝えるのは再利用ではなく再構築を選んだ**理由** — フレームワーク
内部の情報であり、アプリやホスト統合のチューニングには有用だが挙動トレースの中では
ノイズになる。互いに補完的なチャネルなので、新しい episode step kind にはしていない。

**consumer**  `smoke()` は非致命の `SmokeReport.diagnostics` に集める。各要素は
`SmokeIssue` と同じ phase / trigger を伴うので、どの操作が引き起こしたかを特定できる
（必要以上に再構築していること自体は失敗ではない。`SmokeOptions.diagnosticsAsIssues`
= `kumiki smoke --diagnostics-as-issues` で失敗扱いにできる）。`runScenario` は
再レンダを引き起こしたアクションのステップに紐付け、`kumiki run` はそのステップの下に
出力する。`kumiki smoke` は reason ごとの要約を出力する。

### 10.3.13 data prop の等値判定

§10.3.10 も §10.3.11 も「タイルの data prop が変わっていない」を起点にしている。
それを決めるのがこの規則であり、ランタイム唯一の再利用述語である。false positive は
症状の出ないまま古い要素をマウントし続け、false negative は変わっていない subtree を
再構築する。

**範囲**  比較は `TileNode` 自身のフィールドのうち `kind` / `children` / `key` を
*除いた*ものを走査する。`kind` は判別子であり、述語が走る前に決着している
（§10.3.12）。`children` は walker 自身の担当で、子はそれぞれ独立に reconcile される
ので、孫の変化が全ての祖先を再構築してはならない。`key` は keyed child matcher が
消費する identity メタデータ（§10.3.10）で、ペアが述語に届く時点で既に「同じ
インスタンス」だと確定している。

**値**  2 つの値が等値なのは次のいずれかのとき:

- 同一の値である（`===`）
- 両方が同じ長さの配列で、要素同士が等値である
- 両方が **plain な data bag**（prototype が `Object.prototype` または `null`）で、
  own キーの和集合が等値な値に対応している

明記しておくべき帰結:

- **キーが無いことと明示的な `undefined` は等値である。** `{a: 1}` と
  `{a: 1, b: undefined}` は同じタイルである。codegen は省略可能なフィールドを
  出力しないし、条件付き spread は同じ作者定義タイルからどちらの形も生む。
- **`null` は `undefined` ではなく、`0` は `false` ではなく、`""` は `0` ではない。**
  比較は常に `===` ベースであり、`==` は使わない。
- **`NaN` は `NaN` と等値ではない。** それを持つタイルは毎レンダ再構築される。
  prop の中の `NaN` は既に計算が失敗しているという意味であり、再構築が安全側で、
  churn は凍り付いたタイルより見える症状である — ホストタイルであれば
  §10.3.12 の `never-equal-prop` がフィールドを名指しする。patcher が登録されて
  いれば churn は他のどのチャネルからも見えないからである。
- **plain でないオブジェクトは自分自身以外の何とも等値にならない。** `Date` /
  `Map` / `Set` / `RegExp` / DOM ノード / クラスインスタンスは状態を自身の列挙可能
  キーの外に持つので、キー単位の比較では変わった値を「変わっていない」と報告して
  しまう。Kumiki の codegen は plain なデータしか出力しないため `.kumiki` ソース
  からは到達不能であり、ホストレンダラが渡した場合は静かな再利用ではなく再構築に
  なる。同一インスタンスを二度渡した場合は `===` で等値のままである。「plain」の
  判定は prototype 同一性で行われ、これは realm ローカルである — 別 realm
  （`<iframe>`、`vm` コンテキスト）で作られたオブジェクトは exotic として扱われ
  再構築される。安全側であり、`toString` タグ検査に緩めない理由でもある。毎レンダ
  同じタイルに渡し続けるホストは、決して勝てない diff の代償を払う。それを報告する
  のが `never-equal-prop`（§10.3.12）である。

- **関数は自分自身とのみ等値である。** ハンドラもここでは他の値と同じ値である。
  codegen は dispatch する reducer リストをキーにしたインスタンス単位の memo を通して
  全ハンドラを出力するので、同じ配線なら毎レンダ同一参照になり、変わっていないタイル
  は再利用パスをそのまま通る。一方、ハンドラ**だけ**が異なる 2 つのインラインタイルを
  条件分岐で入れ替えたときのように本当に変わった場合は、walker が扱うべき差分になる。
  毎レンダ inline でハンドラを作るホストレンダラは自分自身とも等値にならず、毎レンダ
  patch（patcher が無ければ再構築）を払う。それを `never-equal-prop`（§10.3.12）が
  `function-identity` として報告する。

循環は契約の外である。構造的に循環していて互いに別物の bag 2 つは、スタックが尽きる
まで再帰する。その throw は reconcile の bailout に落ち、ツリー全体を再構築して
`location: "reconcile"` の panic を記録する。サポート外だが、封じ込められていて可視で
ある — codegen は循環を作れないし、visited セットは 1 つの循環を防ぐために毎レンダ
コストを払うことになる。

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
- **配信される HTML は、クライアントが塗るのと同じインラインスタイルを持つ**：tile の要素と、その kind 自身のレイアウト（`column` の flex 軸、`card` の枠、`grid` のトラック）、および prop が対応付けるプロパティ（`gap` / `align` / `justify` / `pad` / `max-w` / `bg` / `radius` / `style`、テキスト tile では `color` / `size` / `weight` / `strike`）。これが無いと初期描画ではすべてのコンテナがブロックとして並び、hydration が終わった瞬間にページがリフローする — SSR が取り除くはずのレイアウトシフトそのものである。
  - **レスポンシブ**値（`{base, sm, md, …}`）は `base` に畳まれる：ブレークポイントはビューポートについての問いであり、サーバにビューポートは無い。
  - **配信されない**のは、インライン宣言では運べないもの：`transition` と `hover:` / `focus:` / `active:` ブロック、`motion` 層は注入された CSS に紐づくクラスであり、hydration 時にクライアントが付ける。イベントハンドラ・フォーカス状態・解決済みの `icon` SVG も同様 — icon は箱だけ確保するので、到着してもリフローしない。
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

### 1 つの AppShape を複数の場所にマウントする

コンパイル済みモジュールのデフォルトエクスポート（`AppShape`）は**アプリ 1 つ**であり、いくつのホストにマウントしても 1 つである（`mount` を 2 回呼んでも、`defineKumikiElement` に factory ではなく `AppShape` を渡して要素を複数置いても同じ）。各ホストは**ビュー**であり、同じ slot を映し、片方のクリックは全部を再描画し、どの要素への `setSlot` も唯一の状態への書き込みになる。

アプリが**一度だけ**持つもの — `app.init`、`app.start`、タイマー、ルータ、effect dispatcher — は最初のマウントに属する。2 つ目のビューを足しても初期化は再実行されず、タイマーが二重に刻むこともない。差分照合の状態はビューごとに持つので、DOM の同一性保持はホスト単位で働く。

**破棄もビュー単位**である。1 つのビューを dispose するとそのホストは空になり登録も外れるが、他のビューは動き続ける。アプリ自体が畳まれるのは**最後の**ビューが消えたときで、その後に同じ shape を再度マウントすれば新しく始まる。ビューの追加に `hydrate` は使えない — サーバの snapshot は**まっさらな**状態に重ねるものであり、このアプリの状態は既に生きているからである。

**独立したインスタンス**が欲しい場合は、モジュールの `createApp` factory を使う（`createApp()` ごとに固有の状態を持つ `AppShape` が返る）。

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

- 完全例 → [examples/](https://github.com/kumikijs/Kumiki/tree/main/packages/examples)
