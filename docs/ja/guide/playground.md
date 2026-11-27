# Playground

ブラウザ上で Kumiki を編集・コンパイル・プレビューできます。コンパイラ（`@kumikijs/compiler`）とランタイム（`@kumikijs/runtime`）はブラウザ内で動き、左で編集すると右に結果が出ます。`例を選ぶ…` から [機能別カタログ](https://github.com/kumikijs/Kumiki/tree/main/packages/examples/features) の各例を読み込めます。

<Playground />

## WebMCP

このページは [WebMCP](https://github.com/webmachinelearning/webmcp) 対応のブラウザやエージェント向けに、`navigator.modelContext.registerTool` でツールを公開しています（対応環境でのみ有効です）。

| ツール | 用途 |
|---|---|
| `kumiki_compile` | 渡した Kumiki ソースをコンパイルし、成否と診断を返す（read-only） |
| `kumiki_list_examples` | playground の機能別例の一覧を返す（read-only） |
| `kumiki_load_example` | 名前を指定して例をエディタに読み込む |
| `kumiki_set_source` | エディタのソースを差し替えてプレビューする |

各診断は `{code, kind, message, line, col, severity}` の形で、`@kumikijs/mcp` サーバーが返すものと同じです。診断が警告だけのプログラムはコンパイルが通ります。playground はそれをプレビューして警告を並べ、`kumiki_compile` は `ok: true` を返します。コンパイルが通らないプログラムでは、`kumiki_build` と同じく警告を先に、エラーを後に並べます。コンパイラ自体が throw したときは、ソースを表示したまま `internal-error` の診断を 1 つだけ出し、プレビューは出しません。

ローカルの CLI やエディタと統合するなら、stdio で動く [`@kumikijs/mcp`](https://github.com/kumikijs/Kumiki/tree/main/packages/mcp) サーバーもあります。
