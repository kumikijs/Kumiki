# Kumiki Examples

[English](./README.md) · 日本語

このディレクトリは Kumiki の実例集である。運用方針として、質問・issue・バグ報告があるたびにここへ例を追加し、「リポジトリを見れば疑問が解決する」状態を維持する。

すべての例は CI でパース・型検査・ビルドが検証される（→ [packages/tests](../tests/)）。壊れた例はマージされない。

## 構成

### `features/` — 機能別ミニマル例

1 ファイル 1 機能。言語の各要素を、それだけに集中した最小のアプリで示す。「この構文どう書くんだっけ」に即答するためのカタログ。

[`features/README.ja.md`](./features/README.ja.md) はトピック別に選んだ案内である。ディレクトリにある全ファイルの一覧は [spec インデックス](../../docs/ja/spec/index.md)にあり、こちらはディスク上のファイルと完全に一致することを CI が保証する。

### `apps/` — 規模順の完成アプリ

小さいものから大きいものへ。実際のアプリで機能がどう組み合わさるかを示す。

<!-- apps:start -->

| アプリ | 行数 | 主に学べること |
|---|---|---|
| [01-counter](./apps/01-counter/) | 25 行 | slot / reducer / tile / イベント |
| [02-todomvc](./apps/02-todomvc/) | 168 行 | todo の `Map`・フィルタ・`bind` と `error(field=…)` を使うフォーム・localStorage 永続化 |
| [03-blog](./apps/03-blog/) | 423 行 | ルーティング・HTTP fetch・サスペンス |
| [04-issue-tracker](./apps/04-issue-tracker/) | 727 行 | CRUD・`Map`・`Option` バリアント・フォーム・日付 |
| [05-project-management](./apps/05-project-management/) | 1254 行 | 入れ子データ・カンバン・コメント・タグ・テーマ切替 |
| [06-expenses](./apps/06-expenses/) | 56 行 | `Map` + `fold` の集計・`Int.parse`・合計を変えないフィルタ |
| [07-http](./apps/07-http/) | 49 行 | `app.http`（base URL・slot から作るヘッダ・`on-401`・タイムアウト）と `retry=exponential(…)` |
| [08-ssr-hydration](./apps/08-ssr-hydration/) | 42 行 | SSR スナップショット・`volatile` slot・ハイドレーション後の操作 |

<!-- apps:end -->

## 実行方法

以下のコマンドはすべて**リポジトリルート**で実行する。

```sh
# 型検査
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki

# ビルド（index.html / app.js / runtime/ を出力 — アプリが使うランタイムモジュールのみ）
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out

# ヘッドレス DOM に mount して操作する
pnpm kumiki smoke packages/examples/apps/01-counter/app.kumiki

# アプリの受け入れ基準を再生する
pnpm kumiki run packages/examples/apps/01-counter/app.kumiki packages/examples/apps/01-counter/scenario.json
```

`check` と `build` が保証するのは構文・型・codegen までである。mount して操作に耐えるかを保証するのは `smoke` と `run` の役目で、詳しくは[検証階層](../../docs/ja/spec/testing.md)を見よ。
