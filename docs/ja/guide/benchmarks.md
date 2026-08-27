# ベンチマーク

「React よりトークンが少ない」「LLM が仕様書だけで習得できる」という Kumiki の主張は、宣言ではなく実測である。2 つのスイートが [`benchmarks`](https://github.com/kumikijs/Kumiki/tree/main/packages/benchmarks) にある。

- **サイズ比較** — Kumiki のアプリと*編集*は、等価な React と比べてどれだけコンパクトか。決定的に再実行可能。
- **学習コスト** — 仕様書だけを与えられた LLM が、単一パスで parse / typecheck / build を通るプログラムを書けるか。

## サイズ比較（Kumiki vs React）

ベースラインは同じ TodoMVC の 2 実装 — [`02-todomvc/app.kumiki`](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/02-todomvc/app.kumiki) と素の React [`App.tsx`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/size-comparison/todomvc-react/src/App.tsx)。トークン化は `gpt-tokenizer`。

### ファイル全体

| | chars | LOC (code) | cl100k tokens | o200k tokens |
|---|---:|---:|---:|---:|
| Kumiki | 4,710 | 116 | 1,360 | 1,364 |
| React | 7,357 | 236 | 1,887 | 1,926 |
| **React ÷ Kumiki** | **1.56×** | **2.03×** | **1.39×** | **1.41×** |

同じアプリが、Kumiki では LLM にとって約 1.4× 少ないトークン、約 2× 少ない行数で書ける。

### 編集シナリオ

ファイル全体のサイズが効くのは最初の 1 回だけ。編集サイズはイテレーションのたびに効く。現実的な機能変更 4 つを両実装に適用し、unified diff のサイズを計測した:

| シナリオ | 実装 | +lines | −lines | chars | cl100k |
|---|---|---:|---:|---:|---:|
| 01 priority フィールド追加 | Kumiki | 4 | 4 | 568 | 175 |
| | React | 8 | 3 | 483 | 150 |
| 02 厳格バリデーション | Kumiki | 7 | 4 | 432 | 112 |
| | React | 4 | 2 | 322 | 88 |
| 03 archived 状態の追加 | Kumiki | 19 | 11 | 1,540 | 442 |
| | React | 27 | 9 | 1,475 | 417 |
| 04 ダークテーマ | Kumiki | 25 | 6 | 1,315 | 401 |
| | React | 48 | 12 | 2,153 | 638 |
| **合計** | **Kumiki** | **55** | **25** | **3,855** | **1,130** |
| | **React** | **87** | **26** | **4,433** | **1,293** |

合計では Kumiki 優位（追加行 1.58× 減、トークン 1.14× 減）だが、一様ではない。局所的な小編集（01–02）は JSX が属性 1 つをその場で書き換えられるぶん React が安く、Kumiki は定義丸ごとの置換になる。Kumiki が勝つのは変更が状態 + UI + ロジックを横断するとき（03, 04）— React で編集が危険になるのがまさにそこ。

### 編集の表現形式（ファイル全体 vs パッチ vs op ストリーム）

Kumiki の AI 編集動詞（`add` / `replace` / `remove`）は定義を丸ごと送る。同じ 4 シナリオで計測すると、op ストリームのコストは**ファイル全体を書き直す場合の 26%**（cl100k で 1,544 vs 5,896）。ただし素の unified テキストパッチのほうがさらに小さい（1,130）。op ストリームの価値は最小バイト数ではなく、各 op が独立に検査可能で、構文的に壊れたファイルを決して生まないことにある。

## 学習コスト（仕様書だけで Kumiki を書く）

各タスクはモデルに **`docs/spec/` + タスク仕様のみ**を与え、単一パスで `.kumiki` プログラムを書かせる — example アプリなし、コンパイラのループなし、リトライなし。その後ハーネスが parse / typecheck / build を採点する。プロトコルの詳細と公平性に関する注記（初回の Claude 4/4 を破棄した理由を含む）は [`learning-cost/summary.md`](https://github.com/kumikijs/Kumiki/blob/main/packages/benchmarks/learning-cost/summary.md) を参照。

| タスク | ベンダー | LOC | cl100k | parse | typecheck | build |
|---|---|---:|---:|:--:|:--:|:--:|
| v1 Pomodoro（~60 行） | Claude | 59 | 384 | ✅ | ✅ | ✅ |
| v2 Kanban（~200 行） | Claude | 178 | 1,421 | ✅ | ✅ | ✅ |
| | Codex | 243 | 1,881 | ✅ | ✅ | ✅ |
| | Gemini | 152 | 1,314 | ✅ | ✅ | ✅ |
| v3 Issue Tracker（~600 行） | Claude | 629 | 5,325 | ✅ | ✅ | ✅ |
| | Codex | 674 | 6,417 | ✅ | ✅ | ✅ |
| | Gemini | 440 | 4,995 | ✅ | ❌ | ❌ |
| v4 Project Mgmt（~900 行） | Claude | 1,029 | 9,552 | ❌ | ❌ | ❌ |
| | Codex | 877 | 8,703 | ✅ | ✅ | ✅ |
| | Gemini | 294 | 4,397 | ❌ | ❌ | ❌ |

表の読み方:

- **中規模アプリは仕様書だけ・単一パスでビルドが通る。** 全ベンダーが v2 をビルドし、3 社中 2 社が ~600 行の v3 をビルド。
- **Codex は着手したタスクをすべてビルド — ~880 行の v4 を通した唯一のベンダー。** Claude は v3 まで持ちこたえ、v4 規模で未サポートの `match` パターンを使って parse 失敗。Gemini は最も早く劣化。
- **このベンチマークはコンパイラのテストでもある。** 実行の過程で実在する欠陥が 2 件浮上 — build でクラッシュする組み込みタイル（[#61](https://github.com/kumikijs/Kumiki/issues/61)）と、例示でしか述べられていなかった規則（[#62](https://github.com/kumikijs/Kumiki/issues/62)）。どちらも修正済みで、上の表は修正後のコンパイラで採点。残る 3 つの ❌ は、ツールチェーンが*正しく*拒否している純粋な authoring エラーである。

## 再現方法

```sh
pnpm --filter @kumikijs/benchmarks measure            # ファイル全体のサイズ + 比率
pnpm --filter @kumikijs/benchmarks measure:scenarios  # シナリオごとのパッチサイズ
pnpm --filter @kumikijs/benchmarks measure:ops        # ファイル全体 vs パッチ vs op ストリーム
pnpm --filter @kumikijs/benchmarks eval <output.kumiki>  # 学習コスト出力の採点
```

学習コストのベンダー列を更新するには、コミット済みプロンプト（`vN-*/codex-prompt.txt` / `gemini-prompt.txt`）でモデルを実行し、出力を `results/<Vendor>/output.kumiki` に保存して `eval` を再実行する。
