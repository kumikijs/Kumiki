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

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/03-blog/app.kumiki
pnpm kumiki build packages/examples/apps/03-blog/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/03-blog/app.kumiki
pnpm kumiki run packages/examples/apps/03-blog/app.kumiki packages/examples/apps/03-blog/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。 `app.http.json` はその実行が応答に使う fixture である — ヘッドレスの階層はネットワークに出ない。

関連仕様: [routing](../../../../docs/ja/spec/routing.md) / [http](../../../../docs/ja/spec/http.md) / [lifecycle](../../../../docs/ja/spec/lifecycle.md)
