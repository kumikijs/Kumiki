# 02 — TodoMVC

[English](./README.md) · 日本語

定番の TodoMVC。リスト操作と永続化が入り、実用アプリの骨格になる。

## 学べること

- `List` の追加・削除・更新と `.filter` / `.map`
- 入力欄の `bind` による双方向結合
- フィルタ状態（All / Active / Done）の切り替え
- `effect` + localStorage による永続化（`saveTodos` の debounce）
- ライフサイクル `app.start` での復元

## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/02-todomvc/app.kumiki
pnpm kumiki build packages/examples/apps/02-todomvc/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/02-todomvc/app.kumiki
pnpm kumiki run packages/examples/apps/02-todomvc/app.kumiki packages/examples/apps/02-todomvc/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。

関連仕様: [language](../../../../docs/ja/spec/language.md) / [forms](../../../../docs/ja/spec/forms.md) / [http](../../../../docs/ja/spec/http.md)
