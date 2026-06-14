# Kumiki Examples

[English](./README.md) · 日本語

このディレクトリは Kumiki の実例集である。運用方針として、質問・issue・バグ報告があるたびにここへ例を追加し、「リポジトリを見れば疑問が解決する」状態を維持する。

すべての例は CI でパース・型検査・ビルドが検証される（→ [Tests](https://github.com/kage1020/Kumiki/tree/main/tests)）。壊れた例はマージされない。

## 構成

### `features/` — 機能別ミニマル例

1 ファイル 1 機能。言語の各要素を、それだけに集中した最小のアプリで示す。「この構文どう書くんだっけ」に即答するためのカタログ。

### `apps/` — 規模順の完成アプリ

小さいものから大きいものへ。実際のアプリで機能がどう組み合わさるかを示す。

| アプリ | 規模 | 主に学べること |
|---|---|---|
| [01-counter](./apps/01-counter/) | ~22 行 | slot / reducer / tile / イベント |
| [02-todomvc](./apps/02-todomvc/) | ~161 行 | リスト・フィルタ・`bind`・localStorage 永続化 |
| [03-blog](./apps/03-blog/) | ~418 行 | ルーティング・HTTP fetch・サスペンス |
| [04-issue-tracker](./apps/04-issue-tracker/) | ~726 行 | CRUD・`Map`・`Option` バリアント・フォーム・日付 |
| [05-project-management](./apps/05-project-management/) | ~1255 行 | 入れ子データ・カンバン・コメント・タグ・テーマ切替 |

## 実行方法

```sh
# 型検査
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts check examples/apps/01-counter/app.kumiki

# ビルド（index.html / app.js / runtime/ を出力 — アプリが使うランタイムモジュールのみ）
pnpm --filter @kumikijs/cli exec tsx src/kumiki.ts build examples/apps/01-counter/app.kumiki ./out
```
