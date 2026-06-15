# エラーコード仕様

Kumiki のコンパイラ（`@kumikijs/compiler`）が報告する診断は、**パースエラー**と**型検査エラー**の 2 系統に分かれる。本書は両者を正規（normative）に列挙する。実装側でコードを追加・変更した場合は、本書も同時に更新しなければならない。

## エラーの形

型検査エラーは `KumikiError` として表現される：

```ts
type KumikiError = {
  code: string;   // "E0103" のような安定識別子
  kind: string;   // "undef-slot" のような機械可読な分類
  message: string; // 人間向けメッセージ（対象名を含む）
  pos: Pos;        // { line, col }
};
```

`code` は永続的な契約であり、一度割り当てたら意味を変えない。`kind` は同一 `code` 配下の細分類で、診断ロジックの分岐に使う。

パースエラーは `ParseError`（`message` + `pos`）として `throw` される。パース段は最初のエラーで停止するため、コードは付与されない。

## コード体系

| 帯 | 領域 |
|---|---|
| `E00xx` | アプリ構造（ルーティングの必須要件など） |
| `E01xx` | 名前解決（未定義の参照） |
| `E02xx` | 型の不一致 |
| `E03xx` | ケイパビリティと純粋性 |
| `E04xx` | モーション |
| `E06xx` | reducer の書き込み規則 |
| `E07xx` | アクセシビリティ（a11y） |
| `E08xx` | ランタイムハザード（コンパイルは通るが実行で壊れる書き方） |

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

### E0110 `sub-routes-without-wildcard-parent`

`sub-routes` を宣言した tile を `app.routes` から指している親エントリの pattern が wildcard（`/*`）で終わっていない。親が wildcard でないと runtime はネストマッチャに到達せず、sub-routes は永遠に発火しない。詳細は [Nested Routes](./routing.md#_3-6-nested-routes)。

> `Tile "<name>" declares sub-routes but its parent route "<path>" is not a wildcard pattern (must end with "/*")`

**修正**：親 pattern を `/*` で終わるように変える（`/settings` → `/settings/*`）か、`sub-routes` ブロックを外す。

### E0111 `orphan-sub-routes`

`sub-routes` を持つ tile が `app.routes` のどのエントリからも参照されていない。ネストルートテーブルに到達経路が無い。

> `Tile "<name>" declares sub-routes but is not the target of any route in app.routes`

**修正**：その tile を target とする `/*` 付きルートを `app.routes` に追加するか、`sub-routes` を削除する。

### E0112 `duplicate-sub-route`

同じ tile の `sub-routes` 内で同一 path が複数回出現している。マッチは定義順なので、重複はデッドコードかタイポ。

> `Sub-route path "<path>" is declared more than once in tile "<name>"`

**修正**：重複を削除する。別パスを表現したいなら綴りを直す。

## E02xx — 型

### E0201 `type-mismatch`

イベントハンドラの引数 / prop が reducer 名でなければならないのに、別種の値だった。

> `Event handler arg "<name>" must be a reducer name`
> `Event handler prop "<name>" must be a reducer name`

## E03xx — ケイパビリティと純粋性

### E0301 `missing-capability`

effect が要求するケイパビリティが `app.caps` で宣言されていない。

> `Effect "<effect>" requires capability "<cap>" which is not declared in app.caps`

**修正**：`app.caps` に必要なケイパビリティを追加する。能力モデルの詳細は [ライフサイクル](./lifecycle.md)。

### E0302 `unknown-capability`

`app.caps` のエントリが、標準ケイパビリティ（[標準ケイパビリティ](./stdlib.md#_2-5-standard-capabilities)）でも `kumiki.caps.json` マニフェストで登録されたものでもない。

> `Unknown capability "<name>" in app.caps — use a standard capability or register it in kumiki.caps.json`

**修正**：標準ケイパビリティを使うか、綴りを直すか、`.kumiki` ファイルと同じディレクトリの `kumiki.caps.json` にカスタムケイパビリティを登録する。詳細は [標準ケイパビリティ](./stdlib.md#_2-5-standard-capabilities)。

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

## E07xx — アクセシビリティ（a11y）

a11y 検査は `check(program, { strictA11y: true })` で有効化される。

### E0701 `a11y-button`

> `button must have a text= argument or aria-label prop`

### E0702 `a11y-image`

> `image must have an alt prop`

### E0703 `a11y-link`

> `link must have inner text or aria-label`

**修正**：可視テキストか、`aria-label` / `alt` を付与する。フォーム全般の指針は [フォーム](./forms.md)。

## E08xx — ランタイムハザード

型は通るが実行時に壊れる「書き方」を、`check` の段階で静的に捕まえるための帯。検証の3層モデルは [3 層検証モデル](./testing.md#_8-10-the-three-layers-of-tooling-verification) を参照。

### E0801 `unimplemented-method`

`obj.method(...)` 形式のメソッド呼び出しが、ランタイム／コード生成の実装するメソッド集合に存在しない。綴り間違い（`.fitler`）や、仕様には載っていても未実装のメソッド、別の型のメソッドの誤用（`Option` に `.to-result` など）で起こる。

> `Method ".<name>" is not implemented by the runtime`

**補足**：実装されているメソッド集合は `@kumikijs/compiler` の `KNOWN_METHODS`（コード生成の `methodCallJs` と同期）が唯一の正。引数なしメソッドを `()` 付きで呼んだ場合もこの帯で捕捉される。標準ライブラリのメソッド一覧は [標準ライブラリ](./stdlib.md)。

**修正**：正しいメソッド名に直すか、その操作を `match` / `fold` など実装済みの手段で書き換える。未実装の仕様メソッドが必要なら、`packages/` に実装して `examples/` に動く例を足す。
