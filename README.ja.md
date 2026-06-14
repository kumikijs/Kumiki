# Kumiki

[English](./README.md) · 日本語

**AI の、AI による、AI のための Web フレームワーク。** 定義同士は組木（_kumiki_）のように噛み合う——釘も糊も、隠れた状態もない——から、AI が並列にアプリを書き・直し・組み替えても壊れない。

```kumiki
slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+1", onClick=inc)
tile App    = column(heading("Count: " + count.show), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Kumiki は JSX・Hooks・依存配列・Provider といった「人間の認知に最適化された」装置を持たない。代わりに **7 レイヤ**（type / slot / effect / reducer / tile / fn / app）の独立した定義の集合としてアプリを表す。構文オーバーヘッドが小さく、定義同士の依存が明示的で、AI が安全に部分編集できる。

> 言語・ランタイム・ツールは 1.0 未満で、マイナーバージョン間で破壊的変更が入りうる。依存させる場合はバージョンを固定すること。

## なぜ Kumiki か

クロスベンダー実測（Claude / Codex / Gemini）では、仕様書だけ・単一パスで、LLM は中規模の Kumiki アプリ（最大 〜600 行のマルチルートなイシュートラッカー）を typecheck・build が通る形で書ける。〜1000 行規模になると編集ループが必要になる。React 比のトークン効率も高く、同等アプリはトークン・行数とも概ね 1.4〜2.0 倍コンパクト。詳細は [packages/benchmarks](./packages/benchmarks/)。

## リポジトリ構成

| ディレクトリ | 役割 |
|---|---|
| [`docs/`](./docs/) | ドキュメントサイト（VitePress）。`spec/`（**正規仕様**）・`guide/`（チュートリアル）。日本語ページは `ja/` 配下。 |
| [`packages/`](./packages/) | 実装と関連コード。`compiler` / `runtime` / `cli` / `mcp` / `syntax` に加え `examples` / `tests` / `benchmarks` |

## クイックスタート

```sh
pnpm install
pnpm build          # 全パッケージをビルド
pnpm test           # 全テスト

# Kumiki プログラムを検査・ビルド（リポジトリルートで実行）
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out
```

はじめての人は [docs/guide/getting-started.md](./docs/guide/getting-started.md) → [docs/guide/your-first-app.md](./docs/guide/your-first-app.md) へ。

## パッケージ

| パッケージ | 内容 |
|---|---|
| [`@kumikijs/compiler`](./packages/compiler/) | lexer・parser・typechecker・codegen |
| [`@kumikijs/runtime`](./packages/runtime/) | DOM ランタイム（signal graph・mount・dispatch） |
| [`@kumikijs/cli`](./packages/cli/) | `kumiki` コマンド（build / check / list / view / add / replace / remove / rename / fix） |
| [`@kumikijs/mcp`](./packages/mcp/) | MCP サーバー。コンパイラと AI 編集・仕様検索を MCP ツールとして公開 |

## 運用モデル

このリポジトリは「**見ればすべての疑問が解決する**」状態を目指す。質問・issue・バグ報告には、原則として **examples と tests を足すことで答える**。壊れた例は CI で弾かれる（[tests/](./tests/)）。詳しくは [CONTRIBUTING.md](./CONTRIBUTING.md)。

## ライセンス

[Apache-2.0](./LICENSE)。著作権表示は [NOTICE](./NOTICE) を参照。
