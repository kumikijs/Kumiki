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

> **実装状況.** 実装済み：`reducer-test`、`tile-test`、`property-test`（[Property テスト](#_8-3-property-tests)）、`kumiki test` ランナー（名前 / `prefix*` フィルタ、テストごとの**時間**表示 `(1ms)` / `(100 cases, 23ms)`、`--coverage`、`--watch`）、`kumiki fix --auto-patch <test-name>`（[失敗テストからの修正](#_8-7-2-fixing-from-a-failing-test)）、`expect` の**ワイルドカード**（`<any-id>` / `<slots.X>`、[ワイルドカード](#_8-2-2-wildcards)）、`reducer-test` 内の **effect 結果モック**（`given.mocks`、[Effect mock](#_8-5-effect-mock)）。ランナーは `PASS` / `FAIL` 行と、失敗時に `expected` / `actual` / `diff at <path>`、およびスカラーのリーフを特定できる場合は値矢印（`"a" -> "b"`）を表示する。仕様化済みで**未実装**：`episode-test`（ランタイムの episode loop [Episode Loop](./runtime.md#_10-5-episode-loop) が前提）。

### 8.1.1 テスト本体が書く名前

テスト本体は式ではなくスキーマである。したがって各位置は、それが何であるかに従って解決される：

| 位置 | 名前の正体 | 報告 |
|---|---|---|
| `given.slots` / `expect.slots` のキー | slot | [E0103](./errors.md#e0103-undef-ref-undef-slot) |
| `given.event.target` | tile | [E0105](./errors.md#e0105-undef-tile) |
| `expect.effects` の要素 | effect | [E0104](./errors.md#e0104-undef-effect-init-not-effect-call) |
| `given.mocks` のキー | effect | [E0104](./errors.md#e0104-undef-effect-init-not-effect-call) |
| すべての式——slot の値、`given.in`、`expect.panic`、`invariant`、モックのペイロード、`episode-test` の `expect` | 式レイヤの規則どおり | E0103 / E0116 など |

`given.event.type` が名指すのは event であり、その語彙は式レイヤではなくトリガ文法のものである。テスト本体から slot は**読める**（その slot が保持する値になる）。`for-all` の名前は `given` と `invariant` の両方でスコープに入り、generator が宣言した型を持つ。`run-reducer(<reducer>)` が取るのは値ではなく reducer 名である（[§8.3](#_8-3-property-tests)）。

これらが解決されるまで、テスト本体の名前は何を書いても受理され、lowering は読めないものを捨てていた：何も名指さない slot キーはテストを slot の既定値のまま走らせ、tile を名指さない event target はテストを target 無しで走らせる——どちらも**成功**しながら、自分が用意していない前提を主張していた。`invariant` の中の未定義呼び出しはさらに悪い。property ランナーが trial の例外を捕まえて invariant の反証として描画するため、出力は無実のコードを犯人に仕立てていた。

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

### 8.2.3 バッチ規則はここにも適用される

reducer テストは*実行中のアプリ*の挙動を表明するものなので、refinement が拒否したバッチはすべての slot を `given` の値のまま残し、effect も発行しない（[batching](./runtime.md#a-batch-commits-all-or-nothing)）。拒否は `expect` ではなく `console.error` に報告される。このティアには `errorIncludes` に相当するものが無いため、`expect` ブロックだけでは「バッチが拒否された」と「reducer が何もしなかった」を区別できない。

### 8.2.4 panic を期待

```kumiki fragment
test addTodo-empty =
    reducer-test addTodo
        given = {slots: {todos: {}, draft: ""}, event: {type: ui.submit, target: NewTodoForm}}
        expect = {panic: "draft cannot be empty"}
```

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
                  'given'      '=' record-lit
                  'invariant'  '=' expr
                  ('count'     '=' int)?            ; 試行回数（デフォルト 100）
                  ('shrink'    '=' bool)?           ; 失敗時の最小化（デフォルト true）
```

### 8.3.2 ジェネレータ

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
| `nominal T` | T の生成器 |
| `refinement T where p` | T を生成して p を満たすまで rejection |

カスタム生成器：

```kumiki snippet
test foo =
    property-test
        for-all = {x: Int where between(0, 100)}
        ...
```

## 8.4 Tile snapshot テスト

tile の構造を期待値と比較：

```kumiki fragment
test counter-display =
    tile-test App
        given = {slots: {count: 5}, in: ()}
        expect = column(
                   heading("Count: 5"),
                   row(DecBtn, ResetBtn, IncBtn))
```

snapshot は深い構造比較。クラス名やスタイルは比較対象外（明示指定したものだけ）。

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

### 8.7.2 失敗テストからの修正 {#_8-7-2-fixing-from-a-failing-test}

`kumiki fix <file> --auto-patch <test-name>` は名前付きテストを実行し、失敗から**修正パッチを提案**する。`--apply` を付けると書き込んで再実行する（テストが通るようになったか、他テストが退行したかを報告）。決定論的に証明できるものだけを修復する：

- ファイルがコンパイルできなければテストは走れない — [`fix`](./ai-edit.md) の型エラー修復（did-you-mean の名前修正、`/404` 欠落）を再利用してテストを走らせる。
- tile-test / reducer-test が、実際値が*一意の*ソースリテラルである**文字列リーフ**で失敗した場合、そのリテラルを期待値に置換する（[出力](#_8-7-1-output) のスナップショット事例）。

リテラルでない乖離（数値 slot、誤った演算子、effect リスト不一致）は推測せず diff として報告する。

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

このティアでも `expect` キーと操作の種類は**閉じた集合**である——scenario ティアのものから `errorIncludes` と `key` / `hover` 操作を除き、上のブラウザ限定名と `setProperty` を加えたもの。集合外のキーはページを開く前に、種類だけでなく値も含めて拒否される。`errorIncludes` は「エラーが報告されること」を要求するが、このティアは報告されたエラーをすべて致命として扱うため、未評価のまま放置するのではなく拒否する。また `{submit}` はイベントの dispatch ではなく `requestSubmit()` を呼ぶ。constraint validation を含めて実物を走らせることがこのティアの目的だからである。`effects`（scenario ティアの capability 境界モック）は**サポートしない**。実 Chromium を実 DOM/CSS に対して走らせることがこのティアの目的であり、黙って無視すれば「リクエストはスタブされている」と信じたまま実際には外へ出ていく fixture ができてしまうため、拒否する。

重い（ブラウザバイナリ）ため既定の CI テストには含めず、フォーカス・レイアウト・実描画の確認や最終検証で使う opt-in 層。結果の**正しさ**は smoke では判定できず、層 3 のアサーションが担う。

`@kumikijs/mcp` は同等の `kumiki_smoke` を提供し、AI エージェントが編集後に自己検証できる。

### example コーパスガード：コンパイルでなくランタイム真正性

example コーパス（`packages/tests`）は「壊れた example は決してマージされない」という常設の保証である。全 example が*コンパイルする*ことだけのアサートでは不十分だ：lowering で落ちた値引数はクリーンにコンパイルされマウントもするが、空だが存在するノードを描画する——「コンパイルは通るが実際は壊れている」状態で、層 1 にも層 2 の「空でない／throw しない」基準にも見えない（`03-union-and-match` の見出しバグが `_s.show(undefined)` に lower されて緑で出荷されたのはまさにこれ）。よってコーパスガードは dropped-expression クラスについて**ランタイム真正性**もアサートする：

- **静的 codegen スキャン。** すべての値保持 display tile（`heading` / `text` / `button` / `label` / `link` / `markdown` / `image` / `icon` / `input`・`textarea` の value）は値を `show(...)` で lower する。これらいずれかの位置で落ちた式は厳密なトークン `show(undefined)` として現れる。Kumiki ソースに `undefined` リテラルは無いため、このトークンは dropped expression からしか生じ得ない——偏在する良性 `undefined`（reducer の読み戻しや selector 無し reducer）とは別物のゼロ誤検出センチネルである。いずれかの example の生成 JS にこれが含まれればコーパスは失敗する。
- **描画 DOM スキャン。** 各 example を headless DOM（happy-dom）にマウントし、リテラル `"undefined"` であるテキストノードを描画しないことをアサートする。センチネルが拾わない経路で DOM に届く生の `undefined` を捕捉する。

これらはブラウザバイナリ無しで既定 CI で走り、再混入した dropped-expression バグは緑で出荷されずビルドを失敗させる。

### シナリオ実行（層 2→3 の橋渡し）と自律ループ

`kumiki run <file> <scenario.json>`（MCP: `kumiki_run_scenario`）は、アプリを**シナリオ**で駆動し、毎ステップの構造化 trace を返す。これが「人を介さない生成→実行→観測→修正ループ」の土台になる。

- **操作（action）**: `{dispatch, payload?}`（reducer を名前で発火）/ `{clickText}` / `{click}` / `{focus}` / `{blur}` / `{key, value}` / `{hover}` / `{fill, value}` / `{choose, value}` / `{navigate}` / `{submit}` / `{wait}`。`{focus}` `{blur}` `{key}` `{hover}` はセレクタ一致要素に対し実際の DOM イベント——`FocusEvent`、`value` を `key` に持つ `KeyboardEvent`、`mouseenter`——を dispatch するため、`ui.focus` / `ui.blur` / `ui.key` / `ui.hover` reducer が依存する `addEventListener` 配線層をシナリオ単独で検証できる。いずれもセレクタ一致要素に対して dispatch する。ランタイムがリスナを張るのがそこだからである。`keydown` はそこからバブルし、これが `ui.key(Container)` をフォーカス可能な子孫から駆動できる理由である。`focus` / `blur` / `mouseenter` はバブルしない（ブラウザは 1 つのイベントを伝播させるのではなく、祖先ごとに別々の `mouseenter` を発火する）。`ui.key` reducer のペイロードは `key` と `code` を運ぶが、この層で設定されるのは `key` だけである。`code` は物理キーを指し、`"Enter"` と書いたシナリオはそれを選んでいないためである。`{submit}` は `ui.submit` reducer が待ち受けるフォームイベントを dispatch する。`form` タイルは作者が付けない限り id を持たないため、セレクタはフォーム自身でもその内側の要素でもよい。`{wait}` はそのステップ本来の settle に指定ミリ秒を上乗せする。debounce の待ち・retry のバックオフ・タイマーはこれで観測する（操作のないステップは settle しない）。
- **観測**: 各ステップ後に `state`（slot スナップショット）・`domText`・`errors`・`emits`（発火した effect）を記録。
- **アサーション（expect）**: `{ noErrors?, errorIncludes?, state?, domIncludes?, domExcludes? }` — 上の操作一覧と同じく**閉じた集合**である。集合外のキーは無視されるのではなく実行を失敗させ、browser ティアが所有する名前（`focused` / `visible` / `hidden` / `animating` / `elementState`、および `setProperty` 操作）はそのティアを名指しして失敗する。したがって、**ブラウザティアのアサーションを含む** `.browser.json` を `kumiki run` に渡すと、何も検証しないまま通るのではなく拒否される。headless DOM で答えられるものしか assert していない fixture はそのまま実行される（コーパスに実例がある）。文書自体も同じく閉じている — `steps`（必須、かつ空でないこと：何も assert しないシナリオが成功を返してはならない）と `effects` / `defaultEffect` のみ。したがって `steps` の綴り間違いは「存在しない」と読まれるのではなく名指しで報告される。シナリオの検証は mount より前に行われ、文書中の問題はすべて一度に報告される。`state` は **slot 状態への部分一致**（ドット区切りパス可）。`errorIncludes` は `noErrors` の対になるもので、各部分文字列がそのステップ中に報告されたいずれかのエラーに含まれることを要求する。refinement が拒否した reducer バッチ（[batching](./runtime.md#a-batch-commits-all-or-nothing)）や、`.err` reducer が受け取らない effect エラーのように、runtime が*報告すること*自体が契約であるケース向けである。scenario ティア専用で、browser ティアは報告されたエラーをすべて致命として扱う。DOM テキストではなく状態を検証できるため、「select が常に最後の選択肢になる」ような**非例外の振る舞いバグ**（人がクリックして気づくクラス）を機械的に検出できる。これは TDD の受け入れ基準（AC）を実行可能にしたものに等しい。
- **effect スクリプト**: `effects: { <name>: [{outcome, value}, ...] }` で HTTP / Storage の結果を順に差し替え、ループを決定論的・ネットワーク非依存に保つ。

なぜ Kumiki でこれが綺麗に成立するか: 状態が明示的（slot）なので oracle が信頼でき、イベントが宣言的（reducer 名）なので正確に駆動でき、effect が capability 境界でモック可能なので再現性がある。エージェントが要件から「アプリ + シナリオ（AC）」を生成し、trace を読んで自己修正することで、人は要件を一度述べるだけでよい。ループの手順は `.claude/skills/kumiki-iterate` に記述。

## 8.11 次

- AI 編集と自動修正 → [AI 編集](./ai-edit.md)
- ランタイム内部 → [ランタイム](./runtime.md)
