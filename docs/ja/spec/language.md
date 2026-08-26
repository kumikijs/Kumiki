# 言語コア仕様

## 1.1 プログラムの全体構造

Kumiki プログラムは **7 種類の定義の集合**である。物理的なファイル境界は存在せず、各定義は次の 4 つ組として content-addressable graph に格納される：

```
(layer, name, body, content-hash)
```

テキスト表現は graph からの projection であり、必要なときに `kumiki view` で取り出せる（→ [AI 編集](./ai-edit.md)）。

```
program     ::= definition*
definition  ::= type-def | slot-def | effect-def | reducer-def | tile-def | fn-def | app-def
```

定義は順不同で前方参照可能。コンパイラがトポロジカルソートを行う。

### 1.1.1 レイヤ一覧 {#_1-1-1-list-of-layers}

| レイヤ | 役割 | 純粋性 |
|---|---|---|
| `type` | 型・スキーマ | 純粋 |
| `slot` | 名前付きグローバル状態 | 純粋初期値 |
| `effect` | 副作用を表す純粋なレコード値 | 純粋（実行は別） |
| `reducer` | message → slot 変更 + effect emit | 純粋（slot 集合上で） |
| `tile` | slot → UI ツリーの純粋投影 | 純粋 |
| `fn` | 補助の純粋関数 | 純粋 |
| `app` | アプリのエントリ | 宣言 |

この 7 つが**ロジック/データ/UI のコア** — 振る舞いを表現するために学ぶべきもの。Kumiki にはこれに加えて、そのコアを膨らませずに傍らに在る**補助的な表示用・メタ定義**がある：`theme`（[デザイントークン](./style.md#_4-2-design-tokens)）、`motion`（[motion 定義](./style.md#_4-9-1-the-motion-definition)）、`test`（[テスト](./testing.md)）。いずれも実在のトップレベル定義だが 7 レイヤーには数えない。上の生成文法 EBNF はコアのみを列挙する。

---

## 1.2 字句

```
identifier  ::= [a-zA-Z][a-zA-Z0-9_-]*           ; 最大 32 文字、最長一致
qname       ::= identifier ('.' identifier)*     ; ドット区切り完全名
cap-name    ::= identifier ('.' cap-segment)*    ; ケイパビリティ。そのセグメントはこの言語の中の何も指さない
cap-segment ::= identifier | keyword             ; ゆえに `telemetry.out` は構文エラーではない
literal     ::= number | string | bool | unit
number      ::= int | float
int         ::= '-'? [0-9]+
float       ::= '-'? [0-9]+ '.' [0-9]+           ; 小数点以下の数字は必須
string      ::= '"' (escape | non-quote-char)* '"'
escape      ::= '\\' ('n' | 't' | 'r' | '"' | '\\' | 'u{' hex+ '}')
bool        ::= 'true' | 'false'
unit        ::= '()'
tuple       ::= '(' expr ',' expr (',' expr)* ')'  ; Tuple が型を付ける値
comment     ::= '#' until-eol                    ; 1 行コメントのみ
```

**`-` は識別子の文字でも引き算でもあり、最長一致で決める。** `-` の直後に識別子文字があれば名前が続き、なければそこで名前が終わる。したがって `page-size` / `base-url` / `on-401` はそれぞれ 1 つの名前であり、`count-1` も同様に 1 つの名前になる — 名前とリテラルの引き算を `count - 1` と書くのはそのためである。`count- 1` も引き算になる（`-` の続く先が無い）。`count -1` が引き算になる理由は別で、空白が `-` に到達する前に名前を終わらせているからである。どこにも解決されない `count-1` は [E0103](./errors.md#e0103-undef-ref-undef-slot) であり、その旨がメッセージに出る。

**両側のどちらかに空白がある `#` は常にコメントを開始する。** セレクタ演算子（[§1.6.1](#_1-6-1-構文)）になるのは、直前の文字が値を終える文字（識別子文字、または閉じる `)` / `]` / `}`）であり、**かつ**直後の文字が識別子を開始する場合だけで、`SaveBtn#new` がその形である。行頭の `#TODO` や `= 0# how many` を含むそれ以外では行末までがコメントになる。したがって `#id` の断片は英字または `_` で始まる — `tile-ref` が元から要求していたとおりである。

**位置情報。** 行の終端は `\n` または `\r\n` であり、単独の `\r` は行内の空白である。列は UTF-16 コードユニットを数えるので、サロゲートペアの文字は列を 2 進める — Language Server Protocol と同じ規約であり、Kumiki の位置を使う側が必要とする規約でもある（パッチはソース行を `column - 1` で分割する）。先頭の BOM が空白として扱われるのも同じ理由で、テキストの一部ではないが分割される文字列の一部ではあるので、1 列を占める。

### 1.2.1 演算子

```
:=  =  ==  !=  <  >  <=  >=
+  -  *  /  %  ->
&&  ||  !            ; bool 演算子
&                    ; `&&` の alias（他言語からの移植容易性のため）
|                    ; 型 union / match arm 区切り（bool OR ではない — `||` を使うこと）
(  )  {  }  [  ]  ,  ;  :  .  #
```

**Bool 演算子の注意**:
- 短絡 AND: `&&`（推奨）または `&`（alias、内部的に同一）
- 短絡 OR : `||`（推奨）または `|`（alias、ただし match arm との衝突を避けるヒューリスティック付き）
- `|` を bool OR として書く場合、後続トークンが「**`Variant`/`_` + `->`**」の組み合わせ（つまり match arm 開始）なら parser は arm separator として優先する。それ以外の expression が続く場合は bool OR として解釈する。安全策として迷ったら `||` を使うこと

### 1.2.2 予約語

```
type  slot  effect  reducer  tile  fn  app
nominal  where  when  for  in  let  if  then  else  match  with
on  do  emit  cap  out  policy  retry
true  false
fresh  self  now  null
```

`null` は予約されているが**プログラム中で使用禁止**（型エラー）。

### 1.2.3 設計判断

- **インデント非依存**: 行頭の空白は無視される
- **改行が文区切り**: `do=` 内のみ `;` で複数文
- **識別子は 32 文字以内**
- **式・型・パターン・tile の木は 256 段まで**: 自分自身を含みうる構文——括弧式・リスト・レコード・`if`・文ブロック・tile 呼び出し・タプルパターン・型適用・theme レコード——はこれ以上深く入れ子にできず、左結合の連鎖（`1 + 1 + 1 + …`、`x.trim().trim()…`、`not` や `-` の連続）もこれを超えるノードを作れない。上限が掛かるのは**出来上がった木**であって、パーサがそこへどう到達したかではない。パース以降の全段階はその木を再帰で辿るため、ループで解析された連鎖であっても下流でスタックを使い切るからである。上限を超えると、パーサが位置付きのエラーを報告する。実際に書かれるものがこの値に近づくことはない——examples と benchmarks のどのプログラムも上限に迫らない。
- **複数行コメント禁止**
- **マクロ禁止**

---

## 1.3 型レイヤ (`type`)

### 1.3.1 構文

```
type-def    ::= 'type' identifier ('(' type-param (',' type-param)* ')')? '=' type-expr
type-param  ::= identifier
type-expr   ::= primitive
              | nominal-type
              | record-type
              | union-type
              | generic-type
              | refinement-type
              | identifier
              | type-app

primitive   ::= 'Text' | 'Int' | 'Float' | 'Bool' | 'Unit' | 'Bytes' | 'Time'
nominal-type ::= 'nominal' type-expr
record-type ::= '{' field (',' field)* '}'
field       ::= identifier ':' type-expr
union-type  ::= variant ('|' variant)+
variant     ::= identifier ( '(' type-expr (',' type-expr)* ')' )?
generic-type ::= identifier '(' type-expr (',' type-expr)* ')'
type-app    ::= identifier '(' type-expr (',' type-expr)* ')'
refinement-type ::= type-expr 'where' pred-expr
pred-expr   ::= identifier ('(' literal (',' literal)* ')')?
```

### 1.3.2 ビルトイン汎化型

```
Map(K, V)
Set(T)
List(T)
Option(T)         ; None | Some(T)
Result(T, E)      ; Ok(T) | Err(E)
Tuple(T1, ..., Tn)
```

### 1.3.3 登録済み refinement 述語

```
nonempty
len-eq(N)         len-lt(N)         len-gt(N)
between(A, B)
positive          negative
email             url               uuid
regex("pattern")
one-of(v1, v2, ...)
```

任意 Boolean 述語は禁止。理由：AI が証明を書く必要が生じるとデバッグループが壊れる。

### 1.3.4 例

```kumiki fragment
type UserId    = nominal Text where len-eq(36)
type Email     = nominal Text where email
type Url       = nominal Text where url
type Percent   = nominal Float where between(0.0, 100.0)
type User      = {id: UserId, name: Text where nonempty, email: Email}
type HttpError = {status: Int where between(400, 599), message: Text}
type LoadResult(T) = Idle | Loading | Loaded(T) | Failed(HttpError)
```

### 1.3.5 型の一意化

構造的に同一の型は同一 content-hash を持つ。`nominal` のみが新 hash を生む。

`nominal` 型を同定するのは **宣言された名前** である。したがって同じ基底型に対する 2 つの宣言は、body が同一であっても 2 つの型である：

```kumiki fragment
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
```

`Cents` と `Yen` は互いを受理しない。一方を他方の要求される位置に置くことは [E0201](./errors.md#e0201-type-mismatch) であり、`nominal Text where uuid` を 2 つ宣言したうえでの `postId := userId` も同様である。nominal への別名は同じ型を指し（`type Money = Cents`）、使用位置に直接書かれた `nominal` は名前を宣言しないので、他の型式と同じく構造的に比較される。

nominal と **その基底型** は双方向に互いを受理する。これが `slot c : Cents = 1` を構築形式なしで成立させており、算術は基底型を返すので（[§1.9](#_1-9-式言語)）`c := c + 1` もそのまま通る。ある nominal を別の nominal へ意図的に変換する手段でもある：nominal を戻り型に宣言した `fn` は、その基底型の body を受理する。

```kumiki fragment
fn toYen(c: Cents, rate: Int) -> Yen = c * rate
```

`where` の refinement 自体は同定に寄与せず（`type Positive = Int where positive` は `Int` である）、runtime の検査のままである（[Forms §5.6](./forms.md#_5-6-バリデーション戦略)）：`slot e : Email = "not-an-email"` はここでは受理され、バリデーションで失敗する。

---

## 1.4 ストアレイヤ (`slot`)

### 1.4.1 構文

```
slot-def    ::= 'slot' identifier ':' type-expr modifier? '=' init-expr
modifier    ::= 'transient' | 'volatile'
init-expr   ::= literal | record-literal | collection-literal | builtin-call
```

| modifier | 意味 |
|---|---|
| (なし) | ホットリロード時に維持・永続化対象 |
| `transient` | ホットリロード時に破棄 |
| `volatile` | episode log に書かれない、ホットリロード時に破棄 |

modifier は最大 1 つ。`volatile` は `transient` がすることをすべて含むので、両方を並べても `volatile` 単独が言っていない事は何も言わない。

初期値は必須。`=` の無い slot は、プログラムが最初に書き込むまで何かを保持していなければならないが、言語にその値が無い — null も、型ごとのゼロ値も無い。

### 1.4.2 不変条件

1. **全 slot がグローバル**
2. 書き換えは **reducer の `do=` からのみ**
3. 初期値は **純粋式のみ**（effect 実行不可）
4. **派生 slot は禁止**（派生計算は `fn` レイヤを使う）

### 1.4.3 例

```kumiki fragment
slot todos       : Map(TodoId, Todo)              = {}
slot filter      : Filter                         = All
slot draft       : Text where len-lt(280)         = ""
slot session     : Option(SessionId)              = None
slot password    : Text                volatile   = ""
slot toast       : Option(Toast)       transient  = None
```

---

## 1.5 副作用レイヤ (`effect`)

### 1.5.1 構文

```
effect-def  ::= 'effect' identifier
                'cap' '=' capability-name
                'in'  '=' type-expr
                'out' '=' type-expr
                ('policy'      '=' policy-expr)?
                ('retry'       '=' retry-expr)?
                ('map-request' '=' map-expr)?

capability-name ::= identifier ('.' identifier)+
policy-expr     ::= 'latest' | 'latest-per-key' '(' expr ')' | 'queue'
                  | 'debounce' '(' duration ')' | 'throttle' '(' duration ')'
                  | 'once'
retry-expr      ::= 'none' | 'linear' '(' int ',' duration ')'
                  | 'exponential' '(' int ',' duration ',' float ')'
duration        ::= int 'ms' | int 's' | int 'm'
map-expr        ::= record-literal       ; 高レベル effect → 低レベル形式への変換
```

### 1.5.2 意味

- effect は **値**（純粋なレコード）
- reducer は `emit name(args)` で放出
- 実行は **runtime の effect dispatcher**
- 実行前に **capability check**（未宣言なら**コンパイル時エラー**）
- 結果は `effect-name.ok($value, $key)` または `effect-name.err($error, $key)` として reducer に届く

### 1.5.3 例

```kumiki fragment
effect loadUser  cap=http.get
                 in=UserId
                 out=Result(User, HttpError)
                 policy=latest-per-key($1)
                 retry=exponential(3, 200ms, 2.0)

effect persist   cap=storage.write
                 in=Map(TodoId, Todo)
                 out=Result(Unit, Text)
                 policy=debounce(300ms)
                 map-request={key: "todos", value: $1}
```

---

## 1.6 リデューサレイヤ (`reducer`)

### 1.6.1 構文

```
reducer-def ::= 'reducer' identifier
                'on' '=' event-pattern
                'do' '=' do-block

event-pattern ::= ui-event | effect-event | timer-event | lifecycle-event | route-event
ui-event      ::= 'ui' '.' ui-kind '(' selector ')'
ui-kind       ::= 'click' | 'submit' | 'change' | 'input' | 'focus' | 'blur' | 'key' | 'hover'
selector      ::= tile-ref
tile-ref      ::= identifier ('#' identifier)?    ; TileName または TileName#id
effect-event  ::= identifier '.' ('ok' | 'err') '(' bind (',' bind)* ')'
timer-event   ::= 'timer' '(' duration ')'   ; intervalMs ごとに当該 reducer を発火
lifecycle-event ::= 'app.start' | 'app.stop' | 'app.error'
                  | 'app.visible' | 'app.hidden' | 'app.online' | 'app.offline'
                  | 'app.http-401' | 'app.http-403' | 'app.http-5xx'
                  | 'tile.mount' '(' identifier ')'
                  | 'tile.unmount' '(' identifier ')'
route-event   ::= 'route.enter' '(' string ')'
                | 'route.leave' '(' string ')'
                | 'route.error' '(' string ')'
bind          ::= '$' identifier

do-block      ::= statement-list
statement-list ::= statement ((';' | newline) statement)*
statement     ::= assign | emit | let-stmt | if-stmt | match-stmt | for-stmt | block
assign        ::= lvalue ':=' expr
emit          ::= 'emit' identifier '(' (expr (',' expr)*)? ')'
let-stmt      ::= 'let' identifier '=' expr
if-stmt       ::= 'if' expr 'then' stmt-body ('else' stmt-body)?
match-stmt    ::= 'match' expr 'with' ('|' pattern '->' stmt-body)+
for-stmt      ::= 'for' identifier 'in' expr stmt-body
block         ::= '{' statement-list '}'
stmt-body     ::= block | statement-list   ; 改行ベース。`else` / `|` / `}` で停止
lvalue        ::= path
path          ::= identifier
                | path '.' identifier        ; field path（Option/Result は自動展開）
                | path '[' expr ']'          ; index/key path
```

**`stmt-body` の形**:
- 単一文: `if cond then x := 1 else x := 2`
- 多文 (block): `if cond then { x := 1; y := 2 } else x := 3`
- 多文 (改行): `else` / `|` / `}` / EOF に到達するまで改行/`;` 区切りで連続

つまり 1 行レイアウトと block レイアウトを混在して書ける。改行ベースで書く場合は、後続文が次のキーワード（`else` 等）で止まる位置に来るよう改行を入れるだけで OK。

### 1.6.2 セレクタ

セレクタは **`TileName`** または **`TileName#id`** のみ（CSS 属性セレクタは廃止）。

```kumiki snippet
reducer add     on=ui.click(AddBtn)         do= ...
reducer toggle  on=ui.click(TodoRow)        do= ...
reducer login   on=ui.submit(form#login)    do= ... # ❌ 'form' は組み込み要素、tile 名ではない
```

組み込み要素（`button`, `input`, `form` 等）にイベントを直接バインドするには、**ラッパ tile を作る**：

```kumiki snippet
tile LoginForm = form(...) {id: "main"}

reducer doLogin
    on=ui.submit(LoginForm)         # tile 名で参照
    do= emit login({...})
```

**`TileName#id`** は、dispatch された要素の `{id}` プロップが `id` と一致する場合だけ subscription を発火させる。`TileName` だけの reducer は全インスタンスに対して発火するが、`#id` 付き reducer はランタイムが id 一致を確認した時のみ発火する。同じ組み込み要素をラップする tile が複数ある状況で意図を明示し、別の tile が誤って同じ reducer を起動するのを防ぐために使う:

```kumiki snippet
tile NewForm  = form(submit-text="add",  text=draft.new)  {id: "new"}
tile EditForm = form(submit-text="save", text=draft.edit) {id: "edit"}

reducer add  on=ui.submit(NewForm#new)   do= ...   # "new" form のみ
reducer save on=ui.submit(EditForm#edit) do= ...   # "edit" form のみ
```

`{id}` プロップは要素のネイティブ HTML `id` 属性としても出力される。§1.6.4 Invariant 3 のマルチ reducer ルールは引き続き適用され、同じイベントにマッチする `TileName` 単体 reducer と `#id` 付き reducer は定義順で実行される。

### 1.6.3 lvalue の意味論

lvalue は **path** であり、ネストしたフィールドや Option の中身を直接書き換えられる。コンパイラが immutable update に展開する。

```kumiki snippet
# これらの reducer 文は:
todos[id].done := true
editor.title := "New"
editor.get.body := "Body"        # Option 経由（コンパイラが Option.map に展開）

# 内部的にこう展開される:
todos := todos.update(id, $1.copy(done=true))
editor := editor.copy(title="New")
editor := editor.map($1.copy(body="Body"))
```

**`.get` 経由は安全**: Option が `None` のときの代入は no-op（panic しない）。明示的に panic させたい場合は `editor := Some(editor.get.copy(body="Body"))` と書く。

**`.copy(field=value, ...)`**: record の immutable update を行うショートカット。method 呼び出しに見えるが、内部的には named-arg を集めて `recordCopy(rec, {field: value, ...})` に展開される。複数 field を 1 度に更新できる：

```kumiki snippet
editor := editor.copy(title="New", body="Body", updatedAt=now)
issue.copy(status=Done, priority=High)
```

### 1.6.4 不変条件

1. **純粋関数**: 入力 = (slot 集合, event payload)、出力 = (新 slot 値, emit 集合)
2. **effect の直接実行は不可**。`emit` で放出のみ
3. **同一 event にマッチした複数 reducer は定義順で実行**
4. **同じ lvalue path に対する書き込みは 1 reducer 内で 1 回まで** (path-shape granularity, E0601)
   - 重複判定は path の **形** で行う。`issues[k].status` と `issues[k].updatedAt` は別 path → 共存可
   - 同じ shape を 2 回書くのは違反: `x := 1; x := 2` ✗
   - `if/match` の **排他分岐内では各分岐ごとに独立にカウント**。同じ shape を then と else の両方で書いても OK（実行時はどちらか一方しか走らない）
   - 例:
     - `issues[iid].status := s; issues[iid].updatedAt := now` ✓ (異なる field path)
     - `if cond then x := 1 else x := 2` ✓ (排他分岐)
     - `x := 1; x := 2` ✗ (同 path シーケンシャル)
     - `if cond then x := 1 else x := 2; x := 3` ✗ (排他分岐合算後にさらに同 path)
   - 同じ shape でも index 値が違う (`m[k1]` と `m[k2]`) のは静的判定不能なため 1 write として扱う（厳しい側）。複数 key を更新したい場合は `for` ループを使う
5. **`fn` 呼び出しは可能**（純粋なので安全）
6. **バッチは全部通るか全部通らないか**: どれか 1 つの slot の新しい値がその型の refinement に違反したら、その reducer 適用は丸ごと破棄される — slot 書き込みなし、`emit` なし、`stop-timer` なし — そして拒否が報告される（[batching](./runtime.md#a-batch-commits-all-or-nothing) 参照）。到達しうる境界はプログラム側の責任である。ガードは自分で書く
   - `Volume = nominal Int where between(0, 11)` に対する `volume := volume + 1` は 11 で ✗（拒否され、報告される）
   - `if volume < 11 then volume := volume + 1` ✓

### 1.6.5 positional binding

| 構文 | 意味 |
|---|---|
| `$1`, `$2`, ... | `effect-event` の bind 順、`fn` 内では引数順 |
| `$el` | イベント発火元 tile の `{...}` props |
| `$event` | イベントペイロード |
| `$route` | route.enter / route.leave / route.error 時の Route と、link のプリフェッチ対象 — それ以外では束縛されない（[ルーティング §3.4](./routing.md#_3-4-ルートライフサイクル)）。他の reducer は `route` slot を読む |
| `$now` | 現在時刻 |

### 1.6.6 例

```kumiki fragment
reducer addTodo
    on=ui.submit(NewTodoForm)
    do= let id = TodoId.fresh()
        todos[id] := {id, text=draft, done=false, createdAt=now}
        draft := ""
        emit persist(todos)

reducer toggle
    on=ui.click(TodoRow)
    do= todos[$el.todoId].done := not todos[$el.todoId].done
        emit persist(todos)

reducer loaded
    on=loadUser.ok($user, $id)
    do= users[$id] := Loaded($user)

reducer editTitle
    on=ui.input(TitleInput)
    do= editor.get.title := $event.value
```

---

## 1.7 ビューレイヤ (`tile`)

### 1.7.1 構文

```
tile-def     ::= 'tile' identifier
                 ('in' '=' type-expr)?
                 ('sub-routes' '=' route-map)?
                 ('error-boundary' '=' identifier)?
                 ('scroll-restoration' '=' bool)?
                 '=' tile-expr

tile-expr    ::= tile-call
               | match-expr
               | control-flow

tile-call    ::= identifier '(' (tile-arg (',' tile-arg)*)? ')' ('{' prop (',' prop)* '}')?
tile-arg     ::= (identifier '=')? expr
prop         ::= identifier ':' expr

control-flow ::= when-expr | for-expr | if-expr
when-expr    ::= 'when' '(' expr ',' tile-expr ')'
for-expr     ::= 'for' identifier 'in' expr tile-expr
if-expr      ::= 'if' expr 'then' tile-expr 'else' tile-expr

match-expr   ::= 'match' expr 'with' match-arm+
match-arm    ::= '|' pattern '->' tile-expr
pattern      ::= identifier
               | identifier '(' bind (',' bind)* ')'
               | '_'
```

**`when(cond, tile)` のセマンティクス**:
- `cond` が真 → `tile` をレンダリング
- `cond` が偽 → **当該子要素を tree から省略**（兄弟への影響なし）
- 親 tile が `column(A, when(c, B), C)` の場合、`c=false` なら `[A, C]` がレンダリングされる
- ランタイムは null/undefined 子を skip するため、`when` で「空欄」を生む安全な手段

**`match` の値文脈 vs tile 文脈**:
- `text/heading/markdown/label/link/image/icon` builtin の **位置引数内** での `match` は値式（`MatchExpr`）として扱われる。各 arm は値（Text, Int, etc.）を返す
- それ以外の tile 引数内（`column`, `row`, `card` 等）の `match` は tile 式（`TileMatch`）として扱われる。各 arm は tile を返す
- 例: `text(match m with | A -> "a" | B -> "b")` ← 値 match
- 例: `column(match xs with | Loaded(ys) -> ... | None -> spinner())` ← tile match

### 1.7.2 不変条件

1. **純粋関数**: 入力 = (slot 集合, in 引数)、出力 = UI ツリー
2. slot 書き込み不可
3. effect emit 不可
4. **直接再帰禁止**。相互再帰は型レベルで深さ証明できるときのみ
5. `for` のイテレート対象は `Map.keys`, `Set.to-list`, `List` のみ
6. tile プロパティ `{...}` の値式中で **slot を読むのは可**（イベントハンドラ引数の固定キャプチャ用途）
7. **`fn` 呼び出し可**

### 1.7.3 イベントハンドラ props

イベントハンドラは **reducer 名を渡す**：

```kumiki snippet
button(text="Save", onClick=saveTodo) {todoId: $1}
```

`onClick=saveTodo` で reducer `saveTodo` がクリック時に呼ばれる。`{todoId: $1}` は `$el.todoId` として reducer に届く。

### 1.7.4 例

```kumiki fragment
tile TodoRow  in=TodoId
              = row(
                  check(value=todos[$1].done, onClick=toggle) {todoId: $1},
                  text(todos[$1].text) {strike: todos[$1].done},
                  button(text="x", onClick=remove) {todoId: $1})

tile TodoList = column(
                  for id in todos.keys
                    when(matchFilter(todos[id], filter),
                      TodoRow(id) {key: id.show}))

tile App      = page(
                  heading("Todos"),
                  NewTodoForm,
                  TodoList,
                  text(itemsLeft.show + " items left"))
```

---

## 1.8 関数レイヤ (`fn`)

### 1.8.1 目的

純粋な補助計算を名前付きで再利用する。tile / reducer / 他 fn から呼べる。

### 1.8.2 構文

```
fn-def      ::= 'fn' identifier
                '(' (fn-param (',' fn-param)*)? ')'
                ('->' type-expr)?               ; 戻り値型（省略時は推論）
                '=' expr

fn-param    ::= identifier ':' type-expr
```

### 1.8.3 不変条件

1. **純粋関数**: 入力 = 引数のみ、出力 = 値のみ
2. **slot 読み書き禁止**（`fn` 引数を経由して受け取る）
3. **effect emit 禁止**
4. **lvalue 不可**（代入なし）
5. **他の fn の呼び出しは可**、**直接再帰は禁止**、相互再帰は型レベルで深さ証明できるときのみ

### 1.8.4 例

```kumiki fragment
fn matchFilter(t: Todo, f: Filter) -> Bool
   = match f with
       | All     -> true
       | Active  -> not t.done
       | Done    -> t.done

fn itemsLeft(ts: Map(TodoId, Todo)) -> Int
   = ts.filter(not $2.done).size

fn visiblePosts(posts: Map(PostId, LoadResult(Post)), tag: Option(Text)) -> List(PostId)
   = posts.entries
          .filter(matchPostTag($2, tag))
          .sort-by(loadedAt($2))
          .map($1)

fn matchPostTag(lr: LoadResult(Post), tag: Option(Text)) -> Bool
   = match (lr, tag) with
       | (Loaded(p), Some(t)) -> p.tags.find($1 == t).is-some
       | (Loaded(_), None)    -> true
       | _                    -> false
```

### 1.8.5 tile / reducer からの呼び出し

```kumiki fragment
tile TodoList = column(
                  for id in todos.keys
                    when(matchFilter(todos[id], filter), TodoRow(id)))

tile Counter  = text("Left: " + itemsLeft(todos).show)

reducer normalize
    on=ui.click(NormalizeBtn)
    do= todos := normalizeAll(todos)

fn normalizeAll(ts: Map(TodoId, Todo)) -> Map(TodoId, Todo)
   = ts.map($2.copy(text=$2.text.trim))
```

### 1.8.6 部分適用と高階関数

ラムダがないため、高階関数渡しは「fn 名」または「式断片」を使う：

```kumiki snippet
items.map(double)         # 登録済み fn 名
items.map($1 * 2)         # 式断片（$1 は要素）
items.filter(matchFilter($1, filter))  # fn 呼び出しを式断片に埋め込む
```

部分適用は **明示的に書く**（カリー化なし）：

```kumiki snippet
fn isActiveOnly(t: Todo) -> Bool = matchFilter(t, Active)
items.filter(isActiveOnly)
```

---

## 1.9 式言語

reducer の `do=` 右辺、tile の中、fn の本体で使う共通式。

```
expr        ::= literal
              | qname                          ; slot, let-binding, fn-arg, builtin 参照
              | expr '.' identifier            ; field access
              | expr '[' expr ']'              ; index
              | expr binop expr
              | unop expr
              | 'if' expr 'then' expr 'else' expr
              | 'match' expr 'with' match-arm+
              | 'let' identifier '=' expr 'in' expr
              | call
              | record-lit
              | collection-lit
              | '(' expr ')'

call        ::= qname '(' (expr (',' expr)*)? ')'
record-lit  ::= '{' (field-init (',' field-init)*)? '}'
field-init  ::= identifier '=' expr | identifier
collection-lit ::= '[' (expr (',' expr)*)? ']'
                 | '{' (entry (',' entry)*)? '}'
entry       ::= expr ':' expr

match-arm   ::= '|' pattern '->' expr
pattern     ::= identifier
              | identifier '(' bind (',' bind)* ')'
              | '(' pattern (',' pattern)* ')'        ; tuple
              | '_'

binop       ::= '+' | '-' | '*' | '/' | '%'
              | '==' | '!=' | '<' | '>' | '<=' | '>='
              | '&' | '|'
unop        ::= '-' | '!'
```

### 1.9.1 禁止事項

- **ラムダ式禁止**
- **`try/catch` 禁止**
- **`null` / `undefined` 禁止**
- **`while` ループ禁止**
- **代入式禁止**（`:=` は statement、式中で使えない）
- **リテラルパターン禁止。** `match` のパターンは union の variant、`Variant(binds)`、tuple、`_` の **いずれか**だけ。リテラル値に対するパターン（`match s with | "Overdue" -> … | "Today" -> …` や数値・真偽値リテラル）は **サポートされず**、パースに失敗する。`match` は *union / variant* を分解するためのものであり、`Text` / `Int` / `Bool` の値で分岐するためのものではない。値で分岐するなら `if/else`（あるいは `if` の連鎖）を使うか、ケースを union 型として表して variant に対して match する：

```kumiki snippet
# ❌ リテラルパターン — サポートされない
match label with | "Overdue" -> red | "Today" -> amber | _ -> gray

# ✅ if/else で値によって分岐する
if label == "Overdue" then red else if label == "Today" then amber else gray

# ✅ あるいはケースを union に持ち上げて variant に match する
type Urgency = Overdue | Today | Later
match urgency with | Overdue -> red | Today -> amber | Later -> gray
```

### 1.9.2 高階関数の代わり

```kumiki snippet
items.map($1 * 2)                          # 式断片
items.map(formatPrice)                     # fn 名
items.filter(matchFilter($1, filter))      # fn 呼び出し
items.fold(0, $1 + $2.price)               # ($1: acc, $2: elem)
```

### 1.9.3 短絡評価

`&` と `|` は短絡評価。

### 1.9.4 演算子の型

各演算子のオペランド型と結果型。コンパイラが検査する（[E0201](./errors.md#e0201-type-mismatch)）：

| 演算子 | オペランド | 結果 |
|---|---|---|
| `+` | どちらか一方が `Text` | `Text` — 連結。もう一方は文字列化される |
| `+` `-` `*` `%` | 両方が数値 | どちらかが `Float` なら `Float`、そうでなければ `Int` |
| `/` | 両方が数値 | **常に `Float`** |
| `<` `>` `<=` `>=` | 両方が数値、両方が `Text`、または両方が `Time` | `Bool` |
| `&` `\|` | 両方が `Bool` | `Bool` |
| `==` `!=` | 任意の 2 値 | `Bool` |
| 単項 `-` | 数値 | オペランドと同じ型 |
| 単項 `!` | `Bool` | `Bool` |

`/` は `Int` 同士でも `Float` である。runtime では JavaScript の `/` そのもので、`5 / 2`
は `2` ではなく `2.5` になる — 結果型を `Int` と宣言することは runtime が守らない約束をす
ることであり、`fn half(x: Int) -> Int = x / 2` は拒否される。整数が欲しい箇所では `.to-int`
（切り捨て。[stdlib §2.2.7](./stdlib.md#_2-2-7-int-float)）を取るか、`Float` を宣言する。

`EffectId` はこの表の外にある：適用できるのは `==` と `!=` だけである
（[E0204](./errors.md#e0204-effect-id-misuse)）。

---

## 1.10 名前空間と参照解決

- **フラットなグローバル名前空間**
- レイヤごとに別名前空間
- 参照は **名前で書き**、CRDT graph 保存時に content-hash に解決
- リネーム = 新名で別 hash を作り参照を更新する CRDT op

→ [AI 編集](./ai-edit.md)

---

## 1.11 content-hash 計算

```
hash(def) = blake3(
    canonical(def.body)
  ⊕ hash(direct-dependency-1)
  ⊕ hash(direct-dependency-2)
  ⊕ ...
)
```

---

## 1.12 アプリエントリ (`app`)

```
app-def    ::= 'app' identifier
               'caps'   '=' '[' (capability-name (',' capability-name)*)? ']'
               'routes' '=' route-map
               ('init'  '=' '[' emit-list ']')?
               ('theme' '=' identifier)?
               ('http'  '=' http-config)?
               ('meta'  '=' meta-config)?
               ('indexed-db' '=' idb-config)?
               ('analytics'  '=' analytics-config)?

route-map  ::= '{' route-entry (',' route-entry)* '}'
route-entry ::= string '->' identifier        ; tile 名へ
              | string '->>' string           ; 静的リダイレクト
emit-list  ::= effect-call (',' effect-call)*
```

→ [ルーティング](./routing.md), [HTTP / Storage](./http.md)

```kumiki fragment
app TodoApp
    caps   = [storage.read, storage.write, http.get]
    routes = {"/" -> TodoList, "/todo/:id" -> TodoDetail, "/404" -> NotFound}
    init   = [loadTodos()]
    theme  = DefaultTheme
```

### 1.12.1 `init` の引数が評価されるタイミング {#_1-12-1-when-init-arguments-are-evaluated}

`init` の各エントリは effect 呼び出しであり、その引数は通常の式である。slot 参照も書ける。引数は app オブジェクトの構築時に**一度だけ**評価され、得られた値が読み直されることはない。後から slot が変わっても、すでに捕捉された引数には反映されない。

その時点で slot 参照が見るのは**宣言時の初期値**である。`route` だけは例外で、runtime が管理していてまだ存在しないため、`init = [load(route.path)]` はコンパイルエラーになる（[E0120](./errors.md#e0120-route-in-app-init)）。`$route` も同様に、ここでは runtime が束縛しない。route が必要なら `route.enter` reducer 側で受け取ること。

`now` は使えるが、捕捉のされ方は同じ — app オブジェクトが構築された瞬間に評価され、effect が走る瞬間ではない。dispatch 時点の時刻が要るなら、結果を受ける reducer 側で取ること。

引数の周りに reducer も無いので、`emit` 式もここでは使えない（[E0305](./errors.md#e0305-fn-impurity)）。エントリそのものが dispatch である。

---

## 1.13 反例

```kumiki snippet
# ❌ ローカル状態
tile Foo = let x = 0 in button(text=x.show)   # tile 内で代入は不可（let で式束縛は可、slot 代わりにはならない）

# ❌ effect の直接呼び出し
reducer r on=ui.click(B) do= http.get("/")   # emit 必須

# ❌ ラムダ
button(onClick=(() -> count + 1))            # 不可、reducer 名のみ

# ❌ null
type User = {name: Text | null}              # Option(Text) を使う

# ❌ 任意述語
type Even = Int where ($1 % 2 == 0)          # 登録済み述語のみ

# ❌ fn 内で slot 読む
fn current() = todos                          # fn 引数で受け取れ

# ❌ CSS 属性セレクタ
reducer r on=ui.change(input[type=file]) do= ...   # tile 名で書け
```

---

## 1.14 完全例: Counter

```kumiki
type N      = nominal Int where between(0, 999)
slot count  : N    = 0

reducer inc   on=ui.click(IncBtn)   do= if count < 999 then count := count + 1
reducer dec   on=ui.click(DecBtn)   do= if count > 0   then count := count - 1
reducer reset on=ui.click(ResetBtn) do= count := 0

tile IncBtn   = button(text="+")
tile DecBtn   = button(text="-")
tile ResetBtn = button(text="reset")

tile App = column(
             heading("Count: " + count.show),
             row(DecBtn, ResetBtn, IncBtn) {gap: "sm"})

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

→ [標準ライブラリ](./stdlib.md), [ルーティング](./routing.md), [01-counter](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/01-counter/app.kumiki)
