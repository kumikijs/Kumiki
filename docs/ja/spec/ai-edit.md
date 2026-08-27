# AI 編集 API・CRDT op・参照整合性

Kumiki のコードは物理ファイルではなく **content-addressable CRDT graph** に格納される。AI エージェントはテキストファイルを編集するのではなく、**構造化された編集オペレーション（op）** を発行する。

これにより：

- ファイル単位のマージ衝突が原理的に発生しない
- 編集の影響範囲が静的に計算できる
- リネームで参照が壊れない（hash 不変）
- 編集失敗時に**自動修復ループ**が回せる

---

## 9.1 全体像

編集は 3 つの地点を巡る:

1. **store** — CRDT graph。定義の集合を保持し、各定義は自身の本体のハッシュで参照される。
2. **projection** — `kumiki view` が store から描き出すテキスト。エージェントが求めた定義だけを含む。
3. **op** — エージェントが書き戻すもの。`kumiki op apply` が store に畳み込む。

つまり AI が読むのは graph のテキスト断面であり、返すのは op であって、テキスト diff ではない。

---

## 9.2 kumiki CLI

### 9.2.1 読み取り系

```bash
kumiki view <selector>              # 定義をテキスト化して出力
kumiki view slot.todos              # 単一定義
kumiki view 'slot.*'                # ワイルドカード
kumiki view --with-deps reducer.add # 関連定義もまとめて出力
kumiki view --hash slot.todos       # content-hash を表示
kumiki view --history slot.todos    # この定義の編集履歴
kumiki view --refs slot.todos       # この定義への参照元一覧
kumiki list <layer>                 # レイヤ内の全定義名
kumiki list                         # 全定義名（layer prefix 付き）
```

### 9.2.2 書き込み系

```bash
kumiki add <layer> <name> <body>            # 新規定義追加
kumiki add ... --body-file <path>           # body をファイルから読む（'-' で stdin）— 空白を保持
kumiki replace <layer>.<name> <body>        # 定義差し替え
kumiki replace ... --body-file <path>       # body をファイルから読む（'-' で stdin）— 空白を保持
kumiki edit <layer>.<name> <patch>          # 部分編集（reducer の do= 内など）
kumiki edit ... --patch-file <path>         # patch JSON をファイルから読む（'-' で stdin）
kumiki rename <layer>.<old> <new>           # リネーム（hash 不変）
kumiki remove <layer>.<name>                # 削除（参照があれば失敗）
kumiki patch apply <file>                   # CRDT op バンドルを適用
kumiki patch revert <op-id>                 # 特定 op を取り消し
```

複数行の body（reducer の `do=` ブロック、fn の複数行 RHS 等）は `--body-file` を使うこと — 位置引数の形は空白1つで join されるため、改行やタブ幅は失われる。`--body-file` と位置引数 body を同時指定すると相互排他エラーとして拒否される。

書き込み系 op はファイルの再パース・再型検査で検証され、`severity: "error"` の診断が 1 つでも出ればロールバックする。ただし例外が 1 つある。プログラムは定義を 1 つずつ積み上げて構築されるため `app` が入るまでは app 不在の状態が続く。したがって **`E0003 missing-app` は書き込み op をロールバックさせない**。完成したアプリケーションかどうかは `kumiki check` が報告するものであり、編集途中のグラフが既に満たしているべき条件ではない。

### 9.2.3 検証系

```bash
kumiki check                       # 型・参照・effect 全部
kumiki check --types               # 型のみ
kumiki check --refs                # 参照整合性のみ
kumiki check --effects             # capability・policy 整合性のみ
kumiki check --a11y                # アクセシビリティ規約
```

3 つの絞り込みフラグは「どの種類の誤りか」という 1 本の軸で選ぶ。フラグは残すものを指定するので合成される — `--types --refs` は片方ではなく両方の帯を報告する。構造（`E00xx`）、オプトイン検査とテスト DSL 不変条件（`E07xx`）、ランタイムハザード（`E08xx`）はその軸に乗っていない — どのフラグも選択しないため、**どの絞り込みでも必ず報告される**。フラグが決められるのは「どの種類の誤りを聞きたいか」であって、エントリポイントの無いプログラムを健全に見せることはできない。

### 9.2.4 修正補助

```bash
kumiki fix --auto-patch <error-id>          # エラーを自動修正する CRDT op を提案
kumiki fix --apply                          # 提案をそのまま適用
kumiki fix --interactive                    # 提案を 1 つずつ確認しながら適用
```

### 9.2.5 終了コード

どの verb も終了コードで結果を報告する。出力のうちシェルが読むのはそこだけだからである。`kumiki fix --apply && kumiki build …` はファイルが壊れたままなら止まらなければならないし、`kumiki test app.kumiki 'checkout-*'` は渡された名前がどのテストにも一致しなければ失敗しなければならない。

| code | 意味 |
|---|---|
| `0` | 頼まれたことを実行した |
| `1` | 実行した上で、その操作が失敗した |
| `2` | 引数の形が違う |

`2` は `.kumiki` ファイルを読む前に決まる — 位置引数の不足、未知のオプション、許可された集合の外にある位置引数。したがって `2` が「プログラムを見た結果」を意味することは決してない。`2` が何を報告していようと、プログラムは調べられていない。

verb ごとに、`1` が意味するのは以下である。

| verb | `1` になる条件 |
|---|---|
| `check` | 絞り込みフラグを通り抜けた severity `error` の診断がある。警告は終了コードを変えない（`ok (1 warning)` は `0`） |
| `build` | プログラムがコンパイルできない、または出力を書けない |
| `smoke` | アプリが mount に失敗する、または操作が例外を投げる |
| `run` | シナリオ文書が読めない・シナリオではない、またはステップが失敗する |
| `test` | テストが失敗した、**または** フィルタが指定されていてどのテストにも一致しなかった。フィルタ無しでテストが 0 件なら `0`。`--watch` は中断されるまで終わらないので何も報告しない |
| `fix` | プロセス終了時点でファイルが求められた状態になっていない。すなわちエラーが残っている、または `--auto-patch <test>` で指定したテストが通っていない。dry run は何も修復しないので、その状態に既に無いファイルはすべて `1` になる |
| `view` / `refs` | ファイル、またはその中の完全名が存在しない。`view --history` が要求するのはファイルだけである — 削除された定義にも履歴はあり、まさにそのときに参照されるからである |
| `list` | ファイルが存在しない、またはフィルタがどの種類の定義も指していない。実在するがその下に定義が無い場合は何も出力せず `0` |
| `add` / `replace` / `remove` / `rename` / `edit` / `patch` | 書き込みが拒否されロールバックされた |
| `lock` / `unlock` | ロックを他のエージェントが保持している、または解放すべきロックが無い |
| `replay` | ログが読めない、指定した episode がログに無い、または再生した episode が panic した |
| `dev` | サーバを起動できなかった。起動後は中断されるまで動き続けるので何も報告しない |

警告が終了コードを変えることはない。2 つの段階を分けているのはまさにそこで、`error` は「プログラムが誤っている」という主張、`warning` は「怪しい」という主張であり、パイプラインを止めてよいのは前者だけである。

MCP サーバ（[§9.7](#_9-7-mcp-server)）は同じ問いに `isError` で答える。ここで `1` になる失敗は、あちらで `isError: true` になる。フラグが内容を変えることはない — 失敗した check は診断を、失敗したシナリオはトレースを返したままである。答えを 1 つも生み出せなかった失敗（ファイルが無い、名前が何も指さない）だけが、内容を封筒 `{"error": {"kind", "message"}}` に置き換える。

## 9.3 CRDT op の形式

### 9.3.1 op の種類

| op | 意味 |
|---|---|
| `add` | 新規定義追加 |
| `replace` | 定義本体を差し替え |
| `edit` | 定義の一部編集（field 更新、reducer の do= 内文の追加削除など） |
| `rename` | 名前変更（hash 不変、参照は別 op で更新）|
| `remove` | 定義削除（dependent ops 自動生成） |
| `link` | 参照追加（明示） |
| `unlink` | 参照削除（明示） |

### 9.3.2 wire format

```json
{
  "op": "add",
  "layer": "slot",
  "name": "todos",
  "body": "Map(TodoId, Todo) = {}",
  "author": "agent:claude-1",
  "ts": 1779884546123,
  "op-id": "op_01JC...",
  "parent-ops": ["op_01JB..."],
  "depends-on": ["type:TodoId@h:9ab3...", "type:Todo@h:7cde..."]
}
```

| フィールド | 意味 |
|---|---|
| `op` | op 種別 |
| `layer` | 対象レイヤ |
| `name` | 対象名 |
| `body` | 新本体（add/replace で必須）|
| `author` | 発行エージェント |
| `ts` | 発行時刻（UNIX ms） |
| `op-id` | op の ULID |
| `parent-ops` | この op が依拠する直前 op の id（CRDT 順序保証） |
| `depends-on` | 本体が参照する他定義の hash（参照整合性検証用） |

### 9.3.3 op の収束保証

Kumiki graph は **Add-Wins LWW-Map**（最終書き込み勝ち + 削除より追加優先）。

- 同名 add が複数エージェントから来た場合: `op-id` の辞書順で勝者決定
- add と remove が交差: add 勝ち（dangling reference になるくらいなら残す）
- replace 同士: ts 新しい方が勝つ
- rename と remove: rename 勝ち

これらは数学的に収束保証される。が、**意味的整合性は別途検査が必要**（次節）。

## 9.4 参照整合性の強制

CRDT が構文収束を保証しても、**意味的衝突**は別問題：

- A: `kumiki remove slot.draft`
- B: `kumiki add tile.NewForm input(bind=draft)`

両方が CRDT として収束したあと、`tile.NewForm` から `slot.draft` への参照が dangling になる。

Kumiki はこれを **2 段階で防ぐ**：

### 9.4.1 op 発行時の事前検査 {#_9-4-1-pre-check-at-op-issuance}

```bash
kumiki remove slot.draft
# Error: cannot remove slot.draft (referenced by 3 tiles, 2 reducers)
#   tile.NewForm:1
#   tile.Compose:4
#   tile.SearchBox:1
#   reducer.submitNew:2
#   reducer.clearDraft:1
# Use --cascade to remove all dependents, or --force to leave dangling
```

`--cascade` で依存先も同一 op バンドルに含めて remove する。`--force` は dangling 許容（warning 出力）。

### 9.4.2 op 適用時の事後検査

複数エージェントの op が同時に着信した場合、**graph store はトランザクション境界で参照検査**を実行：

```
transaction begin
  apply op_A (remove slot.draft)
  apply op_B (add tile.NewForm with ref to draft)
check refs
  -> dangling: tile.NewForm -> slot.draft
resolve:
  policy=strict: rollback both ops, mark as conflict
  policy=heal:   add slot.draft back with default value, log conflict
  policy=warn:   apply both, mark warning, emit notification
transaction commit
```

resolve policy は `kumiki config conflict-policy <strict|heal|warn>` で設定。デフォルト `strict`。

## 9.5 hash 計算と参照解決

### 9.5.1 hash 計算

```
canonical(body) = AST正規化 (識別子は型hash+位置に置換、フィールド名アルファベット順、空白除去)
hash(def) = blake3(canonical(def.body) ⊕ hash(dep1) ⊕ hash(dep2) ⊕ ...)
```

### 9.5.2 参照解決

ソーステキストの `users` のような名前参照は graph store 内では `slot:hash:9ab3c1...` として記録される。

- 名前 → hash 解決はコンパイル時 / op 適用時に行う
- 同名でも依存先が変われば別 hash
- リネームは `(rename, name-old, name-new)` op のみ。hash は不変

### 9.5.3 表示時の名前

`kumiki view` で取り出すと hash は人間可読名に戻される（**ラベル**）。

## 9.6 エラーコードと自動修復

すべてのエラーは構造化されている：

```json
{
  "code": "E0103",
  "kind": "undef-ref",
  "location": "tile.TodoRow.body:2",
  "message": "Reference to undefined slot 'usres'",
  "suggestion": {
    "kind": "did-you-mean",
    "name": "users",
    "similarity": 0.92
  },
  "auto-patch": {
    "op": "edit",
    "layer": "tile",
    "name": "TodoRow",
    "patch": {"body:2": "replace 'usres' -> 'users'"}
  }
}
```

### 9.6.1 コードの定義場所

[エラーコード仕様](./errors.md) が、すべてのコードを 1 箇所で規範的に定義する — 何が発生させ、どんなメッセージを持ち、どう直すか。ここでは再掲しない。表が 2 つあったせいで `E0302` は「effect の直接呼び出し」と「未知の capability」の両方を意味するようになった。どちらの文書を開いたかで意味が変わるコードは、errors.md が言うところの永続的な契約ではない。

自動修復に関して見るべきは errors.md の **自動修復のカバレッジ** 表で、コードごとに `kumiki fix` が修復できるか、どの戦略で行うかを示す。下記のループはそれを消費する。

### 9.6.2 自動修復ループ

```bash
# AI agent script
while true; do
    errors=$(kumiki check --json)
    if [ -z "$errors" ]; then break; fi
    for err in $errors; do
        if has_auto_patch "$err"; then
            kumiki patch apply <(echo "$err" | jq .auto-patch)
        else
            # AI に修正を委ねる
            echo "$err" | ai-fix
        fi
    done
done
```

`kumiki fix --auto-patch <code>` で auto-patch があるエラーは構造的に解決される。auto-patch がないエラーだけ AI のコンテキストに乗せて修正させる。

## 9.7 MCP サーバ {#_9-7-mcp-server}

Kumiki は Model Context Protocol サーバとして起動でき、AI エージェントから直接 tool 呼び出しできる：

```bash
kumiki mcp serve --store ./project.kumiki-store
```

提供される tools：

| tool name | 引数 | 戻り値 |
|---|---|---|
| `kumiki_view` | `selector: string, with_deps?: bool` | 定義テキスト |
| `kumiki_list` | `layer?: string` | 定義名リスト |
| `kumiki_add` | `layer, name, body` | op-id |
| `kumiki_replace` | `qname, body` | op-id |
| `kumiki_edit` | `qname, patch` | op-id |
| `kumiki_rename` | `qname, new_name` | op-id |
| `kumiki_remove` | `qname, cascade?: bool` | op-id + 削除された定義名（[§9.4.1](#_9-4-1-pre-check-at-op-issuance)） |
| `kumiki_check` | `scope?: string` | error list (JSON) |
| `kumiki_fix` | `error_code, apply?: bool` | patch (JSON) |
| `kumiki_refs` | `qname` | 参照元リスト |
| `kumiki_history` | `qname` | op 履歴 |
| `kumiki_episode` | `episode_id` | episode log |

AI からはファイル操作の代わりにこれらを呼ぶ。

## 9.8 エージェント並列開発プロトコル

複数エージェントが同時に編集する際の協調：

### 9.8.1 同時性

- 各エージェントは **ローカル graph store のスナップショット**を持って作業
- 出力は op バンドル
- マスター graph store に op を push → CRDT で収束

### 9.8.2 ロックなし

graph store はロックを取らない。op はいつでも push 可能。ただし：

- 参照整合性で reject される可能性あり
- reject されたエージェントはマスターの最新を pull して再試行

### 9.8.3 タスク境界

複数エージェントが同じ定義を編集することは避けたい。タスク分割の単位を「**定義名のドメイン**」で行う：

```
agent-1: slot.todos*, reducer.todo-*, tile.Todo*
agent-2: slot.user*,  reducer.user-*, tile.User*
agent-3: slot.route,  reducer.route-*
```

これは規約だが、Kumiki コンパイラに **ownership lock**（オプション）を追加できる：

```bash
kumiki lock agent-1 'slot.todos*,reducer.todo-*'
```

同名空間に他エージェントが op を出すと reject される。

## 9.9 episode と op の関係

実行時の episode log はビルド成果物に対して記録される。op は **ソース graph の編集履歴**。両者は分離されている：

| | op log | episode log |
|---|---|---|
| 対象 | ソース定義の変更 | 実行時の状態変化 |
| 永続化先 | graph store | episode store |
| 用途 | 並列開発・回帰検査 | デバッグ・replay test |
| 単位 | CRDT op | reducer 実行 + effect 結果 |

→ episode log は [ランタイム](./runtime.md)。

## 9.10 ファイルシステムとの互換層

実装初期は、graph store を **ディレクトリ内のファイル群として projection** することもできる：

```
project.kumiki/
├── types/
│   ├── User.kumiki
│   └── TodoId.kumiki
├── slots/
│   └── todos.kumiki
├── effects/
│   └── loadTodo.kumiki
├── reducers/
│   └── add.kumiki
├── tiles/
│   ├── TodoRow.kumiki
│   └── App.kumiki
├── fns/
│   └── matchFilter.kumiki
└── .kumiki/
    ├── store.crdt        ← CRDT graph 本体（バイナリ）
    ├── op-log.jsonl
    └── episode-log.jsonl
```

`kumiki sync` で双方向同期：ファイル編集 → op に変換 → store に適用、または store の変更 → ファイルに反映。

これにより既存の Git ベースの workflow とも共存可能。ただし**真の互換性は graph store 側**にある。

## 9.11 設計上の判断記録

| 判断 | 理由 |
|---|---|
| 編集はファイル diff ではなく構造化 op | 並列マージで意味的に安全 |
| 参照整合性は op 発行時と適用時の 2 段階 | CRDT の意味的衝突を構造で防ぐ |
| 自動修復ループ | AI のデバッグサイクルを構造で短縮 |
| MCP サーバ提供 | AI エージェントから直接使える |
| ownership lock オプション | 並列開発の規約を機械化 |
| ファイル投影との互換 | 既存ツール (Git/エディタ) と共存 |

---

## 9.12 次

- ランタイム実装の詳細 → [ランタイム](./runtime.md)
- 完全例 → [examples/](https://github.com/kumikijs/Kumiki/tree/main/packages/examples)
