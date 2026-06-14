# 06 — Expense Tracker

[English](./README.md) · 日本語

支出を追加・削除し、合計と「大きい支出のみ」フィルタを持つ小さなアプリ。`Map` + `fold` による集計と数値パースを扱う。

このアプリは **autonomous iterate ループのデモ**として作られ、その過程で 2 つのフレームワークバグを検出・修正した:

- `List.fold` の codegen 未実装（`_d_1 is not defined`）— smoke 層で検出。
- `Int.parse` が数値変換せず文字列を返していた（合計が文字列連結で壊れる、非例外バグ）— scenario 層の状態/DOM アサーションで検出。

## 学べること

- `Map(Id, V)` の CRUD と `.values.fold(0, $1 + $2.amount)` による合計
- `Int.parse(text).get-or(0)` による入力のパース
- フィルタトグルと、フィルタに影響されない合計
- 追加後の入力欄クリア

## 検証

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts smoke examples/apps/06-expenses/app.kumiki
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts run   examples/apps/06-expenses/app.kumiki examples/apps/06-expenses/scenario.json
```

`scenario.json` は要件を実行可能な受け入れ基準（AC）に落としたもの。`tests/` が CI で実行する。
