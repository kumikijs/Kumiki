# 10 — SSR とハイドレーション

[English](./README.md) · 日本語

サーバレンダリングの境界。アプリは `app.init` が解決済みの状態でサーバ側に描画され、その後ブラウザでハイドレートしてそのまま動き続ける。

## 学べること

- `app.init` が発火した effect の結果が SSR スナップショットに載る
- `volatile` な slot は、そのスナップショットに意図的に載らない
- ハイドレーション後の操作と、そこで生まれるエピソードの連続性
- サーバが値を描画していない入力欄への `bind`
## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/10-ssr-hydration/app.kumiki
pnpm kumiki build packages/examples/apps/10-ssr-hydration/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/10-ssr-hydration/app.kumiki
pnpm kumiki run packages/examples/apps/10-ssr-hydration/app.kumiki packages/examples/apps/10-ssr-hydration/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。 `app.http.json` はその実行が応答に使う fixture である — ヘッドレスの階層はネットワークに出ない。

関連仕様: [runtime](../../../../docs/ja/spec/runtime.md) / [http](../../../../docs/ja/spec/http.md)
