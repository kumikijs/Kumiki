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

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/04-issue-tracker/app.kumiki
pnpm kumiki build packages/examples/apps/04-issue-tracker/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/04-issue-tracker/app.kumiki
pnpm kumiki run packages/examples/apps/04-issue-tracker/app.kumiki packages/examples/apps/04-issue-tracker/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。

関連仕様: [language](../../../../docs/ja/spec/language.md) / [stdlib](../../../../docs/ja/spec/stdlib.md) / [forms](../../../../docs/ja/spec/forms.md)
