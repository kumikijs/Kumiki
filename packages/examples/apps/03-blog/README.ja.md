# 03 — Blog SPA

[English](./README.md) · 日本語

ルーティングと非同期データ取得が入った SPA。一覧 → 詳細の遷移と読み込み状態を扱う。

## 学べること

- `app.routes` によるパスマッチとパラメータ（`/posts/:id`）
- `route.enter` での fetch トリガと `/404` フォールバック
- HTTP `effect` と `latest` 系ポリシー
- 読み込み中・エラーの境界（サスペンス）
- `link` によるクライアントサイド遷移

## 実行

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/03-blog/app.kumiki ./out
```

関連仕様: [routing](../../../spec/routing.md) / [http](../../../spec/http.md) / [lifecycle](../../../spec/lifecycle.md)
