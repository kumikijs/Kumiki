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
| `E0122` | なし | 2つの束縛のどちらが誤りで、もう一方を何と呼ぶべきかは作者の意図。 |
| `E0123` | なし | 2つの束縛のどちらが誤りで、もう一方を何と呼ぶべきかは作者の意図 — E0122 と同じであり、その規則をトリガに適用したものだからである。 |
| `E0218` | あり | 反復対象に欠けているリストアクセサを付ける（`Map` なら `.keys`、`Set` なら `.to-list`）。反復する式が裸の名前のときのみ。 |
| `E0301` | あり | 必要なケイパビリティをアプリの `caps = [...]` 配列へ追記する。 |
| `E0003` | なし | エントリポイントの合成は root tile・ルートテーブル・ケイパビリティ集合の選択を伴う。静的修復ではなくユーザの意図である。 |
| `E0004` | なし | どちらの app が意図されたものか、もう一方の routes を統合すべきかはユーザの意図である。 |
| `E0005` | なし | 循環のどの辺が誤りで、そこに何を描くべきかはユーザの意図である。 |
| `E0006` | なし | 再帰をデータに対する畳み込みへ書き換えるのは置換ではなくアルゴリズムの変更である。 |
| `E0007` | なし | 2 つの定義のどちらが意図されたものかはユーザの意図であり、誤った方を消すと挙動が無言で変わる。 |
| `E0008` | なし | 同様に、どの出現を残すかはユーザの意図であり、`caps` の場合はケイパビリティの判断そのものである。 |
| `E0009` | なし | 連鎖上のどの名前がレコード・ユニオン・プリミティブであるべきで、その本体が何かはユーザの意図である。 |
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

### E0009 `type-cycle`

`type` が自分自身へ解決している：body を定義から定義へたどっていくと、body に一度も到達しないまま、連鎖上にすでに現れた名前へ戻ってくる（[型レイヤの不変条件](./language.md#_1-3-6-不変条件) 不変条件 2）。`type A = A` と、`type A = B` / `type B = A` の組がその 2 つの形である。この定義は何も指していない——たどり着く body が無い——ため、それで宣言された slot は無言で型を持たず、その値に対する検査がすべて黙っていた。これは、綴りを誤った型名が [E0117](#e0117-undef-type) 以前に生んでいたのと同じ沈黙である。1 つの循環につき 1 件、その循環の最初の辺——メッセージが名指しする定義の中——で報告する。

> `type "<name>" resolves to itself (<A> → <B> → <A>)`

たどる連鎖は正規化がたどるものと同じであり、正規化が止まる場所で止まる。別名（`type A = B`）、`nominal` の被せ、`where` refinement、そして**型引数をそのまま返す汎化型**はいずれも次の名前へ導く。最後のものはその位置に書かれた引数を経由して導く — 正規化が代入するのがそれだからであり、`type Alias(T) = T` のもとで `type A = Alias(A)` は循環を閉じる。一方で**レコード・ユニオン・プリミティブ・コンテナ**はそれ自体が型であるため、その**内側**に書かれた名前は辺ではない。これが**再帰型を合法に保つ**ものであり（[§1.3.6](./language.md#_1-3-6-不変条件) 不変条件 4）、そうあり続けなければならない：

```kumiki fragment
type Node    = {value: Int, next: Node}
type Tree    = {children: List(Tree)}
type Shape   = Leaf | Branch(Shape, Shape)
```

いずれも自分自身へ戻るより先に構造的な型へ到達する。2 つを比較したときに停止するのは、この関係が**書かれたとおりの型**に対して余帰納的に読まれるからであって、値が有限だからではない — 上の `Node` は `next` が optional でもコンテナでもないため値を 1 つも持たないが、仕様自身が挙げる合法な再帰型の代表例である。`type A = Option(A)` や `type A = Alias(Option(A))` が合法なのも同じ理由で、コンテナがその型だからである。

`type` 定義を指さない名前は、循環を閉じるのではなく連鎖を終わらせる：汎化型構築子（`List`・`Option`・`Map`）には戻ってくる body が無く、未宣言の名前は [E0117](#e0117-undef-type) が報告すべきものであって、1 つの誤りに 2 つの名前を与えるべきではない。標準ライブラリの**ドメイン型**はほかと同じ定義なので、それを再宣言したプログラム（`type Route = Route`）は自分自身の定義で循環を閉じる。型引数は型引数として読まれ、同じ綴りのグローバル定義として読まれることはない（[§1.3.6](./language.md#_1-3-6-不変条件) 不変条件 5）。

**修正**：連鎖上のどれか 1 つの名前に body を与える。再帰を意図していた型は、自分自身を名指す位置にレコードかユニオンを求めている（`type A = {next: A}`）。別名を意図していた型は、別名の対象となる定義を求めている。

## E01xx — 名前解決

### E0102 `undef-reducer`

reducer 名がどの `reducer` 定義も指していない。名指す箇所は 3 つある：イベントハンドラの引数または prop、`link` の `prefetch`、そして [`app.http`](./http.md#_6-3-認証) の `on-401` / `on-403` / `on-5xx` — 最後のものは、解決されない名前があるとそのレスポンスにハンドラが無い状態になり、「アプリが敢えて処理しないことにしたレスポンス」と区別がつかない。

> `Reference to undefined reducer "<name>"`

ハンドラに書かれた **tile** 名は [E0201](#e0201-type-mismatch) ではなくこのエラーになる：この位置が解決する名前空間は reducer であり、tile 層はそこに無いので、定義済みの `tile Card` に対する `onClick=Card` は reducer `Card` が未定義だと報告される。そこで確認すべきは綴りではなく層である。

**修正**：reducer 名の綴りを確認する。綴りが正しく他の層に定義がある場合は、その位置が求めているのが reducer であることを確認する。`kumiki fix` が近い名前を提案できる（→ [AI 編集](./ai-edit.md)）。

### E0103 `undef-ref` / `undef-slot`

- `undef-ref`：式中で未定義の名前を参照した。
  > `Reference to undefined name "<name>"`
- `undef-slot`：reducer 本体で未定義の slot へ代入した。
  > `Assignment to undefined slot "<name>"`

`count-1` と書いた名前は引き算ではなく 1 つの名前である：`-` は直後に識別子文字があれば名前を続け（[§1.2](./language.md#_1-2-字句)）、`on-401` もまったく同じ書き方の中核構文である。ハイフンの前の部分が何かに解決される場合は、代わりにどう書くべきかをメッセージが示す。

> `Reference to undefined name "count-1" — "-" continues an identifier, so this is one name. Write "count - 1" with spaces for subtraction.`

`let` は書かれたスコープに宣言され（[言語 §1.6.7](./language.md#_1-6-7-scoping-and-shadowing)）、`if` の各枝・`for` の本体・match の各 arm はそれぞれ独立したスコープである。したがって `if` の一方の枝で宣言した名前は、もう一方の枝でも `if` の後のどの文でも未定義であり、`for` の本体や match arm で宣言した名前もその後では未定義である。条件で値を選ぶなら、`if` の前で `if` 式を使って一度だけ宣言する — `let n = if c then "a" else "b"` — か、読み出しを枝の中へ移す。

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
> `Tile-test target "<name>" is a built-in tile — a tile-test can only name a tile the program defines`

**`tile-test` のターゲット**には、存在すること以上が求められる：プログラムが定義した tile でなければならない。他の場所では組み込み tile も普通の tile と同じだが、生成されるテストはターゲットを `App._tilesById` 経由で適用し、これはユーザ定義の tile だけから作られる——したがって `tile-test text` は、何を与えられようと動きようのない唯一の名指しだった。`check` は通り、モジュールは `App._tilesById.text is not a function` で死ぬ。これを捕まえるものは無いので、同じファイルの他のテストも結果ごと失われていた。

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
| `now` / `random` / `fmt` / `panic` | [標準ライブラリ §2.4](./stdlib.md#_2-4-builtin-functions) |
| `Duration.*` / `Bytes.*` / `<T>.fresh` / `.parse` / `.show` | [標準ライブラリ §2.2](./stdlib.md#_2-2-コレクションメソッド)・[§2.4](./stdlib.md#_2-4-builtin-functions) |
| `Decoder.*` / `EffectId.none` | [HTTP / Storage §6.1.4](./http.md#_6-1-4-decoder-型)・[標準ライブラリ §2.1.1.1](./stdlib.md#_2-1-1-1-effectid) |
| `file-url` | [フォーム §5.10](./forms.md#_5-10-file-upload) |
| `prefers-dark` | [スタイル §4.6.1](./style.md#_4-6-1-os-設定への追従) |

`Decoder` / `EffectId` / `Duration` / `Bytes` のメンバを**括弧なし**で書いたものは値ではなく、引数を渡さない呼び出しである。`Decoder.Text` や `EffectId.none` はそう書かれ、`Duration.s` / `Bytes.from-text` も——後者 2 つの名前空間に 0 引数のメンバは無いが——同じ読み方をする。したがってその名前空間が宣言していないメンバは何も持たない値に評価されるのではなくここで報告され（`Duration.nope` は E0116）、実在するメンバに引数を渡さなかった場合は [E0213](#e0213-call-arity-mismatch) になる。この 4 つは上の表が挙げる組み込み呼び出しの qualifier である。それ以外の qualifier に対する括弧なしの `<T>.fresh` / `.parse` / `.show` は呼び出しとして読まれ**ない**——フィールド読みのまま何も持たない値に評価され、診断も出ない。これは規則ではなく既知のギャップである。

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

**呼び出しの qualifier** も型名である。`T.fresh()` / `T.parse(t)` / `T.show(v)` は大文字で始まる任意の `T` に対して lowering される——codegen が正規表現で形だけを見ている——ため、どの型も指さない qualifier はここで拒否しなければそのまま lowering される。`parse` は qualifier が解決される基底型によってテキストを読み（[標準ライブラリ §2.4.3](./stdlib.md#_2-4-3-型変換)）、どの型にも解決されない名前には読むための基底型がない。`parse` が qualifier の名前で分岐していた頃は、綴り間違いは失敗ではなく分岐の変更になっていた：`Itn.parse("12")` は `Some("12")` を返し、それを `Int` slot が保持して以降の加算はすべて文字列連結になっていた。`fresh` と `show` は qualifier を捨てるので、そこでの綴り間違いは同じ値を返す——それでも名前を報告するのは、どの型も指さない qualifier がそれ自体として誤りだからであり、この 2 つについては検査が lowering より意図的に厳しい。qualifier は他の型名と同じ名前空間（プリミティブを含む）に対して解決され、qualifier として綴られている必要がある：ハイフンを含む名前は qualifier ではなく、それで書かれた呼び出しはこれではなく [E0116](#e0116-undef-call) になる。型**コンストラクタ**に解決される qualifier — `List` や `type Box(T)` — は型を指しているが型そのものではなく、[E0124](#e0124-type-constructor-qualifier) になる。

`Decoder` / `EffectId` / `Duration` / `Bytes` はその例外であり、括弧の有無にかかわらず、またその名前が型でもあるかどうかにかかわらず適用される：これらのメンバは [E0116](#e0116-undef-call) が挙げる組み込み呼び出しちょうどであり、`fresh`（および引数なしで書かれた `parse` / `show`）はその中では解決されず、これではなくその E0116 になる。引数を与えられた `parse` / `show` は、他の qualifier と同様にこれらの上でも [標準ライブラリ §2.4.3](./stdlib.md#_2-4-3-型変換) の型メンバである: `Duration.parse(t)` は `Option(Duration)`、`Duration.show(d)` は `Text` である。例外がある理由は、`fresh` が書かれた qualifier を無視し、引数なしで書かれた `parse` / `show` がこれらの名前空間のメンバではないからである——`EffectId.fresh()` も `Duration.fresh()` も新しい id の生成へ lowering され、片方は著者が空のセンチネルを書いた場所に、もう片方は `Duration` slot にそのまま入っていて、どちらも報告されていなかった。`Duration` は標準ライブラリ型、`Bytes` はプリミティブなので、実在する型名が `fresh`、および引数なしの `parse` / `show` について答えない唯一の場所がここである。

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

**検査されるのは `effect-event` の束縛だけである。** body の `let` は依然としてこの名前を取れるし、取ってよい：すでにスコープにある名前の上の宣言はそれをシャドーイングするので（[言語 §1.6.7](./language.md#_1-6-7-scoping-and-shadowing)）、`let` は下のすべての読みで勝ち、[E0119](#e0119-route-bind-out-of-scope) はそのどれも報告しない。ここでの規則が名前についてではなく束縛リストについてのものである理由がこれである：束縛はペイロードの positional に名前を与えるので、`$el` を取る束縛にはそれが表す positional を置く場所が残らないが、`let` にはシャドーイングする外側の束縛があり、そこに置く自分自身の値がある。

`$route` はこれだけを報告する。束縛は依然として reducer のスコープに入るので、body の読みはトリガのスコープ外のペイロードフィールドではなくその束縛に解決される — さもなければ [E0119](#e0119-route-bind-out-of-scope) が読みのたびに発火し、作者が自分で付けた名前について `route` slot へ誘導してしまう。

**修正**：束縛の名前を変える。

### E0122 `duplicate-pattern-bind`

ひとつのパターンが同じ名前を二度束縛している — `Both(a, a)` や `(dup, dup)`。パターンの束縛は**対等**である：それらを入れ子にするものは何もないので、2つ目が1つ目をシャドーイングするためのスコープがそこには存在せず（[言語 §1.6.7](./language.md#_1-6-7-scoping-and-shadowing)）、パターンが名前を与えた2つの値の一方は読む手段を失う。パターン全体がひとつの名前空間なので、タプルの要素どうしも互いに検査される。

> `"<name>" is bound twice in this pattern. The two binds are peers — nothing nests them, so the second does not shadow the first — and one of the two values the pattern names would be unreadable. Rename one`

この検査がないとアームはコンパイルされてしまう：2つ目の束縛は自分専用の識別子を取り、body 内のその名前の読みはすべて黙って*後ろ*の値に解決される — `check` も `smoke` も綺麗なままで。シャドーイングの規則がパターンに届く前は、ロード時に `SyntaxError: Identifier '<name>' has already been declared` を投げるモジュールだった。そちらのほうが騒がしいだけで有用さは変わらない — どちらにせよアームは書かれたとおりの意味を持たない。`_` は何度書かれても対象外である：何も名指ししないし、パターンが複数持つのは当然だからである。

2つの*アーム*が同じ名前を束縛するのは対象外 — それらは選択肢であり、それぞれ自分のスコープを持つ。パターンの外の名前をシャドーイングする束縛も同様で、こちらは [§1.6.7](./language.md#_1-6-7-scoping-and-shadowing) が述べる規則がそのまま働いている。

**修正**：2つの束縛のどちらかの名前を変えるか、アームが読まない値には `_` を書く。

### E0123 `duplicate-effect-bind`

`effect-event` のトリガが、ペイロードの2つの positional をひとつの名前に束縛している — `on=load.ok(dup, dup)`。

> `"<name>" is bound twice in this trigger: it names $<i> and then $<j>, so the two binds are peers — nothing nests them, the second does not shadow the first, and $<i> has no name left to read it by. Rename one, or write "_" for a positional the reducer does not read`

これは [E0122](#e0122-duplicate-pattern-bind) の規則をパターンではなくトリガに適用したものであり、[E0121](#e0121-reserved-bind-name) と同じ衝突を反対側から見たものである：あちらは束縛がコンパイラの宣言する名前を取り、こちらは別の束縛が宣言した名前を取る。codegen は束縛ごとに `const` をひとつ出力するので、reducer の body は同じ名前を二度宣言し、モジュール全体がロード時に `SyntaxError: Identifier '<name>' has already been declared` を投げて何も描画されなかった — `check` も `build` も綺麗なまま、出力されたソースも正しそうに読めるままで。

bind list はペイロードの positional を**順に**名指すので、2つの束縛が同じものを名指すことは何かの省略ではない：その名前がどちらの値に解決されようと、もう一方の positional は読む手段を失う。メッセージ中の番号は位置である — `_` は位置を飛ばすのではなく占めるので、`on=load.ok(_, x, x)` は `$2` と `$3` の衝突になる。

`_` 自身は何度書かれても対象外である：何も名指ししないし、reducer が読まない positional のための綴りがそれだからである。

**繰り返された名前が予約名でもある場合は E0121 だけになる。** `on=load.ok($el, $el)` は束縛ごとに E0121 を1件ずつ集め、E0123 は出ない：それらの報告が既に「束縛の名前を変えよ」と言っており、そうすれば重複も解消するので、3件目は別の誤りを名指すのではなくひとつの誤りを繰り返すだけになる。どちらの場合も束縛は reducer のスコープに入るので、body の読みはそこへ解決され、それ以上何も集めない。

**修正**：2つの束縛のどちらかの名前を変えるか、reducer が読まない positional には `_` を書く。

### E0124 `type-constructor-qualifier`

型メンバ呼び出し — `T.fresh()`、`T.parse(t)`、`T.show(v)` — の qualifier が型ではなく型**コンストラクタ**である: `List`、`Map`、`Tuple`、`type Box(T) = …` のように、まだ型引数を必要とする名前。

> `Type "<name>" takes <n> type argument(s), so it is not a type on its own — "<name>.<member>" needs one that takes none`
> `Type "<name>" takes <n> type argument(s), so it is not a type on its own — "<name>.parse" needs one that takes none and whose base has a reading of a text (Int, Float, Time, Bool, Text or Bytes)`

`Tuple` は任意個の引数を取るため、メッセージは個数なしで `type arguments` と書く。可変長であってもゼロではない。2 行目は `parse` のときのメッセージである: そこでは適用を名付けるだけでは修復が終わらないため、テキストに読み方がある基底型を挙げる。

名前は型のものなので [E0117](#e0117-undef-type) には当たらず、呼び出し先は型メンバなので [E0116](#e0116-undef-call) にも当たらず、呼び出しが持つべき型が無いので [E0201](#e0201-type-mismatch) にも届かない。それぞれの検査はそれ自体としては正しく、呼び出しはその間に落ちていた: `slot n : Int = Box.fresh()` は何も報告されずに `Int` slot へ uuid 文字列を格納していた。`parse` でも報告はこれ 1 つであり、[E0802](#e0802-unimplemented-function) より先に出る: 型でない qualifier には問うべき読み方がない。

**修正**：適用を型として名付け、その名前で呼び出しを修飾する — `type IntBox = Box(Int)` とし、`IntBox.fresh()` と書く。`parse` の場合、適用した型はさらにテキストの読み方がある基底型を持たなければならない（[標準ライブラリ §2.4.3](./stdlib.md#_2-4-3-型変換)）: `type Tagged(T) = nominal Text` に対する `type OrderId = Tagged(Int)` は `Text` として読むが、コンテナには読み方がない — `type IntList = List(Int)` に対する `IntList.parse(t)` は [E0802](#e0802-unimplemented-function) になる — ので、`List.parse` や `Map.parse` などは、部品を `Int`、`Text` … にパースして `fn` で値を組み立てる。`kumiki fix` はこれを修復しない: どの引数を適用するかは作者が決めることであり、skip 理由がそう伝える。

### E0127 `fn-as-value`

値が来る位置に `fn` の名前が括弧なしで書かれている。`fn` は値ではない — ラムダは無い（[言語 §1.9.1](./language.md#_1-9-1-禁止事項)）— ので、括弧のない名前はいつも同じ誤り、すなわち呼び出しの書き忘れである。

> `"<name>" is a fn, and a fn is not a value — write the call: <name>(<params>)`

このチェックがなければ、名前は生成された関数そのものへ lowering されていた。`emit load(label)` は、effect が `in=Text` と宣言している位置へ *関数* を渡して dispatch した：storage のキーは関数のソース文字列になり、HTTP の body は `undefined` にシリアライズされたままリクエストが送られた。どの層もこれを報告しなかった — 値の型をチェッカが決められず、すべての比較が沈黙した — し、`app.init = [load(label)]` はアプリがマウントされる前に同じ場所へ到達した。

同名のローカル束縛（[言語 §1.6.7](./language.md#_1-6-7-scoping-and-shadowing)）・パラメータ・slot がシャドーイングしている名前はその値であり、`fn` ではなく、報告されない。

**括弧のない `fn` 名が正しい唯一の位置**は、高階メソッドの式断片の引数である（[言語 §1.8.6](./language.md#_1-8-6-部分適用と高階関数)）。そこでは値ではなく、メソッドが自身の positional で行う呼び出しを表し、その呼び出しへ lowering される：

| メソッド | 式断片の引数 | 束縛する positional |
|---|---|---|
| `filter`, `map`, `find`, `sort-by` | 唯一の引数 | `$1`（要素）。`Map` または対の `List`（`.entries`）の上では `$1`（キー）と `$2`（値） |
| `fold(init, f)` | 2 番目 | `$1`（アキュムレータ）, `$2`（要素） |
| `flat-map`, `map-err` | 唯一の引数 | `$1` |
| `update(k, f)` | 2 番目 | `$1`（現在の値） |

`xs.map(double)` は `xs.map(double($1))` であり、`xs.fold(0, add)` は `xs.fold(0, add($1, $2))` である。名指された `fn` はそれらの positional を先頭から、自身が宣言する数だけ受け取るので、1 つ以上、かつメソッドが束縛する数以下を宣言していなければならない — そうでなければ [E0213](#e0213-call-arity-mismatch) である。`fold` の `fn` はちょうど 2 つを宣言する。要素は 2 番目だからであり、1 つの `fn` は何も畳み込まない。リストのメソッドの `fn` が 2 つを宣言できるのはキーと値の対の上だけである。チェッカが型を決められるそれ以外のレシーバの上では、2 番目のパラメータは JS のインデックスか要素そのものを再び受け取るので、これも E0213 である。`fold` の 1 番目を含むそれ以外の引数はすべて値であり、このチェックを受ける。

比べるのは数だけである。`fn` のパラメータの型は要素の型と照合されない — インラインの `f($1)` と同じである：`List(Int)` の上の `xs.map(loud)` は、`fn loud(t: Text)` であっても報告されない。

**修正**：呼び出しを書く — `label()`、あるいは宣言された引数を渡して `greet(first, last)`。

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

到着する形は一様でなく、それが値の形より先にハンドラであるかを問う理由である。小文字始まりの名前は参照として解析される。大文字始まりの名前は、tile を取る builtin の名前付き引数では *tile call* として（`box(text("x"), onClick=Card)`）、それ以外——props ブロック、`link` のような値引数 builtin、user tile——では variant タグとして解析される。3 つとも「担っている名前」として読むので、名前自体が大文字始まりの reducer も他と同じように束縛できる：形が記録しているのは大文字か小文字か、そしてその引数がどの tile に載っているかであって、どちらもこの位置で書き手が言い分けていることではない。引数形式は以前は形を先に見ていたため、その位置に書かれた tile 名はリスナのない要素にコンパイルされていた。

裸の名前・引数なしの呼び出し・空の brace 形式に、パーサは同一のノードを与える — `onClick=Bump` / `onClick=Bump()` / `onClick=Bump {}` は解析後に区別がつかない — ので、3 つとも reducer を名指す。見分ける材料が残っておらず、どれか 1 つだけを指す診断も出せない。

したがってこのエラーが報告するのは、そもそも名前でない値である：リテラル、ペイロードを伴う variant タグ（`onClick=Some(1)`）、引数を伴う tile call（`onClick=box(text("z"))`）、props を伴う tile call（`onClick=Card {x: 1}`）。裸の名前がどの reducer も指さない場合は、大文字始まりかどうかによらず [E0102](#e0102-undef-reducer) になる — そこに書かれた tile 名も含めて。ハンドラ位置が解決する名前空間は 1 つであり、tile 層はそこに無いからである。

照合すべき宣言型を持つ位置は次のとおり：`slot` の初期値、代入の右辺（`.field` / `[k]` のパスを辿った先も含む）、宣言済み `fn` への引数、`fn` の body とその `->` 戻り型、`in=` を宣言した user tile への引数、`.get-or` のフォールバック、そしてすべての演算子のオペランド。`emit` の引数も検査するが、そちらは [E0202](#e0202-emit-arg-type-mismatch) を報告する。

`.get-or` のフォールバックはレシーバではなく**呼び出しが返す型**と照合する：空のケースで呼び出しが返す値そのものだから、結果型を担うのはフォールバックである。その結果型はレシーバの型引数から出る — `Option(T)` と `Result(T, E)` は `T`、`Map(K, V)` は `V` — ものであり、だからこそ `Option(S)` の slot に対する `opt := opt.get-or(None)` は 2 回報告される：フォールバックが `S` でないこと、そして `S` は `Option(S)` ではないこと。2 つの読みのどちらを取るかは引数の個数が決める（[Runtime §10.3.7](./runtime.md#_10-3-7-polymorphic-collection-methods)）。したがってレシーバに合わない個数の呼び出しは**ここでは**解決せず、照合する相手も持たない。ただし下げは行われる — 与えられたレシーバに対し、個数が名指す方の読みで — ので、これは沈黙ではなくそれ自体が欠陥である。

代入可能性は構造的で、暗黙変換は 1 つだけ — `Int` は `Float` の位置へ流れ、その逆は流れない。別名と generic の具体化は辿り、`where` の refinement は透過する：この検査が refinement を評価することはない。`type Volume = nominal Int where between(0, 11)` に対する `volume := 50` はこのエラーではなく、値が範囲内かどうかはバリデーションが決める（[Forms §5.6](./forms.md#_5-6-バリデーション戦略)を参照）。

`nominal` はその例外であり、このコードの中で唯一、**実型のあらゆる値が宣言型の値として妥当である**ケースを報告する規則である：`1.5` は `Int` ではなく `{a, b}` は `{a: Int}` ではないが、どの `Yen` も申し分ない `Cents` である。nominal 型を同定するのは宣言された名前であり（[§1.3.5](./language.md#_1-3-5-型の一意化)）、同じ基底型に対する 2 つの宣言は互いを拒否する — `Cents := Yen`、`postId := userId`。自身の nominal 名を持たない型は、その上に宣言されたどの nominal とも双方向に受理し合うので、`slot c : Cents = 1` と `c := c + 1` は成立したままである。nominal の上に宣言された nominal は、自身が宣言された側へ向かう一方向だけ通る。

比較演算子はこの規則の内側にある。`==` はあらゆる *形* に対して全域であり — `Int` と `Text`、`Option` とその `None` — 2 つの nominal 同一性だけが拒否される。`postId == userId` は `postId := userId` と同じ誤りであり、しかもルータや検索が書かれるときの綴りだからである（[§1.9.4](./language.md#_1-9-4-演算子の型)）。順序比較は、同一性を見ることのできない族の問いを越えて同じ組を拒否する — `Int` を基底型に持つ 2 つの nominal はどちらも number である。したがって `cents < yen`、`cents == yen`、`postId == userId` はいずれも報告され、型を書かれたとおりの名前で示す：`Operator "==" cannot compare Cents with Yen`。診断は辺ごとではなく 1 つだけである — 比較には宛先がないのでどちらのオペランドも単独では誤りではなく、二度言うべきことがない。報告位置は比較式そのもので、それは左オペランドの位置である。

拒否されるのは **両辺** が nominal 名を持ち、かつどちらも他方として宣言されていない場合だけである — 代入の規則を対称に読んだものであり、比較には一方を実型と呼べる宛先がないからである。よって `cents == 0` と `postId == ""` は代入と同じく比較でき、`nominal Cents` として宣言された `Deep` は `Cents` とどちらの順でも比較できる。族を共有せず *かつ* 2 つの同一性を持つ順序比較は 1 回だけ報告される：`nominal Bool` 2 つに対する `flag < mark` は単一の `Operator "<" cannot compare Flag with Mark` になる。

同一性が読まれるのは各オペランドの **最上位** だけであり、ここが演算子と代入の分かれ目である：`List(Cents) := List(Yen)` は代入可能性が型引数へ降りていくためこのエラーになるが、同じ組に対する `lc == ly` は報告されない。コンテナ・レコードのフィールド・その他あらゆる型引数の内側にある nominal は、比較からは見えない。この沈黙は誤った診断ではなく欠けた診断であり、それがこのコード全体が保つ読み方である。

**この検査は片側だけを主張する。** 確実に誤っているものだけを報告し、解決できないものについては黙る — 未知の型名、結果型を何も解決できないメソッド（[§2.2](./stdlib.md#_2-2-コレクションメソッド) のメンバーはレシーバから答えを決める — `List(T)` の `xs.head` は `Option(T)`、`Map(K, V)` の `m.keys` は `List(K)`、`.get` と `.get-or` は `Option(T)` / `Result(T, E)` を `T` に、`Map` の索きを `Option(V)` またはフォールバック付きで `V` にアンラップする。`.copy` はレシーバをそのまま返し、`show` / `to-int` / `floor` などの固定表はプリミティブを返す。`.map` や `.fold` のようにラムダの本体が決めるメンバーと、レシーバ自身の型が決まらない場合は動的なまま）、解決できない式の `let` 束縛など。誤った診断は動くプログラムを拒否するが、報告漏れは元から存在しなかった診断が増えないだけである。したがって check が緑であることは型の正しさの証明ではなく、名前の存在そのものは引き続き [E0801](#e0801-unimplemented-method) / [E0116](#e0116-undef-call) が担保する。

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

reducer の `ui.<ev>(<Tile>)` セレクタの対象 tile 配下に `<ev>` を DOM 上で発火し得る要素が一つも無い — 例: `tile Card = box(...)` に対する `ui.focus(Card)`。codegen は静かに handler を捨てるため reducer は死にコードになる。これを check 時の警告として浮上させ、ビルドは止めずにサイレント失敗を可視化する。検査は tile 配下（子 tile を含む）を walk するため、`TodoRow = row(check(...), …)` + `ui.click(TodoRow)` のような cascade パターンでは警告は出ない — codegen は focusable な子孫に handler を配線する。「子 tile を含む」は両側で効いている: 子孫を名前で参照する本体（`tile Row = box(Leaf)`）も、インラインの `box(input(...))` とまったく同じように walk され、codegen も同じ辺を辿って handler を持ち上げる（[§1.6.2](./language.md#_1-6-2-セレクタ)）。かつては検査だけが参照を辿り codegen は辿らなかったため、この警告が報告するはずのサイレントな取りこぼしが、警告なしで起きていた。ただし cascade の片側は未対応で、同じハンドラ prop を書いた呼び出し側（`RemoveBtn {onClick: remove}`）を経由して子孫に届く場合、その prop は持ち上げられた subscription を結合せず置き換えるため、コンテナ側の reducer は発火しない — [#407](https://github.com/kumikijs/Kumiki/issues/407)。

> `Reducer "<r>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" has no descendant that fires "<ev>" (DOM-allowed: …; observed in body: …). The handler is silently dropped.`

各イベントが許容する root builtin tile は以下（現状ツールチェーンの coverage。実装側の source of truth は `packages/compiler/src/ui-lifts.ts` の `UI_LIFTS` で、`packages/compiler/src/codegen/selector.ts` の `propsFor`（ハンドラ生成ゲート）と `typecheck.ts` の W0212 検査の両方がこれを参照する。runtime 側の DOM イベント面は `packages/runtime/src/tiles/input/` 配下の tile モジュール群が持ち、共有のリスナ登録は `_shared.ts`、`tiles-input.ts` はファミリの集約にすぎない。加えて `core.ts` の `applyUiEventHandlers` が普遍的に配線する）:

| `ui.<ev>` | 許容される root tile |
|---|---|
| `click`  | `button`, `check`, `switch`, `radio` |
| `submit` | `form` |
| `change` | `select`, `input`, `textarea`, `check`, `radio`, `switch`, `slider` |
| `input`  | `input`, `textarea`, `editable` |
| `key`    | `input`, `textarea`, `button`, `editable` |
| `focus`  | `input`, `textarea`, `button`, `select`, `editable` |
| `blur`   | `input`, `textarea`, `button`, `select`, `editable` |
| `hover`  | 任意の tile |

**修正**: 許容集合に含まれる root を持つ tile にセレクタを切り替えるか、focusable な要素に対して `input(onFocus=r)` のように明示配線する。ワイルドカード `_` セレクタと `ui.hover` は対象外。

検査は `for` / `when` / `if` / `match` の body も descend する: `if` の then/else 両分岐、`match` の全 arm が観測 root 集合に寄与する。したがって `tile Dyn = for n in xs box(...)` は W0212 を発火（到達可能な root は `box` のみ）、一方 `tile T = if c then input(...) else button(...)` は警告しない（両分岐とも allowed root を寄与）。tile body 全体が解決不能（循環、未定義名）の場合は観測集合が空になり、警告は抑制される — 偽陽性より「警告しない」を優先する。

**`link` についての注記**: `<a>` は native に click を発火するが、`link` は `click` の許容リストに意図的に含めていない — runtime は link 上の click イベントをナビゲーション割込みに予約しており、ユーザ定義 `onClick` reducer を呼ばない。`button` に切り替えるか、親 tile に `onClick=` を配線するのが現状の回避策。

**`editable` と `change` について**: `editable` は `input` / `key` / `focus` / `blur` に載り、`change` にだけ**載らない**。この 1 つの欠落は漏れではなく規則である。`<div contenteditable="true">` は編集ホストなので `tabindex` 無しで focusable であり、`focus` / `blur` / `keydown` / `input` はいずれもブラウザが発火する。違うのは listen する層だけで、前 3 つは `applyUiEventHandlers`、`input` は `editable` レンダラ自身のリスナである。一方 `change` イベントは一切発火せず、これは表の行では埋められない。したがって `ui.change(<editable の tile>)` の W0212 は理由が正しい警告である — `ui.input` を購読して新しいテキストを直前の値を持つ slot と比較するか、編集の終了を捉えたいなら `ui.blur` を使う。

`key` / `focus` / `blur` の各行にある他の空白は、これと同じ意味の規則では**ない**。この 3 つはレンダラが返した要素そのものに付けられるので、これらの行が記録しているのは現状の coverage である。`slider` と `link` は 3 行すべてから、`select` は `key` から欠けているが、いずれも `editable` と同じ理由で focusable あるいは keydown を受け取る — [#456](https://github.com/kumikijs/Kumiki/issues/456) で追跡する。また、行に載っている kind でも個々のインスタンスが発火できないことはある。`disabled` な control は focusable ではなく、それはコンパイル時の表には見えない。

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
| 式断片に `fn` 名を渡す `x.m(f)`（[E0127](#e0127-fn-as-value)） | 式断片が束縛する positional の数、ただし 1 つ以上 | `Function "<name>" expects <n> argument(s) but .<m> supplies at most <k>`（または `needs at least 1`、`.fold` では `supplies exactly 2 — the accumulator and the element`、キーと値の対ではないレシーバの上では `on "<T>" supplies 1 — …`） |
| `x.get-or(...)` | **レシーバ**（どの読みかを選ぶ） | `Method ".get-or" on "<T>" expects <n> argument(s) (…) but got <m> — "…" is the "<U>" reading` |
| `x.get(...)` | **レシーバ**（どの読みかを選ぶ） | `Method ".get" on "<T>" …, but got <m> — "…" is the "<U>" reading` |
| `app.routes` の `"/p" -> T` | 引数無し、したがって `in=` も無し | `Route "<path>" targets tile "<name>", which expects 1 argument(s) — a route target is rendered with none` |
| tile の `sub-routes` の `"/p" -> T` | 同上 | `Sub-route "<path>" in tile "<parent>" targets tile "<name>", which expects 1 argument(s) — a route target is rendered with none` |
| `tile-test` の `given.in` | ターゲットの `in=`、すなわち宣言していれば 1 つ、無ければ 0 | `Tile "<name>" expects <n> argument(s) but got <m>` |

**`.get-or` と `.get`** は、引数の個数を**レシーバ**が決めるメンバーである。いずれも1つの名前に2つの読みがあり、引数の個数で区別されるからである：`Option(T).get-or(d)` / `Result(T, E).get-or(d)` と `Map(K, V).get-or(k, d)`、そして引数を取らずアンラップする `Option(T).get` / `Result(T, E).get` と `Map(K, V).get(k)` / `List(T).get(i)`（[標準ライブラリ §2.2.1](./stdlib.md#_2-2-1-map-k-v) / [§2.2.4](./stdlib.md#_2-2-4-option-t)、[ランタイム §10.3.7](./runtime.md#_10-3-7-polymorphic-collection-methods)）。名前そのものにとってはどちらの個数も正しいので、個数が誤りになるのはレシーバに対してだけであり、メッセージは数だけでなくもう一方の読みを示す。そうでなければ、2行上の呼び出しとなぜ違うのかが読み手に分からない。

報告されなかった場合、呼び出しは与えられたレシーバの上で、**個数**が名指す読みへ lower されていた。`m.get-or("k")` はアンラップ側のヘルパへ届き、そのヘルパは `_tag` を持たない値をそのまま返すので、slot は Map 全体を受け取っていた。`opt.get-or("k", 0)` は Map 側のヘルパへ届き、そこでは持っていないキーで Option オブジェクトを索いてしまうため、`Some` に対しても fallback が答えになっていた。後者のほうが厄介である —— 型は正しく値だけが誤っているので、後続のどこもつまずかない。

型が決定できないレシーバでは、**どちらの読みを意図したか**については何も報告しない：個数は読みを選ぶだけで、それが正しい読みかどうかは決めないからである。動的なレシーバに対する誤ったエラーは沈黙より悪い。ただし**どちらの読みにも収まらない**個数は、レシーバが決定できるかどうかに関わらず報告する — 引数を2つより多く取る読みは存在せず、lowering はちょうど2つしか読まないので、3つ目は何も言われずに捨てられてしまう。

**ルートのエントリ**は、何も渡せない唯一の適用である：`tile: () => …` へ落ちる —— `sub-routes` を持つ親は `tile: (_fill) => …` へ落ちるが、その唯一の引数は runtime の outlet fill（[ライフサイクル §7.3](./lifecycle.md#_7-3-エラー境界-タイル単位)）であってターゲットが読める引数ではない —— ため、`in=` を宣言したターゲットは `$1` が束縛されないまま残り、`check` も `build` も ok と言ったあとで mount が `_d_1 is not defined` で死んでいた。サブルートのエントリ — したがって `route-outlet` が描画するもの — も同じ規則である。どちらも [ルーティング §3.1.4](./routing.md#_3-1-4-a-route-target-takes-no-argument) にあり、この規則で何も失われない理由もそこにある：描画されているルートは `route` slot にあり、どの tile も引数無しで読める。

tile と effect とルートの形は、これまで報告されていなかったものである：`in=` の宣言する引数無しで呼ばれた tile は `$1` が束縛されないまま mount し `_d_1 is not defined` で死ぬ。入力無しで emit された effect は最初の dispatch で `Cannot destructure property … of 'input'` を投げる。そして `in=` を宣言していない tile に引数を*渡した*場合は、mount も描画も正常に通り、呼び出し側が渡したつもりの値だけが静かに捨てられる。ルートのエントリは、どこにも呼び出しが書かれていないまま最初の死に方に到達する：ターゲットを適用するのはエントリ自身であり、それが何も渡せないからである。

**`tile-test`** もターゲットを tile 本体と同じように適用する——lowering は `App._tilesById["<T>"]` を `given.in` に適用する（[テスト §8.4](./testing.md#_8-4-tile-snapshot-tests)）——ので、`given.in` はその適用の引数であり、書かれていれば 1 つ、無ければ 0 と数え、メッセージは tile の形のものである。無い場合、ターゲットは `undefined` に適用され、それを最初に読んだ時点で素の `TypeError: Cannot read properties of undefined` が投げられていた——テスト名も位置も code も無い、この帯が下の `t.format()` について指弾しているのと同じ形である。これを捕まえるものは無く、そのまま CLI に届いて素の 1 行として印字され、同じファイルの他のテストも結果ごと失われていた。逆に `in=` を宣言していないターゲットに書いた場合は捨てられ、テストはその値を一度も見ていない描画を主張していた。

個数はこの適用の半分でしかなく、もう半分——より静かな方——が型である：`show` は値が無い場合も型が違う場合も等しく空文字列として描画する（[標準ライブラリ §2.4](./stdlib.md#_2-4-builtin-functions)）ので、snapshot は「中身が空のラベル」と区別の付かないものと比較して*通ってしまう*。そこで `given.in` は、tile 呼び出しの引数とまったく同じように宣言された `in=` と照合し、同じ code で値自身の位置に報告する——型が合わなければ [E0201](#e0201-type-mismatch)、レコードのフィールドなら [E0214](#e0214-missing-record-field) / [E0215](#e0215-unknown-record-field)。組み込み tile を名指した `tile-test` は、どちらの問いより前に [E0105](#e0105-undef-tile) が退ける。

この個数は、`given` のすべてのセクションが読まれるまで数えない。語彙に無いキーは [E0714](#e0714-test-section-unknown) であり、そういう名前の下に書かれた入力——`given = {slots: {}, input: "Ada"}`——は引数の欠落ではなくそちらの間違いである（セクション名を直した瞬間に消える位置で報告することになる）。lowering が実際に読む `in` は、`given` が他に何を綴り間違えていても書かれた引数なので、もう一方の向きはいずれにしても報告する：削除すべきテキストであるセクション自身の位置で。欠落の側は、位置を持たないのでテストの位置で要求する。

組み込み呼び出しも同じように数える。この個数が表すのは*呼び出し側が渡すべき*数であって、lowering が読む数とは限らない：`Decoder.Json(User)` は何も読まずセンチネルへ落ちる。引数の*型*も検査しない——センチネルはそれを無視する。それでも `Decoder.Json` が引数 1 つを要求し `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` が 0 なのは、その型こそが decode を型安全にするものだからである（[HTTP §6.1.4](./http.md#_6-1-4-decoder-型)）——型を書き忘れた decoder は、書いてある decoder とソース上も出力上も区別が付かなかった。個数を強制する前は、組み込みの引数列は lowering がたまたま読むものでしかなかった：`Duration.s()` は `((0) * 1000)` へ落ち、空の duration で書かれた timer は即座に、そして永久に発火し、`Duration.s(1, 2, "x")` は末尾を黙って捨てていた。呼び出しにしているのは括弧ではなく、したがって数えられる理由も括弧ではない：括弧なしの `Duration.s` も同じ 0 引数の呼び出しであり同じ E0213 で、個数を強制した後もその timer に届いていた唯一の書き方がこれだった。

範囲を持つ組み込みは `fmt` だけである。シグネチャが `fmt(template, ...args)`（[標準ライブラリ §2.4.5](./stdlib.md#_2-4-5-文字列フォーマット)）なので要求できるのはテンプレートだけで、メッセージは最小個数を名指す — `expects at least 1 argument(s) but got 0`。`now` は 0 個ちょうどに縛られているが、それを破る呼び出しは書けない：名前ではなくキーワードであり、0 引数の呼び出しを parser 自身が組み立てるため、`now(1)` はここに届く前に parse error になる。

**メソッド**は、lowering が決まった数の引数を読む場合に検査する — `t.format()` は以前 `check` を通り、位置情報を持たない素の `TypeError` で `build` を殺していた。強制するのは最小個数だけである：`get` / `get-or` / `slice` は渡された個数で分岐し、前の2つはさらに上記のとおりレシーバに照らして検査される。

`.get` は最小個数だけでは規則を述べられない。2つの読みが最小個数について食い違うからである：表が言う「1」は `Map` / `List` の読みのものなので、引数を取らないレシーバに対する `o.get()` が "expects 1 argument(s)" と言われ、逆の誤り `o.get(1)` は最小個数を満たしてしまい何も報告されなかった。結果型も助けにならない — レシーバが取らない個数は何にも解決せず、したがって照合相手を持たないからである。

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

**user tile** にも同じ問いを立て、2 つ目の形で答える。user tile に書かれたハンドラは、その tile が描画するノードにマージされる（[§1.7.3](./language.md#_1-7-3-event-handler-props)）ので、発火するかどうかは何を描画するかで決まる — `tile Inner = box(text("clickme"))` に対する `Inner(onClick=open)` は、描画はされるが何も配線されない。まさにこの警告が存在する理由の失敗である。ほかに気づける層が無い：この警告は非致命なので `check` は 0 で終了し（`ok (1 warning)`）、`build` も emit を出し、`smoke` から見えるのは「正しく描画され、クリックする対象が無い」タイルでしかない。

> `"<handler>" on <tile>() is dropped — <tile> renders nothing that fires it (observed in body: <kinds>). Put it on <tiles>, or subscribe with a reducer's on=ui.<event>(<Tile>)`

`<kinds>` は tile の描画ツリーを辿って集めたもので、これは [W0212](#w0212-ui-event-tile-mismatch-warning) が使うのと同じ走査である。報告するのは、そのツリーのどこにも発火する種類が無い場合だけ。これは意図的に控えめである：prop が着地するのはその tile の **root** ノードなので、`tile Card = box(button(...))` もハンドラを捨てるが、この走査は root と子孫を区別しないため報告しない。逆に、報告するものはすべて確実に捨てられる。

走査が種類を 1 つも見つけられなかった場合は報告しない — その tile の root 自体が、builtin でも宣言済み tile でもない名前である場合（`tile Inner = Nope()`、あるいは循環 `tile Inner = Inner()`）で、走査は何も学べていない。W0212 も同じ空の答えを前にして黙る。これらの形にはそれぞれの符号がある（[E0005](#e0005-tile-cycle)、[E0105](#e0105-undef-tile)）。解決できない名前が解決可能な body の**内側**にある場合（`tile Inner = box(Nope())`）は別の話で、その周囲の種類は root についての正しい答えなので、W0213 は解決できない部分を名指す符号と並んで報告される。

`onKeyDown` / `onMouseEnter` / `onFocus` / `onBlur` は報告しない。ランタイムはタイルが生成した要素にリスナをそのまま付ける。ただしそれは「リスナが付く」ことであって「イベントが届く」ことではない — `focus` と `blur` はバブリングしないので、フォーカス可能でないコンテナでは発火せず、`keydown` がコンテナに届くのはフォーカス可能な子孫がある場合だけである。そこまで報告するにはフォーカス可能性の解析が必要で、この検査は行わない。

[W0212](#w0212-ui-event-tile-mismatch-warning) は同じ黙殺を反対側から見たもの — `<ev>` を発火できないタイルを対象にした `ui.<ev>(Tile)` 購読である。こちらは捕まえられない：コンテナはクリック可能な子孫が 1 つでもあれば通過し、ボタンを含むカードのレイアウトはすべてそれに当たる。

**修正**：イベントを発火するタイルにハンドラを移すか、内容を `button` で包む — user tile なら、呼び出し側でも、その tile の中で root が発火するタイルになるようにしてもよい。領域内のどこかのクリックに反応させたい場合は、`on=ui.click(<クリック可能な子>)` で reducer を購読する。

### W0214 `fmt-placeholder-argument-mismatch` (warning)

**リテラル**のテンプレートと引数リストが食い違う `fmt` 呼び出し——その番号の引数が無い `{n}`、どのプレースホルダも指さない引数、あるいはその両方。どちらも実行時エラーではない（[標準ライブラリ §2.4.5](./stdlib.md#_2-4-5-文字列フォーマット)）：引数が届かないプレースホルダは書かれたまま描画され、どのプレースホルダも指さない引数は捨てられる。

> `fmt template and arguments disagree: {1} has no argument`
> `fmt template and arguments disagree: argument 3 is named by no placeholder`
> `fmt template and arguments disagree: {2} has no argument; argument 2 is named by no placeholder`

この警告が在る理由は2つめの形にある。`fmt("Hello {0}", name, count)` は正しい呼び出しとまったく同じ文字列を描画するので、捨てられた `count` は出力にも状態にも DOM にも何も残さない——最初から渡していないプログラムと、どの層も区別できない。1つめの形は画面に `"Hello {1}"` という痕跡を残すが、1つの間違いの両半分が別々に（片方は警告、片方はバグ報告として）届かないよう、ここで一緒に報告する。

引数の番号は呼び出しに書かれた通りに数えるので、テンプレートが第1引数であり、`{0}` は第2引数である。

検査するのはリテラルのテンプレートだけである。slot やフィールドを渡す `fmt(tpl, x)` にはコンパイル時のプレースホルダ集合が無く、その slot を初期化したリテラルの形は呼び出しが実際に見る形ではない。個数そのもの——`fmt` にテンプレートがあるか——は [E0213](#e0213-call-arity-mismatch) であり、これは致命的で、その場合はこの警告の代わりに報告される。

**修正**: 足りない引数を足す、足りないプレースホルダを足す、あるいは要らない引数を消す。余った値を文の別の場所に置きたいなら、`+` はプレースホルダ無しで連結できる。

## E03xx — ケイパビリティと純粋性

### E0301 `missing-capability`

effect が要求するケイパビリティが `app.caps` で宣言されていない。要求元は effect 自身の `cap=`、または `navigate` / `toast` のような[標準 effect](./stdlib.md#_2-6-標準-effect)（プログラム側で宣言しないもの）が登録されているケイパビリティである。DOM ランタイムはどちらも同じように制限する — 宣言されていないケイパビリティの effect は拒否され、拒否は報告される（[runtime.md §10.4.2](./runtime.md#_10-4-2-capability-check)）。この検査がないと emit はコンパイルもマウントも通り、プログラムが動かないことは実行時の panic で初めて分かる。

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

slot の初期値がほかの slot——あるいは自分自身、あるいは runtime の `route` slot（直接でも `fn` 呼び出し越しでも）——を読み取っている。導出 slot は禁止されており（[store 層の不変条件](./language.md#_1-4-2-不変条件) 不変条件 4）、`init-expr`（[store 層の構文](./language.md#_1-4-1-構文)）が受け付けるのはリテラル・レコードリテラル・コレクションリテラル・組み込み呼び出しのいずれかで、そのどれも slot を名指ししない。

> `Slot "<name>" reads slot "<other>" in its initial value; derived slots are prohibited — compute it in a fn instead`
> `Slot "<name>" reads "route" in its initial value; derived slots are prohibited, and this one cannot be computed at all: initial values are evaluated while the module loads, and the runtime installs the route during the mount that follows. Take the route from a route.enter reducer, which runs with the route the app landed on`
> `Slot "<name>" reads "<read>" through "<fn>" (<fn> → … → <read>) in its initial value; …`

低水準化もこの不変条件と一致している：slot の読み取りはライブ値テーブルの参照として出力されるが、そのテーブルは slot テーブルより先ではなく、slot テーブルから作られる。slot テーブルはモジュールのインポート中に評価されるので、slot を読む初期値は、2 つの slot をどちらの順で宣言してもモジュールのインポート中に例外になる——宣言順が決め手ではない。どの初期値も slot を読めない以上、初期値どうしの循環は書きようがなく、専用のコードも持たない。

**`route` もここでは slot であり、そもそも計算できない。** runtime は `route` をマウント中に、つまりすべての初期値が評価された後にライブ値テーブルへ設置する。したがって初期値が何かを導出しようにも、まだ route が無い。通常の導出 slot への助言も役に立たない：初期値から呼んだ `fn` は同じ slot テーブルの中で評価されるので、同じく存在しない route に行き着く。route を読む `fn` は、マウント後に走る場所ならどこでも正しい——それが成り立たないのはここと `app.init` の引数だけである（[E0120](#e0120-route-in-app-init)。同じ規則の隣の位置）。初期値からそうした `fn` を呼ぶと、E0120 と同じく呼び出し位置で、読み取りに至る `fn` の連鎖とともに報告される。`<read>` は連鎖の最後の本体が読む綴り、`route` または `$route` である。そのためメッセージは「compute it in a fn」を省き、`route.enter` の reducer を案内する。この検査がないと、`slot at : Text = route.path` も、`fn here() -> Text = route.path` を伴う `slot at : Text = here()` も綺麗にコンパイルが通り、モジュールのインポート中に `Cannot access '_live' before initialization` を投げて何もマウントされない。初期値に書いた `$route` は未定義の名前（[E0103](#e0103-undef-ref-undef-slot)）である——初期値をペイロード付きで適用するものはない。`route` という名前のローカル束縛や `fn` 引数はその束縛であって slot ではない。`now` は slot ではなくモジュールのインポートから来るので、初期値から読んでよい。

**修正**：slot 自体は単独で成り立つ値にし、導出形は導出計算のための層である `fn` で計算する。起動時に 1 度だけ導出したい値なら `route.enter` の reducer に置く——route の場合はそこが唯一の場所である。その reducer は着地した route で走り、以後の到着のたびにも走る。

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

### E0602 `unassignable-member`

lvalue のステップが、レシーバのフィールドではなく**標準ライブラリのメンバー**を指している。lvalue のステップ集合は閉じている（[言語 §1.6.3](./language.md#_1-6-3-lvalue-の意味論)）— フィールド、インデックス、そして `Option` / `Result` への `.get` の3つだけ — ので、メンバーを通した書き込みはできない。そのセグメントはリテラルのキーになり、書き込みは slot をレコードで置き換えてしまう。`Text` に対する `name.length := 9` は、slot に `{"length": 9}` を残していた。

> `Cannot assign through ".<member>": it is a member of "<T>", not a field`

例外は `.get` だが、§1.6.3 が定義する範囲に限る。アンラップしないレシーバ — `Map` や `List` — に対する `.get` は他のメンバーと同じであり、同じように報告される。

名前は予約ではなくディスパッチされる：`length` という名前のフィールドを宣言したレコードは、今まで通りそのフィールドへ書き込める。逆にレコードは `.show` を宣言しないので、ディスパッチは標準ライブラリへ落ち、`rec.show := "x"` は他のメンバーと同じく E0602 になる。

E0602 は「その名前はこのレシーバの**メンバーである**」と述べるので、その文が真であるときにだけ報告される。このレシーバのメンバーではない名前は、`:=` のどちら側でも [E0108](#e0108-undef-member) になる。単に存在しない名前（`name.frist`）と、別のレシーバに属する名前の両方がこれにあたる — `.abs` は `Int` / `Float` のメソッドなので、`Text` に対しては代入できないのではなく未定義である。型が決定できないレシーバ — ユニオンや不透明な型引数 — ではどちらも報告しない。読み側と同じく、動的なレシーバに対する誤ったエラーは沈黙より悪いからである。

**対処**：そのメンバーが導出するはずだった値を直接書く（`name.length := 9` ではなく `name := "some text"`）。レシーバがレコードなら、実在するフィールドを使う。

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

テスト DSL 不変条件（現時点では E0712 / E0713 / E0714。E0710–E0719 はこの用途のために予約）は test 系定義の内部でのみ発火し、オプトインフラグを必要としない。

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

### E0714 `test-section-unknown`

テスト本体の `given` / `expect` のキーが、そのテスト種別のどのセクションも名指していない。セクションは種別ごとに閉じた語彙であり（[テスト §8.1.1](./testing.md#_8-1-1-the-names-a-test-body-writes)）——`reducer-test` は `slots` / `event` / `mocks` を取り `slots` / `effects` / `panic` で主張する、`tile-test` は `slots` / `in`、`property-test` は `slots` / `event`、`episode-test` は `slots-equal` / `no-panics` / `no-errors` で主張する——lowering はそれぞれを名前で読む。

集合に無い名前は誰にも読まれず、誰にも報告されなかった。つまりそのセクションは起こらなかった。これはテストが弱くなるのではなく別のテストになるということであり、しかも成功する：

```kumiki invalid
test typo-section =
    reducer-test inc
        given  = {slot: {count: 41}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}, effects: []}
```

`slots` ではなく `slot` なので 41 は決して設定されない：`count` は宣言された `0` から始まり、`inc` が `1` にし、`expect` は成立する——作者が選んでいない状態に対して。

> `` Unknown section "<name>" in a|an <kind> `<given|expect>` — did you mean "<nearest>"? (accepted: <その種別の集合>) ``
> `` Unknown section "<name>" in a|an <kind> `<given>` — "<name>" is an `expect` section (accepted: <その種別の集合>) ``

受理される集合は常に示す。最も近い名前が答えでない場合の答えがそれだからであり、語彙は 3 語しかないので推測より安い——同じ距離の候補が 2 つあるときは何も提示しない。テストの*もう一方*の節のセクション名（`given` に書かれた `effects` など）は、綴り間違いではなく位置の間違いとして報告する。名前は正しく場所が違うのであって、距離の規則には言えないことである。

未知キーの*中*の名前は解決しない：存在しないセクションに属する名前は、最初の間違いを直した瞬間に消える位置に出る 2 つ目の診断になるからである。そこでもなお報告されるのは、どこに書かれていても間違っているもの——`given` の中のワイルドカードはどのセクションでも [E0109](#e0109-test-wildcard-misuse) であり、セクション名を直しても残る。

**修正**：その種別の綴りでセクション名を書く。受理される集合はメッセージに載っており、それは `codegen/emit-test.ts` がセクションを読むのと同じテーブルである——checker が拒否するセクションは、どこも lowering しないセクションであり、`episode-test` の `expect` が認識しないセクションは codegen で throw する（何も主張しないテストに降ろさない）。

## E08xx — ランタイムハザード

型は通るが実行時に壊れる「書き方」を、`check` の段階で静的に捕まえるための帯。検証の3層モデルは [3 層検証モデル](./testing.md#_8-10-the-three-layers-of-tooling-verification) を参照。

### E0801 `unimplemented-method`

`obj.method(...)` 形式のメソッド呼び出しが、ランタイム／コード生成の実装するメソッド集合に存在しない。綴り間違い（`.fitler`）や、仕様には載っていても未実装のメソッド、別の型のメソッドの誤用（`Option` に `.to-result` など）で起こる。

> `Method ".<name>" is not implemented by the runtime`

**補足**：実装されているメソッド集合は `@kumikijs/compiler` の `KNOWN_METHODS`（コード生成の `methodCallJs` と同期）が唯一の正。引数なしメソッドは `()` 付きでも無しでも書ける — [標準ライブラリ §2.2.3](./stdlib.md#_2-2-3-list-t) が括弧なしをショートカットと呼んでおり、どちらの形もコンパイルできる。標準ライブラリのメソッド一覧は [標準ライブラリ](./stdlib.md)。

**修正**：正しいメソッド名に直すか、その操作を `match` / `fold` など実装済みの手段で書き換える。未実装の仕様メソッドが必要なら、`packages/` に実装して `examples/` に動く例を足す。

### E0802 `unimplemented-function`

本ドキュメントが記述しているが、ツールチェーンが lowering を持たない関数の呼び出し。`E0116` とは異なり、名前は正しく、書かれたとおりには lowering できない。

> `Function "<name>" is documented but not implemented by the runtime`
> `"<T>" has no reading of a text — parse into Int, Float, Time, Bool, Text or Bytes and build it in a fn`

現在この状態にある呼び出しは 2 つあり、それぞれが 1 つのメッセージに対応する。1 つ目は `trace(label, value)`（[標準ライブラリ §2.4.6](./stdlib.md#_2-4-6-デバッグ補助)）。仕様上の挙動は episode ログへの記録だが、lowering された式から mount の episode logger へ届く接続点が存在しない — 修正はコード生成のケース追加ではなくランタイム側の変更になる。その間ここで報告することが診断の誠実さを保つ: 報告しなければ呼び出しは未定義のグローバルへ落ち、評価された場所でプログラムが壊れ、仕様を指し示すものは何も残らない。

2 つ目は、基底型にテキストの読み方がない型に対する `T.parse(text)` — レコード、ユニオン、コンテナ、`File`、`EffectId`、`Unit`、またはそれらの上の `nominal`。読み方のある基底型は [標準ライブラリ §2.4.3](./stdlib.md#_2-4-3-型変換) が挙げている。`trace` と違い、これは実装を待っている欠落ではない: レコードを表すテキストの綴りは存在しないので、どんな lowering にも作るものがない。メッセージが未実装と言わずにそう述べるのはそのためである。呼び出しの型は `Option(T)` だが、lowering は生のテキストを `Some` で包んでいたため、`T` として読む側が取り出す値は文字列だった。どの型も指さない `T` はこれではなく [E0117](#e0117-undef-type) であり、型引数なしで書かれた型コンストラクタ（`List.parse(t)`、`type Box(T) = …` に対する `Box.parse(t)`）は [E0124](#e0124-type-constructor-qualifier) になり — そもそも型ではないので読み方の有無は問われない —、定義が何にも解決されない `T`（未定義の名前の別名、循環）はその定義での報告に任され、`nominal` はその基底型で判断される — `type Cents = nominal Int` は `Int` と同じようにパースされる。

**修正**：呼び出しを削除する。`trace` はデバッグ補助であり、言語のどの機能もこれに依存していない。`T.parse` の場合は、読み方のある型（`Int.parse`、`Text.parse` など）でテキストを読み、`fn` の中でそこから `T` を組み立てる。

### E0803 `unimplemented-refinement`

`where` refinement が、[§1.3.3](./language.md#_1-3-3-登録済み-refinement-述語) に登録されているがツールチェーンが実行時チェックへ lowering していない述語を指している。`E0802` の 1 つ下の層にある対応物で、名前は正しく、欠けているのは実装側である。

> `Refinement "<pred>" is documented but not enforced by the runtime`
> `Refinement "<pred>" is not a registered predicate`

2 つ目のメッセージは、表がそもそも持っていない述語に対するもの。その名前はチェッカーへ届く前にパーサが弾くので、ここへ到達するのは手で組み立てた AST 経由だけである — コンパイラ自身のテストはその経路でこの診断を駆動している。

**現在この状態にある述語はない。** このチェックが存在するのは、代わりに何が起きていたかによる: `refinementToJs` は実装していないものをすべて `(_v) => true` へ lowering する `default` 分岐で終わっていたため、登録済み 12 述語のうち 7 つが「決して失敗しないチェック」としてランタイムへ届いていた — `slot n : Int where positive` は `-7` を受け入れ、その slot に対する `error(field=n)` は何も表示しなかった。refinement は値が slot へ入る際に通るチェックとして規定されている（[フォーム §5.6](./forms.md#_5-6-バリデーション戦略)、[ランタイム §10.3.3](./runtime.md#_10-3-3-batching)）ので、lowering のない述語はドキュメントがプログラムの実際の挙動と異なる約束をしている状態であり、しかもそれを誰も報告しなかった。パーサが受け付ける名前は lowering テーブルの名前とちょうど一致するため、今日のソースからこの診断へ到達することはない。lowering を伴わずに §1.3.3 へ述語を追加した場合に、実行時ではなくビルド時にここへ落ちる。

**修正**：lowering を実装するか、lowering のある述語を使う。refinement はランタイムが守る保証なので第三の選択肢はない — ツールチェーンが検査できない述語が必要な場合は、値がプログラムへ入る場所（パース結果を受け取る `fn`、reducer のガード）で検証する。

### E0804 `refinement-args-invalid`

登録済み述語が、チェックを組み立てられない引数とともに、またはその述語が検査できない基底型の上に書かれている。

> `Refinement "<pred>" takes <n> argument(s) but got <m>`
> `Refinement "<pred>" takes <what> but argument <i> is <given>`
> `Refinement "<pred>" needs at least <min> value(s) but got <n>`
> `Refinement between(A, B) has a lower bound above its upper bound, so no value satisfies it`
> `Refinement regex("<p>") is not a pattern: <reason>`
> `Refinement len-lt(0) is shorter than every text, so no value satisfies it`
> `Refinement "<pred>" tests <text | a number | text or a number> but is written over <base>, so no value satisfies it`
> `Refinement "one-of" lists <literal> (argument <i>) but is written over <base>, so no value equals it`
> `Refinement "<pred>" tests <what> but <G(args)> applies it over <base>, so no value satisfies it`

各述語の引数個数と形は [§1.3.3](./language.md#_1-3-3-登録済み-refinement-述語) の表にある。**どの値も**満たせない refinement は、**あらゆる値が**満たす refinement と同じ欠陥であり — どちらも slot の保証を、それに依存するプログラムから奪う — 述語が取らない形の引数はそのどちらかを生む：`between(5, 1)` と `len-eq(2.5)` はあらゆる値を拒否し、`len-gt(-1)` はあらゆる値を受理し（`v.length > -1` は `""` に対しても真）、`one-of()` は受理する候補を持たない。最も鋭いのは `between(0, "x")` で、生成されるチェックは `v >= 0 && v <= x` となり、その後半は境界との比較ではなく宣言のない名前への参照なので、最初の書き込みか最初の `error(field=…)` 描画で `ReferenceError` を投げていた。`len-lt(0)` は正しい個数を取りながら、0 未満の長さは存在しないので、やはりあらゆるテキストを拒否する。

基底型は同じ規則のもう半分である。各述語は 1 つの形の値を検査し、それ以外には `false` を返す（[§1.3.3](./language.md#_1-3-3-登録済み-refinement-述語)）。そのため別の形の基底型の上に書かれた述語は**あらゆる**値を拒否する：`slot name : Text where positive` は何も通さず、そこへの書き込みはそのたびに reducer のバッチを破棄する。各述語が必要とするもの：

| 述語 | 検査するもの | 必要な基底型 |
|---|---|---|
| `nonempty`, `len-eq`, `len-lt`, `len-gt`, `email`, `url`, `uuid`, `regex` | テキスト | `Text` |
| `between`, `positive`, `negative` | 数値 | `Int`・`Float`・`Time` |
| `one-of` | いずれかのリテラルとの厳密な一致 | テキストリテラルなら `Text`、数値リテラルなら `Int`・`Float`・`Time` |

`one-of` は厳密な所属判定に lower されるので、各リテラルは基底型の値でなければならない：`Text where one-of(1, 2)` はどのテキストとも一致しない候補を並べており、`Bool`・レコード・union にはそもそもリテラルがない。正しいリテラルの中に 1 つだけ誤ったものが混じっている場合も報告される — その候補は決して選ばれない。

基底型は refinement が書かれている連鎖 — 別名・`nominal`・先行する `where` — をたどって読む。したがって `type Handle = nominal Text` に `where positive` を付けると報告され、`nominal Int` に `where between(0, 9)` を付けても報告されない。レコード・union・コンテナはどちらの系統が検査する基底型でもなく、`EffectId` のような不透明な型も同様である：実行時に何で表されていようと、プログラムはその述語が問う対象となる値をその型として持たない。

型パラメータはそれ自体では基底型について何も言わないので、定義 `type NonEmpty(T) = T where nonempty` は報告されない。報告されるのはその**適用**である：引数を本体へ代入し — 入れ子の適用・レコードのフィールド・union のペイロードを通して — それによって検査できない基底型の上に置かれた refinement を適用箇所で報告する。`slot n : NonEmpty(Int)` や `type N = NonEmpty(Int)` の `NonEmpty(Int)`、`type W(T) = nominal T where positive` に対する `W(Text)` がそれである。引数によらず定義そのものが持つ問題は、定義で 1 度だけ報告される。

**修正**：述語が取る引数を書く — `between` には数値の境界、`len-*` 系には 0 以上の整数、`regex` にはコンパイルできるパターン、`one-of` には 1 個以上のリテラル — そして述語が検査する基底型の上に書くか、手元の基底型を検査する述語を選ぶ（テキストには `positive` ではなく `len-gt(0)`）。
