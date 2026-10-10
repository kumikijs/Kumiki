# テスト

Kumiki のテストは **3 種類**：

1. **reducer test** — 純粋関数なので入力と期待出力で検証
2. **effect mock** — capability ガード境界でモックして dispatcher 動作を検証
3. **episode replay** — 実運用 trace を mock effect で再生して回帰検出

すべて Kumiki 言語の中で記述する（外部テストフレームワーク不要）。

## 8.1 テスト定義レイヤ

```
test-def ::= 'test' identifier '=' test-expr
test-expr ::= reducer-test | tile-test | episode-test | property-test
```

`test` 定義は **6 つ目のレイヤ**。CRDT graph に格納され、`kumiki test` で実行される。本番ビルドには含まれない。

> **実装状況.** 実装済み：`reducer-test`、`tile-test`、`property-test`（[Property テスト](#_8-3-property-tests)）、`kumiki test` ランナー（名前 / `prefix*` フィルタ、テストごとの**時間**表示 `(1ms)` / `(100 cases, 23ms)`、`--coverage`、`--watch`）、`kumiki fix --auto-patch <test-name>`（[失敗テストからの修正](#_8-7-2-fixing-from-a-failing-test)）、`expect` の**ワイルドカード**（`<any-id>` / `<slots.X>`、[ワイルドカード](#_8-2-2-wildcards)）、`reducer-test` 内の **effect 結果モック**（`given.mocks`、[Effect mock](#_8-5-effect-mock)）、および `episode-test`（[Episode リプレイ](#_8-6-episode-replay)、ランタイムの [Episode Loop](./runtime.md#_10-5-episode-loop) に支えられる）。ランナーは `PASS` / `FAIL` 行と、失敗時に `expected` / `actual` / `diff at <path>`、およびスカラーのリーフを特定できる場合は値矢印（`"a" -> "b"`）を表示する。

### 8.1.1 テスト本体が書く名前 {#_8-1-1-the-names-a-test-body-writes}

テスト本体は式ではなくスキーマである。したがって各位置は、それが何であるかに従って解決される：

| 位置 | 名前の正体 | 報告 |
|---|---|---|
| `given.slots` / `expect.slots` のキー | slot | [E0103](./errors.md#e0103-undef-ref-undef-slot) |
| `given.event.target`（`type` が `ui.*` のとき） | tile | [E0105](./errors.md#e0105-undef-tile) |
| `expect.effects` の要素 | effect（宣言されたもの、または標準 effect） | [E0104](./errors.md#e0104-undef-effect-init-not-effect-call) |
| `given.mocks` のキー | effect | [E0104](./errors.md#e0104-undef-effect-init-not-effect-call) |
| すべての式——slot の値、`given.in`、`expect.panic`、`invariant`、モックのペイロード、`episode-test` の `expect` | 式レイヤの規則どおり | E0103 / E0116 など |
| `given.slots` / `expect.slots` の値、`expect.effects` の引数、`given.mocks` のペイロード | slot の型・effect の `in=` 型・effect の `out=` の該当側の値 | [E0201](./errors.md#e0201-type-mismatch)、[E0214](./errors.md#e0214-missing-record-field)、[E0215](./errors.md#e0215-unknown-record-field) |
| `given` / `expect` の**セクション**キー | そのテスト種別が受理する閉じた集合の 1 つ | [E0714](./errors.md#e0714-test-section-unknown) |

セクション名そのものは解決すべき名前ではなく語彙であり、テスト種別ごと・節ごとに閉じている：

| テスト種別 | `given` | `expect` |
|---|---|---|
| `reducer-test` | `slots` / `event` / `mocks` | `slots` / `effects` / `panic` |
| `tile-test` | `slots` / `in` | tile 式——セクションは無い |
| `property-test` | `slots` / `event` | 無し。主張は `invariant` 節 |
| `episode-test` | 無し。読み込んだログが given | `slots-equal` / `no-panics` / `no-errors` |

その集合に無いキーは **E0714**（キー自身の位置で報告し、受理される集合を示し、十分近いものがあれば最も近い受理名を提示する）。セクションは lowering がテストの前提を読み出す場所なので、落ちたセクションはテストを弱めるのではなく別のテストに*置き換える*：`given = {slot: {count: 41}}` は何も設定せず、reducer は slot の宣言された既定値に対して走る。

落ちたキーの*中*の名前は解決しない——存在しないセクションに属しているからである。そこでもなお報告されるのは、どこに書かれていても間違っているもの：`given` の中のワイルドカードはどのセクションでも **E0109** であり、セクション名を直しても残る。


`given.event.type` が名指すのは event であり、その語彙は式レイヤではなくトリガ文法のものである。`target` が tile なのはその event が `ui.*` のときだけで、timer で駆動される reducer は timer 名を書き、effect の結果で駆動される reducer には書く名前が無い。どちらのフィールドも生成されたテストには届かない——payload は event の*その他の*フィールドから作られ、ランナーが適用する reducer はテスト自身の target である——ので、この規則はテストが何を*する*かではなく何を*言っている*かについてのものである。

テスト本体から slot は**読める**（その slot が保持する値になる）。`for-all` の名前は `given` と `invariant` の両方でスコープに入り、generator が宣言した型を持つ。`run-reducer(<reducer>)` が取るのは値ではなく reducer 名であり、呼べるのは property-test の invariant だけである（[§8.3](#_8-3-property-tests)）：trial の束縛を読む形に lowering されるため、それ以外の場所では、生成モジュールがどのテストも結果を出す前に死ぬ。

いくつかの位置は名前ではなく**形**を検査する。認識できない形に対して lowering が別の主張をしてしまうからである（[E0713](./errors.md#e0713-test-shape-invalid)）：`reducer-test` のモックが `ok(...)` / `err(...)` / `delay(...)` でなければ成功モックになり、`expect.effects` がリストでなければ「effect は何も emit されなかった」という主張になり、`given` / `expect` / `mocks`（や `given` の `mocks` / `event`）がレコードでなければ空のレコードとして読まれ、書いたはずのセットアップ・主張・台本が起きない。一段下の slot → 値のセクション——`given` の `slots`、`reducer-test` の `expect` の `slots`、`episode-test` の `expect` の `slots-equal`——も同じくレコードであり、そうでなければどの slot も設定せず、どの slot も主張しなかった。`slots-equal` だけはレコードの代わりに裸の名前 `from-log`（ログ自身の最終値）も取る。それ以外のどの位置でも、`from-log` は他と同じただの名前である。

これらが解決されるまで、テスト本体の名前は何を書いても受理され、lowering は読めないものを捨てていた：何も名指さない slot キーはテストを slot の既定値のまま走らせる——**成功**しながら、自分が用意していない前提を主張していた。`invariant` の中の未定義呼び出しはさらに悪い。property ランナーが trial の例外を捕まえて invariant の反証として描画するため、出力は無実のコードを犯人に仕立てていた。

## 8.2 Reducer テスト

```kumiki fragment
test addTodo-basic =
    reducer-test addTodo
        given = {
            slots: {todos: {}, draft: "Hello"},
            event: {type: ui.submit, target: NewTodoForm}
        }
        expect = {
            slots: {todos: {<any-id>: {text: "Hello", done: false}}, draft: ""},
            effects: [persist(<slots.todos>)]
        }
```

### 8.2.1 構文

```
reducer-test ::= 'reducer-test' identifier
                 'given'  '=' '{' 'slots' ':' record-lit ',' 'event' ':' event-lit '}'
                 'expect' '=' '{' 'slots' ':' record-lit ',' 'effects' ':' effect-list '}'

event-lit ::= '{' 'type' ':' event-pattern (',' kv)* '}'
effect-list ::= '[' (effect-call (',' effect-call)*)? ']'
```

### 8.2.2 ワイルドカード {#_8-2-2-wildcards}

`<any-id>` は「任意の生成 ID」、`<slots.todos>` は「実行後の slot 値への参照」。

ワイルドカードが書けるのは `reducer-test` の `expect` の中だけである（それ以外の場所は **E0109**）。それ以外の照合は**厳密**である。レコードはキー集合全体で比較され、決定的なテストでは予測できない穴をワイルドカードが埋める。**値**としての `<any-id>` は存在する任意の値（例えば新しく生成された id）に一致し、`<slots.X>` は slot `X` の実行後の値に一致する。**map のキー**としての `<any-id>` は、他のどれとも対応しないエントリちょうど一つと対になる。ゼロ個や二つ以上なら失敗である。**Set リテラルの要素**としての `<any-id>` は、それぞれ他のどれとも対応しない要素一つと対になる。`[<any-id>, <any-id>]` はちょうど二つの生成された要素を、`["a", <any-id>]` は `"a"` ともう一つを求める。**map のキー**や **Set リテラルの要素**としての `<slots.X>` は、値としての場合と同じく slot `X` の実行後の値を表す。`{<slots.pick>: 1}` はその値をキーとするエントリを、`["z", <slots.pick>]` は `"z"` とその値を、その値をその場所に書いた場合と同じに求める。リテラルが書く他の要素やキーと同じく、それは他と異なる自分だけの一つを求める。`pick` が `"z"` を保持するとき、`["z", <slots.pick>]` は一つのキーに二つの要素を求めることになり、二つをどの順に書いても失敗する。同じ値を保持する slot を指す二つの `<slots.X>` キーも同様である。各 `<slots.X>` はどの `<any-id>` が対になるより先に自分のキーを取るので、`[<any-id>, <slots.pick>]` は `pick` の値ともう一つを求める。ワイルドカードが代わりになれるのは要素やキーの全体だけである。構造を持つ要素やキーの内側に入れ子になったもの（`[{id: <slots.pick>}]`）は **E0109** になる。要素はその値全体でキー付けされるので、内側のワイルドカードは決して一致しないからである。部分的なレコード照合に頼るのではなく、他の非決定的なフィールドは値としてのワイルドカードで覆うこと（例：`createdAt: <any-id>`）。

### 8.2.3 バッチ規則はここにも適用される {#_8-2-3-the-batch-rule-applies-here-too}

reducer テストは*実行中のアプリ*の挙動を表明するものなので、refinement が拒否したバッチはすべての slot を `given` の値のまま残し、effect も発行しない（[batching](./runtime.md#a-batch-commits-all-or-nothing)）。拒否は `expect` ではなく `console.error` に報告される。このティアには `errorIncludes` に相当するものが無いため、`expect` ブロックだけでは「バッチが拒否された」と「reducer が何もしなかった」を区別できない。

### 8.2.4 panic を期待

```kumiki fragment
test addTodo-empty =
    reducer-test addTodo
        given = {slots: {todos: {}, draft: ""}, event: {type: ui.submit, target: NewTodoForm}}
        expect = {panic: "draft cannot be empty"}
```

### 8.2.5 route slot {#_8-2-5-the-route-slot}

`route` はプログラムが宣言するものではなくランタイムが維持する slot であり（[§3.2](./routing.md#_3-2-current-route-state)）、`given.slots` が上書きすべき `slot route` は存在しない。ハーネスが slot テーブルを宣言済み slot と `given` だけから組み立てるなら、この slot は存在せず、`route.path` を読む reducer は slot 不在で panic することになる。

ハーネスは `mount` が起点とするのと同じ空 route を、すべてのティアで seed する — `reducer-test` とその multi-step 形、`tile-test`、`property-test` 中の `run-reducer`、そして `episode-test` / `kumiki replay` の経路。route を書かないテストはその route（`{path: "/", pattern: "/", params: {}, query: {}, hash: None}`）に対して走るので、現在の route を読む reducer も特別な作法なしにテストできる:

```kumiki fragment
test route-defaults-to-empty =
    reducer-test noticed
        given  = {slots: {seen: ""}, event: {type: ui.click, target: Go}}
        expect = {slots: {seen: "/"}}
```

`given.slots` で `route` を指定すれば、現在の route で分岐する reducer を駆動できる。ここはハーネスが `mount` より*多く*やる唯一の箇所である: 一部のフィールドだけを書いた route は、書かれなかったフィールドに空 route の値を取るので、省略記法が reducer に undefined を渡すことはない。

```kumiki fragment
test route-seeded-in-part =
    reducer-test patterned
        given  = {slots: {at: "", route: {pattern: "/posts/:id", params: {"id": "7"}}},
                  event: {type: ui.click, target: Go}}
        expect = {slots: {at: "/posts/:id#7"}}
```

route 自身のフィールド（`path` / `pattern` / `params` / `query` / `hash`）以外の名前は **E0108**、record でない `route` は **E0201** である。これらが無ければ、綴り間違いは補完に飲み込まれ、テストは空 route に対して走る — 緑のまま、避けようとした分岐を実行しながら。

`expect.slots` は比較する slot を列挙するものであり、書かれなかった slot は比較されない。したがって seed した route を毎回書き直す必要はなく、テストの主題であるときは他の slot と同様に表明できる。ただし列挙された slot の値は**完全なキー集合で厳密に照合**される（[§8.2.2](#_8-2-2-wildcards)）ため、`expect` に `route` を書くときは record 全体を書く。

## 8.3 Property テスト {#_8-3-property-tests}

```kumiki fragment
test toggle-is-involution =
    property-test
        for-all = {todoId: TodoId, todos: Map(TodoId, Todo)}
        given = {slots: {todos: todos}, event: {type: ui.click, target: TodoRow, el: {todoId: todoId}}}
        invariant = run-reducer(toggle).run-reducer(toggle).slots.todos == todos
```

### 8.3.1 構文

```
property-test ::= 'property-test'
                  'for-all'    '=' record-lit       ; 生成する変数
                  'given'      '=' '{' (property-given (',' property-given)*)? '}'
                  'invariant'  '=' expr
                  ('count'     '=' int)?            ; 試行回数、1 以上（デフォルト 100）
                  ('shrink'    '=' bool)?           ; 失敗時の最小化（デフォルト true）

property-given ::= 'slots' ':' record-lit | 'event' ':' event-lit
```

`count` は 1 以上の整数である。ケースを 1 つも走らせない property は何も assert しておらず、`steps` のないシナリオと同じく成功を返してはならない（[§8.10](#_8-10-the-three-layers-of-tooling-verification)）。そのため `count = 0` は、何も検査しないまま通るテストではなく parse error になる。`0.5` や `-3` もケースの個数ではなく、いずれもリテラルの位置で同じ parse error になる：`property-test "<name>" count must be a whole number, 1 or more (got 0.5)`。

`run-reducer(name)` は reducer が残す状態 `{slots: {…}}` を返し、その `slots` はプログラムが宣言した slot（とランタイムの `route`）で型付けされる。これを通した読み取りは slot そのものの読み取りと同じように検査される: `Set(Int)` に対する `run-reducer(add).slots.tags.to-list` はキーが数値として読み戻される `List(Int)` であり（[標準ライブラリ §2.2.2](./stdlib.md#_2-2-2-set-t)）、プログラムが宣言していない slot 名は、property を反例として失敗させる `undefined` ではなく [E0108](./errors.md#e0108-undef-member) になる。

`run-reducer` のバッチを refinement が拒否した試行は**失敗する**（[batching](./runtime.md#a-batch-commits-all-or-nothing)）。reducer は実行されていないので、そのステップには返す状態が無い。開始時の状態に対して invariant を読めば、起きていないステップについて性質が成り立ってしまう — `put` が拒否される試行ではどれも `run-reducer(put).slots.pair == p` が成り立つように。失敗は反例と拒否を伴い、拒否は reducer と、拒否された書き込みを名指しする：

```
FAIL  inc-stays-in-range (1 cases, 2ms)
  expected: invariant holds for all generated inputs
  actual:   counterexample (case 1/100): {"n":3} — reducer "inc" was rejected: slot "count" cannot hold 4 (between(0, 3))
  diff at:  (property)
```

したがって property が成り立つのは、どの `run-reducer` も実行された試行の上だけである。バッチが拒否されたときに何が起きるかを表明するには reducer テストを書く。その `expect` は拒否されたバッチが残す slot を名指しする（[§8.2.3](#_8-2-3-the-batch-rule-applies-here-too)）。property を拒否から切り離すには、reducer が受け入れる入力を生成する（`n: Int where between(0, 2)`）。

### 8.3.2 ジェネレータ {#_8-3-2-generators}

各型は自動生成器を持つ：

| 型 | デフォルト生成 |
|---|---|
| `Int` | -1000 ~ 1000 |
| `Float` | -1000.0 ~ 1000.0 |
| `Text` | 0~50 文字、ASCII |
| `Bool` | true/false |
| `List(T)` | 0~10 要素 |
| `Map(K, V)` | 0~10 要素 |
| `Set(T)` | 0~10 要素 |
| `Option(T)` | 50% None / 50% Some |
| `Result(T, E)` | 50% Ok / 50% Err |
| `Unit` | `()` |
| `Tuple(T1, …, Tn)` | 各要素をそれぞれの生成器で |
| `nominal T` | T の生成器 |
| `refinement T where p` | p に制約された T を生成する |
| record `{…}` | 各フィールドを再帰的に生成する |
| union | ランダムな variant、ペイロードを再帰的に生成する |
| `G(A1, …, An)` | G の本体。パラメータは引数として生成する |
| 再帰型 | その本体を、有界の深さまで（下記） |

`for-all` の値はどれもその型の値であり、全体が組み立てられる — タプルの各要素とレコードの各フィールドは、それぞれ自身の生成器で、自身の refinement の下で生成される（`regex` は除く。下の注記を参照）。したがって `p: Tuple(Text, Int where negative)` は常に、後半が負のペアである。生成器が組み立てられない型は、プログラムの検査時に、それを名指す `for-all` フィールドで拒否される（[E0715](./errors.md#e0715-for-all-no-generator)）— 型のどこかに、`File` または `EffectId`（プラットフォームか `emit` だけが作る）、有限の値を持たない再帰型（`type Inf = {v: Int, next: Inf}`）、異なる引数で自身を適用するジェネリック（`type Grow(T) = Stop | Deeper(Grow(List(T)))`。ステップごとに新しい型になる）を含む型である。値の代わりに `null` のような代用品を渡される試行は無い。

再帰型は有界の深さまで生成される。型の中へ 4 ステップまでは、どの選択もランダムに行われる。それを越えると、各選択は最も早く終わる道を取る — それ以降のステップが最も少なくて済む variant や `Result` の結果、`None`、空のコレクション。`type Tree = Leaf | Node(Int, Tree)` は `Node` が高々 4 段の木を生成し、`type Chain = {v: Int, next: Option(Chain)}` は `None` で終わる鎖を生成し、互いを保持し合う 2 つの型は、どちらかが終われるところで終わる。再帰型は有限の値を少しでも持つならこうして終わる。1 つも持たないものは E0715 の対象である。

refinement は棄却サンプリングではなく基底の生成器への制約として畳み込まれる。`between(a, b)` は数値範囲を、`nonempty` / `len-*` は文字列長を、`positive` / `negative` は符号を制約する。`email` / `url` / `uuid` は**形**として畳み込まれ、生成器はその形の実例を組み立てる。したがって生成された値は、ランタイムが書き込みに対して適用するのと同じチェックを通る（[言語 §1.3.3](./language.md#_1-3-3-登録済み-refinement-述語)） — これらを無視する生成器は、アプリが取り得ない状態の上で性質を検査してしまう。`one-of` は列挙されたリテラルから生成する。畳み込める制約がない唯一の述語が `regex` である。任意のパターンから生成することは、パターンに照らして検査することとは別の問題だからである：`regex` で refine された型に対する `for-all` は基底型を無制約に生成するので、カスタム生成器を与えるか、ケースを手で書く。生成は**シード付き**であり（既定値はテスト名のハッシュ）、失敗したケースは実行をまたいで正確に再現する。失敗時、反例は**縮小**され（`shrink = false` で無効化）、その型の値であり続ける最小の値へ向かう（数値 → 0 またはそれに最も近い境界、文字列 → 許される最短の長さ、コレクション → 要素数を減らす、`Some` → `None`、レコードとタプル → 一部分ずつ）。したがって報告される反例は、試行が実行されえた値である。`invariant` の中の `run-reducer(name)` は、`given` のイベントを使って現在の `{slots}` 状態に reducer を適用し次の状態を返すので、手順を連鎖できる（`run-reducer(toggle).run-reducer(toggle).slots.todos`）。

カスタム生成器：

```kumiki snippet
test foo =
    property-test
        for-all = {x: Int where between(0, 100)}
        ...
```

## 8.4 Tile snapshot テスト {#_8-4-tile-snapshot-tests}

tile の構造を期待値と比較：

```kumiki fragment
test counter-display =
    tile-test App
        given = {slots: {count: 5}}
        expect = column(
                   heading("Count: 5"),
                   row(DecBtn, ResetBtn, IncBtn))
```

snapshot は深い構造比較。クラス名やスタイルは比較対象外（明示指定したものだけ）。

比較するのは、期待するノードの `kind`、順序どおりの `children`、そしてそのノードが持つ**すべての内容フィールド**である。内容フィールドとは、ビルトインがノードに載せるフィールド（`text`、`image` の `src`、`link` の `to`、`input` の `value`、`check` のチェック状態、`select` の `options`）と、それ以外にそのノードが書かれた名前付き引数（`image` の `alt`、`button` の `disabled` や `variant`、`aria-*` のラベル、`id` など）である。期待するノードが持たないフィールド（`input(value="x")` は `placeholder` を述べていない）は比較しないので、いくつものフィールドを描くタイルの 1 つだけを snapshot で主張できる。

期待するノードに何が書かれていても、次のものは比較しない：

- `{…}` ブロック：スタイル、クラス、そこに書いたそれ以外のプロパティ。`column(…) {pad: "sm"}` は余白について何も主張しない。プロパティを比較したいときは名前付き引数で書く；
- ハンドラ（`onClick=…` と、`ui.*` の購読が結びつける reducer）；
- ノードが持つ同一性と配線：`key`（`{key: …}` で書いたもの、または `for` の暗黙のキー）、コントロールの `bind`、リンクの `prefetch`。

ビルトインは、引数を省いたときにもいくつかのフィールドを補う。期待するノードはそれを他のフィールドと同じように持つ。したがって `check()` はチェックされていない check であり、`details(text("x"))` は空の summary を主張する。別の値を主張するには、その引数を書く：

| ビルトイン | 引数を省いたときに持つもの |
|---|---|
| `text`、`heading`、`button`、`label`、`link`、`markdown`、`code`、`editable` | `text: ""` |
| `link` | `to: ""` |
| `image` | `src: ""` |
| `icon` | `name: ""` |
| `check`、`switch` | チェックなし |
| `select` | `options: []` |
| `list` | `ordered: false` |
| `details` | `summary: ""` |
| `error` | `field: ""` |
| `modal`、`drawer`、`popover` | `open: true` |

`aria-*` の属性は、どう書かれていても（`aria-label="…"`、`aria` マップ、実際のタイルの `{…}` ブロック）1 つずつ別のフィールドである。`button(text="x", aria-label="Close")` はラベルを主張し、タイルが同時に描く `aria-describedby` については何も述べない。そのパスは `button.aria-label` であり、`check` / `switch` のチェック状態は、それを決める引数の名前 `value` で報告する。

不一致はフィールドのパスと値の矢印（`image.src  "/a.png" -> "/b.png"`）で報告する。`expected:` / `actual:` の行は比較したフィールドだけを表示する。実際のノードには同じ位置の期待するノードが述べるフィールドを表示するので、実際のノードだけが持つ `placeholder` や `bind` は表示されない。

```
tile-test ::= 'tile-test' identifier
              'given'  '=' '{' (tile-given (',' tile-given)*)? '}'
              'expect' '=' tile-expr

tile-given ::= 'slots' ':' record-lit | 'in' ':' expr
```

`given.in` はターゲットの引数である。そしてターゲットはプログラムが定義した tile でなければならない——生成されるテストはターゲットに `App._tilesById` 経由で到達し、そこにはユーザ定義の tile しか入っていないので、組み込み tile はターゲットになれない（[E0105](./errors.md#e0105-undef-tile)）。`tile-test` はそのターゲットを tile 本体と同じように適用する——`App._tilesById["<T>"]` に `given.in` を渡す——ので、`in=` を宣言しているターゲットには 1 つ必要、宣言していないターゲットには渡してはならず、いずれの場合も値は宣言された型と照合される：

```kumiki fragment
tile Greeting in=Text = heading("Hi, " + $1)

test greeting-renders-input =
    tile-test Greeting
        given  = {slots: {}, in: "Ada"}
        expect = heading("Hi, Ada")
```

個数の不一致は [E0213](./errors.md#e0213-call-arity-mismatch) である——引数の個数を間違えて呼ばれた tile と同じ code、同じ文言であり、これもそういう呼び出しの 1 つだからである。宣言された型が受け付けない値は、他のどの呼び出し位置とも同じく、値自身の位置での [E0201](./errors.md#e0201-type-mismatch) である。

これらの検査が無かったとき、ターゲットの宣言する `in` を省いた `tile-test` は tile を `undefined` に適用し、それを最初に読んだ時点でテスト名も位置も code も無い素の `TypeError` を投げていた。これを捕まえるものは無いので、同じファイルの他のテストも結果ごと失われた。`in=` を宣言していないターゲットに渡した `in` は捨てられ、snapshot はその値を一度も見ていない描画と比較していた。そして*型の違う* `in` はさらに静かで、個数だけでは足りなかった理由がこれである：`show` はそれを、値が無い場合とまったく同じく空文字列として描画するので、snapshot は「中身が空のラベル」と区別の付かないものと比較して通ってしまう——どの tile 呼び出しも作れない形を主張したまま。

## 8.5 Effect mock {#_8-5-effect-mock}

effect の戻り値を差し替える：

```kumiki fragment
test loadUser-success =
    reducer-test fetchUser-flow
        given = {
            slots: {users: {}},
            event: {type: ui.click, target: LoadBtn, el: {userId: "u1"}},
            mocks: {
                loadUser: ok({id: "u1", name: "Alice", email: "a@x.com"})
            }
        }
        expect = {
            slots: {users: {"u1": Loaded({id: "u1", name: "Alice", email: "a@x.com"})}},
            effects: []
        }
```

`mocks: {effect-name: ok(value) | err(error) | delay(ms, ok(value))}` で任意の effect の結果を差し替える。

mock は effect の結果の代わりに置かれるので、その結果と同じように読まれる。`.kumiki` のテストでは checker が先に payload を見て、effect の `out=` の片側に照らす（[§8.1.1](#_8-1-1-the-names-a-test-body-writes)）。`storage.*` / `session.*` / `indexed.*` の effect は `Text` で失敗するので、そこへの `err({message: "blocked"})` は **E0201** であり、テストは `err("blocked")` と書く。checker が見ない値 — [`kumiki replay --mock`](./runtime.md#_10-5-3-replay) の JSON payload や、`from-log` で replay される記録済みの `effect-end`（[§8.6](#_8-6-episode-replay)） — は、そうした effect では、その effect が provider の err 値を読むのと同じ読み方で読まれる（[標準ライブラリ §2.5](./stdlib.md#_2-5-standard-capabilities)）。scenario の effect スクリプトと同じである（[§8.10](#_8-10-the-three-layers-of-tooling-verification)）：`Text` は書いたとおり、`Text` の `message` を持つレコードはそのフィールド（`{"message": "blocked"}` は `"blocked"`）、それ以外はその JSON テキスト。したがって mock の下でも、アプリには決して入れられない値を `Text` の slot が持つことはない。それ以外の capability への `err`（`HttpError` や、カスタム capability 自身の `E`）は、書いたとおり `.err` に届く。

## 8.6 Episode replay

実運用で記録した episode log を再生して結果を検証：

```kumiki fragment
test bug-2026-05-21 =
    episode-test
        load    = "fixtures/episode-2026-05-21.log"
        mocks   = {
            loadUser: from-log,        # ログに記録された結果をそのまま返す
            persist:  ignore
        }
        expect  = {
            slots-equal: from-log,     # 最終 slot がログの記録と一致
            no-panics: true
        }
```

```
episode-test ::= 'episode-test'
                 'load'   '=' string
                 'mocks'  '=' '{' (identifier ':' mock-policy (',' identifier ':' mock-policy)*)? '}'
                 'expect' '=' '{' (episode-expect (',' episode-expect)*)? '}'

mock-policy    ::= 'from-log' | 'ignore' | 'ok' '(' expr ')' | 'err' '(' expr ')'
episode-expect ::= 'slots-equal' ':' (record-lit | 'from-log')
                 | 'no-panics' ':' bool
                 | 'no-errors' ':' bool
```

`slots-equal: from-log` は最終 slot をログが記録した値と比較する。レコードを書けば、比較する slot とその期待値をそれで名指す。

### 8.6.1 episode log の形式

→ [ランタイム](./runtime.md) で詳述。

### 8.6.2 用途

- バグ報告に付随した episode log を fixture にして regression test 化
- モデル / アルゴリズムを変更した後でも同じ入力で同じ結果が出るか確認
- スキーマ変更時に旧 log が migration できるか検証

## 8.7 ランナー

```bash
kumiki test                    # 全テスト実行
kumiki test reducer-test       # reducer-test のみ
kumiki test addTodo-*          # ワイルドカードフィルタ
kumiki test --watch            # 変更時に再実行
kumiki test --coverage         # カバレッジ (reducer/effect/tile 単位)
```

### 8.7.1 出力 {#_8-7-1-output}

```
PASS  addTodo-basic        (1ms)
PASS  toggle-is-involution (100 cases, 23ms)
FAIL  counter-display
  expected: column(heading("Count: 5"), row(...))
  actual:   column(heading("Count: 0"), row(...))
  diff at:  [0].text  "Count: 5" -> "Count: 0"
```

コンパイルできないファイルではテストはひとつも走らない。ランナーはファイルを解決済みの（絶対）パスで示し、各診断を `kumiki check` と同じく警告、エラーの順に同じ形 — `<code> <kind> at <line>:<col>: <message>` — で出力し、診断が `test` の中にあればその名前を添える：

```
compile failed (/path/to/app.kumiki):
E0713 test-shape-invalid at 8:26: `given.slots` must be a record, `{<slot>: …}` (in test "starts-at-41")
```

### 8.7.2 失敗テストからの修正 {#_8-7-2-fixing-from-a-failing-test}

`kumiki fix <file> --auto-patch <test-name>` は名前付きテストを実行し、失敗から**修正パッチを提案**する。`--apply` を付けると、テストを通し他のテストを壊さないと確かめたうえで書き込む。決定論的に証明できるものだけを修復する：

- ファイルがコンパイルできなければテストは走れない — [`fix`](./ai-edit.md) の型エラー修復（did-you-mean の名前修正、`/404` 欠落）を再利用してテストを走らせる。**同じ回帰ゲートを通る**：合成後のソースを再パース・再型検査し、報告済みの診断をひとつも解消しないか新たな診断を持ち込む場合は書き込みをロールバックする。そもそもパースできない場合も同様で、そのときは「無意味な修復」ではなくパースできなかったこととして報告される。こうして拒否された修復はファイルをバイト単位で元のまま残し、そのことを述べる — 「パッチが無い」ではないし、そこで報告される診断はファイル自身のものであって、拒否されたパッチが足すはずだったものではない。書き込みについて報告される件数はソースを実際に変えたパッチの数であり、dry run は提案した数を報告する。
- tile-test / reducer-test がスカラーのリーフで失敗した場合、実際値の出どころである唯一のソースリテラルをすべての `test` 本体の外から探し — テスト対象の定義を優先し、次にそれが参照するものを見る — 期待値への置換を提案する：
  - 実際値が*一意の*リテラルとして書かれている**文字列・数値・真偽値のリーフ**（[出力](#_8-7-1-output) のスナップショット事例や、`fn step() -> Int = 1` のような定数）。候補は**トークン全体**でなければならない：`Btn1` の中、`10` の中、文字列の中、コメントの中の `1` は候補にならない；
  - 実際値と期待値が中間の一区間だけ異なり、その区間を 1 つの文字列リテラルが含む**文字列リーフ**。そのリテラルをその場で書き換える；
  - ちょうど 1 つの reducer が `slot := slot + N`・`- N`・`* N` の形で書く**数値 slot**。オペランドを 2 つの値から解く。
- `--apply` はそのパッチを**ゲートを通して**書き込む：パッチ後のソースをディスクに書く前に再パース・再型検査・テスト実行し、コンパイルでき、名前付きテストが通り、以前通っていたテストがすべて通る場合に限り書き込む。こうして拒否されたパッチは書き込まれない — ファイルは上のコンパイル修復が残したとおりのまま（その修復が無かったなら呼び出し前とバイト単位で同一）— そして理由を述べる：パースできない、診断を持ち込む（その一覧）、テストランナーがそのソースで例外を投げる、名前付きテストが実行されない、名前付きテストがなお失敗する、以前通っていたテストを失敗させるか実行されなくする（その名前）。拒否は拒否として報告され、適用済みの修正としても生のコンパイルエラーとしても報告されない。dry run（`--apply` なし）はこのゲートを通さずにパッチを提案する。

それ以外の乖離（誤った演算子、effect リスト不一致、単一のリテラルでは説明できない値）は推測せず diff として報告する。

ここでは**警告はコンパイルエラーではない**。診断が `W02xx` だけのファイルはコンパイルが通るので、テストは走り、警告を併記したうえで振る舞いの修復が提案される。

## 8.8 統合テスト（ブラウザ駆動） {#_8-8-integration-tests-browser-driven}

E2E はランタイム外で実装する。Playwright / Cypress などの既存ツールを使う。Kumiki 側からは：

- **`test-id` prop** をすべての tile に付けられ、**`data-kumiki-test`** 属性になる
- **`data-kumiki-tile`** 属性がランタイムから自動付与され、種別を名乗る
- **`window.__kumikiApp.live`** がアプリの slot マップ——シナリオ層とブラウザ層が読む状態オラクルである

```javascript
// Playwright 例
await page.locator('[data-kumiki-test=add-btn]').click()
const todos = await page.evaluate(() => window.__kumikiApp.live.todos)
expect(Object.keys(todos)).toHaveLength(1)
```

`__kumikiApp` はコンパイルされたモジュール自身が公開する `AppShape` であり、`live` はその背後にある slot マップである。テスト用に取られた複写ではなく、ランタイムがそこから描画しているオブジェクトそのものである——読むのは安全だが、書くのは安全ではない。

## 8.9 設計上の判断記録

| 判断 | 理由 |
|---|---|
| テストを言語内に書く | 別言語にすると AI の学習対象が増える |
| reducer は純粋関数なので入出力比較で十分 | mock 不要、決定論的 |
| property test を一級市民に | reducer の不変条件を構造で検証 |
| episode replay を一級市民に | 本番バグを自動的にテスト化できる |
| E2E は外部ツール | Kumiki のスコープ外、既存ツールを尊重 |

## 8.10 ツールによる検証の 3 層 {#_8-10-the-three-layers-of-tooling-verification}

上記の `test` 定義（言語内テスト）とは別に、ツールチェインは段階的な検証を提供する。各層は前の層が捕まえられないものを捕まえる。**`check`/`build` が通っても「動く」ことの証明にはならない**点が重要である。

| 層 | コマンド | 捕まえるもの | 捕まえないもの |
|---|---|---|---|
| 1. コンパイル | `kumiki check` / `kumiki build` | 構文・型・参照解決・codegen | 実行時の挙動 |
| 2. ランタイム smoke | `kumiki smoke` | mount 例外・空描画・未処理 rejection（headless DOM に mount し、全 button/input/select を操作） | 結果の正しさ |
| 3. 振る舞いアサーション | `test` 定義 / example 固有テスト | 「結果が正しいか」（例: select が常に最後の選択肢になる等の非例外バグ） | — |

### smoke（層 2）

`kumiki smoke <file>` は、コンパイル済みアプリを headless DOM（happy-dom）に mount し、初期描画後にすべての操作可能要素へイベントを発火させ、各ステップでランタイム例外・コンソールエラー・未処理 rejection・空描画を監視する。ここでの**空**とは、テキストも、それ自体が内容となる要素（画像、コントロール、ステータス領域）もない描画を指す。空のコンテナが重なっただけの木は描画ではなく白紙である。フォームは、内側のフィールドを埋めた後に直接 submit される。`form` タイルは submit ボタンを持たないことが多く、持っていても合成クリックで submit されるかどうかは DOM ごとに異なる activation behaviour である——フォームへの直接 dispatch はどの DOM でも同じ意味になり、ボタンのないフォームで `ui.submit` reducer に到達する唯一の経路でもある。「型は通るが、ランタイムに存在しないメソッドを呼んで操作時に落ちる」「描画されない」といった、従来は人がブラウザで確認していたクラスのバグを自動で検出する。汎用であり、アプリ固有の知識を持たない。

ブラウザでの実描画（CSS レイアウト・実フォーカス等）は headless DOM では再現しきれない。そのための**実ブラウザ tier** が `@kumikijs/e2e`（Chromium / Playwright）であり、headless DOM tier と**同じシナリオ形式**で動く。状態 oracle は同じく `window.__kumikiApp.live`、表示テキストは `innerText`（可視のみ）。加えてブラウザ限定アサーションを持つ:

- `focused`: 指定セレクタが実際にフォーカスされていること（再レンダリング時のフォーカス奪取バグを検出）
- `visible` / `hidden`: 計算済みスタイル上で本当に見えている／いないこと（`display:none` 等）

このティアでも `expect` キーと操作の種類は**閉じた集合**である——scenario ティアのものから `errorIncludes` と `key` / `hover` 操作を除き、上のブラウザ限定名と `setProperty` を加えたもの。集合外のキーはページを開く前に、種類だけでなく値も含めて拒否される。`actionErrorIncludes` は除かれる側ではない。それが表明する拒否は両ティアが問う同一のルールから来るので、拒否を表明する fixture は両方で走れなければならない——ただしブラウザの constraint validation が止めた `{submit}` は例外で、それを走らせるのはこのティアだけである（[後述](#a-submit-the-form-holds-back-is-refused)）。`errorIncludes` は「エラーが報告されること」を要求するが、このティアは報告されたエラーをすべて致命として扱うため、未評価のまま放置するのではなく拒否する。操作自体が実行できなかったステップは、scenario ティアと同じく `actionError` として報告されて失敗する。fixture 側の壊れたセレクタはアプリの欠陥ではないため、常に致命として扱われるエラー一覧からは外してある。`{fill}` は Playwright 自身の拒否が言わない「何に一致したか」を挙げるため、**セレクタがラッパーへずれた場合**は両ティアで同じメッセージが読める。プラットフォームが拒否するコントロールも同様に、同じルールによって同じ言葉で拒否される。Playwright 自身の actionability より先に問う——そちらは 3 秒後に別の言葉で答え、`{focus}` に至っては何も答えないからである。また `{submit}` はイベントの dispatch ではなく `requestSubmit()` を呼ぶ。constraint validation を含めて実物を走らせることがこのティアの目的だからである。validation が止めた送信は、通過せず拒否される。`effects`（scenario ティアの capability 境界モック）は**サポートしない**。実 Chromium を実 DOM/CSS に対して走らせることがこのティアの目的であり、黙って無視すれば「リクエストはスタブされている」と信じたまま実際には外へ出ていく fixture ができてしまうため、拒否する。

重い（ブラウザバイナリ）ため既定の CI テストには含めず、フォーカス・レイアウト・実描画の確認や最終検証で使う opt-in 層。結果の**正しさ**は smoke では判定できず、層 3 のアサーションが担う。

`@kumikijs/mcp` は同等の `kumiki_smoke` を提供し、AI エージェントが編集後に自己検証できる。

### example コーパスガード：コンパイルでなくランタイム真正性

example コーパス（`packages/tests`）は「**壊れた example は決してマージされない**」という常設の保証である。コンパイルが通るだけでは足りない。lowering で落ちた値はクリーンにコンパイルされマウントもするが、空のノードを描画する。よってすべての example は:

- `strictA11y` を含めてコンパイルが通り、ランタイムが export するヘルパーだけを呼ぶ。
- headless DOM（happy-dom）にマウントでき、`smoke` を生き延び、リテラル `"undefined"` のテキストノードを描画しない。
- scenario を持つなら（app example は必ず持つ）それを通過する。

これらはブラウザバイナリ無しで既定 CI で走る。

### シナリオ実行（層 2→3 の橋渡し）と自律ループ

`kumiki run <file> <scenario.json>`（MCP: `kumiki_run_scenario`）は、アプリを**シナリオ**で駆動し、毎ステップの構造化 trace を返す。これが「人を介さない生成→実行→観測→修正ループ」の土台になる。

- **操作（action）**: `{dispatch, payload?}`（reducer を名前で発火）/ `{clickText}` / `{click}` / `{focus}` / `{blur}` / `{key, value}` / `{hover}` / `{fill, value}` / `{choose, value}` / `{navigate}` / `{submit}` / `{wait}`。`{focus}` `{blur}` `{key}` `{hover}` はセレクタ一致要素に対し実際の DOM イベント——`FocusEvent`、`value` を `key` に持つ `KeyboardEvent`、`mouseenter`——を dispatch するため、`ui.focus` / `ui.blur` / `ui.key` / `ui.hover` reducer が依存する `addEventListener` 配線層をシナリオ単独で検証できる。いずれもセレクタ一致要素に対して dispatch する。ランタイムがリスナを張るのがそこだからである。`keydown` はそこからバブルし、これが `ui.key(Container)` をフォーカス可能な子孫から駆動できる理由である。`focus` / `blur` / `mouseenter` はバブルしない（ブラウザは 1 つのイベントを伝播させるのではなく、祖先ごとに別々の `mouseenter` を発火する）。`ui.key` reducer のペイロードは `key` と `code` を運ぶが、この層で設定されるのは `key` だけである。`code` は物理キーを指し、`"Enter"` と書いたシナリオはそれを選んでいないためである。`{submit}` は `ui.submit` reducer が待ち受けるフォームイベントを dispatch する。`form` タイルは作者が付けない限り id を持たないため、セレクタはフォーム自身でもその内側の要素でもよい。bind されたフィールドがバリデーションに失敗している form は reducer を呼ばず（[forms.md §5.2.2](./forms.md#_5-2-2-submit-の挙動)）、form が送信を差し止めた `{submit}` は通過せず拒否される（[後述](#a-submit-the-form-holds-back-is-refused)）。`{fill, value}` は `input` / `textarea` / `editable` に書き込み、それ以外に当たった場合は一致した要素名を挙げて拒否する。セレクタがラッパーへずれたとき、誰も読まないプロパティを代入して通るのではなく失敗する。`{wait}` はそのステップ本来の settle に指定ミリ秒を上乗せする。debounce の待ち・retry のバックオフ・タイマーはこれで観測する（操作のないステップは settle しない）。
- **観測**: 各ステップ後に `state`（slot スナップショット）・`domText`・`errors`・`emits`（発火した effect）を記録。**実行できなかった操作**——何にも一致しないセレクタ、テキストを持たない要素への `fill`、アプリに存在しない reducer 名を指す `{dispatch}`、`#id` スコープ付き reducer を payload でその id を渡さずに指す `{dispatch}`、**プラットフォームが操作を拒否するコントロール**（[後述](#a-step-cannot-drive-a-control-the-platform-refuses)）、および **form が差し止めた**、またはブラウザの constraint validation が止めた `{submit}`（[後述](#a-submit-the-form-holds-back-is-refused)）——は `actionError` として別に記録され、そのステップを失敗させる。これは `error` ではない。アプリについて何も観測していないため、`noErrors` も `errorIncludes` もこれを見ない。両者を同じ場所にまとめていたために、fixture が自分の間違いが起きたことを assert できてしまっていた（`{"do": {"key": "#typo", "value": "Enter"}, "expect": {"errorIncludes": ["no element"]}}` は、何も押さないまま通っていた）。
- **アサーション（expect）**: `{ noErrors?, errorIncludes?, actionErrorIncludes?, state?, domIncludes?, domExcludes? }` — 上の操作一覧と同じく**閉じた集合**である。集合外のキーは無視されるのではなく実行を失敗させ、browser ティアが所有する名前（`focused` / `visible` / `hidden` / `animating` / `elementState`、および `setProperty` 操作）はそのティアを名指しして失敗する。したがって、**ブラウザティアのアサーションを含む** `.browser.json` を `kumiki run` に渡すと、何も検証しないまま通るのではなく拒否される。headless DOM で答えられるものしか assert していない fixture はそのまま実行される（コーパスに実例がある）。文書自体も同じく閉じている — `steps`（必須、かつ空でないこと：何も assert しないシナリオが成功を返してはならない）と `effects` / `defaultEffect` のみ。したがって `steps` の綴り間違いは「存在しない」と読まれるのではなく名指しで報告される。シナリオの検証は mount より前に行われ、文書中の問題はすべて一度に報告される。`state` は **slot 状態への部分一致**（ドット区切りパス可）。`errorIncludes` は `noErrors` の対になるもので、各部分文字列がそのステップ中に報告されたいずれかのエラーに含まれることを要求する。refinement が拒否した reducer バッチ（[batching](./runtime.md#a-batch-commits-all-or-nothing)）や、`.err` reducer が受け取らない effect エラーのように、runtime が*報告すること*自体が契約であるケース向けである。scenario ティア専用で、browser ティアは報告されたエラーをすべて致命として扱う。満たせるのはアプリが報告したエラーだけである——操作自体が実行できなかったステップは代わりに `actionError` を報告し、失敗する。`actionErrorIncludes` はそのもう一方のチャネルに対応するものである。各部分文字列がそのステップの `actionError` に含まれることを要求し、一致したものは `expectedActionError` へ移ってステップを失敗させなくなる。これが必要なのは、拒否そのものが fixture の表明したい挙動であることが多いためである——「保存中は save ボタンが disabled なので、クリックしても何も起きない」を書く方法はこれ以前には無く、disabled なコントロールを操作したステップは、ガードが効いていても reducer が存在しなくても同じく通っていた。逆向きにも一方通行である：拒否を要求したのに拒否されなかったステップは失敗する。したがってルールが拒否しなくなった日には、拒否を表明している fixture はすべて緑ではなく赤になる。DOM テキストではなく状態を検証できるため、「select が常に最後の選択肢になる」ような**非例外の振る舞いバグ**（人がクリックして気づくクラス）を機械的に検出できる。これは TDD の受け入れ基準（AC）を実行可能にしたものに等しい。
- **effect スクリプト**: `effects: { <name>: [{outcome, value}, ...] }` で HTTP / Storage の結果を順に差し替え、ループを決定論的・ネットワーク非依存に保つ。スクリプトした結果は provider の結果の代わりに置かれるので、provider の結果と同じように読まれる。`storage.*` / `session.*` / `indexed.*` の effect への `err` は、その effect が provider の err 値を読むのと同じ読み方で（[標準ライブラリ §2.5](./stdlib.md#_2-5-standard-capabilities)）、`out=` が宣言する `Text` として `.err` に届く。`Text` は書いたとおり、`Text` の `message` を持つレコードはそのフィールド（`{"message": "blocked"}` は `"blocked"`）、それ以外はその JSON テキスト（`42` は `"42"`）であり、`value` を書かないスクリプトは `"undefined"` になる。`value` の無い provider の err が届けるのがそれだからである。したがってシナリオが、アプリには決して入れられない値を `Text` の slot に入れることはない。それ以外の capability への `err`（`HttpError` や、カスタム capability 自身の `E`）は、スクリプトに書いたとおり `.err` に届く。
- **後始末**: 実行はレポートを返す前に自身の mount を dispose する。レポートより長生きするものは無い — `timer` reducer のインターバルは止まり、ホストのライフサイクルリスナは外れ、shape は再び mount できる状態に戻る。描画された DOM も一緒に消えるので、`domText` ではなく要素そのものを見たい呼び出し側は自分で mount する。

#### プラットフォームが拒否するコントロールはステップからも操作できない {#a-step-cannot-drive-a-control-the-platform-refuses}

シナリオは「ユーザーが操作したときこのアプリは動くか」に答えるために存在する。値を書いてイベントを dispatch するやり方はプラットフォームを迂回するため、`disabled` なフィールドへの `fill` が slot を動かし `ui.input` reducer まで走ってしまっていた——緑で、しかも製品には作れない挙動を表明した状態である。これは高くつく方向の失敗である。アプリは理由があってフィールドを無効化しており（保存処理中、権限のないユーザー）、シナリオはそこへ構わず入力し、ティアは何も検証していないのに「ガードは効いている」と報告する。

コントロールを操作する前に、1 つのルールが判断する。各操作がコントロールに要求するもの:

| 要求 | 操作 |
|---|---|
| ジェスチャ | `{click}`, `{clickText}`, `{choose}`, `{focus}`, `{blur}`, `{key}` |
| 入力 | `{fill}` |

コントロールが拒否するもの:

| 状態 | 拒否する要求 | 報告される理由 |
|---|---|---|
| `disabled` | 両方 | `disabled` |
| `readonly` | 入力 | `readonly` |
| `contenteditable="false"` | 入力 | `not editable` |

拒否されたステップは `actionError` を報告して失敗し、メッセージはコントロールと理由を名指しする。代わりに拒否そのものを表明したい fixture は `expect.actionErrorIncludes` を使う。これが照合するのは拒否だけであって `actionError` チャネル全体ではない。したがって、何にも一致しないセレクタを拒否として主張することはできない——`no element matching selector #save-disabled` は `disabled` を含んでおり、それを主張できてしまえば「何も検証しないまま通る」が一段上で再現するだけである。

このルールは 3 つのドライバすべてが問う。2 つの scenario ティアと、見つけたコントロールを片端から操作する `kumiki smoke` である。smoke は拒否されたコントロールを報告せず**スキップ**する——書かれたスクリプトを走らせるわけではないので、操作できないコントロールは誰の間違いでもない——が、そこへイベントを発火させることは両方向に嘘をついていた。到達できない button の裏にある reducer の例外をアプリの欠陥として報告し、同時に、効かなくなったガードを見えなくしていた。

意図的な帰結が 3 つある。いずれも HTML 仕様から読み取ったのではなく Chromium で実測したものである（[`disabled-controls.spec.ts`](https://github.com/kumikijs/Kumiki/blob/main/packages/e2e/tests/disabled-controls.spec.ts) がその実測をテストとして残したもの）:

- **`{hover}` はコントロール操作ではない。** Chromium は `disabled` な `<input>` にも `<button>` にも `mouseenter` を発火するので、そこに置かれた `ui.hover` reducer は実際に走る。ここで拒否すればプラットフォームに無い規則を発明することになる——これは逆向きの、そしてより悪いバグである。動いているプログラムを壊れていると報告するからだ。
- **`readonly` が拒否するのは入力だけである。** readonly な `<input>` はフォーカス可能で `keydown` も受け取るので、`{focus}` と `{key}` は通る。
- **`editable` の理由は `disabled` ではなく `not editable` である。** `disabled` と `readonly` はどちらも `contenteditable="false"` として描画され、DOM 上に両者を区別するものは無い。したがって与える理由は真であるほうを選ぶ。

`{submit}` はコントロールではなくフォームを対象とし、`{dispatch}` / `{navigate}` は DOM ではなく seam を駆動するので、いずれもこのルールを問わない。`check` / `radio` / `switch` がタイルの id を載せる `<label>` を対象にした操作は、その内側の `<input>` で判定される。ブラウザがラベルではなくコントロールで判定するからである。disabled なコントロールの*内側*を対象にした操作——`loading` な button が描くスピナーなど——はそのコントロールで判定される。ドライバが dispatch したイベントはそこへ届くからである。

#### form が差し止めた `{submit}` は拒否される {#a-submit-the-form-holds-back-is-refused}

`form` は、bind しているすべてのフィールドがバリデーションを通るときにだけ `ui.submit` reducer を呼ぶ（[forms.md §5.2.2](./forms.md#_5-2-2-submit-の挙動)）。差し止められた送信は何も残さない——エラーも状態変化もない——ため、`{submit}` ステップは reducer が走ったかどうかにかかわらず通っていた。送信を期待する fixture は、ゲートが送信を差し止めている間も緑になっていた。

form タイルは送信イベントを差し止めた bind 先の slot を書き留め、ステップは自分が起こしたイベントについてその記録を読む。差し止められた送信は `actionError` を報告してステップを失敗させ、差し止めたフィールドをすべて名指しする：`submit #email: the form held the submit back — the field bound to email fails its validation`。フィールドが 2 つ以上のときは複数形になり、slot は form のコントロールが bind する順にカンマ区切りで並ぶ：`the fields bound to email, code fail their validation`。`expect.actionErrorIncludes` は他の拒否と同じくこれを claim でき（`["the field bound to email fails its validation"]`）、送信が通ったステップでこれを要求すると失敗する。通った送信は `actionError` なしで通過し、`ui.submit` reducer を持たない form への送信も同様である（差し止めるものがない）。

両シナリオティアは、ゲートの判断を同じ記録——form タイルが書き、form を所有するアプリの mount の `_submitHeldBy` シームを通して読む——に対して同じルール（`submitFault`）で判定する。したがって form タイルが submit イベントを受け取る限り、両者は同じことを同じ言葉で報告する。メッセージが名指しするのはフィールドであって失敗の理由ではない——拒否された値、bind 先の型の値として読めないテキスト、失敗する既定値のいずれでも form は差し止める。どれだったかは、そのフィールドの `error(field=…)` が述べる。

両ティアが異なるのはイベントの届き方であり、したがって form タイルがそれを受け取るかどうかである。scenario ティアは form 自身に submit イベントを dispatch するため、**ブラウザの constraint validation を経由しない**：`required` や input の `type` が課すチェック（`type="email"`、`type="number"` など）は、そこでは何も止めない。browser ティアは `requestSubmit()` を呼び、これは先に constraint validation を走らせる。それに失敗するコントロールがあると、submit イベントが一つも発火しないまま送信が止まる——form タイルはそれを受け取らず、reducer も走らない。このステップも拒否され、各コントロールとそれが失敗した `ValidityState` のフラグを名指しする：`submit #name: the browser's constraint validation stopped the submit before the form saw it — <input type=text id=name> reports valueMissing`。`["<input type=text id=name> reports valueMissing"]` で claim できる。したがって、コントロールが constraint に失敗している form は、scenario ティアでは送信され browser ティアでは拒否されうる。両ティアで共有する fixture は constraint を満たすコントロールで駆動するか、拒否を `.browser.json` の側だけで表明する。

このように判定されるのは `{submit}` だけである。submit ボタンへの `{click}` も同じゲートを通るが、そのステップが報告するのはクリックであり、クリックはプラットフォームが届けている。暗黙の送信——フィールドでの Enter——も送信ステップではない：scenario ティアの `{key: "Enter"}` は `keydown` を dispatch するだけで、そこでの DOM はそれを送信に変えない。browser ティアには `{key}` という操作がない。送信を意図するステップは `{submit}` と書く。

なぜ Kumiki でこれが綺麗に成立するか: 状態が明示的（slot）なので oracle が信頼でき、イベントが宣言的（reducer 名）なので正確に駆動でき、effect が capability 境界でモック可能なので再現性がある。エージェントが要件から「アプリ + シナリオ（AC）」を生成し、trace を読んで自己修正することで、人は要件を一度述べるだけでよい。ループの手順は `.claude/skills/kumiki-iterate` に記述。

## 8.11 次

- AI 編集と自動修正 → [AI 編集](./ai-edit.md)
- ランタイム内部 → [ランタイム](./runtime.md)
