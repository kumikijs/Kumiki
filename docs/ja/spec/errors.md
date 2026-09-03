# エラーコード仕様

Kumiki のコンパイラ（`@kumikijs/compiler`）が報告する診断は、**パースエラー**と**型検査エラー**の 2 系統に分かれる。本書は両者を正規（normative）に列挙する。実装側でコードを追加・変更した場合は、本書も同時に更新しなければならない。

## エラーの形

型検査エラーは `KumikiError` として表現される：

```ts
type KumikiError = {
  code: string;     // "E0103" のような安定識別子
  kind: string;     // "undef-slot" のような機械可読な分類
  message: string;  // 人間向けメッセージ（対象名を含む）
  pos: Pos;          // { line, col }
  severity?: "error" | "warning"; // 省略時は "error"
};
```

`code` は永続的な契約であり、一度割り当てたら意味を変えない。`kind` は同一 `code` 配下の細分類で、診断ロジックの分岐に使う。`severity` は省略時 `"error"`（既存の診断との後方互換のため、未指定 = error 扱い）。`"warning"` は非致命的で、CLI では stderr、Vite では Rollup の `this.warn` に流れるが、終了コードを変えずビルドも止めない。

パースエラーは `ParseError`（`message` + `pos`）、字句エラーは `LexError` として `throw` される。どちらも `code` を持たない — その段は最初のエラーで停止するので、コードが指し示すべき診断の集合が存在しない。出力そのものが診断の集合であるツール（`kumiki fix` のロールバック報告、MCP ツールの JSON エンベロープ）は、「診断ゼロ = クリーン」が保たれるように [E0000](#e0000-parse-error) を合成する。

チェッカのコードは `packages/compiler/src/typecheck.ts` から発行され、`E0000` は上記 2 つのツールが付与する。機械化された spec-drift ガード（`packages/compiler/test/spec-drift.test.ts`）は、コードを付与するすべてのファイルから実装側の集合を抽出する — ツール側で発明されドキュメント化されていないコードは、チェッカ側で発明された場合とまったく同じように失敗する。

## コード体系

| 帯 | 領域 |
|---|---|
| `E00xx` | アプリ構造（ルーティングの必須要件など） |
| `E01xx` | 名前解決（未定義の参照・予約名との衝突） |
| `E02xx` | 型の不一致 |
| `E03xx` | ケイパビリティと純粋性 |
| `E04xx` | モーション |
| `E06xx` | reducer の書き込み規則 |
| `E07xx` | オプトイン検査：a11y／strict-icons／テスト DSL 不変条件 |
| `E08xx` | ランタイムハザード（コンパイルは通るが実行で壊れる書き方） |
| `W02xx` | 非致命的な警告（ビルドは成功する） |

## 自動修正のカバレッジ

`kumiki fix`（および `kumiki fix --apply`）は、診断の一部についてソースを決定的に書き換える。適用されたパッチはすべて回帰ゲートを通る：合成後のソースを再パース・再型検査してから書き込みを確定し、結果に新しい失敗が入るか、既存の失敗を 1 つも解消できなかった場合はロールバックする。

ゲートが問うのは修復が**失敗を持ち込んだか**であって何かが動いたかではない。そのため診断の同一性は**コード・kind・メッセージ**で取り、2 つの集合を多重集合として比較する。位置は意図的に含めない：置換後が置換前より短ければ同じ行の右にある診断はすべてずれ、行を挿入する修復はその下の診断をすべてずらすので、位置で照合すると触れてもいない診断が「修復が作ったもの」として読まれてしまう。1 つのコードを持つ 2 つの診断を区別するのはメッセージである。これが効くのは、別の修復が件数の帳尻を合わせてしまう場合である：1 つの `E0211` を言い換え、同時に 1 つの `E0119` を解消すると、コード別の件数だけでは綺麗な修復に見えるのに、言い換えられた診断はファイルに残ったままになる。集合の所属ではなく件数で比べるのは、同一の 2 つのうち 1 つを解消済みと数えられるようにするためである。`E0301 → E0302` のような 1 対 1 の入れ替わりは、コードが違うので従来どおり捕まる。

| コード | 自動修正 | 方針 |
|---|---|---|
| `E0001` | あり | `NotFound` tile を挿入し、`app.routes` に `"/404" -> NotFound` を追加する。 |
| `E0102` | あり | 既知の reducer 名に対する近傍名の提案（Levenshtein ≤ 2 または ≤ 25%）。 |
| `E0103` | あり | 既知の slot / 束縛名に対する近傍名の提案。 |
| `E0104` | あり | 宣言済みの `effect` 名と、プログラムが宣言しない[標準 effect](./stdlib.md#_2-6-標準-effect) に対する近傍名の提案（スコープ限定 — 名前の近い tile や slot は候補にならない）。 |
| `E0105` | あり | 既知の tile 名に対する近傍名の提案。 |
| `E0106` | あり | `on=timer(d, name=N)` から収集したタイマー名に対する近傍名の提案（スコープ限定 — トップレベル定義は候補にならない）。 |
| `E0107` | あり | 宣言済み motion 名に対する近傍名の提案。 |
| `E0116` | あり | 宣言済み `fn` 名と組み込み呼び出しに対する近傍名の提案（スコープ限定 — 名前の近い slot や tile は候補にならない）。 |
| `E0117` | あり | 型名に対する近傍名の提案。プログラム自身の `type` 定義を先に、続いてプリミティブ・標準ライブラリのドメイン型・generic コンストラクタ（スコープ限定 — 名前の近い slot や fn は候補にならない）。 |
| `E0118` | あり | 宣言済みの theme 名と slot 名に対する近傍名の提案 — `app.theme` が受け付ける 2 つの名前空間（スコープ限定 — 名前の近い tile や reducer は候補にならない）。 |
| `E0209` | あり | scrutinee union の variant タグに対する近傍名の提案（組み込みの `Option` / `Result` と、別名を辿ったユーザ `TypeDef` の body）。 |
| `E0211` | あり | セレクタの対象について、宣言済み tile 名に対する近傍名の提案。 |
| `E0216` | あり | 宣言された union の variant タグに対する近傍名の提案。解決方法はパターン側の E0209 と同じ。 |
| `E0119` | あり | 報告位置の `$route` を `route` に書き換える — slot が現在のルートを保持し、どの reducer からも読める。 |
| `E0121` | なし | 代わりの名前を選び、body 内のすべての読みを書き換えるのは作者の意図であり、静的修復の外。 |
| `E0218` | あり | 反復対象に欠けているリストアクセサを付ける（`Map` なら `.keys`、`Set` なら `.to-list`）。反復する式が裸の名前のときのみ。 |
| `E0301` | あり | 必要なケイパビリティをアプリの `caps = [...]` 配列へ追記する。 |
| `E0003` | なし | エントリポイントの合成は root tile・ルートテーブル・ケイパビリティ集合の選択を伴う。静的修復ではなくユーザの意図である。 |
| `E0004` | なし | どちらの app が意図されたものか、もう一方の routes を統合すべきかはユーザの意図である。 |
| `E0005` | なし | 循環のどの辺が誤りで、そこに何を描くべきかはユーザの意図である。 |
| `E0006` | なし | 再帰をデータに対する畳み込みへ書き換えるのは置換ではなくアルゴリズムの変更である。 |
| `E0007` | なし | 2 つの定義のどちらが意図されたものかはユーザの意図であり、誤った方を消すと挙動が無言で変わる。 |
| `E0008` | なし | 同様に、どの出現を残すかはユーザの意図であり、`caps` の場合はケイパビリティの判断そのものである。 |
| `E0304` | なし | 導出値をどこで計算するか（`fn` か、入場時に 1 度だけ走る reducer か）はユーザの意図である。 |
| `E0210` | なし | 型引数の追加はユーザの意図の合成であり、静的修復の外側にある。 |
| その他 | なし | 現時点では自動修復の対象外（よくある形が見つかれば issue を立てること）。 |

失敗した `test` からの振る舞い修復（`kumiki fix --auto-patch <test-name>`）は別のティアで、失敗した leaf を一意のソース位置まで辿れる場合に機能する：

- 文字列 / 数値 / 真偽値リテラルの完全一致。**スコープを考慮した曖昧性解消**付き：対象 tile / reducer 自身の行範囲を優先し、次にその依存、最後に無関係なコードの順で選ぶ。
- **文字列の前後一致修復**：`actual` と `expected` が共通の接頭辞・接尾辞を持つとき、食い違う中間部分だけを差し替える。
- **reducer の算術修復**：失敗した slot を書く reducer がちょうど 1 つのとき、`slot := slot ± N` を期待される差分に合わせて書き換える（符号の反転・オペランドの変更）。

## E00xx — 構造

### E0000 `parse-error`

ソースを字句解析／構文解析できなかった。チェッカは生成しない — parser は throw するので、診断の*リスト*を返さなければならないツールが、空のリスト = クリーンという意味を保つためにこのコードを合成する。`message` は parser 自身の文言、`pos` は停止したトークンの位置。

> `Parse error at <line>:<col>: <what was expected>`

**修正**：報告された位置の構文を直す。この文書の他のコードはすべて、パースできるファイルを前提にしている。

### E0001 `missing-404`

`app.routes` を宣言したアプリは、`/404` パターンのルートを必ず含めなければならない。未マッチのパスはここへフォールバックする。

> `app.routes must include a "/404" entry`

**修正**：`route "/404" -> NotFound` のような 404 用 tile へのルートを追加する。詳細は [ルーティング](./routing.md)。

### E0002 `duplicate-timer-name`

2 つ以上の `timer(d, name=N)` トリガーが、同じタイマー名 `N` を宣言している。タイマー名は単一のネームスペースを共有し、`stop-timer(N)` が一意に定まるようアプリ内で一意でなければならない。

> `Timer name "<name>" is declared more than once`

**修正**：いずれかのタイマーを改名し、各 `name=` を一意にする。詳細は [timer](./lifecycle.md#_7-1-5-timer)。

### E0003 `missing-app`

プログラムに `app` 定義が 1 つも無く、エントリポイントが存在しない。ルートテーブルも、マウントすべきルート tile も決まらない。空ファイルもこのケースに含まれる。位置は `1:1`——欠けているものには位置が無いため。

> `Program has no app definition`

これを判定するのはコード生成ではなく検査である。**絞り込み無しの** `check` が `ok` と報告したものは必ずビルドできなければならない（`--types` / `--refs` / `--effects` は報告を 1 つの帯に絞るため、より小さい問いに答える。ただし `E00xx` はどの絞り込みも選ばないため常に残る）。詳細は [アプリエントリ](./language.md#_1-12-アプリエントリ-app)。

唯一の例外は構築途中のプログラムである。[AI 編集](./ai-edit.md)の動詞は定義を 1 つずつ追加していくため、この要求を課すと `app` が入るまでの全編集がロールバックされてしまう。したがって編集時は要求を外して検査し、未完成であることは `kumiki check` が報告する。

**修正**：`caps` / `routes` / `init` を持つ `app` 定義を追加する。

### E0004 `duplicate-app`

プログラムが `app` 定義を 2 つ以上宣言している。エントリポイントは 1 つであり、コード生成は最初の 1 つを読んで残りを捨てる。つまり 2 つ目の `app` が持つ routes / caps / init / theme は、どこにも現れないまま成果物から消える。2 つ目以降の各定義位置で 1 件ずつ報告する。

> `Program declares more than one app definition ("<name>")`

`E0003` と違い、構築途中のプログラムでも緩和されない — app が 1 つ足りないのは未完成だが、1 つ多いのは誤りである。

**修正**：余分な定義を削除するか統合する。app を差し替えるなら `replace` するか、新しいものを追加する前に古いものを `remove` する。

### E0005 `tile-cycle`

tile が、直接またはほかの tile を経由して自分自身へ展開している（[tile 層の不変条件](./language.md#_1-7-2-不変条件) 不変条件 4）。コード生成は子をすべてインライン展開するため、循環は無限の木になる。これが無かった頃は、位置も無く関係する tile の名前も出ないままスタックを使い切っていた。1 つの循環につき 1 件、その循環の最初の辺——メッセージが名指しする tile の中——で報告する。

> `Tile "<name>" expands into itself (<A> → <B> → <A>)`

辺はコード生成がたどるものと同じである：入れ子の tile 呼び出し、tile を表す識別子引数、`for` / `when` / `if` / `match` の各分岐、そしてその tile 自身の `error-boundary`——boundary の本体は、それを宣言した tile のあらゆる呼び出し箇所で `catch` の中へインライン展開されるため、戻ってくる boundary はほかの子と同様に循環を閉じる。`sub-routes` は辺ではない：サブルートは `route-outlet` を通じてルーターが選択し、インライン展開されることはない。

**修正**：循環を断つ。繰り返しはコレクションに対する `for` に、描き分けは `when` / `match` に属し、いずれも tile が自分自身を含む必要はない。

### E0006 `fn-cycle`

`fn` が、直接またはほかの関数を経由して自分自身を呼んでいる（[fn 層の不変条件](./language.md#_1-8-3-不変条件) 不変条件 5）。直接再帰は明確に禁止されており、相互再帰も「深さを型レベルで証明できる場合」に限って認められる——その証明を書く形式が言語に無いため、呼び出しグラフの循環はすべて報告する。1 つの循環につき 1 件、その循環の最初の呼び出し位置で報告する。

> `fn "<name>" calls itself (<f> → <g> → <f>)`

**修正**：繰り返しをデータ側で表現する。`List` に対する `fold` / `map` / `filter` は構成上必ず停止し、それこそがこの不変条件が守ろうとしているものである。

### E0007 `duplicate-definition`

同じ層の定義が 2 つ以上、同じ名前を共有している。シンボル収集は名前ごとに 1 エントリしか保持しないため、後の宣言が先の宣言を置き換え、**実行されたプログラムは書かれたプログラムと別物になっていた**。最初のもの以降の各宣言位置で 1 件ずつ報告する。

> `<layer> "<name>" is declared more than once; only one of the two declarations takes effect`

どちらの宣言が生き残るかは一様ではないため、メッセージはそれを述べない。シンボル収集は**最後**を保持するので型検査が見たのはそれだが、同名の `reducer` は両方とも成果物に到達し、ランタイムは**最初**を dispatch する。つまりツールチェーンの両半分が「どの定義が存在するか」について食い違っていた。

ネームスペースは層ごとであり、層内でのみ効く：`slot` と `tile` が名前を共有するのは合法（コード生成は裸の識別子の子を何よりも先に tile として解決する）であり、プログラム自身の `type Route = …` が標準ライブラリのものを覆い隠すのも合法である。2 つ目の `app` はこれに先行する `E0004` が担当し、独自のコードを保つ。

**修正**：片方を削除するか改名する。`kumiki rename` は重複の生成を拒否し、`kumiki add` は重複が生じるとロールバックする。

### E0008 `duplicate-clause` / `duplicate-key` / `duplicate-field` / `duplicate-param` / `duplicate-variant`

1 つの構文の内側で、名前が 2 回書かれている。後の出現位置——削除すべき方——で報告する。

> `<what> "<name>" is written more than once`

| `kind` | 対象 |
|---|---|
| `duplicate-clause` | `app` / `effect` / `tile` の句（`caps = … caps = …`、`cap=… cap=…`、`in=… in=…`） |
| `duplicate-key` | レコードリテラルのフィールド、リテラルの Map キー、`theme` / `motion` の項目（任意の深さ）、tile の名前付き引数、tile の prop、`app.routes` および tile の `sub-routes` のルートパターン |
| `duplicate-field` | レコード**型**のフィールド（レコード型が書かれるあらゆる場所） |
| `duplicate-param` | `fn` の引数、`type` の型引数、`property-test` の `for-all` ジェネレータ |
| `duplicate-variant` | ユニオンのバリアントタグ |

探索は構造的である：各定義から、それが含むすべての式・型・tile・test 本体へ降りる。したがって `app.meta = {title: …, title: …}`、`reducer-test` の `given` 内の重複キー、2 度書かれた tile prop——いずれもほかのどの検査の経路上にも無いもの——にも到達する。

これが些細でない理由は `caps` にある：句は 1 つのフィールドへ組み立てられるため後勝ちになり、2 つの `caps` 句の順序を入れ替えるとケイパビリティ集合が無言で変わる——**セキュリティ境界が行順で決まる**うえ、エージェントが行を追記していくワークフローでは検出しようがない。ルートパターンの重複は両方のエントリを出力し、ルーターは最初にマッチするため 2 つ目の tile へは到達できない。バリアントタグの重複は、そのユニオンに対するすべての `match` のいずれかの腕を到達不能にする。

計算されたキーの Map は比較しない：2 つが衝突するかどうかはランタイムの問いであり、ここではその答えを持たない。

**修正**：後の方を削除する。両方を意図していたなら改名する。

## E01xx — 名前解決

### E0102 `undef-reducer`

reducer 名がどの `reducer` 定義も指していない。名指す箇所は 3 つある：イベントハンドラの引数または prop、`link` の `prefetch`、そして [`app.http`](./http.md#_6-3-認証) の `on-401` / `on-403` / `on-5xx` — 最後のものは、解決されない名前があるとそのレスポンスにハンドラが無い状態になり、「アプリが敢えて処理しないことにしたレスポンス」と区別がつかない。

> `Reference to undefined reducer "<name>"`

**修正**：reducer 名の綴りを確認する。`kumiki fix` が近い名前を提案できる（→ [AI 編集](./ai-edit.md)）。

### E0103 `undef-ref` / `undef-slot`

- `undef-ref`：式中で未定義の名前を参照した。
  > `Reference to undefined name "<name>"`
- `undef-slot`：reducer 本体で未定義の slot へ代入した。
  > `Assignment to undefined slot "<name>"`

`count-1` と書いた名前は引き算ではなく 1 つの名前である：`-` は直後に識別子文字があれば名前を続け（[§1.2](./language.md#_1-2-字句)）、`on-401` もまったく同じ書き方の中核構文である。ハイフンの前の部分が何かに解決される場合は、代わりにどう書くべきかをメッセージが示す。

> `Reference to undefined name "count-1" — "-" continues an identifier, so this is one name. Write "count - 1" with spaces for subtraction.`

**修正**：参照先の slot / 束縛が宣言済みか確認する。

### E0104 `undef-effect` / `init-not-effect-call`

`emit` の対象、または reducer が `on=<effect>.ok(…)` / `.err(…)` で待ち受ける effect が、未定義の effect を指している。セレクタの綴りを間違えると、その reducer は誰も生成しない結果を待ち続けることになり、完了しない effect と区別がつかない。`app.init` のエントリも同じ経路で検証される — 文法上これは effect 呼び出しであり（[§1.12](./language.md#_1-12-アプリエントリ-app)）、ケイパビリティ検査も引数型検査も同様に適用され、組み込み effect（`toast` / `navigate` / `log` 等）も同じく使える。

> `Reference to undefined effect "<name>"`

そもそも呼び出しですらない init エントリは kind `init-not-effect-call` になる。コード生成には落とす先が無く、この診断が無かった頃は init 配列に `null` を出力し、dispatcher が mount 時にそこから `.effect` を読んで、位置情報の無い生の `TypeError` でアプリが死んでいた。

> `app.init entries must be effect calls`

### E0106 `undef-timer`

`stop-timer(N)` 文が、どの `timer(d, name=N)` トリガーも宣言していないタイマー名 `N` を参照している。

> `stop-timer refers to undefined timer name "<name>"`

**修正**：綴りを確認するか、`timer(d, name=N)` でタイマーを宣言する。詳細は [timer](./lifecycle.md#_7-1-5-timer)。

### E0105 `undef-tile`

tile 参照、またはルート定義のターゲットが未定義の tile を指している。

> `Reference to undefined tile "<name>"`
> `Route "<path>" targets undefined tile "<name>"`

### E0107 `undef-motion`

tile の `motion: "<name>"` プロップが、`motion <name> = {…}` 定義の無い motion を指している。

> `Reference to undefined motion "<name>"`

**修正**：綴りを確認するか、motion を宣言する。詳細は [`motion` 定義](./style.md#_4-9-1-the-motion-definition)。

### E0108 `undef-member`

`recv.member` アクセスで、`recv` の**推論型**が既知なのに `member` がその型のフィールドでも stdlib のメソッド/ショートカットでもない（ADR-002）。タイポ（`list.frist`）や形状違いのメンバー使用（`head` フィールドの無い record への `record.head`）を捕捉する。受け手型が推論できないときはエラーにならず、名前ベースのショートカット dispatch が使われる。

> `Record type has no field or method ".<member>"` / `Type "<T>" has no member ".<member>"`

**修正**：メンバー名を直す。`recv` が record なら、存在するフィールドを使う。詳細は [List(T)](./stdlib.md#_2-2-3-list-t)。

### E0110 `unknown-token-group`

`@<group>.<name>` 形式のテーマトークン参照（[スタイル §4.3](./style.md#_4-3-トークン参照)）の `<group>` が、閉じたテーマ名前空間（`colors`・`spacing`・`radius`・`shadow`・`typography`・`breakpoints`）のいずれでもない。

> `Unknown theme token group "@<group>" (allowed: …)`

**修正**：列挙されたグループを使う（`@colors.surface`、`@spacing.md` など）。素の識別子のつもりだったなら `@` 接頭辞を外す。

### E0109 `test-wildcard-misuse`

テスト用ワイルドカード（`<any-id>` / `<slots.X>`）が `reducer-test` の `expect` 以外の場所 — reducer / tile / fn / app の本体、あるいはテストの `given` — に出現している。ワイルドカードは期待結果側の照合構文（[ワイルドカード](./testing.md#_8-2-2-wildcards)）であり、計算する値としても、入力として与える値としても意味を持たない。

> `Test wildcard "<any-id>" is only valid inside a reducer-test \`expect\``

**修正**：ワイルドカードを削除するか、`reducer-test` の `expect` 内に移す。

### E0111 `orphan-sub-routes`

`sub-routes` を持つ tile が `app.routes` のどのエントリからも参照されていない。ネストルートテーブルに到達経路が無い。

> `Tile "<name>" declares sub-routes but is not the target of any route in app.routes`

**修正**：その tile を target とする `/*` 付きルートを `app.routes` に追加するか、`sub-routes` を削除する。

### E0112 `duplicate-sub-route`

同じ tile の `sub-routes` 内で同一 path が複数回出現している。マッチは定義順なので、重複はデッドコードかタイポ。

> `Sub-route path "<path>" is declared more than once in tile "<name>"`

これは古いコードのもとにある `E0008` の規則そのものである。先に存在していたコードであり、コードの意味は恒久であるため、サブルートパスの重複は 2 件報告されるのではなくここに留まる。`E0008` が**どのように**報告するかについて述べていることはすべて当てはまる——後の側のエントリで、最初以降のエントリごとに 1 件ずつ。

**修正**：重複を削除する。別パスを表現したいなら綴りを直す。

### E0113 `sub-routes-without-outlet`

`sub-routes` を宣言した tile の body に `route-outlet` 呼び出しが存在しない。コンパイルは通るが、マッチした子ルートをどこにも描画できないので「ビルドは成功するが何も起きない」という Kumiki が一番嫌う失敗モードになる。

> `Tile "<name>" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render`

**修正**：子を表示したい場所に `route-outlet()` を 1 つ置く。要らないなら `sub-routes` を外す。

### E0114 `sub-routes-without-wildcard-parent`

`sub-routes` を宣言した tile を `app.routes` から指している親エントリの pattern が wildcard（`/*`）で終わっていない。親が wildcard でないと runtime はネストマッチャに到達せず、sub-routes は永遠に発火しない。詳細は [Nested Routes](./routing.md#_3-6-nested-routes)。

> `Tile "<name>" declares sub-routes but its parent route "<path>" is not a wildcard pattern (must end with "/*")`

**修正**：親 pattern を `/*` で終わるように変える（`/settings` → `/settings/*`）か、`sub-routes` ブロックを外す。

### E0115 `reserved-slot-name`

コンパイラが slot テーブルを参照する前に解決してしまう名前で `slot` を宣言している。そのため、その slot は誰からも読めない。該当するのは router が管理する route slot（[Routing](./routing.md#_3-2-current-route-state)）の `route` のみ — `now` や `self` など他の予約名は lexer が先に弾く。この診断がないと宣言はコンパイルを通り、slot は自分の値ではなく route オブジェクトを黙って描画する。

> `Slot "<name>" collides with <what it collides with>; reads of it never see this slot`

**修正**：slot の名前を変える。

### E0116 `undef-call`

呼び出し `f(...)` がどの関数も指していない。候補集合はプログラム内の `fn` 定義と組み込み呼び出しで、後者は 3 つの文書に分かれている。

| callee | 規定箇所 |
|---|---|
| `now` / `random` / `fmt` / `panic` | [標準ライブラリ §2.4](./stdlib.md#_2-4-ビルトイン関数) |
| `Duration.*` / `Bytes.*` / `<T>.fresh` / `.parse` / `.show` | [標準ライブラリ §2.2](./stdlib.md#_2-2-コレクションメソッド)・[§2.4](./stdlib.md#_2-4-ビルトイン関数) |
| `Decoder.*` / `EffectId.none` | [HTTP / Storage §6.1.4](./http.md#_6-1-4-decoder-型)・[標準ライブラリ §2.1.1.1](./stdlib.md#_2-1-1-1-effectid) |
| `file-url` | [フォーム §5.10](./forms.md#_5-10-file-upload) |
| `prefers-dark` | [スタイル §4.6.1](./style.md#_4-6-1-os-設定への追従) |

`run-reducer` は候補に含まれない。生成された property-test の trial 内でしか lowering されず、property-test の invariant は本検査ではなく専用の走査で解決されるためである。それ以外の場所に書けば E0116 になる。テスト本体の中では専用の文面を持つ——誤っているのは名前ではなく位置だからである：

> `Call to "run-reducer" outside a property-test invariant`

lowering が読む `_init` / `_event` は trial の中でしか束縛されないため、`given` や `expect` から生成されたモジュールは、どのテストも結果を出す前に `_init is not defined` で死ぬ。

> `Call to undefined function "<name>"`

コード生成は未知の callee を同名バインディングの呼び出しへ落とすため、この検査が無いと綴り間違いが check も build も通り、最初の評価時に `<name> is not defined` を投げる。受理集合はコード生成が落とせる集合とちょうど一致させている — 守る対象より緩い検査がその失敗を生んだのであり、厳しすぎる検査は動くプログラムを拒否する。

`obj.method(...)` に対する同じ関係が `E0801` であり、式の形が異なるため別々に解決される。

**修正**：綴りを直すか、`fn` を宣言する。

### E0117 `undef-type`

型名が何も指していない：`type` 定義にも、[標準ライブラリの型](./stdlib.md#_2-1-ビルトイン型)にも、外側の `type` 定義の型パラメータにも該当しない。

> `Reference to undefined type "<name>"`

解決できない名前は**不透明型**であり、不透明型はあらゆる値を受理する — したがってこの検査が無い状態では `slot v : NoSuchType = 1` が通り、以降 `v` を使うすべての箇所でも値検査が効かなかった。綴り間違い 1 つが、その下流全体の型検査を無効化していた。

型パラメータはそれを宣言した定義の body の中だけでスコープに入る：`type Box(T) = {v: T}` は正しく、`type Box(T) = {v: U}` は誤り。他の宣言箇所（`slot` / `fn` / `effect` / `tile in=`）は型パラメータを持たないので、そこでの未解決名は常にエラーである。

**呼び出しの qualifier** も型名である。`T.fresh()` / `T.parse(t)` / `T.show(v)` は大文字で始まる任意の `T` に対して lowering される——codegen が正規表現で形だけを見ている——が、メンバによって意味が違う。`parse` は qualifier で分岐するため、綴り間違いは失敗ではなく分岐の変更になっていた：`Int.parse("12")` は `Some(12)` を返すが `Itn.parse("12")` は `Some("12")` を返し、それを `Int` slot が保持して以降の加算はすべて文字列連結になる。`fresh` と `show` は qualifier を捨てるので、そこでの綴り間違いは同じ値を返す——それでも名前を報告するのは、どの型も指さない qualifier がそれ自体として誤りだからであり、この 2 つについては検査が lowering より意図的に厳しい。qualifier は他の型名と同じ名前空間（プリミティブを含む）に対して解決され、qualifier として綴られている必要がある：ハイフンを含む名前は qualifier ではなく、それで書かれた呼び出しはこれではなく [E0116](#e0116-undef-call) になる。

**修正**：綴りを直すか、型を定義するか、外側の定義のパラメータ列に名前を加える。`kumiki fix` が最も近い型名を提案する。

### E0118 `undef-theme`

`app.theme = <name>` の `<name>` が、`theme` 定義でも slot でもない。どちらも正しい書き方であり、theme 名ならその theme を選び、slot ならその値が名指す theme を選ぶ — つまり実行中に theme を切り替えられる（[スタイル §4.6](./style.md#_4-6-dark-mode)）。

> `Reference to undefined theme "<name>"`

どちらにも解決されない名前は、登録されていない theme をランタイムが引くことになる。ランタイムは組み込みの既定値にフォールバックして描画するので、設定を誤ったアプリではなく、単にスタイルが当たっていないだけのアプリに見える。

**修正**：綴りを直すか、theme を宣言する。`kumiki fix` が最も近い theme 名または slot 名を提案する。

### E0119 `route-bind-out-of-scope`

reducer が `$route` を読んでいるが、その reducer のペイロードにランタイムはルートを入れない。`$route` が束縛されるのは `route.enter` / `route.leave` / `route.error` の reducer と、link が `prefetch` に指名した reducer — プリフェッチと実際の遷移で 1 つの body を共有できるよう、後者は前者と同じ束縛で発火する（[ルーティング §3.4](./routing.md#_3-4-ルートライフサイクル)、[§3.8](./routing.md#_3-8-prefetch)）。それ以外のトリガは、ルートを含まないペイロードで reducer を適用する。

> `"$route" is only bound in a route.enter / route.leave / route.error reducer and in a link's prefetch target; nothing binds one here, so every field off it reads undefined. Read the "route" slot instead — it holds the current route and is in scope everywhere`

この検査がないと、読みは空オブジェクトに落ちる：`$route.params.get-or("id", "")` はフォールバックを返し、`$route.pattern` は `undefined` を返す。それらとの比較はすべて false になり、reducer の body 全体が黙って何もしない。`fn` や tile の body はそもそもペイロードで適用されないので、そこでの `$route` はこれではなく未定義の名前（[E0103](#e0103-undef-ref-undef-slot)）である。`app.init` の引数は [E0120](#e0120-route-in-app-init) を報告する — 上のメッセージが `route` slot を無条件に薦められるのはそのためで、その助言が成り立たない唯一の位置はこの検査に到達しない。`let` やパターンが束縛した名前はその束縛であってペイロードではないので、そもそも報告されない。

**修正**：`route` slot を読む（[ルーティング §3.2](./routing.md#_3-2-current-route-state)）。ランタイムが保守しており、どの層からも読める。`kumiki fix` が書き換えを提案する。

### E0120 `route-in-app-init`

`app.init` の引数が `route` あるいは `$route` を読んでいる、もしくはそれを読む `fn` を呼んでいる。init の引数が評価されるのは app オブジェクトの構築時に**一度だけ**であり（[言語 §1.12.1](./language.md#_1-12-1-when-init-arguments-are-evaluated)）、ランタイムが `app.live.route` を用意するのはその後に続くマウントの中である。つまり引数が捕捉される時点に読めるルートは存在しない。

> `"<name>" is not available in an app.init argument: these arguments are evaluated once, while the app object is being built, and the runtime installs the route during the mount that follows. Take the route from a route.enter reducer, which runs with the route the app landed on`
> `"<name>" is not available in an app.init argument through "<fn>" (<fn> → … → <name>): …`

この検査がないと、引数は `_live["route"]` に落ちて `undefined` を捕捉する。`init = [load(route.path)]` は綺麗にコンパイルが通り、マウント時に `Cannot read properties of undefined (reading 'path')` を投げる — アプリは一度も描画されない。`$route` は同じ穴の裏側で、ここでは何もそれを束縛せず、[E0119](#e0119-route-bind-out-of-scope) の助言はこの検査が弾く `route` の綴りへ作者を送り込んでしまう。

**制約がかかるのは引数が到達する先であって、綴り方ではない。** ルートを読む `fn` 自体は正しい — slot テーブルに無いので純粋性の規則の対象にならず、他のどの呼び出し元もルートを用意するマウントの後に走る。誤っているのは `app.init` からの呼び出しだけであり、しかも直接読むより騒がしく壊れる：呼び出しは app オブジェクトのリテラルに落ちるので、モジュールは**インポート中**に例外を投げ、何一つロードされない。呼び出しは何段でも追跡し、到達までの連鎖をメッセージに載せる — 呼ばれた `fn` の名前だけを出す報告は、それ自体は誤っていない定義へ作者を送り込むからである。

**修正**：`route.enter` reducer 側でルートを受け取る（[ルーティング §3.4](./routing.md#_3-4-ルートライフサイクル)）。ランタイムはアプリが着地したルートで reducer を適用する。ルートを必要としない `init` エントリはそのままでよく、別の用途で `fn` を呼んでいるエントリはそのまま呼び続けてよい。

### E0121 `reserved-bind-name`

`effect-event` のトリガがペイロードの positional を `$el` / `$event` / `$route` に束縛している。この3つは [positional binding](./language.md#_1-6-5-positional-binding) であり、コンパイラはそのすべてをどの reducer の body にも宣言する — 種になるのはトリガのペイロードが持っている値だけで、effect イベントのペイロードは `{$1, $2}` なので3つのどれも持たない。したがってこの名前を取る束縛は、同じ名前の2つ目の宣言になる。

> `"<name>" is a positional binding the compiler declares in every reducer body, so an effect-event bind cannot also take the name — the two declarations collide and the module does not load. Rename the bind`

この検査がないと、reducer は同じ `const` を二度宣言する body に落ちる。モジュール全体がロード時に `SyntaxError: Identifier '<name>' has already been declared` を投げ、アプリは一度も描画されない — `check` も `build` も、出力されたソースの見た目も綺麗なままで。`$1` が報告されないのは、他に宣言する者がいないからである。数字が位置を決めるわけではない（`on=load.ok(_, $1)` は*2つ目*の positional をそれに束縛する）。`$now` も同様で、こちらはそもそも誰も宣言しない。

**検査されるのは `effect-event` の束縛だけである。** body の `let` は依然としてこの名前を取れる — [E0119](#e0119-route-bind-out-of-scope) は外側の `let` 束縛がペイロードに勝つと述べており、match アームのパターンは実際に正しくシャドウする — が、トップレベルの `let` は宣言と同じスコープに落ちるため、かつての束縛と同じように衝突する。これは名前の規則ではなく codegen のスコープの不具合であり、別の欠陥として追跡されている。

`$route` はこれだけを報告する。束縛は依然として reducer のスコープに入るので、body の読みはトリガのスコープ外のペイロードフィールドではなくその束縛に解決される — さもなければ [E0119](#e0119-route-bind-out-of-scope) が読みのたびに発火し、作者が自分で付けた名前について `route` slot へ誘導してしまう。

**修正**：束縛の名前を変える。

## E02xx — 型

### E0201 `type-mismatch`

値が、その位置の要求する型を持っていない。

> `Expected <declared> but got <actual>`
> `Operator "<op>" expects a number but got <type>`
> `Operator "<op>" expects Bool but got <type>`
> `Operator "<op>" cannot compare <type> with <type>`
> `Condition of "<form>" must be Bool but got <type>`
> `Expected <declared> but got variant "<name>"`
> `Tile "<name>" expects a value of type <type> but got a tile`
> `Event handler arg "<name>" must be a reducer name`
> `Event handler prop "<name>" must be a reducer name`
> `link prefetch must be a reducer name`

イベントハンドラが束縛するのは **reducer** であり、これは `f(onX=r)` と `f() {onX: r}` のどちらの形でも変わらない。reducer の名前空間で解決される唯一の引数位置であり、そこに書かれた裸の識別子の意味は形ではなくこの位置が決める。

到着する形は一様でなく、それが値の形より先にハンドラであるかを問う理由である。小文字始まりの名前は参照として解析される。大文字始まりの名前は、tile を取る builtin の名前付き引数では *tile call* として（`box(text("x"), onClick=Card)`）、それ以外——props ブロック、`link` のような値引数 builtin、user tile——では variant タグとして解析される。いずれも参照ではないのでこのエラーになる。引数形式は形を先に見ていたため、その位置に書かれた tile 名はリスナのない要素にコンパイルされていた。

付随する制約：名前自体が大文字始まりの reducer はハンドラに束縛できない。参照として到着しないためである。小文字で綴ること。

照合すべき宣言型を持つ位置は次のとおり：`slot` の初期値、代入の右辺（`.field` / `[k]` のパスを辿った先も含む）、宣言済み `fn` への引数、`fn` の body とその `->` 戻り型、`in=` を宣言した user tile への引数、`.get-or` のフォールバック、そしてすべての演算子のオペランド。`emit` の引数も検査するが、そちらは [E0202](#e0202-emit-arg-type-mismatch) を報告する。

`.get-or` のフォールバックはレシーバではなく**呼び出しが返す型**と照合する：空のケースで呼び出しが返す値そのものだから、結果型を担うのはフォールバックである。その結果型はレシーバの型引数から出る — `Option(T)` と `Result(T, E)` は `T`、`Map(K, V)` は `V` — ものであり、だからこそ `Option(S)` の slot に対する `opt := opt.get-or(None)` は 2 回報告される：フォールバックが `S` でないこと、そして `S` は `Option(S)` ではないこと。2 つの読みのどちらを取るかは引数の個数が決める（[Runtime §10.3.7](./runtime.md#_10-3-7-polymorphic-collection-methods)）。したがってレシーバに合わない個数の呼び出しは**ここでは**解決せず、照合する相手も持たない。ただし下げは行われる — 与えられたレシーバに対し、個数が名指す方の読みで — ので、これは沈黙ではなくそれ自体が欠陥である。

代入可能性は構造的で、暗黙変換は 1 つだけ — `Int` は `Float` の位置へ流れ、その逆は流れない。別名と generic の具体化は辿り、`where` の refinement は透過する：この検査が refinement を評価することはない。`type Volume = nominal Int where between(0, 11)` に対する `volume := 50` はこのエラーではなく、値が範囲内かどうかはバリデーションが決める（[Forms §5.6](./forms.md#_5-6-バリデーション戦略)を参照）。

`nominal` はその例外であり、このコードの中で唯一、**実型のあらゆる値が宣言型の値として妥当である**ケースを報告する規則である：`1.5` は `Int` ではなく `{a, b}` は `{a: Int}` ではないが、どの `Yen` も申し分ない `Cents` である。nominal 型を同定するのは宣言された名前であり（[§1.3.5](./language.md#_1-3-5-型の一意化)）、同じ基底型に対する 2 つの宣言は互いを拒否する — `Cents := Yen`、`postId := userId`。自身の nominal 名を持たない型は、その上に宣言されたどの nominal とも双方向に受理し合うので、`slot c : Cents = 1` と `c := c + 1` は成立したままである。nominal の上に宣言された nominal は、自身が宣言された側へ向かう一方向だけ通る。

演算子はこの規則の外にある：`==` はすべての型に定義され、順序比較は両辺が同じ族（number / text / time）に属するかだけを問う — number / text / time を基底型に持つ 2 つの nominal は常に属するので、`cents < yen` も `postId < userId` も報告されない。それ以外の基底型ではどちらの辺も族を持たず、演算子側がそれを報告する：`nominal Bool` 2 つに対する `flag < mark` は `Operator "<" cannot compare Flag with Mark` になる。

**この検査は片側だけを主張する。** 確実に誤っているものだけを報告し、解決できないものについては黙る — 未知の型名、結果型を何も解決できないメソッド（`.get` と `.get-or` はレシーバの型引数から答えを決める — `Option(T)` / `Result(T, E)` は `T`、`Map` は `.get` なら `Option(V)`、フォールバック付きなら `V`。`.copy` はレシーバをそのまま返し、`show` / `to-int` / `floor` などの固定表はプリミティブを返す。それ以外は動的なまま）、解決できない式の `let` 束縛など。誤った診断は動くプログラムを拒否するが、報告漏れは元から存在しなかった診断が増えないだけである。したがって check が緑であることは型の正しさの証明ではなく、名前の存在そのものは引き続き [E0801](#e0801-unimplemented-method) / [E0116](#e0116-undef-call) が担保する。

**修正**：値を直すか、宣言型を広げる。nominal どうしの不一致が意図的なものであれば、2 つの型が共有する基底型を経由して変換し、それを戻り型が行き先を表す `fn` として書く — `-> UserId = p + ""` であって、`-> UserId = p` ではない（後者はこのエラーそのものである）。`fn` は意図を記録するだけで、強制されるのは body が基底型に到達していることだけである。

### E0202 `emit-arg-type-mismatch`

`emit` の引数が、その effect の宣言する `in=` 型と一致しない。

> `Expected <in-type> but got <actual>`
> `Expected <in-type> but got variant "<name>"`
> `emit "<effect>" expects an EffectId argument`

`EffectId` の場合だけ文言を分けているのは、修正の種類が違うからである。これはキャンセルの配線ミスの典型形で、`emit stopSearch(searchId)`（`searchId : EffectId`）は正しく、`emit stopSearch(42)` や `emit stopSearch("id")` は誤り。codegen は `EffectId` でない値をそのまま渡し、cancel パスは静かに no-op となる — 成功したキャンセルと見分けがつかない。

引数の**個数**はこのコードではなく [E0213](#e0213-call-arity-mismatch) が扱う。

**修正**：宣言された `in=` 型の値を渡す（`EffectId` なら、以前に fire-and-track した同じ effect が返したハンドル）。もしくは effect の `in=` を実態に合わせる。詳細は [EffectId](./stdlib.md#_2-1-1-1-effectid) と [emit](./lifecycle.md)。

### E0204 `effect-id-misuse`

`EffectId` 型の値が定義されていない操作に使われている。`EffectId` で定義された操作は等価比較（`==` / `!=`）、`EffectId` 型 slot への代入、`in` 型が `EffectId` の effect への引数渡しのみ。算術・順序比較・`text(...)` での描画は拒否する — `EffectId` は不透明型なのでランタイムが表現を変えてもアプリが壊れないようにするため。

> `Operator "<op>" cannot be applied to EffectId — only "==" / "!=" are defined`
> `text(...) cannot render EffectId — it is an opaque handle`

**修正**: `EffectId.none` との `==` / `!=` 比較に置き換えるか、cancel 用 effect に渡す。詳細は [EffectId](./stdlib.md#_2-1-1-1-effectid)。

### E0205 `bind-on-file-input`

`input(type="file")` には `bind=` でスロットを束ねられない。`bind=` の双方向束縛の互換型テーブル（[Forms §5.1.1](./forms.md#_5-1-1-elements-that-support-bind)）にファイルを受け入れる型が無く、ファイルは change イベントの payload 経由でのみ受け取れる（[Forms §5.10](./forms.md#_5-10-file-upload)）。

> `input(type="file") does not support bind="<name>"; receive files via a ui.change reducer with $event.files.head`

```kumiki invalid
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", bind=avatar)
```

**修正**: `bind=` を外し、change イベントからファイルを取り出す reducer を追加する：

```kumiki fragment
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", accept="image/*")
reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
```

### E0206 `file-only-prop`

`input` の `accept` / `multiple` prop は `type="file"` のときのみ有効。これらは下層の `<input>` 要素にそのまま流し込まれるため、HTML 仕様としてファイルピッカーに対してのみ意味を持つ（[Forms §5.10](./forms.md#_5-10-file-upload)）。他の `type` で使う場合 — あるいは `type` を省略した場合（デフォルトは `"text"`）— は無効な HTML となり、潜在バグになる。診断は `type` が静的に `"file"` でないと確定できる場合のみ発火し、非リテラルの `type=` 式には触らない。

> `input prop "accept" requires type="file" (got type="text"); accept/multiple are only valid on file inputs`
> `input prop "multiple" requires type="file" (got no type, defaults to "text"); accept/multiple are only valid on file inputs`

```kumiki invalid
slot draft : Text = ""
tile Picker = input(type="text", bind=draft, accept="image/*")
```

**修正**: `type="file"` を付けてファイルピッカーにするか、`accept` / `multiple` prop を取り除く：

```kumiki fragment
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", accept="image/*", multiple=true)
reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
```

### E0207 `pat-arity-mismatch`

`match` の arm パターンの要素数が、scrutinee の静的型と食い違っている。tuple パターンは `Tuple(...)` scrutinee と同じ arity でなければならず、variant パターンはその variant のペイロード arity と同じ bind 数でなければならない。この検査が無いと codegen は常に false のガードを吐き、その arm が実行時に一度も発火しない（「コンパイルは通るが誤った分岐が走る」）静かな失敗になる。

> `Tuple pattern has <m> item(s) but scrutinee type "Tuple(<…>)" has <n>`
> `Variant "<tag>" pattern has <m> bind(s) but the variant carries <n> payload(s)`

**修正**：パターン要素数を型に合わせて増減する。`Tuple(Int, Int)` なら `(a, b)`、`Some(T)` なら `Some(x)`（1 bind）にする。

### E0208 `pat-type-mismatch`

`match` の arm パターンの形状が、scrutinee の静的型と食い違っている — 例えば `Int` scrutinee に対する tuple パターン `(a, b)`、record 型に対する variant パターン `Some(x)`。パターンが構造的にどうやっても一致しないため、その arm はコンパイル時点で dead。

> `Tuple pattern cannot match scrutinee of type "<T>"`
> `Variant pattern "<tag>" cannot match scrutinee of type "<T>"`

**修正**：scrutinee 型に合うパターン形状に直す。scrutinee 側が本当に union / tuple であるべきなら、宣言型を先に直す。

### E0209 `pat-unknown-variant`

`match` の arm が、scrutinee union 型に宣言されていない variant tag を指している。組み込み union（`Option(T)` は `Some` / `None`、`Result(T, E)` は `Ok` / `Err`）とユーザ宣言の `type X = A | B(…) | …` の両方が対象。

> `Variant "<tag>" is not a member of scrutinee type "<T>"`

**修正**：tag の綴りを直すか、union 定義に variant を追加する。`kumiki fix` が近い名前を提案できる（→ [AI 編集](./ai-edit.md)）。

### E0210 `type-arity-mismatch`

ユーザ宣言のジェネリック型の型レベル適用 `T(...)` が、宣言側パラメータと異なる数の型引数を受けている。この検査が無いと、後段の型パラメータ置換が短い写像しか作らずペイロードに未解決 `TypeRef` を残し、パターン検査は no-op に劣化する — まさにこの帯（と静的検査全般）が捕まえたい「静かな失敗」形。

> `Type "<name>" expects <m> type argument(s) but got <n>`

**修正**：呼び出し側で宣言の型引数数に合わせるか、宣言側パラメータリストを変える。

### E0211 `undef-tile-in-selector`

reducer が宣言されていない tile を指している。tile を名指すトリガは 2 つあり、どちらも対象になる：`ui.*` セレクタと、`tile.mount(<Tile>)` / `tile.unmount(<Tile>)`。この検査がないと、`ui.click(SaveBtn)` を `ui.click(SaveBtnn)` と打ち間違えてもコンパイルが通り、どこにも bind されない reducer（= 意図的に未使用の reducer）と区別がつかない。

> `Reducer "<name>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" is not declared`
> `Reducer "<name>" subscribes to tile.mount(<Tile>) but tile "<Tile>" is not declared`

**修正**: `tile <Tile> = …` を宣言するか、tile 名を既存のものに直す。`emit confirm({onYes: r, …})` 等のコールバックとして間接的に dispatch される reducer 用のワイルドカード `_`（[Lifecycle §7](./lifecycle.md) 参照）は `ui.*` セレクタでのみ受理され、解決すべき tile を持たない。lifecycle イベントにその形は無い — 名前を持つ tile が描画ツリーに出入りしたときに発火するイベントだからである。

### E0212 `selector-id-mismatch`（`--strict-selector-id` で opt-in）

reducer の `ui.<ev>(Tile#id)` セレクタが指す `#id` を、対象 tile のリテラル `{id: "..."}` prop がどう転んでも生成できない。E0211 は tile 名のタイポを捕まえるが、この検査は `#id` 側のタイポを捕まえる — 例えば `tile NewForm = form(...) {id: "new"}` に対する `on=ui.submit(NewForm#nw)`。runtime `_dispatch` のフィルタ（spec [§1.6.2](./language.md#_1-6-2-セレクタ)）は不一致を静かにスキップするため、この検査がなければ reducer は発火せず、開発者はエラーを目にすることができない。`kumiki check --strict-selector-id` または `compile({ strictSelectorId: true })` で opt-in する。

> `Reducer "<name>" subscribes to ui.<ev>(<Tile>#<id>) but tile "<Tile>" is declared with id "<actual>" — this selector can never match`

検査は `for` / `when` / `if` / `match` の 4 種すべての制御フロー body を descend する: `for` / `when` は単一 body へパススルー、`if` は両分岐を merge、`match` は全 arm が観測 id 集合に寄与する。`tile T = if c then button(...) {id: "a"} else button(...) {id: "b"}` は `"a" | "b"` を持ち、`--strict-selector-id` の下では `T#c` セレクタが E0212 を発火する。参照先の user tile は descend しない — 別 tile への `Ref` を含む body は id 集合が unknown になるため、将来 use-site での per-instance id-override 構文を導入する余地を check 時に潰さない。

**E0212 が沈黙する場合（runtime フィルタが権威となる）**:

- tile が `{id}` prop をそもそも持たない。
- tile の `{id}` の値がリテラル文字列ではない式（`Ref`, method call など） — 実行時の値が check 時にはわからない。
- セレクタに `#id` がない。
- セレクタがワイルドカード `_`。
- 対象 tile 自体が未宣言（E0211 が既に発火するので、E0212 は抑制して単一の根本原因を提示する）。

**修正**: セレクタの `#id` を tile の `{id}` リテラルに合わせるか、tile の `{id}` リテラルをセレクタに合わせる。

### W0212 `ui-event-tile-mismatch`（warning）

reducer の `ui.<ev>(<Tile>)` セレクタの対象 tile 配下に `<ev>` を DOM 上で発火し得る要素が一つも無い — 例: `tile Card = box(...)` に対する `ui.focus(Card)`。codegen は静かに handler を捨てるため reducer は死にコードになる。これを check 時の警告として浮上させ、ビルドは止めずにサイレント失敗を可視化する。検査は tile 配下（子 tile を含む）を walk するため、`TodoRow = row(check(...), …)` + `ui.click(TodoRow)` のような cascade パターンでは警告は出ない — codegen は focusable な子孫に handler を配線する。

> `Reducer "<r>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" has no descendant that fires "<ev>" (DOM-allowed: …; observed in body: …). The handler is silently dropped.`

各イベントが許容する root builtin tile は以下（現状ツールチェーンの coverage — `codegen.ts` および `packages/runtime/src/tiles-input.ts` の射影）:

| `ui.<ev>` | 許容される root tile |
|---|---|
| `click`  | `button`, `check`, `switch`, `radio` |
| `submit` | `form` |
| `change` | `select`, `input`, `textarea`, `check`, `radio`, `switch`, `slider` |
| `input`  | `input`, `textarea`, `editable` |
| `key`    | `input`, `textarea`, `button` |
| `focus`  | `input`, `textarea`, `button`, `select` |
| `blur`   | `input`, `textarea`, `button`, `select` |
| `hover`  | 任意の tile |

**修正**: 許容集合に含まれる root を持つ tile にセレクタを切り替えるか、focusable な要素に対して `input(onFocus=r)` のように明示配線する。ワイルドカード `_` セレクタと `ui.hover` は対象外。

検査は `for` / `when` / `if` / `match` の body も descend する: `if` の then/else 両分岐、`match` の全 arm が観測 root 集合に寄与する。したがって `tile Dyn = for n in xs box(...)` は W0212 を発火（到達可能な root は `box` のみ）、一方 `tile T = if c then input(...) else button(...)` は警告しない（両分岐とも allowed root を寄与）。tile body 全体が解決不能（循環、未定義名）の場合は観測集合が空になり、警告は抑制される — 偽陽性より「警告しない」を優先する。

**`link` についての注記**: `<a>` は native に click を発火するが、`link` は `click` の許容リストに意図的に含めていない — runtime は link 上の click イベントをナビゲーション割込みに予約しており、ユーザ定義 `onClick` reducer を呼ばない。`button` に切り替えるか、親 tile に `onClick=` を配線するのが現状の回避策。

### E0213 `call-arity-mismatch`

適用が、適用される側の宣言する個数と異なる個数の引数を渡している。Kumiki には部分適用もデフォルト引数も無いため、個数の不一致は狭い型ではなくエラーである。

| 適用の形 | 宣言する側 | メッセージ |
|---|---|---|
| `fn` への `f(...)` | 仮引数列 | `Function "<name>" expects <n> argument(s) but got <m>` |
| 組み込み呼び出しへの `b(...)` | 呼び出し側が渡すべき引数の数 | `Function "<name>" expects [at least ]<n> argument(s) but got <m>` |
| `emit E(...)` | 引数 1 つ、`in=Unit` なら 0 | `Effect "<name>" expects <n> argument(s) but got <m>` |
| user tile への `T(...)` | `in=` を宣言していれば 1 つ、無ければ 0 | `Tile "<name>" expects <n> argument(s) but got <m>` |
| union variant の `V(...)` | その variant の payload 列 | `Variant "<name>" carries <n> payload(s) but got <m>` |
| 標準ライブラリのメソッドへの `x.m(...)` | lowering が読む引数の数 | `Method ".<m>" expects <n> argument(s) but got <m>` |
| `app.routes` の `"/p" -> T` | 引数無し、したがって `in=` も無し | `Route "<path>" targets tile "<name>", which expects 1 argument(s) — a route target is rendered with none` |
| tile の `sub-routes` の `"/p" -> T` | 同上 | `Sub-route "<path>" in tile "<parent>" targets tile "<name>", which expects 1 argument(s) — a route target is rendered with none` |

**ルートのエントリ**は、何も渡せない唯一の適用である：`tile: () => …` へ落ちるため、`in=` を宣言したターゲットは `$1` が束縛されないまま残り、`check` も `build` も ok と言ったあとで mount が `_d_1 is not defined` で死んでいた。サブルートのエントリ — したがって `route-outlet` が描画するもの — も同じ規則である。どちらも [ルーティング §3.1.4](./routing.md#_3-1-4-a-route-target-takes-no-argument) にあり、この規則で何も失われない理由もそこにある：描画されているルートは `route` slot にあり、どの tile も引数無しで読める。

tile と effect とルートの形は、これまで報告されていなかったものである：`in=` の宣言する引数無しで呼ばれた tile は `$1` が束縛されないまま mount し `_d_1 is not defined` で死ぬ。入力無しで emit された effect は最初の dispatch で `Cannot destructure property … of 'input'` を投げる。そして `in=` を宣言していない tile に引数を*渡した*場合は、mount も描画も正常に通り、呼び出し側が渡したつもりの値だけが静かに捨てられる。ルートのエントリは、どこにも呼び出しが書かれていないまま最初の死に方に到達する：ターゲットを適用するのはエントリ自身であり、それが何も渡せないからである。

組み込み呼び出しも同じように数える。この個数が表すのは*呼び出し側が渡すべき*数であって、lowering が読む数とは限らない：`Decoder.Json(User)` は何も読まずセンチネルへ落ちる。引数の*型*も検査しない——センチネルはそれを無視する。それでも `Decoder.Json` が引数 1 つを要求し `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` が 0 なのは、その型こそが decode を型安全にするものだからである（[HTTP §6.1.4](./http.md#_6-1-4-decoder-型)）——型を書き忘れた decoder は、書いてある decoder とソース上も出力上も区別が付かなかった。個数を強制する前は、組み込みの引数列は lowering がたまたま読むものでしかなかった：`Duration.s()` は `((0) * 1000)` へ落ち、空の duration で書かれた timer は即座に、そして永久に発火し、`Duration.s(1, 2, "x")` は末尾を黙って捨てていた。

範囲を持つ組み込みは `fmt` だけである。シグネチャが `fmt(template, ...args)`（[標準ライブラリ §2.4.5](./stdlib.md#_2-4-5-文字列フォーマット)）なので要求できるのはテンプレートだけで、メッセージは最小個数を名指す — `expects at least 1 argument(s) but got 0`。`now` は 0 個ちょうどに縛られているが、それを破る呼び出しは書けない：名前ではなくキーワードであり、0 引数の呼び出しを parser 自身が組み立てるため、`now(1)` はここに届く前に parse error になる。

**メソッド**は、lowering が決まった数の引数を読む場合に検査する — `t.format()` は以前 `check` を通り、位置情報を持たない素の `TypeError` で `build` を殺していた。強制するのは最小個数だけである：`get-or` と `slice` は渡された個数で分岐する。

**修正**：宣言どおりの個数を渡すか、宣言の側を変える。

### E0214 `missing-record-field`

record リテラルが、宣言型の要求するフィールドを欠いている。Kumiki の record に省略可能フィールドは無い — 欠けうるフィールドは `Option(T)` であり、それでも書く必要がある。

> `Record literal is missing field "<name>" of type <type>`

欠けたフィールド 1 つにつき 1 件、リテラルの位置に報告する。

**修正**：フィールドを与えるか、型を変える。

### E0215 `unknown-record-field`

record リテラル、または `.copy(f=v)` の record 更新が、宣言型に無いフィールドを名指している。

> `Record type has no field "<name>"`

どちらも素のオブジェクト spread へ落ちるため、宣言されていないフィールドは「誰も読まないプロパティ」になっていた — 拒否されるのではなく、値が静かに捨てられていた。

**修正**：フィールド名を直すか、型に宣言する。

### E0216 `unknown-variant`

variant コンストラクタが、宣言された union 型に無いタグを名指している — `type Status = Idle | Busy` に対する `slot s : Status = Zork`。

> `Variant "<name>" is not a member of type "<type>"`

タグは `{_tag: "Zork"}` へ落ち、どの `match` arm にも一致しない。UI は静かに何も描かず、runtime エラーも出ない。パターン側の同じ誤りが [E0209](#e0209-pat-unknown-variant) である。

**修正**：宣言済みのタグを使うか、そのタグを union に加える。`kumiki fix` が最も近いタグを提案する。

### E0217 `int-literal-precision`

`Int` の位置に、JavaScript が正確に表現できる範囲（`Number.MAX_SAFE_INTEGER`、9007199254740991）を超えるリテラルが与えられた。リテラルは AST に載る時点で丸められるため、そのまま実行すれば書かれた値とは違う値で動く。

> `Int literal <value> is not exactly representable and was rounded to <value>`

小数部を持つリテラルは精度ではなく型の誤りなので、[E0201](#e0201-type-mismatch) を報告する。

**修正**：安全範囲内の値を使うか、その数値を `Text` として持つ。

### E0218 `for-over-non-list`

`for` が `Map` または `Set` を直接反復している。`for` の反復対象はリストであり（[タイル層の不変条件](./language.md#_1-7-2-不変条件) inv. 5）、この 2 つはランタイムではキー付きオブジェクトである — プログラムはコンパイルを通り、ループが使われる場所で投げる：タイルなら `.map is not a function`、reducer なら `object is not iterable`。

> `"for" iterates a List, but this is a <Map|Set> — iterate its .<keys|to-list>`

`Map` は 2 つのリストを持ち、束縛するものが違う：`for k in m.keys` はキーを、`for v in m.values` は値を束縛する。メッセージが `.keys` を先に出すのは [§1.7.2](./language.md#_1-7-2-不変条件) inv. 5 が挙げている形がそれだからであり、`kumiki fix` もそちらを提案する — ループ本体がどちらを求めていたかは確認すること。

ループの両方の形 — タイルの中と reducer の `do=` ブロックの中 — で報告される。型が決定できない対象は報告しない。

**修正**：`Map` なら `m.keys`、`Set` なら `s.to-list` を反復する。`kumiki fix` が接尾辞を提案する。

### W0213 `handler-on-inert-tile` (warning)

ハンドラ prop が、そのレンダラが決して読まないタイルに書かれている — `row(text("card"), onClick=open)`、`card(...) {onChange: r}` など。対応する DOM イベントを持つタイルだけが配線する：`onClick` は `button` / `check` / `radio` / `switch`、`onChange` は input 系、`onInput` は input 系と `editable`、`onSubmit` は `form`、`onClose` はオーバーレイ系。それ以外はハンドラを痕跡なく捨てるので、その reducer は死んだコードになる。

> `"<handler>" on <tile>() is dropped — <tile> does not fire it. Put it on <tiles>, or subscribe with a reducer's on=ui.<event>(<Tile>)`

`onKeyDown` / `onMouseEnter` / `onFocus` / `onBlur` は報告しない。ランタイムはタイルが生成した要素にリスナをそのまま付ける。ただしそれは「リスナが付く」ことであって「イベントが届く」ことではない — `focus` と `blur` はバブリングしないので、フォーカス可能でないコンテナでは発火せず、`keydown` がコンテナに届くのはフォーカス可能な子孫がある場合だけである。そこまで報告するにはフォーカス可能性の解析が必要で、この検査は行わない。

[W0212](#w0212-ui-event-tile-mismatch-warning) は同じ黙殺を反対側から見たもの — `<ev>` を発火できないタイルを対象にした `ui.<ev>(Tile)` 購読である。こちらは捕まえられない：コンテナはクリック可能な子孫が 1 つでもあれば通過し、ボタンを含むカードのレイアウトはすべてそれに当たる。

**修正**：イベントを発火するタイルにハンドラを移すか、内容を `button` で包む。領域内のどこかのクリックに反応させたい場合は、`on=ui.click(<クリック可能な子>)` で reducer を購読する。

## E03xx — ケイパビリティと純粋性

### E0301 `missing-capability`

effect が要求するケイパビリティが `app.caps` で宣言されていない。要求元は effect 自身の `cap=`、または `navigate` / `toast` のような[標準 effect](./stdlib.md#_2-6-標準-effect)（プログラム側で宣言しないもの）が登録されているケイパビリティである。DOM ランタイムはどちらも同じように制限する — 宣言されていないケイパビリティの effect は console 警告を出して捨てられるので、この検査がないと emit はコンパイルもマウントも通り、そして何も起きない。

> `Effect "<effect>" requires capability "<cap>" which is not declared in app.caps`

**修正**：`app.caps` に必要なケイパビリティを追加する。能力モデルの詳細は [ライフサイクル](./lifecycle.md)。

### E0302 `unknown-capability`

`app.caps` のエントリが、標準ケイパビリティ（[標準ケイパビリティ](./stdlib.md#_2-5-standard-capabilities)）でも `kumiki.caps.json` マニフェストで登録されたものでもない。

> `Unknown capability "<name>" in app.caps — use a standard capability or register it in kumiki.caps.json`

**修正**：標準ケイパビリティを使うか、綴りを直すか、`kumiki.caps.json` にカスタムケイパビリティを登録する（`.kumiki` ファイルの隣でも、プロジェクトルートまでの任意の階層でもよい）。`kumiki check` / `kumiki build` と Vite プラグインは、読まれたマニフェスト、または見つからなかった場合の探索ディレクトリを併記する。詳細は [標準ケイパビリティ](./stdlib.md#_2-5-standard-capabilities)。

### E0303 `invalid-cancel-target`

`cap=http.cancel` を持つ effect の宣言が必要な形（`in=EffectId out=Unit`）になっていない、または cancel パスでサイレントに無視される属性（`policy` / `retry` / `map-request`）を宣言している。cancel capability は id でキャンセルし何も返さないため、リクエスト単位の挙動を宣言するのはユーザ意図と挙動の乖離になる。

> `effect "<name>" with cap=http.cancel must declare in=EffectId out=Unit`
> `effect "<name>" with cap=http.cancel cannot declare a policy`
> `effect "<name>" with cap=http.cancel cannot declare retry`
> `effect "<name>" with cap=http.cancel cannot declare map-request`

**修正**: `in=` / `out=` を `in=EffectId out=Unit` に直し、`policy=` / `retry=` / `map-request=` 句があれば削除する。あるいは `cap=http.cancel` を外す。[HTTP Cancellation](./http.md#_6-4-cancellation) を参照。

### E0304 `derived-slot`

slot の初期値がほかの slot——あるいは自分自身——を読み取っている。導出 slot は禁止されており（[store 層の不変条件](./language.md#_1-4-2-不変条件) 不変条件 4）、`init-expr`（[store 層の構文](./language.md#_1-4-1-構文)）が受け付けるのはリテラル・レコードリテラル・コレクションリテラル・組み込み呼び出しのいずれかで、そのどれも slot を名指ししない。

> `Slot "<name>" reads slot "<other>" in its initial value; derived slots are prohibited — compute it in a fn instead`

低水準化もこの不変条件と一致している：slot の読み取りはライブ値テーブルの参照として出力されるが、そのテーブルは slot テーブルより先ではなく、slot テーブルから作られる。したがって slot を読む初期値は、2 つの slot をどちらの順で宣言してもマウント時に例外になる——宣言順が決め手ではない。どの初期値も slot を読めない以上、初期値どうしの循環は書きようがなく、専用のコードも持たない。

**修正**：slot 自体は単独で成り立つ値にし、導出形は導出計算のための層である `fn` で計算する。起動時に 1 度だけ導出したい値なら `route.enter` の reducer に置く。

### E0305 `fn-impurity`

`fn`（純粋関数）が slot を読み取っている。`fn` は引数のみに依存しなければならない。

> `fn "<name>" must not read slot "<name>"`

**修正**：必要な slot 値を引数として渡す。

同じコードは純粋性のもう一方も扱う：reducer の body **以外のどこか**に式として書かれた `emit` である — `fn`、tile、slot の初期値、`effect` の `map-request`、`app.init` の引数（[言語 §1.12.1](./language.md#_1-12-1-when-init-arguments-are-evaluated)）。いずれも effect キューを持たない文脈で評価されるので、dispatch の行き先が無い。

> `emit "<name>" used as an expression is only allowed inside a reducer body`

**修正**：`emit` を reducer の中へ移す。`app.init` のエントリはそれ自体が dispatch なので、effect を引数ではなくエントリそのものとして書く。

## E04xx — モーション

`motion` 定義の閉じた文法の妥当性（[`motion` 定義](./style.md#_4-9-1-the-motion-definition)）。

### E0401 `motion-unknown-property`

keyframe ストップが閉じたアニメ可能集合（`opacity`, `translate-x`, `translate-y`, `scale`, `rotate`）外のプロパティを使うか、数値でない値を与えている。

> `motion "<name>": unknown keyframe property "<prop>" (allowed: …)`

**修正**：対応プロパティを使うか、それで表現する。

### E0402 `motion-invalid-timing`

タイミングフィールドが閉じた集合外：`duration`（ms 数値か `fast`/`normal`/`slow`）、`easing`（`linear`/`ease`/`ease-in`/`ease-out`/`ease-in-out`）、`iteration`（正の Int か `infinite`）、`direction`（`normal`/`reverse`/`alternate`/`alternate-reverse`） — またはフィールド名自体が未知。

> `motion "<name>": easing must be one of …`

**修正**：閉じた集合内の値（またはフィールド）を使う。

### E0403 `motion-malformed`

`motion` に `keyframes` レコードが無いか、keyframes に `from` / `to` ストップが無い（または `from` / `to` 以外のストップを使っている）。

> `motion "<name>" keyframes must include a "to" record`

**修正**：`keyframes: {from: {…}, to: {…}}` を与える。

## E06xx — reducer の書き込み規則

### E0601 `duplicate-write`

同一 reducer 内で、同じ slot パス形状（lvalue shape）へ複数回書き込んでいる。1 reducer 1 書き込み（パス形状粒度）の規則に反する。

> `Slot path "<shape>" is written more than once in this reducer`

**補足**：粒度は**パス形状**である。`issues[id].status` と `issues[id].updatedAt` は別形状とみなされ共存できるが、`count` への二重代入は禁止される。

## E07xx — オプトイン検査（a11y／strict-icons／テスト DSL 不変条件）

明示的な `strict*` オプトインが無い限り**無効**な検査と、テスト DSL 自身の不変条件を守る検査の帯。ここに警告レベルは存在しない — フラグが無ければ `check()` が `strict*` 系のコードを完全に除去するので、出力にも終了コードにも現れない。フラグが有れば通常のエラーになる。テスト DSL 系のコードは `test` / `episode-test` / `property-test` 定義の内部でのみ発火するので、常時アクティブでよい。

a11y 検査は `check(program, { strictA11y: true })` で有効化される。

### E0701 `a11y-button`

> `button must have a text= argument or aria-label prop`

### E0702 `a11y-image`

> `image must have an alt prop`

### E0703 `a11y-link`

> `link must have inner text or aria-label`

**修正**：可視テキストか、`aria-label` / `alt` を付与する。フォーム全般の指針は [フォーム](./forms.md)。

### E0705 `a11y-label-for`

> `label for="<x>" names no tile — no id="<x>" in this program`

`label {for: "<x>"}` のリテラルな対象が、プログラム内のどの `id="<x>"` / `{id: "<x>"}` とも一致しない。このラベルは何もラベル付けしていない——クリックしてもどのコントロールにもフォーカスが移らず、スクリーンリーダーはそのフィールドを名前なしとして読み上げる。ソースの見た目だけが関連付けを主張している状態になる。

解決されるのは両側ともリテラルのみ。`for` 自体が式である場合は照合されず、実行時に組み立てられる id（`{id: "row-" + t.id}`）は定義域に入らない——[E0704](#e0704-unknown-icon) がアイコン名に対して採る「リテラルのみ」の方針と同じ。

後半には明記すべき帰結がある：**リテラルの** `for` が**計算される** id を指す場合は報告される。これは正しい報告である（一つのリテラル名で行ごとのコントロールを指すことはできない）が、修正は「id を追加する」ではない。

**修正**：ラベルが指す id をコントロールに与えるか、名前を修正する。id を行ごとに組み立てている場合は、`for` も同じように組み立てる（`label(text="Name") {for: "row-" + t.id}`）——計算される `for` は照合されない。検査時には決定できない組み合わせだからである。[フォーム](./forms.md) を参照。

strict-icons 検査は `check(program, { strictIcons: true, iconNames })` で有効化される。

### E0704 `unknown-icon`

> `Unknown icon name "<x>" — not in @kumikijs/icons or any theme.icons block`

リテラルの `icon(name="<x>")` 参照のうち、`check()` に渡された `iconNames`（通常は `@kumikijs/icons` の `ALL_ICONS` キー集合）にも、ソース内のどの `theme.icons` ブロックにも含まれない名前。動的な `icon(name=<expr>)` は check 時に解決不能なので対象外で、ランタイムのプレースホルダにフォールバックする（[スタイル §4.8.4](./style.md#_4-8-4-strict-mode) 参照）。

**修正**：タイポを直す、カスタムパスを `theme.icons` に登録する、または `@kumikijs/icons` をインストールして組み込み名を有効化する。

テスト DSL 不変条件（現時点では E0712 のみ。E0710–E0719 はこの用途のために予約）は test 系定義の内部でのみ発火し、オプトインフラグを必要としない。

### E0712 `episode-mock-invalid`

`episode-test` の `mocks` レコードで、ある effect に対するモック値が受理される 4 形式のいずれでもない。受理されるのは、bare 識別子の `from-log`（記録済みの結果をリプレイ）と `ignore`（effect 全体をスキップ）、およびコンストラクタ呼び出しの `ok(...)`（成功ペイロードを固定）と `err(...)`（失敗ペイロードを固定）。他の値 — `from_log` のようなタイポ、任意の式、bare な reducer 名など — は codegen 側で降ろし方が定義されておらず、build 時に loud な `Error` として throw される。E0712 の役割は、その失敗をより早い `check` 段で、offending value を指す `pos` 付きの診断として浮かび上がらせること — codegen 段の throw（スタックが compiler を指す）ではなく、ソース位置を指した診断で受け取れるようにする。

> `Mock for "<name>" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``

**修正**：モック値を 4 形式のいずれかに置換する。記録済みエピソードから再生するなら `from-log`、effect を no-op にするなら `ignore`、成功結果を固定するなら `ok(<value>)`、失敗結果を固定するなら `err(<value>)`。詳細は [episode-test](./testing.md)。

### E0713 `test-shape-invalid`

テスト本体のある位置が、lowering の読まない形の値を持っている。しかもその fallback は「失敗」ではなく、それ自体がひとつの主張になっている。

現在 2 箇所ある：

- `reducer-test` の `given.mocks` が、`ok(...)` / `err(...)` / `delay(<ms>, ok(...)|err(...))` 以外を effect に束ねている。`mockScriptJs` はそれ以外を `{outcome: "ok", value: null}` として扱うため、失敗経路を駆動するつもりのモックが成功経路を駆動していた——「effect が失敗したときにどうなるか」を主張するテストが、一度も失敗させないまま永久に緑になる。（[E0712](#e0712-episode-mock-invalid) は `episode-test` に対する同じ規則で、そちらの語彙には `from-log` と `ignore` も含まれる。）
- `expect.effects` がリストでない。`effectListJs` は非リストを `[]` に降ろすが、これは主張が無いのではなく**「effect は何も emit されなかった」という主張**である——角括弧を忘れた `effects: persist(count)` は、何も emit しない reducer に対して成功し、中の effect 名は解決すらされない。

> `Mock for "<name>" must be \`ok(...)\`, \`err(...)\`, or \`delay(ms, ok(...)|err(...))\``
> `` `expect.effects` must be a list of effects ``

**修正**：受理される形で書く。どちらの位置も codegen 側で throw するようになったため、`check` を飛ばした呼び出し元は、静かに書き換えられた主張ではなく名前付きの失敗を受け取る。

## E08xx — ランタイムハザード

型は通るが実行時に壊れる「書き方」を、`check` の段階で静的に捕まえるための帯。検証の3層モデルは [3 層検証モデル](./testing.md#_8-10-the-three-layers-of-tooling-verification) を参照。

### E0801 `unimplemented-method`

`obj.method(...)` 形式のメソッド呼び出しが、ランタイム／コード生成の実装するメソッド集合に存在しない。綴り間違い（`.fitler`）や、仕様には載っていても未実装のメソッド、別の型のメソッドの誤用（`Option` に `.to-result` など）で起こる。

> `Method ".<name>" is not implemented by the runtime`

**補足**：実装されているメソッド集合は `@kumikijs/compiler` の `KNOWN_METHODS`（コード生成の `methodCallJs` と同期）が唯一の正。引数なしメソッドは `()` 付きでも無しでも書ける — [標準ライブラリ §2.2.3](./stdlib.md#_2-2-3-list-t) が括弧なしをショートカットと呼んでおり、どちらの形もコンパイルできる。標準ライブラリのメソッド一覧は [標準ライブラリ](./stdlib.md)。

**修正**：正しいメソッド名に直すか、その操作を `match` / `fold` など実装済みの手段で書き換える。未実装の仕様メソッドが必要なら、`packages/` に実装して `examples/` に動く例を足す。

### E0802 `unimplemented-function`

本ドキュメントが記述しているが、ツールチェーンがまだ lowering していない関数の呼び出し。`E0116` とは異なり、名前は正しく、欠けているのは実装側である。

> `Function "<name>" is documented but not implemented by the runtime`

現在この状態にあるのは `trace(label, value)`（[標準ライブラリ §2.4.6](./stdlib.md#_2-4-6-デバッグ補助)）の 1 つ。仕様上の挙動は episode ログへの記録だが、lowering された式から mount の episode logger へ届く接続点が存在しない — 修正はコード生成のケース追加ではなくランタイム側の変更になる。その間ここで報告することが診断の誠実さを保つ: 報告しなければ呼び出しは未定義のグローバルへ落ち、評価された場所でプログラムが壊れ、仕様を指し示すものは何も残らない。

**修正**：呼び出しを削除する。`trace` はデバッグ補助であり、言語のどの機能もこれに依存していない。
