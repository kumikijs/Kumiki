# 01 — Counter

[English](./README.md) · 日本語

Kumiki の最小アプリ。これだけで「状態・更新・描画」の 1 サイクルが揃う。

## 学べること

- `slot` で状態を宣言する
- `reducer` で `on=`（イベント）→ `do=`（状態更新）を書く
- `tile` で UI を組み、`button` のクリックを reducer に結ぶ
- `app` ですべてを束ねる

## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/01-counter/app.kumiki
pnpm kumiki run packages/examples/apps/01-counter/app.kumiki packages/examples/apps/01-counter/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。

関連仕様: [language](../../../../docs/ja/spec/language.md)
