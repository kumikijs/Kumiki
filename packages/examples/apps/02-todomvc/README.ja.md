# 02 — TodoMVC

[English](./README.md) · 日本語

定番の TodoMVC。リスト操作と永続化が入り、実用アプリの骨格になる。

## 学べること

- `Map` のエントリの追加・削除・更新と `.filter`
- 入力欄の `bind` による双方向結合と、Add ボタンまたは Enter でのフォーム送信
- draft の refinement（`len-lt(280)`）に違反すると `error(field=draft)` が理由を表示し、フォームは送信を止める
- フィルタ状態（All / Active / Done）の切り替えと、`bg` / `color` による選択中タブの表示
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
