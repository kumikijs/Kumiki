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

パースエラーは `ParseError`（`message` + `pos`）として `throw` される。パース段は最初のエラーで停止するため、コードは付与されない。

コード付き診断は `packages/compiler/src/typecheck.ts` からのみ発行される。lexer は `LexError` を、parser は `ParseError` を throw する — どちらも `message` + `pos` は持つが `code` は持たない設計（single-shot、リカバリ無し）。機械化された spec-drift ガード（`packages/compiler/test/spec-drift.test.ts`）は実装側のコード集合をこの `typecheck.ts` からのみ抽出する。

## コード体系

| 帯 | 領域 |
|---|---|
| `E00xx` | アプリ構造（ルーティングの必須要件など） |
| `E01xx` | 名前解決（未定義の参照） |
| `E02xx` | 型の不一致 |
| `E03xx` | ケイパビリティと純粋性 |
| `E04xx` | モーション |
| `E06xx` | reducer の書き込み規則 |
| `E07xx` | オプトイン検査：a11y／strict-icons／テスト DSL 不変条件 |
| `E08xx` | ランタイムハザード（コンパイルは通るが実行で壊れる書き方） |
| `W02xx` | 非致命的な警告（ビルドは成功する） |

## E00xx — 構造

### E0001 `missing-404`

`app.routes` を宣言したアプリは、`/404` パターンのルートを必ず含めなければならない。未マッチのパスはここへフォールバックする。

> `app.routes must include a "/404" entry`

**修正**：`route "/404" -> NotFound` のような 404 用 tile へのルートを追加する。詳細は [ルーティング](./routing.md)。

### E0002 `duplicate-timer-name`

2 つ以上の `timer(d, name=N)` トリガーが、同じタイマー名 `N` を宣言している。タイマー名は単一のネームスペースを共有し、`stop-timer(N)` が一意に定まるようアプリ内で一意でなければならない。

> `Timer name "<name>" is declared more than once`

**修正**：いずれかのタイマーを改名し、各 `name=` を一意にする。詳細は [timer](./lifecycle.md#_7-1-5-timer)。

## E01xx — 名前解決

### E0102 `undef-reducer`

イベントハンドラ引数 / prop が、存在しない reducer 名を指している。

> `Reference to undefined reducer "<name>"`

**修正**：reducer 名の綴りを確認する。`kumiki fix` が近い名前を提案できる（→ [AI 編集](./ai-edit.md)）。

### E0103 `undef-ref` / `undef-slot`

- `undef-ref`：式中で未定義の名前を参照した。
  > `Reference to undefined name "<name>"`
- `undef-slot`：reducer 本体で未定義の slot へ代入した。
  > `Assignment to undefined slot "<name>"`

**修正**：参照先の slot / 束縛が宣言済みか確認する。

### E0104 `undef-effect`

`emit` の対象が未定義の effect を指している。

> `Reference to undefined effect "<name>"`

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

**修正**：重複を削除する。別パスを表現したいなら綴りを直す。

### E0113 `sub-routes-without-outlet`

`sub-routes` を宣言した tile の body に `route-outlet` 呼び出しが存在しない。コンパイルは通るが、マッチした子ルートをどこにも描画できないので「ビルドは成功するが何も起きない」という Kumiki が一番嫌う失敗モードになる。

> `Tile "<name>" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render`

**修正**：子を表示したい場所に `route-outlet()` を 1 つ置く。要らないなら `sub-routes` を外す。

### E0114 `sub-routes-without-wildcard-parent`

`sub-routes` を宣言した tile を `app.routes` から指している親エントリの pattern が wildcard（`/*`）で終わっていない。親が wildcard でないと runtime はネストマッチャに到達せず、sub-routes は永遠に発火しない。詳細は [Nested Routes](./routing.md#_3-6-nested-routes)。

> `Tile "<name>" declares sub-routes but its parent route "<path>" is not a wildcard pattern (must end with "/*")`

**修正**：親 pattern を `/*` で終わるように変える（`/settings` → `/settings/*`）か、`sub-routes` ブロックを外す。

## E02xx — 型

### E0201 `type-mismatch`

イベントハンドラの引数 / prop が reducer 名でなければならないのに、別種の値だった。

> `Event handler arg "<name>" must be a reducer name`
> `Event handler prop "<name>" must be a reducer name`

### E0202 `emit-arg-type-mismatch`

`emit` の対象 effect が `in=EffectId` を宣言しているのに、渡した引数の静的推論型が `EffectId` ではない。キャンセルの配線ミスの典型形で、`emit stopSearch(searchId)`（`searchId : EffectId`）は正しく、`emit stopSearch(42)` や `emit stopSearch("id")` は誤り。この検査が無いと codegen は `EffectId` でないランタイム値をそのまま渡し、cancel パスは静かに no-op となる — 成功したキャンセルと見分けがつかなくなる。

> `emit "<effect>" expects an EffectId argument`

検査は best-effort：`emit` が引数を 1 つ以上持ち、かつその第 1 引数の型が静的に推論できる場合にのみ発火する。引数無しの `emit` や、型が check 時に解決できない式は対象外で、runtime に委ねる。

**修正**：以前に fire-and-track した同じ effect が返した値のような、`EffectId` 型の slot / 束縛を渡す。もしくは — その effect が本当にスカラーを受けるべきなら — `effect` 宣言の `in=` 型を実態に合わせる。詳細は [EffectId](./stdlib.md#_2-1-1-1-effectid) と [emit](./lifecycle.md)。

### E0204 `effect-id-misuse`

`EffectId` 型の値が定義されていない操作に使われている。`EffectId` で定義された操作は等価比較（`==` / `!=`）、`EffectId` 型 slot への代入、`in` 型が `EffectId` の effect への引数渡しのみ。算術・順序比較・`text(...)` での描画は拒否する — `EffectId` は不透明型なのでランタイムが表現を変えてもアプリが壊れないようにするため。

> `Operator "<op>" cannot be applied to EffectId — only "==" / "!=" are defined`
> `text(...) cannot render EffectId — it is an opaque handle`

**修正**: `EffectId.none` との `==` / `!=` 比較に置き換えるか、cancel 用 effect に渡す。詳細は [EffectId](./stdlib.md#_2-1-1-1-effectid)。

### E0205 `bind-on-file-input`

`input(type="file")` には `bind=` でスロットを束ねられない。`bind=` の双方向束縛の互換型テーブル（[Forms §5.1.1](./forms.md#_5-1-1-elements-that-support-bind)）にファイルを受け入れる型が無く、ファイルは change イベントの payload 経由でのみ受け取れる（[Forms §5.10](./forms.md#_5-10-file-upload)）。

> `input(type="file") does not support bind="<name>"; receive files via a ui.change reducer with $event.files.head`

**修正**: `bind=` を外し、change イベントからファイルを取り出す reducer を追加する：

```kumiki
slot avatar : Option(File) = None
tile AvatarPicker = input(type="file", accept="image/*")
reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
```

### E0206 `file-only-prop`

`input` の `accept` / `multiple` prop は `type="file"` のときのみ有効。これらは下層の `<input>` 要素にそのまま流し込まれるため、HTML 仕様としてファイルピッカーに対してのみ意味を持つ（[Forms §5.10](./forms.md#_5-10-file-upload)）。他の `type` で使う場合 — あるいは `type` を省略した場合（デフォルトは `"text"`）— は無効な HTML となり、潜在バグになる。診断は `type` が静的に `"file"` でないと確定できる場合のみ発火し、非リテラルの `type=` 式には触らない。

> `input prop "accept" requires type="file" (got type="text"); accept/multiple are only valid on file inputs`
> `input prop "multiple" requires type="file" (got no type, defaults to "text"); accept/multiple are only valid on file inputs`

**修正**: `type="file"` を付けてファイルピッカーにするか、`accept` / `multiple` prop を取り除く：

```kumiki
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

reducer の `ui.*` セレクタが宣言されていない tile を指している。この検査がないと、`ui.click(SaveBtn)` を `ui.click(SaveBtnn)` と打ち間違えてもコンパイルが通り、どこにも bind されない reducer（= 意図的に未使用の reducer）と区別がつかない。

> `Reducer "<name>" subscribes to ui.<ev>(<Tile>) but tile "<Tile>" is not declared`

**修正**: `tile <Tile> = …` を宣言するか、セレクタの tile 名を既存のものに直す。`emit confirm({onYes: r, …})` 等のコールバックとして間接的に dispatch される reducer 用のワイルドカード `_`（[Lifecycle §7](./lifecycle.md) 参照）はこの検査の対象外。

### E0212 `selector-id-mismatch`（`--strict-selector-id` で opt-in）

reducer の `ui.<ev>(Tile#id)` セレクタが指す `#id` を、対象 tile のリテラル `{id: "..."}` prop がどう転んでも生成できない。E0211 は tile 名のタイポを捕まえるが、この検査は `#id` 側のタイポを捕まえる — 例えば `tile NewForm = form(...) {id: "new"}` に対する `on=ui.submit(NewForm#nw)`。runtime `_dispatch` のフィルタ（spec §1.6.2）は不一致を静かにスキップするため、この検査がなければ reducer は発火せず、開発者はエラーを目にすることができない。`kumiki check --strict-selector-id` または `compile({ strictSelectorId: true })` で opt-in する。

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
| `input`  | `input`, `textarea` |
| `key`    | `input`, `textarea`, `button` |
| `focus`  | `input`, `textarea`, `button`, `select` |
| `blur`   | `input`, `textarea`, `button`, `select` |
| `hover`  | 任意の tile |

**修正**: 許容集合に含まれる root を持つ tile にセレクタを切り替えるか、focusable な要素に対して `input(onFocus=r)` のように明示配線する。ワイルドカード `_` セレクタと `ui.hover` は対象外。

検査は `for` / `when` / `if` / `match` の body も descend する: `if` の then/else 両分岐、`match` の全 arm が観測 root 集合に寄与する。したがって `tile Dyn = for n in xs box(...)` は W0212 を発火（到達可能な root は `box` のみ）、一方 `tile T = if c then input(...) else button(...)` は警告しない（両分岐とも allowed root を寄与）。tile body 全体が解決不能（循環、未定義名）の場合は観測集合が空になり、警告は抑制される — 偽陽性より「警告しない」を優先する。

**`link` についての注記**: `<a>` は native に click を発火するが、`link` は `click` の許容リストに意図的に含めていない — runtime は link 上の click イベントをナビゲーション割込みに予約しており、ユーザ定義 `onClick` reducer を呼ばない。`button` に切り替えるか、親 tile に `onClick=` を配線するのが現状の回避策。

## E03xx — ケイパビリティと純粋性

### E0301 `missing-capability`

effect が要求するケイパビリティが `app.caps` で宣言されていない。

> `Effect "<effect>" requires capability "<cap>" which is not declared in app.caps`

**修正**：`app.caps` に必要なケイパビリティを追加する。能力モデルの詳細は [ライフサイクル](./lifecycle.md)。

### E0302 `unknown-capability`

`app.caps` のエントリが、標準ケイパビリティ（[標準ケイパビリティ](./stdlib.md#_2-5-standard-capabilities)）でも `kumiki.caps.json` マニフェストで登録されたものでもない。

> `Unknown capability "<name>" in app.caps — use a standard capability or register it in kumiki.caps.json`

**修正**：標準ケイパビリティを使うか、綴りを直すか、`.kumiki` ファイルと同じディレクトリの `kumiki.caps.json` にカスタムケイパビリティを登録する。詳細は [標準ケイパビリティ](./stdlib.md#_2-5-standard-capabilities)。

### E0303 `invalid-cancel-target`

`cap=http.cancel` を持つ effect の宣言が必要な形（`in=EffectId out=Unit`）になっていない、または cancel パスでサイレントに無視される属性（`policy` / `retry` / `map-request`）を宣言している。cancel capability は id でキャンセルし何も返さないため、リクエスト単位の挙動を宣言するのはユーザ意図と挙動の乖離になる。

> `effect "<name>" with cap=http.cancel must declare in=EffectId out=Unit`
> `effect "<name>" with cap=http.cancel cannot declare a policy`
> `effect "<name>" with cap=http.cancel cannot declare retry`
> `effect "<name>" with cap=http.cancel cannot declare map-request`

**修正**: `in=` / `out=` を `in=EffectId out=Unit` に直し、`policy=` / `retry=` / `map-request=` 句があれば削除する。あるいは `cap=http.cancel` を外す。[HTTP Cancellation](./http.md#_6-4-cancellation) を参照。

### E0305 `fn-impurity`

`fn`（純粋関数）が slot を読み取っている。`fn` は引数のみに依存しなければならない。

> `fn "<name>" must not read slot "<name>"`

**修正**：必要な slot 値を引数として渡す。

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

既定では警告として扱われ明示的な `strict*` オプトインで初めてエラーに昇格する検査、あるいはテスト DSL 自身の不変条件を守る検査の帯。`strict*` 系のコードは対応するフラグが立っていない限り `check()` が出力から除去する。テスト DSL 系のコードは `test` / `episode-test` / `property-test` 定義の内部でのみ発火するので、常時アクティブでよい。

a11y 検査は `check(program, { strictA11y: true })` で有効化される。

### E0701 `a11y-button`

> `button must have a text= argument or aria-label prop`

### E0702 `a11y-image`

> `image must have an alt prop`

### E0703 `a11y-link`

> `link must have inner text or aria-label`

**修正**：可視テキストか、`aria-label` / `alt` を付与する。フォーム全般の指針は [フォーム](./forms.md)。

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

## E08xx — ランタイムハザード

型は通るが実行時に壊れる「書き方」を、`check` の段階で静的に捕まえるための帯。検証の3層モデルは [3 層検証モデル](./testing.md#_8-10-the-three-layers-of-tooling-verification) を参照。

### E0801 `unimplemented-method`

`obj.method(...)` 形式のメソッド呼び出しが、ランタイム／コード生成の実装するメソッド集合に存在しない。綴り間違い（`.fitler`）や、仕様には載っていても未実装のメソッド、別の型のメソッドの誤用（`Option` に `.to-result` など）で起こる。

> `Method ".<name>" is not implemented by the runtime`

**補足**：実装されているメソッド集合は `@kumikijs/compiler` の `KNOWN_METHODS`（コード生成の `methodCallJs` と同期）が唯一の正。引数なしメソッドを `()` 付きで呼んだ場合もこの帯で捕捉される。標準ライブラリのメソッド一覧は [標準ライブラリ](./stdlib.md)。

**修正**：正しいメソッド名に直すか、その操作を `match` / `fold` など実装済みの手段で書き換える。未実装の仕様メソッドが必要なら、`packages/` に実装して `examples/` に動く例を足す。
