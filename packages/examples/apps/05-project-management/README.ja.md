# 05 — Project Management

[English](./README.md) · 日本語

最大規模のリファレンスアプリ（~1255 行）。入れ子データ・カンバン・テーマ切替まで、実アプリで必要になる要素を一通り含む。

## 学べること

- プロジェクト / タスク / コメントの入れ子データモデル（`Map` の多段構成）
- カンバンボードとステータス遷移（`nextStatus`）
- 親子タスク（`parentTaskId: Option<TaskId>`）と削除時のカスケード
- タグ・コメントの追加と除去
- パス形状粒度の 1-write 規則に沿った reducer（`tasks[id].status` と `tasks[id].updatedAt` は共存可）
- 動的テーマ切替（`app.theme = slotName`）

## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/05-project-management/app.kumiki
pnpm kumiki build packages/examples/apps/05-project-management/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/05-project-management/app.kumiki
pnpm kumiki run packages/examples/apps/05-project-management/app.kumiki packages/examples/apps/05-project-management/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。

関連仕様: [language](../../../../docs/ja/spec/language.md) / [stdlib](../../../../docs/ja/spec/stdlib.md) / [style](../../../../docs/ja/spec/style.md) / [errors](../../../../docs/ja/spec/errors.md)
