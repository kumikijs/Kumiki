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

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/02-todomvc/app.kumiki ./out
```

関連仕様: [language](../../../spec/language.md) / [forms](../../../spec/forms.md) / [http](../../../spec/http.md)
