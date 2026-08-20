# 08 — HTTP リトライ

[English](./README.md) · 日本語

07 と同じ fetch にリトライ方針を付けたもの。`retry=exponential(3, 200ms, 2.0)` により、ランタイムは 5xx と接続エラーを指数バックオフで再試行し、4xx はそのまま最終的な失敗として扱う。

## 学べること

- HTTP effect への `retry=exponential(回数, 遅延, 倍率)` の宣言
- 再試行されるもの（5xx・接続エラー）と、されないもの（4xx）
- `retry` と `policy=latest` の組み合わせ
- すべての試行を経ても残った失敗を `.err` reducer で報告する
## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/08-http-retry/app.kumiki
pnpm kumiki build packages/examples/apps/08-http-retry/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/08-http-retry/app.kumiki
pnpm kumiki run packages/examples/apps/08-http-retry/app.kumiki packages/examples/apps/08-http-retry/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。 `app.http.json` はその実行が応答に使う fixture である — ヘッドレスの階層はネットワークに出ない。

関連仕様: [http](../../../../docs/ja/spec/http.md)
