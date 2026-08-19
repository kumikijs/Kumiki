# 07 — アプリレベルの HTTP

[English](./README.md) · 日本語

アプリ全体で 1 つの HTTP 設定。`app.http` が base URL・全リクエスト共通のヘッダ・タイムアウト・認証失敗時に呼ぶ reducer を持つので、個々の effect がそれらを繰り返さずに済む。

## 学べること

- `base-url` を一度だけ設定し、各 effect の `map-request` はパスだけを書く
- slot から組み立てるヘッダ（`X-Session`）が状態に追従する
- `on-401` で認証失敗のレスポンスを reducer に流す
- `timeout` と `credentials` をアプリレベルで宣言する
- `match` による `Result` の描画 — spinner・card・エラー文言
## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/07-app-http/app.kumiki
pnpm kumiki build packages/examples/apps/07-app-http/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/07-app-http/app.kumiki
pnpm kumiki run packages/examples/apps/07-app-http/app.kumiki packages/examples/apps/07-app-http/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。 `app.http.json` はその実行が応答に使う fixture である — ヘッドレスの階層はネットワークに出ない。

関連仕様: [http](../../../../docs/ja/spec/http.md)
