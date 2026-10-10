# Contributing to Kumiki

[English](./CONTRIBUTING.md) · 日本語

## 基本方針：質問・バグには example と test で答える

このリポジトリのゴールは「**見れば疑問が解決する**」ことです。そのため:

- **質問が来たら** → 該当する最小例を `packages/examples/features/` に足す（無ければ）。
- **バグ報告が来たら** → 挙動を固定する scenario 付きの最小再現例を `packages/examples/` に足し、バグを持つパッケージ（`packages/<pkg>/test/`。複数パッケージを組み合わせる必要があるときだけ `packages/tests/`）に回帰テストを足してから直す。
- **新機能を入れたら** → `docs/spec/` を更新し、`packages/examples/` に動く例を足す。

仕様（`docs/spec/`）が正、実装（`packages/`）がそれに従う。食い違いを見つけたら、どちらを直すかを設計判断として PR の説明に残す。

## セットアップ

```sh
pnpm install
pnpm build
pnpm test
```

ツール: パッケージマネージャは **pnpm**、ビルドは **Turborepo** + **tsdown/tsc**、テストは **Vitest**、Lint/Format は **Biome**。

## 提出前チェック

```sh
pnpm exec turbo run typecheck test build && pnpm lint
```

すべて緑であること。特に:

- **新しい example は必ず check + build + smoke が通る**（`packages/tests/` が自動検証する）。`check`/`build` は構文・型・codegen までしか保証しない。**実際に mount して操作して落ちないか**は `kumiki smoke <file>` で検証し、`packages/tests/` が全 example に対してこれを実行する。「コンパイルは通るが動かすとエラー/何も描画されない」バグはここで捕まえる。
- **example はネットワークに出ない。** http effect を emit する example は、隣に `<source>.http.json` を置く — `{"GET /api/quote": {"json": …}}`、retry のはしごのように応答を変えたい場合は最後の要素が繰り返される配列。エントリのないリクエストは報告されて実行を失敗させるので、fixture の欠落がアプリ自身の `.err` reducer に隠れることはない。
- **app example は必ず `scenario.json` を持つ**。`packages/tests/` がそれを実行する。コンパイルが通り `smoke` を生き延びることは、そのアプリが目的を果たすかについて何も言っていない。それを書き留める場所が scenario である。feature example も同様に `<name>.scenario.json` を追加できる。
- **テストファイルは型チェックされるプログラムの中に置く。** Vitest は型を検査せず剥がすだけなので、型チェックされていないファイルの assertion は落ちないまま何も主張しなくなる。テストを持つ workspace パッケージは、それらを include する config を指す `typecheck` script を宣言する。
- **テストは振る舞いを検証する。** ソースやドキュメントを読んで grep するテストは Linter の偽装であり、捕まえるものより維持コストのほうが大きい。その不変条件は型・ランタイムチェック・lint ルールで表す。フィクスチャは相対パスでなく `@kumikijs/examples`（`feature(name)`, `app(name)`）から取る。
- **陳腐化する参照を書かない。** コード・コメント・テスト名・example に仕様の節番号や issue / PR 番号を書かない。参照が必要なら仕様のファイル名を書く。
- **lint の inline 抑制（`@biome-ignore` 等）は禁止**。足したくなったら設計を直す。
- **依存バージョンを直書きしない**。`pnpm add` で最新を入れ、共通バージョンは `pnpm-workspace.yaml` の catalog に置く。

## Git

- `main` / `dev` へ直接コミットしない。feature ブランチを切る。
- こまめにコミットする。

### ブランチとリリースの流れ

`dev` が統合ブランチ、`main` はリリース専用。機能 PR は `dev` に向けるので、changeset はリリースを起こさずに `dev` に溜まる。リリースするときは `dev` → `main` を 1 つの PR でマージする。すると `release` ワークフローがまとめて 1 つの "Version Packages" PR を開き、それをマージすると npm に公開される。

- 機能・修正 → `dev` への PR。
- リリース → `dev` → `main` の PR を出し、自動生成された "Version Packages" PR をマージする。

## ディレクトリ別の置き場所

| 変更内容 | 置き場所 |
|---|---|
| 言語/ランタイムの仕様 | `docs/spec/` |
| 使い方・チュートリアル | `docs/guide/` |
| 動く例 | `packages/examples/features/` または `packages/examples/apps/` |
| 実装 | `packages/*/src/` |
| テスト | パッケージ内 `test/`。複数パッケージを組み合わせるものは `packages/tests/src/` |

## Changesets

公開パッケージの利用者から観測できる変更には changeset を足す（`pnpm changeset`）。公開パッケージはすべて同じバージョンで一緒にリリースされるので、bump はリリース全体として選ぶ。1.0 までは挙動を壊す・変えるものは `minor`、それ以外は `patch`。

changeset の最初の段落が各パッケージの `CHANGELOG.md` の 1 行になる。そこには利用者向けの 1 文を書く。動機・調査・エッジケースは PR の説明に書き、changelog からはコミット経由でリンクされる。
