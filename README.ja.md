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

## なぜ Kumiki か

クロスベンダー実測（Claude / Codex / Gemini）では、仕様書だけ・単一パスで、LLM は中規模の Kumiki アプリ（最大 〜600 行のマルチルートなイシュートラッカー）を build が通る形で書ける。〜1000 行規模になると編集ループが必要になる。React 比のトークン効率も高く、同等アプリはトークン・行数とも概ね 1.4〜2.0 倍コンパクト。詳細は [packages/benchmarks](./packages/benchmarks/)。

## リポジトリ構成

| ディレクトリ | 役割 |
|---|---|
| [`docs/`](./docs/) | ドキュメントサイト（VitePress）。`spec/`（**正規仕様**）・`guide/`（チュートリアル）。日本語ページは `ja/` 配下。 |
| [`packages/`](./packages/) | 公開パッケージと、examples・結合テスト・ベンチマーク（[パッケージ](#パッケージ)を参照） |

## クイックスタート

`.kumiki` ファイルを 1 つ書いたら:

```sh
npm i -g kumiki
kumiki dev app.kumiki        # ホットリロード付きで配信
kumiki check app.kumiki      # 型検査して診断を出す
kumiki build app.kumiki ./out
```

最初の 1 ファイルを書くところは [はじめに](./docs/guide/getting-started.md)、1 レイヤずつ組み立てるのは [最初のアプリ](./docs/guide/your-first-app.md) にある。

Kumiki 自体を開発する場合は、クローンして:

```sh
pnpm install
pnpm build          # 全パッケージをビルド
pnpm test           # 全テスト
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
```

## パッケージ

公開パッケージはすべて同じバージョンでリリースされる。

| パッケージ | 内容 |
|---|---|
| [`kumiki`](./packages/kumiki/) | `kumiki` コマンド。インストールするのはこれ |
| [`@kumikijs/cli`](./packages/cli/) | その中身のコマンド群: build / dev / check / smoke / test / run / replay と AI 編集用の verb（list / view / refs / add / replace / remove / rename / edit / patch / lock / unlock / fix） |
| [`@kumikijs/compiler`](./packages/compiler/) | lexer, parser, typechecker, codegen |
| [`@kumikijs/runtime`](./packages/runtime/) | DOM ランタイム（signal graph, mount, effect dispatch, SSR, smoke と scenario の実行） |
| [`@kumikijs/vite`](./packages/vite/) | Vite プラグイン。任意の Vite プロジェクトで `import App from "./app.kumiki"` |
| [`@kumikijs/mcp`](./packages/mcp/) | コンパイラ・AI 編集・仕様検索をツールとして公開する MCP サーバー |
| [`@kumikijs/syntax`](./packages/syntax/) | Shiki / VitePress / VS Code 向け TextMate 文法 |
| [`@kumikijs/icons`](./packages/icons/) | 組み込みアイコンセット。CLI と Vite プラグインが同梱する |

非公開: [`examples`](./packages/examples/)（動くプログラム。全パッケージのテストが使うフィクスチャ）、[`tests`](./packages/tests/)（compiler・runtime・CLI をまたぐ結合テスト）、[`e2e`](./packages/e2e/)（実ブラウザ層）、[`benchmarks`](./packages/benchmarks/)。

## 運用モデル

このリポジトリは「**見ればすべての疑問が解決する**」状態を目指す。質問・issue・バグ報告には、原則として **examples と tests を足すことで答える**。すべての例は CI でコンパイル・マウントされ、scenario で操作される（[packages/tests/](./packages/tests/)）。詳しくは [CONTRIBUTING.md](./CONTRIBUTING.md)。

## ライセンス

[Apache-2.0](./LICENSE)。著作権表示は [NOTICE](./NOTICE) を参照。
