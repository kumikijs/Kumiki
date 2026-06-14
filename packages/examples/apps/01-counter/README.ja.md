# 01 — Counter

[English](./README.md) · 日本語

Kumiki の最小アプリ。これだけで「状態・更新・描画」の 1 サイクルが揃う。

## 学べること

- `slot` で状態を宣言する
- `reducer` で `on=`（イベント）→ `do=`（状態更新）を書く
- `tile` で UI を組み、`button` のクリックを reducer に結ぶ
- `app` ですべてを束ねる

## 実行

```sh
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/01-counter/app.kumiki ./out
```

関連仕様: [language](../../../spec/language.md)
