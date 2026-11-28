# 07 — HTTP

[English](./README.md) · 日本語

アプリ全体で 1 つの HTTP 設定と、それを使う effect のリトライ方針です。`app.http` が base URL・slot から組み立てるヘッダ・401 を受ける reducer・タイムアウト・credentials を持つので、effect はパスだけを書けば済みます。`retry=exponential(3, 200ms, 2.0)` により、ランタイムは 5xx と接続エラーを指数バックオフで再試行し、4xx はそのまま最終的な失敗として扱います。

## 学べること

- `base-url` を一度だけ設定し、各 effect の `map-request` はパスだけを書く
- slot から組み立てるヘッダ（`X-Session`）が状態に追従する。サインインすると次のリクエストから新しい値が載る
- `on-401` で認証失敗のレスポンスを `on=app.http-401` の reducer に流す
- `timeout` と `credentials` をアプリレベルで宣言する
- `retry=exponential(回数, 遅延, 倍率)` で再試行されるもの（5xx・接続エラー）とされないもの（4xx）、`policy=latest` との組み合わせ
- `match` による読み込み状態の描画（spinner・card・エラー文言）

## 実行

以下のコマンドはすべて**リポジトリルート**で実行します。

```sh
pnpm kumiki check packages/examples/apps/07-http/app.kumiki
pnpm kumiki build packages/examples/apps/07-http/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/07-http/app.kumiki
pnpm kumiki run packages/examples/apps/07-http/app.kumiki packages/examples/apps/07-http/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生します。`app.http.json` はショーケースが応答に使う fixture です。503 を 2 回返してから名言を返すので、最初の読み込みで再試行の様子が見えます。

関連仕様: [http](../../../../docs/ja/spec/http.md)
