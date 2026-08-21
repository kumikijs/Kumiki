# Contributing to Kumiki

[English](./CONTRIBUTING.md) · 日本語

Kumiki は 1.0 未満の OSS で、運用方針がやや特殊です。読んでから手を動かしてください。

## 基本方針：質問・バグには example と test で答える

このリポジトリのゴールは「**見れば疑問が解決する**」ことです。そのため:

- **質問が来たら** → 該当する最小例を `packages/examples/features/` に足す（無ければ）。
- **バグ報告が来たら** → 最小再現例を `packages/examples/` に足し、`packages/tests/` に回帰テストを足してから直す。
- **新機能を入れたら** → `docs/spec/` を更新し、`packages/examples/` に動く例を足す。

仕様（`docs/spec/`）が正、実装（`packages/`）がそれに従う。食い違いを見つけたら、どちらを直すかを設計判断として PR の説明に残す。

## 開発フロー（TDD）

1. **設計** — 要件と方針を固める
2. **受け入れ基準（AC）** — テストケースを AC として書き出す（コードはまだ）
3. **テスト実装** — AC からテストコードを書く
4. **実装** — テストを通す production コードを書く
5. **反復** — 全テストが緑になるまで

実装からいきなり始めない。

## セットアップ

```sh
pnpm install
pnpm build
pnpm test
```

ツール: パッケージマネージャは **pnpm**、ビルドは **Turborepo** + **tsc/esbuild**、テストは **Vitest**、Lint/Format は **Biome**。

## 提出前チェック

```sh
pnpm exec turbo run typecheck test lint build
```

すべて緑であること。特に:

- **新しい example は必ず check + build + smoke が通る**（`packages/tests/` が自動検証する）。`check`/`build` は構文・型・codegen までしか保証しない。**実際に mount して操作して落ちないか**は `kumiki smoke <file>`（= `packages/tests/` の runtime smoke）で検証する。「コンパイルは通るが動かすとエラー/何も描画されない」バグはここで捕まえる。
- **example はネットワークに出ない。** http effect を emit する example は、隣に `<source>.http.json` を置く — `{"GET /api/quote": {"json": …}}`、retry のはしごのように応答を変えたい場合は最後の要素が繰り返される配列。エントリのないリクエストは報告されて実行を失敗させるので、fixture の欠落がアプリ自身の `.err` reducer に隠れることはない。
- **app example は必ず `scenario.json` を持つ**。`packages/tests/` がそれを実行する。コンパイルが通り `smoke` を生き延びることは、そのアプリが目的を果たすかについて何も言っていない。それを書き留める場所が scenario である。feature example も同様に `<name>.scenario.json` を追加できる。
- **テストファイルは型チェックされるプログラムの中に置く。** Vitest は型を検査せず剥がすだけなので、型チェックされていないファイルの assertion は落ちないまま何も主張しなくなる: `filter((d) => d.kind === "stale-closure-risk")` はそのメンバーが消えた時点で構造的に空になり、永遠に緑のままになる。テストを持つ workspace パッケージは、それらを include する config を指す `typecheck` script を宣言する。build の config の `rootDir` が `test/` を取り込めない場合は、隣に置く `tsconfig.typecheck.json` がそれ。`packages/tests/typecheck-coverage.test.ts` が workspace を pnpm で、テストファイルを git で列挙し、宣言していないパッケージがあれば落ちる。
- **lint の inline 抑制（`@biome-ignore` 等）は禁止**。足したくなったら設計を直す。
- **依存バージョンを直書きしない**。`pnpm add` で最新を入れ、共通バージョンは `pnpm-workspace.yaml` の catalog に置く。

## Git

- `main` / `dev` へ直接コミットしない。feature ブランチを切る。
- こまめにコミットする。

## ディレクトリ別の置き場所

| 変更内容 | 置き場所 |
|---|---|
| 言語/ランタイムの仕様 | `docs/spec/` |
| 使い方・チュートリアル | `docs/guide/` |
| 動く例 | `packages/examples/features/` または `packages/examples/apps/` |
| 実装 | `packages/*/src/` |
| テスト | パッケージ内 `test/`、横断は `packages/tests/` |
