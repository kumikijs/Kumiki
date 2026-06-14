# Feature Catalog

[English](./README.md) · 日本語

1 ファイル 1 機能の最小例。各ファイルはそれだけで完結した動く Kumiki アプリであり、CI でパース・型検査・ビルドが検証される。

## 言語コア

| 例 | 内容 |
|---|---|
| [01-slot-and-reducer](https://github.com/kage1020/Kumiki/blob/main/examples/features/01-slot-and-reducer.kumiki) | slot（状態）+ reducer（更新）+ tile（描画）の基本サイクル |
| [02-nominal-type](https://github.com/kage1020/Kumiki/blob/main/examples/features/02-nominal-type.kumiki) | nominal 型と `between` リファインメント |
| [03-union-and-match](https://github.com/kage1020/Kumiki/blob/main/examples/features/03-union-and-match.kumiki) | union 型と `match` 式 |
| [04-record-and-copy](https://github.com/kage1020/Kumiki/blob/main/examples/features/04-record-and-copy.kumiki) | レコード型と `.copy(field=value)` 不変更新 |
| [05-pure-fn](https://github.com/kage1020/Kumiki/blob/main/examples/features/05-pure-fn.kumiki) | 純粋関数 `fn`（slot を読まない） |
| [06-if-expression](https://github.com/kage1020/Kumiki/blob/main/examples/features/06-if-expression.kumiki) | 値としての `if ... then ... else` |

## コレクション・標準ライブラリ

| 例 | 内容 |
|---|---|
| [07-list](https://github.com/kage1020/Kumiki/blob/main/examples/features/07-list.kumiki) | `List` の `.map` / `.filter` / `for` |
| [08-map](https://github.com/kage1020/Kumiki/blob/main/examples/features/08-map.kumiki) | `Map` の insert / get-or / keys |
| [09-set](https://github.com/kage1020/Kumiki/blob/main/examples/features/09-set.kumiki) | `Set` の toggle / has |
| [10-option](https://github.com/kage1020/Kumiki/blob/main/examples/features/10-option.kumiki) | `Option` の Some / None |
| [11-time-and-duration](https://github.com/kage1020/Kumiki/blob/main/examples/features/11-time-and-duration.kumiki) | `Time` / `Duration` 演算 |
| [22-result](https://github.com/kage1020/Kumiki/blob/main/examples/features/22-result.kumiki) | `Result` の Ok / Err とパース |

## UI・スタイル

| 例 | 内容 |
|---|---|
| [12-layout](https://github.com/kage1020/Kumiki/blob/main/examples/features/12-layout.kumiki) | column / row / grid とレイアウト prop |
| [13-text-input-bind](https://github.com/kage1020/Kumiki/blob/main/examples/features/13-text-input-bind.kumiki) | 入力欄の双方向 `bind` |
| [14-select](https://github.com/kage1020/Kumiki/blob/main/examples/features/14-select.kumiki) | 型付き options の select |
| [15-checkbox](https://github.com/kage1020/Kumiki/blob/main/examples/features/15-checkbox.kumiki) | チェックボックスと disabled |
| [16-conditional-ui](https://github.com/kage1020/Kumiki/blob/main/examples/features/16-conditional-ui.kumiki) | `when(...)` による条件描画 |
| [17-theme](https://github.com/kage1020/Kumiki/blob/main/examples/features/17-theme.kumiki) | テーマトークンと動的テーマ切替 |

## アプリレベル

| 例 | 内容 |
|---|---|
| [18-routing](https://github.com/kage1020/Kumiki/blob/main/examples/features/18-routing.kumiki) | パスパラメータ・リダイレクト・404 |
| [19-effect-http](https://github.com/kage1020/Kumiki/blob/main/examples/features/19-effect-http.kumiki) | HTTP effect と `latest` ポリシー |
| [20-effect-storage](https://github.com/kage1020/Kumiki/blob/main/examples/features/20-effect-storage.kumiki) | localStorage 永続化（once / debounce） |
| [39-effect-session](https://github.com/kage1020/Kumiki/blob/main/examples/features/39-effect-session.kumiki) | sessionStorage 永続化（タブ単位・`storage-*` と同じ形） |
| [21-timer](https://github.com/kage1020/Kumiki/blob/main/examples/features/21-timer.kumiki) | `timer(1s)` による定期実行 |
| [23-lifecycle-route-enter](https://github.com/kage1020/Kumiki/blob/main/examples/features/23-lifecycle-route-enter.kumiki) | `app.start` / `route.enter` |

新しい質問・バグには、まずここへ最小再現例を足すことで答える。
