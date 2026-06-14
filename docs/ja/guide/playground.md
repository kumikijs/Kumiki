# Playground

ブラウザ上で Kumiki を編集 → コンパイル → プレビューできる。コンパイラ（`@kumikijs/compiler`）とランタイム（`@kumikijs/runtime`）はブラウザ内で動く。左で編集すると右に結果が出る。`例を選ぶ…` から [機能別カタログ](https://github.com/kage1020/Kumiki/tree/main/packages/examples/features)の各例を読み込める。

<Playground />

## WebMCP

このページは [WebMCP](https://github.com/webmachinelearning/webmcp) 対応ブラウザ/エージェント向けに、`navigator.modelContext.registerTool` でツールを公開する（対応環境でのみ有効）。

| ツール | 用途 |
|---|---|
| `kumiki_compile` | 渡した Kumiki ソースをコンパイルし、成否と診断を返す（read-only） |
| `kumiki_list_examples` | playground の機能別例の一覧を返す（read-only） |
| `kumiki_load_example` | 名前を指定して例をエディタに読み込む |
| `kumiki_set_source` | エディタのソースを差し替えてプレビューする |

ローカル CLI / エディタ統合用には、stdio で動く [`@kumikijs/mcp`](https://github.com/kage1020/Kumiki/tree/main/packages/mcp) サーバーもある。
