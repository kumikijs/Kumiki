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

### 9.2.2 書き込み系 {#_9-2-2-write-commands}

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

`add` の `<layer>` は `kumiki list` が受け付けるラベルのいずれか（`type`・`slot`・`effect`・`reducer`・`tile`・`fn`・`app`・`theme`・`motion`・`test`）で、それ以外の語に対して `kumiki add` はファイルを読む前に `2` で終了する。`<name>` は識別子 1 つであり、`add` はそれ以外を拒否する。body は定義から `<layer> <name>` とその後の区切りを除いたもので、`slot count : Int = 0` なら `Int = 0`、`tile Greeting = heading("Hi")` なら `heading("Hi")` である。tile の節（`in=`・`error-boundary=`・`scroll-restoration=`・`sub-routes=`）と type のパラメータは名前と `=` の間に置かれるので、それらを持つ body はそれらで始まり `=` も含む。`in=Text = heading($1)` は `tile Greet in=Text = heading($1)` を書き、`(T) = {v: T}` は `type Box(T) = {v: T}` を書く。節やパラメータで始まらない `replace` の body は、定義が持つものを残す。`tile Greeting error-boundary=Oops = …` に対して body `heading("Hello")` は `tile Greeting error-boundary=Oops = heading("Hello")` を書く。変えるには残すものを body に書き、すべて外すには body を `=` から始める。`replace` は `replaced` の行の後に、定義から無くなった節やパラメータごとに 1 行（`  dropped error-boundary`、`  dropped parameter T`）を出力する。検証を通る書き込みで、それらが気づかれずに失われることはない。

書き込み系 op はファイルの再パース・再型検査で検証され、`severity: "error"` の診断が 1 つでも出ればロールバックする。ただし例外が 1 つある。プログラムは定義を 1 つずつ積み上げて構築されるため `app` が入るまでは app 不在の状態が続く。したがって **`E0003 missing-app` は書き込み op をロールバックさせない**。完成したアプリケーションかどうかは `kumiki check` が報告するものであり、編集途中のグラフが既に満たしているべき条件ではない。

1 つのファイルへの書き込み op は**直列化**される。`add`・`replace`・`edit`・`rename`・`remove`・`patch apply`・`patch revert`・`lock`・`unlock` は、読み込み → 検証 → 書き込み → ログ追記の間ずっとそのファイルの書き込みロック（兄弟ファイル `<file>.kumiki-write.lock`。§9.8.3 の所有ロック `<file>.kumiki-locks.json` とは別物）を保持する。`patch apply` と `patch revert` は、それを構成する op 全体で 1 度だけ保持する。合成したソースは書き込む*前に*検証され、ファイルはその場で書き換えるのではなく rename した兄弟ファイルで置き換えられるので、他の読み手が書きかけのファイルを見ることはなく、reject された op が何かを上書きすることもない。（置き換えなので、ファイルのパスにあるシンボリックリンクは辿られずに置き換えられ、ファイル自身のパーミッションは保たれない。）その後 op ログへの追記に失敗した場合は、ファイルを元に戻して op を reject する。その結果、op ログのすべての op はファイルに反映されており、成功を報告した op はすべて両方にある。`kumiki fix --apply` も rename で書き込むが書き込みロックは取らないので、同じファイルに対して書き込み系 verb と並行して実行してはならない。

ロックが保持されていれば書き手はその解放を待つ：既定で 30 秒、`KUMIKI_WRITE_LOCK_WAIT_MS` を与えればそのミリ秒数。待ち時間は書き手ごとなので、複数が並んでいれば最後の書き手は前にいるすべての書き手の分だけ待つ。期限内に解放されなければ op は reject される：exit `1`、何も書き込まず、何もログに残さず、メッセージは保持者の pid とホスト（ワーカースレッドならそのスレッドも）、ロックファイルを名指しする。MCP ツールも同じように待ち、その間サーバーは他のリクエストに応答しない。保持者がいないと分かっているロックは、待たずに引き継がれる：このホスト上の終了済みプロセスを名指ししている場合、書き手自身のスレッドを名指ししている場合（そのスレッドは何も保持していないので、自身の解放が失敗して残ったロックである）、または保持者を名指ししていない（空、JSON でない、pid が正の整数でない、スレッド ID が非負整数でない）うえに 2 秒より古い場合である。1 つのプロセスのワーカースレッドは pid を共有するため、ロックにはプロセスに加えて書き込み中のスレッドも記録される。実行中のプロセスの別スレッドを名指しするロックは、他の生きている書き手と同様に待たれる。スレッドがまだ動いているかは別のスレッドからは確認できないため、書き込みの途中で終了した（terminate されたなど）ワーカースレッドが残したロックは、そのプロセスが終了するまで待たれる。そのスレッドがファイルを書いていなければ、ロックファイルを削除すること。スレッドを記録していないロックは、そのプロセスのメインスレッドを名指ししているものとして読む。別ホスト上のプロセス（別のコンテナ、共有ドライブ上の Windows と WSL など）を名指しするロックは、そのプロセスがまだ動いているかを確認できないため、決して引き継がれない。動いていなければロックファイルを削除すること。

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
| `body` | 新本体（add/replace で必須）。形は [§9.2.2](#_9-2-2-write-commands) のとおり。tile と type の body は常に節やパラメータを書き、それらが無ければ `=` から始まる（`= heading("Hi")`）。そのため `patch apply` は、定義がその後どんな節を得ていても、op が書いた定義を書く |
| `prev` | `replace` と `edit` のみ：op の前に定義が持っていた本体。形は `body` と同じ。`patch revert` はこれを書き戻すので、手で書いた節のようにどのログの body にも無い節やパラメータも戻る。名前と本体の間にあったもの（名前の後のコメント、改行など）は残らず、本体は `add` が書くのと同じように名前に続く |
| `author` | 発行エージェント |
| `ts` | 発行時刻（UNIX ms） |
| `op-id` | op の ULID |
| `parent-ops` | この op が依拠する直前 op の id（CRDT 順序保証） |
| `depends-on` | 本体が参照する他定義の hash（参照整合性検証用） |
| `removed` | `remove --cascade` のみ：op が削除したすべての定義。要求された定義が先頭（[§9.4.1](#_9-4-1-pre-check-at-op-issuance)） |
| `bodies` | `remove` のみ：op が削除したすべての定義を `{layer, name, body}` として、削除時点の本体とともに記録する。要求された定義が先頭。`patch revert` はこれを復元する |
| `with` | `add` のみ：同じ op で追加される他の定義 `{layer, name, body}`。cascade の revert が依存元を復元する手段 |

`with` と `bodies` は 3 つのフィールドがすべて文字列であるオブジェクトの配列、`removed` は op 自身の定義で始まる修飾名の配列、`prev` は `replace` または `edit` の文字列でなければならない（`prev` を持つのはこの 2 つの op だけである）。これに反する patch ファイルの op や op ログの行は、何も書き込む前に、そのフィールドを名指しして拒否される。

`prev` 無しで記録された `replace` や `edit` の `patch revert` は、ログがその定義について持つ直近の body を使う。そこにある tile や type の body が節やパラメータを書いていなければ、`replace` と同じく定義が持つものが残る。`<layer> <name>` で始まる、定義全体であるログの body は、その定義を名指しして拒否され、何も書き込まれない。

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

`--cascade` で依存元も同一 op バンドルに含めて remove する。依存元とは、remove する定義を直接または推移的に参照するすべての定義であり、`app` も含まれうる。remove する定義が参照している定義は、それ自身も依存元でない限り残る。`--force` は dangling 許容（warning 出力）。

cascade の `remove` op は、取り除いたすべての定義を `removed` に列挙し（要求された定義が先頭）、それぞれの本体を `bodies` に記録する。その op を `kumiki patch revert` すると、それらすべてを **1 つの** `add` op として復元する：要求された定義がその `layer` / `name` / `body` になり、依存元はその `with` リストになる。本体は remove に記録されたものなので、その時点でファイルにあったものである。rename が依存元を書き換えて新しい本体を記録しなかった場合も同じである。`bodies` が存在する前に記録された `remove` は、remove より前に op ログがその名前について記録した最後の本体にフォールバックする。どれか 1 つでも見つからなければ、revert は何も書き込まずに `1` で終了し、復元できなかった定義を名指しする。`removed` なしで記録された cascade は、何を取り除いたかが不明なので拒否される。revert が部分的な復元を成功として報告することはない。

その `add` を revert すると、それが追加した集合、すなわち名前付きの定義と `with` のすべての要素を、ちょうどそのとおりに取り除く。現在その定義を参照しているものから集合を導き直すことはしないので、もう依存していない要素も取り除かれる。その後に rename された要素は新しい名前で取り除かれる（[§9.5.3](#_9-5-3-names-at-display-time)）。要素がもうファイルにない（その後に remove された）場合、集合の外の定義が要素を参照している場合は、何も書き込む前に拒否される。エラーはそのような参照をそれぞれ `<外の定義> references <要素>` として名指しする。要素が他のエージェントにロックされている場合も、他の op と同じく拒否される（[§9.8.3](#_9-8-3-task-boundaries)）：ファイルはバイト単位で元のままで、op は記録されない。復元する `add` が戻す各定義についても同じである。`removed` を持つ cascade の `remove` を `patch apply` した場合も同じく、記録された集合を同じ拒否条件のもとで取り除く。

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

hash にはどの定義の名前も含まれない。定義自身の名前は除かれ、他の定義への参照はその綴りではなく参照先の hash として数えられる。空白とコメントも含まれない。したがって rename は、rename された定義とそれを参照するすべての定義の hash を変えない。空白やコメントの変更も同じである。rename の前に記録された `depends-on` のダイジェストは、rename の後も依存先の `kumiki view --hash` と一致する。本体の意味の変更（`Int = 0` を `Int = 1` にする）は、その定義とそれに依存するすべての定義の hash を変える。ただし下記の既知の例外が 1 つある。`slot a : Int = 0` と `slot b : Int = 0` のように名前だけが異なる 2 つの定義は、同じ hash を持つ。

2 つの相互再帰する型のように、互いに循環して参照し合う定義は、どれの hash も他より先には計算できないので、まとめて 1 つの単位として hash される。単位の中では、ある要素から別の要素への参照は、参照先の hash ではなく、参照先の要素が述べる内容（その要素自身の単位内の要素への参照は除く）として数えられ、各要素の hash は単位のすべての要素が述べる内容を含む。したがって要素の hash はどの要素から先に辿り着いても同じであり、要素の `depends-on` のダイジェストはその `kumiki view --hash` と一致する。

既知の制限：参照は参照先の定義の hash として数えられ、名前だけが異なる 2 つの定義は同じ hash を持つので、その一方への参照ともう一方への参照は同じに数えられる。`slot a` と `slot b` がどちらも `Int = 0` なら、2 つの slot は別々の状態であるにもかかわらず、`a := b` と `b := a` は同じ hash になる。

### 9.5.2 参照解決

ソーステキストの `users` のような名前参照は graph store 内では `slot:hash:9ab3c1...` として記録される。

- 名前 → hash 解決はコンパイル時 / op 適用時に行う
- 同名でも依存先が変われば別 hash
- リネームは `(rename, name-old, name-new)` op のみ。hash は不変
- tile の位置、つまり値 builtin でない builtin の位置引数（`column(leaf)`、[言語 §1.7.1](./language.md#_1-7-1-構文)）に書いた名前は、slot や `fn` が同じ名前を持っていても（[E0007](./errors.md#e0007-duplicate-definition)）その名前の tile を指し、値の位置（`text(leaf)`・`Card(leaf)`・名前付き引数）では値を指すので、`refs`・`rename`・`remove --cascade` はプログラムがそこで描画する、あるいは読む定義に従う

### 9.5.3 表示時の名前 {#_9-5-3-names-at-display-time}

`kumiki view` で取り出すと hash は人間可読名に戻される（**ラベル**）。

rename が動かすのはラベルであり、定義ではない。remove は定義を終わらせる：その後にその名前で add された定義や、その名前へ rename された定義は、別の定義である。`kumiki rename slot.count total` の後は次のようになる：

- `kumiki view --history slot.total` は、定義が `slot.count` だった間の op（定義を add した op まで遡る）、rename、その後の op を順に列挙する。以前に `slot.total` という名前で、remove された定義の op も列挙されたままである。`slot.count` は、その名前の履歴として、その名前で行われた op を引き続き列挙する。以前に `slot.count` という名前で remove された定義の op もそこに含まれるが、`slot.total` はそれらを列挙しない。
- rename より前の op を `kumiki patch revert` すると、その定義の現在の名前に対して作用する。`slot.count` の `replace` を revert すると、以前の本体が `slot.total` に復元される。その後に別の定義が `slot.count` という名前を取っていても同じである。以前の本体は、op ログがそれを記録した時点で定義が持っていた名前で探される。その本体が定義自身を名指す箇所、すなわち自身の名前と、自身への各参照（再帰する型や fn）は、rename が書き換えるのと同じ位置で、定義の現在の名前で書かれる。したがって復元された本体は、以前の名前を今持っている定義ではなく、自身を参照する。
- 後の op が remove した定義に対する op を `kumiki patch revert` すると、何も書き込む前に拒否され、定義を終わらせた op が名指しされる：`patch revert: <op> replaced slot.count, which is no longer in the file: <op> removed slot.count; nothing was written`。現在その名前を何が持っていても同じである：その後にその名前で add された定義やその名前へ rename された定義は別の定義であり、remove を revert して戻された定義も、op ログにとっては別の定義である。

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

この `edit` op は、`tile.TodoRow` の 2 行目（定義の最初の行から数える）にある最初の `usres` を置き換える。その行に `usres` が無い場合（エラーが報告された後にその行が変わった場合など）、op は失敗した他の書き込みと同じく拒否される（§9.2.5）：終了コードは `1` で、何も書き込まれず、何も記録されず、メッセージはそのテキストと行を名指しする。`{"find": …, "replace": …}` のパッチも、`find` が定義に無いときは同じく拒否される。

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

これはエージェント間の調整の話であり、定義を編集前に予約する者はいない。1 つの `.kumiki` ファイルへの書き込みは別の話で、書き込み系 verb はファイルそのものの上で順番を取る（§9.2.2）。そのため並行する op は反映されるか reject されるかのどちらかで、黙って失われることはない。

### 9.8.3 タスク境界 {#_9-8-3-task-boundaries}

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

ロックは verb が名指しした定義だけでなく、**op が触れるすべての定義**に対して検査される。何に触れたかは verb からではなくソースから読み取る：op が書き込もうとするソースが検証を通った後、前後の定義を修飾名で突き合わせ、追加された定義・削除された定義・本文が変わった定義をすべて検査する。これには `remove --cascade` が取り除く各依存元、`rename` が作る新しい名前と本文を書き換える各定義、そして `replace`・`add`・`edit` の本文が一緒に持ち込む定義（`slot.count` の `replace` で、本文が `slot todosX : Int = 0` という行まで続けば `slot.todosX` が作られる）が含まれる。そのうち 1 つでもロックされていれば op 全体が書き込み前に reject される：ファイルはバイト単位で変わらず、op は記録されず、exit `1` となり、メッセージは修飾名順で最初にロックされていた定義とその所有者を名指しする。名指しされた定義は、何かを書き込む前にも検査される。`patch apply`・`patch revert`・MCP ツールも同じ mutator を通るので、同じ検査を受ける。

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
