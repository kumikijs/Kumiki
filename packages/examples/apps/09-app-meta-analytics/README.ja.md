# 09 — アプリの meta と analytics

[English](./README.md) · 日本語

それ自体のコードを必要としない 2 つのアプリレベルのブロック。`app.meta` はページの head メタデータをアプリの管理下に置き、`app.analytics` は `analytics.send` capability に既定のシンクを与えるので、ホスト側の SDK を繋がなくても計測イベントの行き先が決まる。

## 学べること

- `app.meta` — title・description・og-image・favicon が mount 時に反映される
- `app.analytics` — `analytics.send` の既定シンクとなる provider と app-id
- reducer から slot 書き込みと並べて `analytics.send` の effect を発火する
- effect が必要とする capability を `caps` に宣言する
## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/09-app-meta-analytics/app.kumiki
pnpm kumiki build packages/examples/apps/09-app-meta-analytics/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/09-app-meta-analytics/app.kumiki
pnpm kumiki run packages/examples/apps/09-app-meta-analytics/app.kumiki packages/examples/apps/09-app-meta-analytics/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。

関連仕様: [runtime](../../../../docs/ja/spec/runtime.md)
