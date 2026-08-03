# はじめに

Kumiki は「AI ファースト」の Web フレームワークである。アプリを小さな定義の組み合わせとして記述し、ツールチェインが素のブラウザアプリへコンパイルする。

## インストールせずに試す

最速の入口は [Playground](./playground.md)。コンパイラとランタイムがブラウザ内で動き、左で編集すると右に描画される。clone もインストールも不要。

CLI・MCP・自分のファイルを扱うときは、以下のローカル環境を用意する。

## Kumiki プログラムの見た目

カウンターはわずかな定義である。`slot` が状態、`reducer` がイベントを状態変更に変え、`tile` が状態を UI へ投影し、`app` が全体を束ねる:

```kumiki
slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+1")
tile App    = column(heading("Count: " + count), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

これがメンタルモデルの全体である。完成版は [app.kumiki](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/01-counter/app.kumiki)、7 レイヤの解説は [Kumiki の考え方](./thinking-in-kumiki.md) にある。

## ローカル環境を用意する

**Node.js 22+** が必要。CLI は `@kumikijs/cli` をインストールする:

```sh
npm i -g @kumikijs/cli
# またはインストールせず直接実行
npx @kumikijs/cli --help
```

example・benchmarks・playground までソースを触りたい場合は、リポジトリを clone してワークスペースの `kumiki` スクリプトを使う:

```sh
git clone https://github.com/kumikijs/Kumiki.git
cd Kumiki
pnpm install        # ワークスペースのパッケージをリンク（どのコマンドより先に必須）
pnpm build          # 全パッケージをビルド
pnpm test           # 任意: 全パッケージが緑になることを確認
```

## 最初の例を動かす

**check** — `.kumiki` ファイルをパース + 型検査する:

```sh
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
# → ok
```

**build** — 静的アプリにコンパイルする:

```sh
pnpm kumiki build packages/examples/apps/01-counter/app.kumiki ./out
# → Wrote out/index.html, app.js, runtime/ (core, stdlib, tiles-layout, tiles-text, tiles-input)
```

`out/index.html` をブラウザで開けばカウンターが動く（「Count: 0」と、加算・減算・リセットのボタン）。`app.js` は生成された純粋なロジック、`runtime/` はこのアプリが実際に使う DOM ランタイムモジュールだけを含む（minify 済み。カウンターは gzip 約 9KB で、ルーティングやテーブルを使わないアプリにルーターやテーブルのコードは含まれない）。

**smoke** — 「コンパイルが通る」だけでなく「実際に動く」ことを確認する。ヘッドレス DOM にマウントしてクリックまで通す:

```sh
pnpm kumiki smoke packages/examples/apps/01-counter/app.kumiki
# → ok — mounted, rendered, 3 interaction(s), no runtime errors
```

## うまくいかないとき

check のエラーはコードと位置付きで出る:

```
E0103 undef-ref at 3:39: Reference to undefined name "total"
```

コード（ここでは `E0103`）が種類を表す。意味は [エラーカタログ](../spec/errors.md) を参照。多くはタイプミスか定義漏れで、よくある直し方は [Kumiki の考え方](./thinking-in-kumiki.md) と [レシピ](./recipes.md) でカバーする。

コマンド自体が失敗する場合:

- `Cannot find package '@kumikijs/compiler'` や `tsx: command not found` → `pnpm install` の実行漏れ。実行する。
- `.kumiki` ファイルのパスが見つからない → パスはリポジトリルート基準か確認（`pnpm kumiki` はルートで動く）。

## エディタ / AI 連携（MCP）

`@kumikijs/mcp` は check・build・編集・仕様検索を MCP ツールとして公開し、AI エージェントが Kumiki を一気通貫で操作できる。クライアント設定例は [README.md](https://github.com/kumikijs/Kumiki/blob/main/packages/mcp/README.md) を参照。

## 次へ

- [最初のアプリ](./your-first-app.md) — Counter を 1 レイヤずつ一から書く。
- [Kumiki の考え方](./thinking-in-kumiki.md) — 7 レイヤと React との違い。
- [Examples](https://github.com/kumikijs/Kumiki/tree/main/packages/examples) — 機能別の最小例と完成アプリ。
- [Playground](./playground.md) — ブラウザで引き続き実験する。
