# 04 — Issue Tracker

[English](./README.md) · 日本語

CRUD を中心とした中規模アプリ（~726 行）。`Map` 主体のデータモデルと `Option` バリアントの分岐が学べる。

## 学べること

- `Map` をストアとした作成・更新・削除（`.copy(field=value)` による不変更新）
- `Option` / ユーザー定義バリアントの `match` 分岐（`Some(Backlog)` 等の入れ子ペイロード）
- フォーム入力とフォーカス保持
- `select` / プルダウンによるステータス・優先度変更
- 期日（`Time`）の設定と表示
- タグの付与・除去

## 実行

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/04-issue-tracker/app.kumiki ./out
```

関連仕様: [language](../../../spec/language.md) / [stdlib](../../../spec/stdlib.md) / [forms](../../../spec/forms.md)
