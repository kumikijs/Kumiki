# ベンチマーク

「React よりトークンが少ない」「LLM が仕様書だけで習得できる」という Kumiki の主張は、宣言ではなく実測に基づいています。2 つのスイートが [`benchmarks`](https://github.com/kumikijs/Kumiki/tree/main/packages/benchmarks) にあります。

- **サイズ比較** — Kumiki のアプリと*編集*は、等価な React と比べてどれだけコンパクトか。決定的で、いつでも再実行できます。
- **学習コスト** — 仕様書だけを与えられた LLM が、ビルドが通りタスクの求める動作をするプログラムを書けるか。Kumiki CLI を使える場合と使えない場合の両方で測ります。

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

## 学習コスト（仕様書から Kumiki を書く）

各タスクはモデルに **`docs/spec/` とタスク仕様だけ** を、ほかに何も置いていないワークスペースで与え、書かれたプログラムを 2 つの観点で採点します。ビルドが通るか（parse / typecheck / build と `kumiki smoke`）と、タスクが求める動作をするかです。後者のために、タスク仕様はアプリが使うべき id・ラベル・effect の名前を定めています。採点には基準 1 つにつき 1 本の受け入れシナリオを使い、そうした名前を通してアプリを操作します。このシナリオはモデルには見せません。各タスクは 2 つのトラックで実行します。

- **spec**: ワークスペースにコンパイラがないので、プログラムは単一パスで書きます。
- **toolchain**: Kumiki CLI もインストールされており、モデルは 30 分以内なら `kumiki guide`・`check`・`build`・`smoke`・`run`・`test` を何度でも実行できます。

プロトコルの詳細、実行したコマンド、実行ごとの規模は [`learning-cost/summary.md`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/learning-cost/summary.md) を参照してください。

受け入れ基準の合格数:

| タスク | Claude | Claude + CLI | Codex | Codex + CLI | Gemini | Gemini + CLI |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| v1 Pomodoro（~60 行） | 5/5 | — | 5/5 | — | 5/5 | — |
| v2 Kanban（~200 行） | 9/9 | — | 9/9 | — | 9/9 | — |
| v3 Issue Tracker（~700 行） | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 | 17/17 |
| v4 Project Mgmt（~1,000 行） | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 |
| v5 Synced Notes（HTTP effect、~300 行） | 9/14 | 14/14 | 0/14 | 14/14 | 10/14 | 14/14 |
| v6 Change Request（990 行のアプリを改修） | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |

モデルは Claude Opus 5.5、Codex `gpt-6.1-terra`、Gemini `gemini-4-neon` で、推論の強さ（effort）はすべて `high`、各セル 1 回ずつの実行です。v1 と v2 は spec トラックだけで実行しました。

表から読み取れること:

- **機能の多いアプリは、仕様書だけで正しく書けます。** 3 社とも v3・v4・v6 の基準をすべて満たしました。コンパイラを一度も実行せずに、~1,000 行の v4 まで書けています。
- **仕様書だけで足りないのは effect で、そこをツールが補います。** すべての操作が、失敗・再試行・新しい要求による置き換えのありうる HTTP effect を通る v5 では、spec トラックで 4〜14 基準を落としました。2 社は effect 結果の 2 番目の束縛が何を持つかを読み違えました。これは何もチェックしない箇所です。残る 1 社は、すべてのアプリに必要な `/404` ルートを書き忘れました。CLI があると 3 社とも 14/14 です。
- **大きなプログラムの改修は小さく収まります。** v6 の 6 回の実行は、990 行のアプリに 49〜68 行を追加して 4〜11 行を削除しました。守るべき 23 の振る舞いを壊した実行はありません。

## 再現方法

```sh
pnpm --filter @kumikijs/benchmarks measure            # ファイル全体のサイズ + 比率
pnpm --filter @kumikijs/benchmarks measure:scenarios  # シナリオごとのパッチサイズ
pnpm --filter @kumikijs/benchmarks measure:ops        # ファイル全体 vs パッチ vs op ストリーム
pnpm --filter @kumikijs/benchmarks eval <output.kumiki>  # 学習コスト出力のビルドが通るか
pnpm --filter @kumikijs/benchmarks acceptance [tasks]     # 受け入れ基準を満たすか
```

学習コストのセルを更新するには `pnpm --filter @kumikijs/benchmarks learning-cost <task> <vendor> <spec|toolchain>` を実行します。ワークスペースを作り、そのベンダーのエージェントを走らせ、出力を `results/<Vendor>[-toolchain]/` に保存します。その後 `eval` と `acceptance` を再実行してください。
