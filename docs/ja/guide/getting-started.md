# はじめに

CLI を入れ、1 ファイル書き、ブラウザで動かすところまで。clone もバンドラ設定もプロジェクト雛形も要らない。

## インストール

```sh
npm i -g kumiki
# またはインストールせず直接実行
npx kumiki --help
```

必要なのは Node.js 20 以降（パッケージが宣言している下限）。

::: tip インストールすらせずに試す
[Playground](./playground.md) はコンパイラとランタイムをブラウザ内で動かす。例を選び、左で編集すれば右に描画される。
:::

## アプリを書く

`app.kumiki` として保存する:

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

宣言は 4 つ。`slot` が状態、`reducer` がイベントを状態変更に変え、`tile` が状態を UI へ投影し、`app` がエントリを名指しする。同じファイルを 1 行ずつ組み立てるのが [最初のアプリ](./your-first-app.md)、残り 3 レイヤを含む全体像が [Kumiki の考え方](./thinking-in-kumiki.md) にある。

## 動かす

```sh
kumiki dev app.kumiki
# → kumiki dev — http://localhost:5173/
```

この URL を開いて `+1` を押す。dev サーバは保存のたびに再ビルドし、コンパイルエラーはオーバーレイに出る。

静的な成果物が欲しいときは build する:

```sh
kumiki build app.kumiki ./out
# → Wrote out/index.html, app.js, runtime/ (core, stdlib, tiles-layout, tiles-text, tiles-input)
```

`out/index.html` はそのままブラウザで開ける。`runtime/` にはこのアプリが触るモジュールしか入らないので、カウンターは gzip 約 9KB で済む。ルーティングもテーブルも使わないアプリに、ルーターとテーブルのコードは含まれない。

## 検査する

`check` はファイルを実行せずに読む:

```sh
kumiki check app.kumiki
# → ok
```

`smoke` はヘッドレス DOM にマウントしてクリックまで通す。「コンパイルは通るが何も描画しない」を捕まえるのはこちらである:

```sh
kumiki smoke app.kumiki
# → ok — mounted, rendered, 1 interaction(s), no runtime errors
```

公開前にはどちらも通しておく。引数なしの `kumiki` が残りのコマンドを一覧する。

## check が落ちたら

診断はコードと位置を伴う:

```
E0103 undef-ref at 3:39: Reference to undefined name "total"
```

コードが種類を表す。[エラーカタログ](../spec/errors.md) を引けば、`E0103` は名前がどこにも解決しないこと、つまりほとんどの場合はタイプミスか定義漏れだと分かる。自動修正のあるコードなら `kumiki fix app.kumiki E0103` がパッチを提案する。

## 次へ

- [最初のアプリ](./your-first-app.md) — Counter を 1 レイヤずつ
- [レシピ](./recipes.md) — 「こうしたい」から動く例を逆引きする
- [Examples](https://github.com/kumikijs/Kumiki/tree/main/packages/examples) — 機能ごとに 1 ファイル、それと完成アプリ

::: details clone して使う場合
example・benchmarks・コンパイラのソースを触るならリポジトリを clone する。ワークスペースはリポジトリルートから `pnpm kumiki` として同じ CLI を公開する:

```sh
git clone https://github.com/kumikijs/Kumiki.git
cd Kumiki
pnpm install
pnpm kumiki check packages/examples/apps/01-counter/app.kumiki
```
:::

::: details AI エージェントから操作する場合
`@kumikijs/mcp` は check・build・定義単位の編集・仕様検索を MCP ツールとして公開する。クライアント設定例は [README](https://github.com/kumikijs/Kumiki/blob/main/packages/mcp/README.md) を参照。
:::
