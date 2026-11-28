# 08 — SSR とハイドレーション

[English](./README.md) · 日本語

サーバレンダリングの境界を扱います。アプリは `app.init` が解決した状態でサーバ側に描画され、その後ブラウザでハイドレートしてそのまま動き続けます。ショーケースのプレビューはブラウザ内でクライアントとしてマウントするため、サーバでの描画そのものは見えません。SSR の経路は `renderToString` と `hydrate` を使う `packages/tests` のテストが検証しています。

## 学べること

- `app.init` が発火した effect の結果が SSR スナップショットに載る
- `volatile` な slot は、そのスナップショットに意図的に載らない
- ハイドレーション後の操作と、そこで生まれるエピソードの連続性
- サーバが値を描画していない入力欄への `bind`

## 実行

以下のコマンドはすべて**リポジトリルート**で実行します。

```sh
pnpm kumiki check packages/examples/apps/08-ssr-hydration/app.kumiki
pnpm kumiki build packages/examples/apps/08-ssr-hydration/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/08-ssr-hydration/app.kumiki
pnpm kumiki run packages/examples/apps/08-ssr-hydration/app.kumiki packages/examples/apps/08-ssr-hydration/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生します。 `app.http.json` はその実行が応答に使う fixture で、ヘッドレスの階層はネットワークに出ません。

関連仕様: [runtime](../../../../docs/ja/spec/runtime.md) / [http](../../../../docs/ja/spec/http.md)
