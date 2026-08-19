# 11 — 複数購読

[English](./README.md) · 日本語

1 つのイベントを 2 つの reducer が購読する。どちらも、ソース順に発火する — 1 回のクリックで両方の slot が進むのを見れば、この規則は読むより早く納得できる。

## 学べること

- 同じ `on=ui.click(...)` を宣言する 2 つの `reducer`
- どちらが先に書くかをソース順が決める
- 各 reducer が自分の slot だけを持ち、互いを知らずに済む
## 実行

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
pnpm kumiki check packages/examples/apps/11-multi-subscribe/app.kumiki
pnpm kumiki build packages/examples/apps/11-multi-subscribe/app.kumiki ./out
pnpm kumiki smoke packages/examples/apps/11-multi-subscribe/app.kumiki
pnpm kumiki run packages/examples/apps/11-multi-subscribe/app.kumiki packages/examples/apps/11-multi-subscribe/scenario.json
```

`scenario.json` はこのアプリの要件を実行可能な受け入れ基準（AC）に落としたもので、CI では [`packages/tests/`](../../../tests/) が再生する。

関連仕様: [language](../../../../docs/ja/spec/language.md)
