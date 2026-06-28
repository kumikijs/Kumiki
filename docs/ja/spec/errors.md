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
| `E07xx` | アクセシビリティ（a11y）／strict-icons |
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

### E0113 `sub-routes-without-outlet`

`sub-routes` を宣言した tile の body に `route-outlet` 呼び出しが存在しない。コンパイルは通るが、マッチした子ルートをどこにも描画できないので「ビルドは成功するが何も起きない」という Kumiki が一番嫌う失敗モードになる。

> `Tile "<name>" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render`

**修正**：子を表示したい場所に `route-outlet()` を 1 つ置く。要らないなら `sub-routes` を外す。

## E02xx — 型

### E0201 `type-mismatch`

イベントハンドラの引数 / prop が reducer 名でなければならないのに、別種の値だった。

> `Event handler arg "<name>" must be a reducer name`
> `Event handler prop "<name>" must be a reducer name`

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

## E07xx — アクセシビリティ（a11y）／strict-icons

既定では警告として扱われ、明示的な `strict*` オプトインで初めてエラーに昇格する検査の帯。対応するフラグが立っていない限り `check()` がこれらのコードを出力から除去する。

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

## E08xx — ランタイムハザード

型は通るが実行時に壊れる「書き方」を、`check` の段階で静的に捕まえるための帯。検証の3層モデルは [3 層検証モデル](./testing.md#_8-10-the-three-layers-of-tooling-verification) を参照。

### E0801 `unimplemented-method`

`obj.method(...)` 形式のメソッド呼び出しが、ランタイム／コード生成の実装するメソッド集合に存在しない。綴り間違い（`.fitler`）や、仕様には載っていても未実装のメソッド、別の型のメソッドの誤用（`Option` に `.to-result` など）で起こる。

> `Method ".<name>" is not implemented by the runtime`

**補足**：実装されているメソッド集合は `@kumikijs/compiler` の `KNOWN_METHODS`（コード生成の `methodCallJs` と同期）が唯一の正。引数なしメソッドを `()` 付きで呼んだ場合もこの帯で捕捉される。標準ライブラリのメソッド一覧は [標準ライブラリ](./stdlib.md)。

**修正**：正しいメソッド名に直すか、その操作を `match` / `fold` など実装済みの手段で書き換える。未実装の仕様メソッドが必要なら、`packages/` に実装して `examples/` に動く例を足す。
