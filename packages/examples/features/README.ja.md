# Feature Catalog

[English](./README.md) · 日本語

1 ファイル 1 機能の最小例。各ファイルはそれだけで完結した動く Kumiki アプリであり、CI でパース・型検査・ビルドが検証される。

以下の表はトピック別に選んだ案内であり、ディレクトリの一覧ではない。ここにある全ファイルの一覧は [spec インデックス](../../../docs/ja/spec/index.md)の examples 表にあり、こちらはディスク上のファイルと完全に一致することを CI が保証する。

## 言語コア

| 例 | 内容 |
|---|---|
| [01-slot-and-reducer](./01-slot-and-reducer.kumiki) | slot（状態）+ reducer（更新）+ tile（描画）の基本サイクル |
| [02-nominal-type](./02-nominal-type.kumiki) | nominal 型と `between` リファインメント |
| [03-union-and-match](./03-union-and-match.kumiki) | union 型と `match` 式 |
| [04-record-and-copy](./04-record-and-copy.kumiki) | レコード型と `.copy(field=value)` 不変更新 |
| [05-pure-fn](./05-pure-fn.kumiki) | 純粋関数 `fn`（slot を読まない） |
| [06-if-expression](./06-if-expression.kumiki) | 値としての `if ... then ... else` |

## コレクション・標準ライブラリ

| 例 | 内容 |
|---|---|
| [07-list](./07-list.kumiki) | `List` の `.map` / `.filter` / `for` |
| [08-map](./08-map.kumiki) | `Map` の insert / get-or / keys |
| [09-set](./09-set.kumiki) | `Set` の toggle / has |
| [10-option](./10-option.kumiki) | `Option` の Some / None |
| [11-time-and-duration](./11-time-and-duration.kumiki) | `Time` / `Duration` 演算 |
| [22-result](./22-result.kumiki) | `Result` の Ok / Err とパース |

## UI・スタイル

| 例 | 内容 |
|---|---|
| [12-layout](./12-layout.kumiki) | column / row / grid とレイアウト prop |
| [13-text-input-bind](./13-text-input-bind.kumiki) | 入力欄の双方向 `bind` |
| [14-select](./14-select.kumiki) | 型付き options の select |
| [15-checkbox](./15-checkbox.kumiki) | チェックボックスと disabled |
| [16-conditional-ui](./16-conditional-ui.kumiki) | `when(...)` による条件描画 |
| [17-theme](./17-theme.kumiki) | テーマトークンと動的テーマ切替 |
| [74-common-tile-props](./74-common-tile-props.kumiki) | すべての tile が受ける props（`class` / `aria` / `test-id` / `role`）、サイズの略記、読み込み中は無効化されるボタン |

## アプリレベル

| 例 | 内容 |
|---|---|
| [18-routing](./18-routing.kumiki) | パスパラメータ・リダイレクト・404 |
| [19-effect-http](./19-effect-http.kumiki) | HTTP effect と `latest` ポリシー |
| [20-effect-storage](./20-effect-storage.kumiki) | localStorage 永続化（once / debounce） |
| [39-effect-session](./39-effect-session.kumiki) | sessionStorage 永続化（タブ単位・`storage-*` と同じ形） |
| [21-timer](./21-timer.kumiki) | `timer(1s)` による定期実行 |
| [23-lifecycle-route-enter](./23-lifecycle-route-enter.kumiki) | `app.start` / `route.enter` |
| [46-stdlib-paren-methods](./46-stdlib-paren-methods.kumiki) | stdlib メソッドの括弧付き形（`is-ok()` / `values()` / `lower()` / `sort()` 等）と `Bytes.from-text/base64/bytes` 構築子 |
| [61-reserved-identifier-names](./61-reserved-identifier-names.kumiki) | JS の予約語（`new` / `class` / `var`）やランタイム内部名（`_live` / `_s`）と衝突する識別子 |
| [62-conditional-inline-tile-handlers](./62-conditional-inline-tile-handlers.kumiki) | ハンドラだけが異なる 2 つのインラインタイルを条件分岐で入れ替える |
| [76-conditional-adds-a-universal-handler](./76-conditional-adds-a-universal-handler.kumiki) | 後から分岐が `onFocus` / `onBlur` を*足す*ケース（renderer ではなく runtime が持ち上げる 4 種） |
| [86-container-selector-through-reference](./86-container-selector-through-reference.kumiki) | 本体が tile 参照のコンテナに対する `ui.key` / `ui.focus` / `ui.blur` / `ui.hover`（同じ木のインライン形と並記） |
| [63-reducer-batch-atomicity](./63-reducer-batch-atomicity.kumiki) | refinement が reducer のバッチを丸ごと拒否する挙動と、代わりに書くべきガード |
| [64-init-slot-argument](./64-init-slot-argument.kumiki) | slot 参照を引数にして `app.init` から effect を発火する |
| [65-prefers-dark](./65-prefers-dark.kumiki) | `prefers-dark()` で OS のカラースキームに追従する |
| [66-value-types](./66-value-types.kumiki) | 値レベルの型検査が受理する形と、それぞれが以前隠していた誤り |

新しい質問・バグには、まずここへ最小再現例を足すことで答える。
