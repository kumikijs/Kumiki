# ベンチマーク

「React よりトークンが少ない」「LLM が仕様書だけで習得できる」という Kumiki の主張は、宣言ではなく実測に基づいています。2 つのスイートが [`benchmarks`](https://github.com/kumikijs/Kumiki/tree/main/packages/benchmarks) にあります。

- **サイズ比較** — Kumiki のアプリと*編集*は、等価な React と比べてどれだけコンパクトか。決定的で、いつでも再実行できます。
- **学習コスト** — 仕様書だけを与えられた LLM が、単一パスで parse / typecheck / build を通るプログラムを書けるか。

## サイズ比較（Kumiki vs React）

ベースラインは同じ TodoMVC の 2 実装です。[`02-todomvc/app.kumiki`](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/02-todomvc/app.kumiki) と素の React の [`App.tsx`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/size-comparison/todomvc-react/src/App.tsx) で、どちらも Add ボタン、280 文字の上限とそのメッセージ、空白だけの入力の無視を備えています。トークン化には `gpt-tokenizer` を使っています。

### ファイル全体

| | chars | LOC (code) | cl100k tokens | o200k tokens |
|---|---:|---:|---:|---:|
| Kumiki | 4,975 | 123 | 1,427 | 1,430 |
| React | 8,023 | 255 | 2,021 | 2,062 |
| **React ÷ Kumiki** | **1.61×** | **2.07×** | **1.42×** | **1.44×** |

同じアプリを、Kumiki なら LLM は約 1.4 倍少ないトークン、約 2 倍少ない行数で書けます。

### 編集シナリオ

ファイル全体のサイズが効くのは最初の 1 回だけですが、編集のサイズはイテレーションのたびに効きます。現実的な機能変更 4 つを両実装に適用し、unified diff のサイズを計測しました。

| シナリオ | 実装 | +lines | −lines | chars | cl100k |
|---|---|---:|---:|---:|---:|
| 01 priority フィールド追加 | Kumiki | 4 | 4 | 582 | 177 |
| | React | 8 | 3 | 469 | 146 |
| 02 文字数上限を 100 に | Kumiki | 1 | 1 | 100 | 30 |
| | React | 4 | 3 | 412 | 111 |
| 03 archived 状態の追加 | Kumiki | 19 | 11 | 1,554 | 444 |
| | React | 27 | 9 | 1,461 | 413 |
| 04 ダークテーマ | Kumiki | 25 | 6 | 1,315 | 401 |
| | React | 48 | 12 | 2,153 | 638 |
| **合計** | **Kumiki** | **49** | **22** | **3,551** | **1,052** |
| | **React** | **87** | **27** | **4,495** | **1,308** |

合計では Kumiki が優位（追加行は 1.78 倍少なく、トークンは 1.24 倍少ない）ですが、一様ではありません。

- 局所的な小さい編集（01）は、JSX が属性 1 つをその場で書き換えられるぶん React のほうが安く済みます。Kumiki は定義を丸ごと置き換えるからです。
- ルールが型にある変更（02）は Kumiki が 1 行で済みます。上限を変えるとメッセージも入力の拒否もそれに従いますが、React ではガード・メッセージ・`maxLength` の 3 か所を揃えて直す必要があります。
- 状態・UI・ロジックを横断する変更（03, 04）でも Kumiki が勝ちます。React で編集が危険になるのは、まさにこの種の変更です。

### 編集の表現形式（ファイル全体 vs パッチ vs op ストリーム）

Kumiki の AI 編集動詞（`add` / `replace` / `remove`）は定義を丸ごと送ります。同じ 4 シナリオで計測すると、op ストリームのコストは**ファイル全体を書き直す場合の 24%**（cl100k で 1,456 vs 6,142）でした。ただし素の unified テキストパッチのほうがさらに小さく（1,052）なります。op ストリームの価値は最小バイト数ではなく、各 op を独立に検査でき、構文的に壊れたファイルを決して生まないことにあります。

## 学習コスト（仕様書だけで Kumiki を書く）

各タスクはモデルに **`docs/spec/` とタスク仕様だけ** を与え、単一パスで `.kumiki` プログラムを書かせます。example アプリもコンパイラのループもリトライもありません。その後ハーネスが parse / typecheck / build を採点します。プロトコルの詳細、実行したコマンド、公平性に関する注記は [`learning-cost/summary.md`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/learning-cost/summary.md) を参照してください。

| タスク | ベンダー | LOC | cl100k | parse | typecheck | build |
|---|---|---:|---:|:--:|:--:|:--:|
| v1 Pomodoro（~60 行） | Claude | 63 | 439 | ✅ | ✅ | ✅ |
| | Codex | 51 | 341 | ✅ | ✅ | ✅ |
| | Gemini | 69 | 609 | ✅ | ✅ | ✅ |
| v2 Kanban（~200 行） | Claude | 188 | 1,624 | ✅ | ✅ | ✅ |
| | Codex | 200 | 1,611 | ✅ | ✅ | ✅ |
| | Gemini | 331 | 2,323 | ✅ | ✅ | ✅ |
| v3 Issue Tracker（~600 行） | Claude | 864 | 7,482 | ✅ | ✅ | ✅ |
| | Codex | 772 | 6,143 | ✅ | ✅ | ✅ |
| | Gemini | 1,460 | 10,353 | ✅ | ✅ | ✅ |
| v4 Project Mgmt（~1,000 行） | Claude | 986 | 10,122 | ✅ | ✅ | ✅ |
| | Codex | 897 | 8,644 | ✅ | ✅ | ✅ |
| | Gemini | 1,995 | 16,598 | ✅ | ✅ | ✅ |

モデルは Claude Opus 5.5、Codex `gpt-6.1-terra`、Gemini `gemini-4-neon` で、推論の強さ（effort）はすべて `high` です。各タスク 1 回ずつ、仕様とタスク仕様だけを置いたワークスペース（example もコンパイラもなし）で実行しました。

表から読み取れること:

- **最大のアプリでも、仕様書だけ・単一パスでビルドが通ります。** 3 社とも ~1,000 行の v4 を含む 4 タスクすべてをビルドし、すべての出力が `kumiki smoke` も通りました。
- **effort も結果の一部です。** 最初に effort `low` で走らせた Codex は、v1 と v4 をそれぞれ規則 1 つで落とし、v4 は 287 行しか書きませんでした。同じモデルを `high` にすると、どちらもビルドが通ります。
- **正しさは揃い、規模は揃いません。** v3 で 3 社が書いた行数は 772・864・1,460 です。ビルドと smoke が通るのは、プログラムが言語として正しく、実行できるということです。タスク仕様をすべて満たしているかどうかは、このベンチマークでは採点していません。

## 再現方法

```sh
pnpm --filter @kumikijs/benchmarks measure            # ファイル全体のサイズ + 比率
pnpm --filter @kumikijs/benchmarks measure:scenarios  # シナリオごとのパッチサイズ
pnpm --filter @kumikijs/benchmarks measure:ops        # ファイル全体 vs パッチ vs op ストリーム
pnpm --filter @kumikijs/benchmarks eval <output.kumiki>  # 学習コスト出力の採点
```

学習コストのベンダー列を更新するには、コミット済みのプロンプト（`vN-*/codex-prompt.txt` / `gemini-prompt.txt`）でモデルを実行し、出力を `results/<Vendor>/output.kumiki` に保存して `eval` を再実行します。
