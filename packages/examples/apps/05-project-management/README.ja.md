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

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/05-project-management/app.kumiki ./out
```

関連仕様: [language](../../../spec/language.md) / [stdlib](../../../spec/stdlib.md) / [style](../../../spec/style.md) / [errors](../../../spec/errors.md)
