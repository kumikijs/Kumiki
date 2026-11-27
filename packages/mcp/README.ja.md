# @kumikijs/mcp

[English](./README.md) · 日本語

Kumiki コンパイラと AI 編集ツールチェインを **MCP（Model Context Protocol）サーバー**として公開する。エディタや AI エージェントから、Kumiki プログラムの検査・ビルド・ナビゲーション・編集・仕様参照を行える。

## ツール

| ツール | 用途 |
|---|---|
| `kumiki_check` | `source` または `path` をパース + 型検査し、診断を返す |
| `kumiki_build` | 自己完結 JS モジュールへコンパイル（runtime インライン） |
| `kumiki_smoke` | headless DOM に mount して UI を操作し、ランタイム例外・空描画・未処理 rejection を検出（check/build では捕まらない層） |
| `kumiki_run_scenario` | シナリオ（操作列 + 状態アサーション）でアプリを駆動し、毎ステップの slot 状態・DOM・エラー・emit を trace として返す。人を介さない生成→実行→観測→修正ループの土台 |
| `kumiki_list` | ファイル内の定義一覧（layer で絞り込み可） |
| `kumiki_view` | 定義 1 件の表示（`withDeps` で依存も） |
| `kumiki_refs` | 定義への参照箇所を検索 |
| `kumiki_add` / `kumiki_replace` / `kumiki_remove` / `kumiki_rename` | 定義の編集 |
| `kumiki_fix` | 修復可能な診断の自動パッチ案を提示 |
| `kumiki_guide` | `kumiki guide` が出力するもの：`author` / `debug` / `iterate` のワークフローガイド、診断の項目（`E0201`）、仕様文書 |
| `kumiki_spec_search` / `kumiki_spec_list` / `kumiki_spec_get` | 正規仕様（spec/）の検索・一覧・取得 |

## 起動

```sh
pnpm --filter @kumikijs/mcp start
```

MCP クライアント（例: Claude Code）の設定例:

```json
{
  "mcpServers": {
    "kumiki": {
      "command": "node",
      "args": ["--import", "tsx", "packages/mcp/src/server.ts"]
    }
  }
}
```

ガイドと仕様は `@kumikijs/cli` のビルドに同梱されたものなので、答えはインストールされたバージョンと一致します。別の仕様の写しを読ませるには、環境変数 `KUMIKI_SPEC_DIR` を設定します。
