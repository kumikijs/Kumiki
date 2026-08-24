# 標準ライブラリ

Kumiki の標準ライブラリは「**最小完備**」を目標に設計されている。同じ目的の関数を複数提供しない（AI の選択を曖昧にしないため）。

## 2.1 ビルトイン型

### 2.1.1 プリミティブ

| 型 | 表現 | リテラル例 |
|---|---|---|
| `Text` | UTF-8 文字列 | `"hello"` |
| `Int` | 64bit 整数 | `42`, `-7` |
| `Float` | 64bit 浮動小数 | `3.14`, `-0.5` |
| `Bool` | 真偽値 | `true`, `false` |
| `Unit` | 単一値 | `()` |
| `Bytes` | バイト列 | リテラルなし、`Bytes.from-text(text)` / `Bytes.from-base64(text)` / `Bytes.from-bytes(list)` で生成（§2.2.10 参照） |
| `Time` | UNIX ナノ秒 | リテラルなし、`now` または `Time.parse(text)` |
| `EffectId` | `emit` が返す不透明ハンドル（§2.1.1.1 参照） | リテラルなし、`EffectId.none` |

#### 2.1.1.1 `EffectId`

`EffectId` は dispatched effect を 1 件指す不透明ハンドル。`emit` を式として使うと返ってくる:

```
let id = emit fetchQuote()
```

`EffectId` 上で定義されている操作は等価比較（`==` / `!=`）と `EffectId` 型 slot への代入のみ。算術・順序比較・`text(...)` での描画はコンパイル時に拒否される（[E0204](./errors.md#e0204-effect-id-misuse)）。

`EffectId.none` はセンチネル値（空ハンドル）。`EffectId` 型 slot の安全な初期値で、`emit cancel(...)` に渡しても実行時エラーではなく no-op になる。slot を実 `EffectId` で上書きしたあとは、その slot を `cap=http.cancel` の effect に渡すことで対応 effect をキャンセルできる（[HTTP §6.4](./http.md#_6-4-cancellation) 参照）。

### 2.1.2 汎化型

| 型 | 用途 |
|---|---|
| `Map(K, V)` | キーは Eq、値は任意 |
| `Set(T)` | T は Eq |
| `List(T)` | 順序あり、インデックスアクセス可 |
| `Option(T)` | `None` または `Some(T)` |
| `Result(T, E)` | `Ok(T)` または `Err(E)` |
| `Tuple(T1, ..., Tn)` | 固定長 |

### 2.1.3 ドメイン型（標準提供） {#_2-1-3-domain-types-provided-by-the-standard-library}

| 型 | 定義 |
|---|---|
| `HttpStatus` | `nominal Int where between(100, 599)` |
| `HttpError` | `{status: HttpStatus, message: Text, body: Option(Text)}` |
| `Url` | `nominal Text where url` |
| `Email` | `nominal Text where email` |
| `Uuid` | `nominal Text where uuid` |
| `Duration` | `nominal Int` (ナノ秒) |
| `Route` | `{path: Text, pattern: Text, params: Map(Text, Text), query: Map(Text, Text), hash: Option(Text)}` — [ルーティング §3.2](./routing.md#_3-2-current-route-state) 参照 |
| `FormData` | `Map(Text, FormValue)` |
| `FormValue` | `TextV(Text) \| NumberV(Float) \| BoolV(Bool) \| FileV(File)` |
| `File` | `{name: Text, size: Int, type: Text, content: Bytes}` |
| `PanicInfo` | `{message: Text, location: Text, episode-id: Text, cause: Option(Text), category: Text}` — `app.error` および `error-boundary` tile の `in=` に渡る値 |

---

## 2.2 コレクションメソッド

### 2.2.1 Map(K, V)

```
keys                        : List(K)
values                      : List(V)
entries                     : List(Tuple(K, V))  ; 実装上 [[k, v], ...] の配列
size                        : Int
is-empty                    : Bool
has(k)                      : Bool
get(k)                      : Option(V)
get-or(k, default)          : V
insert(k, v)                : Map(K, V)        ; 純粋。新 Map を返す
remove(k)                   : Map(K, V)
update(k, expr)             : Map(K, V)        ; expr の中で $1 が現在値
merge(other)                : Map(K, V)
filter(pred)                : Map(K, V)        ; pred の中で $1=key, $2=value
map(expr)                   : Map(K, V')       ; expr の中で $1=key, $2=value
```

`.entries` は `List(Tuple(K, V))` として **2 要素配列の列**を返す。後続の `map` / `sort-by` / `filter` lambda はランタイム destructure により `$1=key, $2=value` で扱える：

```kumiki fragment
fn sortedByCreatedAt(m: Map(Id, Item)) -> List(Id)
   = m.entries.sort-by($2.createdAt).map($1)
```

`get-or` は **Option 用にも使える** polymorphic method:

```kumiki snippet
m.get-or(k, default)         # Map: 値がなければ default
opt.get-or(default)          # Option: None なら default、Some(v) なら v
```

`.filter` は **List と Map の両方に対して使え**、ランタイムが受信側の型を見て自動振り分けする (polymorphic dispatch)：
- 受信側が List → 各要素について `pred($1)` を評価、`true` の要素だけ残す
- 受信側が Map  → 各エントリについて `pred($1, $2)` (key, value) を評価、`true` のエントリだけ残す

例えば `m.keys.filter(...)` のようにチェーンしたとき、`m.keys` は `List(K)` を返すため `filter` は List のシグネチャで動く。混在チェーンを書いても型に応じた挙動になる。

### 2.2.2 Set(T)

```
size                        : Int
has(x)                      : Bool
add(x)                      : Set(T)
remove(x)                   : Set(T)
toggle(x)                   : Set(T)
union(other)                : Set(T)
intersect(other)            : Set(T)
diff(other)                 : Set(T)
to-list                     : List(T)
```

### 2.2.3 List(T)

```
length                      : Int
is-empty                    : Bool
get(i)                      : Option(T)
head                        : Option(T)
tail                        : List(T)
last                        : Option(T)
push(x)                     : List(T)
prepend(x)                  : List(T)
concat(other)               : List(T)
slice(start, end)           : List(T)
reverse                     : List(T)
sort                        : List(T)          ; T は Ord
sort-by(expr)               : List(T)
unique                      : List(T)
map(expr)                   : List(T')
filter(pred)                : List(T)
contains(x)                 : Bool
find(pred)                  : Option(T)
fold(init, expr)            : Acc              ; expr の中で $1=acc, $2=elem
join(sep)                   : Text             ; T が Text
chunk(n)                    : List(List(T))
zip(other)                  : List(Tuple(T, U))
```

**括弧なしショートカット**: 引数なしメソッド（`is-empty` / `length` / `reverse` / `sort` / `unique` / `head` / `tail` / `last`）は **`()` を省略して field のように書ける**：

```kumiki fragment
slot todos : List(Todo) = []
fn count() -> Int = todos.length              # 括弧なし OK
fn empty() -> Bool = todos.is-empty           # 同上
fn norm() -> List(Todo) = todos.reverse       # 同上
```

> **dispatch 規則.** `recv.m` は名前ではなく `recv` の**推論型**で dispatch される：`recv` が `m` という名のフィールドを持つ record ならフィールドを読み、`m` メソッドを持つ stdlib 型ならショートカットを使う。よってメソッドと同名の record フィールド（`{head, …}` への `node.head`）はフィールドとして読まれ、shadow されない。受け手型が**既知**で `m` がフィールドでもメンバーでもないときはコンパイルエラー（[エラー E0108](./errors.md#e0108-undef-member)）。受け手型が推論できないとき（例：型のない reducer payload）は従来の名前ベース dispatch を使う。

**`map` / `filter` / `sort-by` の lambda 引数**:
- List 要素には `$1` を、`.entries` 後の `[k, v]` ペアには `$1=key, $2=value` を束縛します（ランタイムが自動 destructure）
- 例: `m.entries.sort-by($2.createdAt).map($1)` で `$1=key`, `$2=value`

### 2.2.4 Option(T)

```
is-some                     : Bool
is-none                     : Bool
get                         : T               ; None なら panic（reducer 内のみ許可）
get-or(default)             : T
map(expr)                   : Option(T')
flat-map(expr)              : Option(T')
filter(pred)                : Option(T)
or(other)                   : Option(T)
to-list                     : List(T)
```

### 2.2.5 Result(T, E)

```
is-ok                       : Bool
is-err                      : Bool
get                         : T               ; Err なら panic
get-err                     : E               ; Ok なら panic
get-or(default)             : T
map(expr)                   : Result(T', E)
map-err(expr)               : Result(T, E')
flat-map(expr)              : Result(T', E)
or(other)                   : Result(T, E)
to-option                   : Option(T)
```

> **panic 意味論.** `Option.get` / `Result.get`（多相 unwrap、カッコ無しで `value.get` とも書ける）は空ケース（`None` / `Err`）で panic し、`Result.get-err` は `Ok` で panic する。いずれも live runtime が扱う唯一の制御された panic シグナルを送出する — [エラー処理](./lifecycle.md#_7-2-error-handling) を参照。reducer 外では `get-or(default)` を推奨。

### 2.2.6 Text

```
length                      : Int
is-empty                    : Bool
upper                       : Text
lower                       : Text
trim                        : Text
starts-with(s)              : Bool
ends-with(s)                : Bool
contains(s)                 : Bool
split(sep)                  : List(Text)
replace(from, to)           : Text
slice(start, end)           : Text
parse-int                   : Option(Int)
parse-float                 : Option(Float)
```

### 2.2.7 Int / Float

```
abs, neg, min(b), max(b), clamp(lo, hi)
floor, ceil, round                            ; -> Int
sqrt, log, exp, pow(n)                        ; log は自然対数
show, to-float (Int), to-int (Float, 切り捨て)
```

`floor` / `ceil` / `round` は受け手が何であれ `Int` に**型付けされる**。`round` の中間値は上（+∞ 方向）へ丸める——`(-2.5).round` は `-2` である。`sqrt` / `log` / `exp` は `Float` に型付けされる。`pow` には結果型がない：`2.pow(3)` は `Int` だが `2.pow(-1)` は `0.5` であり、受け手が結果を決めるわけでもない。したがって `pow` の式は代入先に対して検査されない。

Kumiki の算術はこれで全部である。`math` 名前空間は存在しない：修飾子は大文字始まりの名前なので、`math.abs(x)` は `math` という名前への参照になり [E0103](./errors.md#e0103-undef-ref-undef-slot) を報告する。

定義域の外を渡せばプラットフォームの答えがそのまま出る——`(-1.0).sqrt` は `NaN`、`(0.0).log` は `-Infinity`——そして `.show` はそれぞれ `"NaN"` / `"-Infinity"` と描画する。Kumiki に非数を表す別の型はない。上の `Int` は型であって値の保証ではない：`(-1.0).sqrt.floor` は `Int` に型付けされ、値は `NaN` である。slot がそれを拒むための道具は refinement（`where between(…)`）である。

`x.show` は **全型共通**の文字列化メソッド。Int / Float / Bool / variant / nominal すべて `.show : Text` を返す。Kumiki には `to-text` という名前は存在しない。

### 2.2.8 Time

```
Time.now                    : Time
Time.parse(text)            : Option(Time)    ; ISO8601
plus(duration)              : Time
minus(duration)             : Time
diff(other)                 : Duration
format(pattern)             : Text            ; "yyyy-MM-dd HH:mm"
```

`format` は以下のトークンをその時刻のフィールドに置き換え、パターンの残りはそのまま出力する。したがって `"dd/MM/yyyy"` も `"[on] dd"` もパターンである。

| トークン | フィールド |
|---|---|
| `yyyy` | 年（4 桁） |
| `MM` | 月（`01`–`12`） |
| `dd` | 日（`01`–`31`） |
| `HH` | 時（`00`–`23`） |
| `mm` | 分（`00`–`59`） |
| `ss` | 秒（`00`–`59`） |

トークンは語の内部にあっても置換される。`format("summer dd")` は `su05er 14` になる — `mm` はどこに現れてもトークンだからである。エスケープは無い。パターンはトークンと区切り記号（`-` `/` `:` 空白）で書くものであって、文ではない。

フィールドは**ローカル**のものである。結果の文字列はタイムゾーンを含まないので読み手の壁時計として読まれる。UTC のフィールドを出すと、その瞬間のローカル日付が UTC 日付と食い違う読み手全員に誤った日が表示される — グリニッジより東では深夜過ぎ、西では夕方である。

`Time.parse` は §2.2.9 が `Time` に与えているのと同じ表現、すなわちミリ秒数を返す。時刻を指さないテキスト（空文字列を含む）は `None` になる。**日付のみ**の文字列は、プラットフォーム標準のパーサが与える UTC 深夜ではなく**ローカル**の深夜として読む：`format` はローカルのフィールドを出すので、`"2026-08-14"` を UTC として読むとグリニッジより西では `2026-08-13` が返る。そして `type="date"` の input が生成するのはまさにその文字列である。

### 2.2.9 Duration

```
Duration.ms(n)              : Duration
Duration.s(n)               : Duration
Duration.m(n)               : Duration   ; min と書いても可
Duration.h(n)               : Duration
Duration.d(n)               : Duration   ; days と書いても可
to-ms                       : Int
```

Time / Duration はランタイム上では **raw ミリ秒数**として表現される。`time.plus(Duration.h(72))` のような演算は単なる ms 加算に展開される。

```kumiki fragment
fn isSoon(due: Time) -> Bool = due < now.plus(Duration.h(72))
fn elapsed(start: Time) -> Duration = now.diff(start)
```

### 2.2.10 Bytes

`Bytes` は生のバイト列で、ランタイム上は `Uint8Array` として表現される。v0.x ではコレクション系メソッドは持たず、構築子のみを提供する。

```
Bytes.from-text(text)       : Bytes        ; UTF-8 エンコード
Bytes.from-base64(text)     : Bytes        ; 標準 base64 デコード
Bytes.from-bytes(list)      : Bytes        ; List(Int) から（各値は下位 8bit にマスク）
```

---

## 2.3 tile プリミティブ要素

Kumiki の組み込みタイル。**意味タグ**であり HTML タグの直訳ではない。

### 2.3.1 構造要素

| 要素 | 役割 | 主な props |
|---|---|---|
| `page` | アプリのルート画面 | `title`, `class` |
| `region` | 名前付きセクション | `aria-label`, `class` |
| `row` | 水平レイアウト | `gap`, `align`, `justify` |
| `column` | 垂直レイアウト | `gap`, `align`, `justify` |
| `stack` | 重ね配置 | `align` |
| `grid` | グリッド | `cols`, `gap` |
| `box` | 汎用コンテナ | `class`, `style` |
| `card` | カード | `class` |
| `panel` | パネル | `class` |
| `divider` | 区切り | `orientation` |
| `scroll` | スクロールコンテナ | `direction`, `max-height` |

### 2.3.2 テキスト要素

| 要素 | 役割 | 主な props |
|---|---|---|
| `text` | テキスト表示 | `strike`, `bold`, `italic`, `size`, `color` |
| `heading` | 見出し | `level` (1-6) |
| `link` | リンク | `to`, `external` |
| `code` | コード | `lang` |
| `markdown` | Markdown 描画 | （内容は引数） |

### 2.3.3 メディア要素

| 要素 | 役割 | 主な props |
|---|---|---|
| `image` | 画像 | `src`, `alt`, `width`, `height`, `loading` |
| `icon` | アイコン | `name`, `size` |
| `video` | 動画 | `src`, `controls`, `autoplay` |

`image` の `width` / `height` は属性として書かれる——画像が到着する前に領域を確保するのはこれである。`loading` は `lazy` または `eager` を取る。

### 2.3.4 入力要素

| 要素 | 役割 | 主な props |
|---|---|---|
| `button` | ボタン | `text`, `onClick`, `variant`, `disabled`, `loading` |
| `input` | テキスト入力 | `bind`, `placeholder`, `type` (text/email/password/...), `disabled` |
| `textarea` | 複数行入力 | `bind`, `rows`, `placeholder` |
| `check` | チェックボックス | `value`, `onClick`, `onChange`, `label` |
| `radio` | ラジオボタン | `name`, `value`, `selected`, `onClick`, `onChange` |
| `select` | セレクト | `bind`, `options` (List of `{label, value}`), `placeholder`, `onChange` |
| `slider` | スライダー | `bind`, `min`, `max`, `step`, `onChange` |
| `switch` | トグル | `value`, `onClick`, `onChange` |

`button` の `loading` はボタンを無効化し、`aria-busy` を付け、ラベルの手前にスピナーを置く（[フォーム §5.8](./forms.md#_5-8-ui-during-submission)）。`disabled` は単独で無効化する。`variant` は `data-kumiki-variant` 属性になる——`class` やテーマのスタイルシートが選択するためのフックである。Kumiki はどの variant 名にも見た目を同梱しない：「ghost」ボタンがどう見えるべきかはデザインの決定であり、ここで発明すればそれは言語機能になってしまう。

### 2.3.5 フォーム

| 要素 | 役割 | 主な props |
|---|---|---|
| `form` | フォーム（form をラップする tile に `ui.submit(WrapperTile)` で届く） | `id`, `auto-complete`, `novalidate` |
| `label` | ラベル | `for` |
| `fieldset` | フィールド集合 | `legend` |
| `error` | バリデーションエラー表示 | `field` |

### 2.3.6 リスト・表

| 要素 | 役割 | 主な props |
|---|---|---|
| `list` | リスト | `ordered` |
| `list-item` | リスト項目 | |
| `table` | 表 | |
| `table-head` | 表ヘッダ | |
| `table-body` | 表本体 | |
| `table-row` | 表行 | |
| `table-cell` | 表セル | `colspan`, `rowspan` |

### 2.3.7 オーバーレイ

| 要素 | 役割 | 主な props |
|---|---|---|
| `overlay` | z 軸のスタック。最初の子がベース層、以降の子はその上に重ねて置かれる — この表の他が乗る土台（[スタイル §4.4.3](./style.md#_4-4-3-stack)） | `align` |
| `modal` | モーダル | `open`, `onClose`, `title` |
| `drawer` | ドロワー | `open`, `onClose`, `side` |
| `tooltip` | ツールチップ | `text`, `placement` |
| `popover` | ポップオーバー | `open`, `onClose`, `placement` |
| `toast` | トースト通知 | `kind`（info/success/warn/error — `data-level` として載るだけで、組み込みの見た目は持たない）、`text`、`duration`（kind 別のデフォルトは [ライフサイクル §7.7](./lifecycle.md#_7-7-トースト) 参照） |
| `details` | ネイティブの `<details>` 開閉（#190） — `summary` がヘッダのラベル、子要素が折りたたまれるパネルになる | `summary`, `open` |

### 2.3.8 フィードバック

| 要素 | 役割 | 主な props |
|---|---|---|
| `spinner` | スピナー | `size` |
| `progress` | プログレスバー | `value`, `max` |
| `skeleton` | スケルトン | `kind` (text/box/circle) |

`spinner` はアニメーションするローディングインジケータをレンダーする（`role="status"` を持つアクセシブルな要素。アニメーションは `prefers-reduced-motion` 下で無効化される）。`size` はトークン `sm` / `md` / `lg` / `xl` のいずれかを取り、指定がなければ周囲のテキストサイズに追従する。

### 2.3.9 制御要素

| 要素 | 役割 |
|---|---|
| `when(cond, tile)` | cond が true なら tile を表示 |
| `if cond then tA else tB` | 条件分岐 |
| `for x in coll tile` | 反復 |
| `route-outlet` | ネストルートの出力位置 |
| `link(to=...)` | ルート遷移リンク |

### 2.3.10 props の共通仕様

すべての tile は次の共通 props を受ける（ビルトイン）：

| prop | 型 | 何になるか |
|---|---|---|
| `class` | `Text` | class トークン。ランタイム自身が付ける class に**追加**される |
| `style` | `Map(Text, Text)` | インラインスタイル宣言。キーが CSS プロパティ名。略記のあとに適用されるので競合時はこちらが勝つ（最小限の使用を推奨） |
| `aria` | `Map(Text, Text)` | エントリごとに `aria-*` 属性。すでに `aria-…` で始まるキーは二重に付けない |
| `key` | `Text` | レンダーをまたいだ tile の同一性。props から引き上げられ、属性にはならない |
| `test-id` | `Text` | `data-kumiki-test` 属性（[テスト §8.8](./testing.md#_8-8-integration-tests-browser-driven)） |
| `id` | `Text` | 要素の `id`。reducer セレクタの `#id` 部分でもある（[§1.6.2](./language.md#_1-6-2-セレクタ)） |
| `role` | `Text` | `role` 属性。tile の種別が前提とする値を上書きする |
| `aria-*` | `Text` | その ARIA 属性。`aria` マップを介さず単体で書く形 |

`class` / `style` は [スタイル §4.1](./style.md#_4-1-方針) が述べる逃げ道である。上記はすべて**どの種別にも**適用され、スタイルの略記（[§4.3.1](./style.md#_4-3-1-shorthand-properties)）とサイズの props（[§4.4.7](./style.md#_4-4-7-sizing)）も同様である——ランタイムはこれらを種別ごとのレンダラの外側で書くため、`image` の `max-w` も `button` の `bg` も届き、ホストが登録した tile（§10.3.10）にも適用される。

その prop を自分で写像する種別はそちらが優先する：`spinner` と `icon` の `size` はタイポグラフィトークンではなくそのものの大きさを選び、`skeleton` の `h` はプレースホルダの高さである。

両方のレンダリング経路がこれらを書く——マウントされた要素が持つものは、配信されたページも持つ。例外は class を介す層（`transition`、`hover:` / `focus:` / `active:` ブロック、`motion`）で、これらは注入 CSS でありハイドレーション後にのみ存在する。

---

## 2.4 ビルトイン関数

### 2.4.1 ID 生成

```
TypeName.fresh()           : T            ; nominal 型の新 ID（UUIDv7）
```

### 2.4.2 時刻

```
now                        : Time          ; 現在時刻
```

### 2.4.3 型変換

```
TypeName.parse(text)       : Option(T)    ; nominal 型の文字列パース
TypeName.show(value)       : Text         ; 値の文字列表現
```

### 2.4.4 乱数

```
random()                   : Float        ; 0 <= x < 1
```

残りの算術は [§2.2.7](#_2-2-7-int-float)、数値のメソッドとして提供する。

`random()` は `now` と同じく環境を読む。`now` と同じく、式が書ける場所ならどこでも呼べる。読むたびに答えが変わるので、括弧は省略できない。

### 2.4.5 文字列フォーマット

```
fmt(template, ...args)     : Text         ; "Hello {0}, you have {1}"
```

埋め込みは**未実装**である：ランタイムに `fmt` ヘルパが無いため、`fmt` の呼び出しはプレースホルダを残したままテンプレートに評価される——`fmt("{0}-{1}", "a", "b")` は `"{0}-{1}"` になる。個数の検査（[E0213](./errors.md#e0213-call-arity-mismatch)）は、この欠落ではなく上のシグネチャに対して行われる。

`+` で `Text` と他型を結合した場合、自動で `show` 相当が呼ばれる。

### 2.4.6 デバッグ補助

```
trace(label, value)        : T            ; episode log にラベル付きで記録、値はそのまま返す
panic(message)             : never        ; プログラムを停止（reducer 内のみ）
```

`trace` は**未実装**である。lowering された式から mount の episode logger へ到達する経路が無く、記録するには存在しないランタイム接続点が要る。`check` はこの呼び出しに対して [E0802](./errors.md#e0802-unimplemented-function) を報告し、名前が評価時に未定義グローバルへ落ちることを防ぐ。`panic` は実装済み。

---

## 2.5 標準 capability {#_2-5-standard-capabilities}

`app.caps` で宣言できる capability の標準セット：

| capability | 用途 |
|---|---|
| `http.get`, `http.post`, `http.put`, `http.patch`, `http.delete` | HTTP リクエスト |
| `http.cancel` | 進行中の HTTP リクエストを `EffectId` でキャンセル（[Cancellation](./http.md#_6-4-cancellation) 参照） |
| `storage.read`, `storage.write` | localStorage |
| `session.read`, `session.write` | sessionStorage |
| `indexed.read`, `indexed.write` | IndexedDB |
| `nav.push`, `nav.replace`, `nav.back` | ルート遷移 |
| `clipboard.read`, `clipboard.write` | クリップボード |
| `notification.show` | デスクトップ通知 |
| `analytics.send` | 計測イベント送信 |
| `log.write` | ログ出力 |
| `crypto.random`, `crypto.hash` | 暗号 |
| `media.camera`, `media.microphone` | メディアデバイス |
| `geo.read` | 位置情報 |
| `socket.connect`, `socket.send` | WebSocket |

標準でも登録済みでもない capability を `app.caps` に書くとコンパイルエラー（[E0302](./errors.md#e0302-unknown-capability)）。

#### カスタム capability の登録（`kumiki.caps.json`）

プロジェクトは **`kumiki.caps.json`** マニフェストを置くことで、受理される集合を拡張できる：

```json
{
  "capabilities": [
    { "name": "telemetry.track", "description": "..." }
  ]
}
```

各エントリは `group.action` 形式（小文字・ドット区切り）の capability 名で、裸の文字列でも `description` を持つオブジェクトでもよい。登録された名前は `app.caps` で受理され、それに紐づく effect（`effect track cap=telemetry.track …`）は emit 可能になり、capability 境界で dispatch される — 標準 effect と全く同様に scenario でモックできる。標準集合に既にある名前は再宣言してはならない。

**マニフェストを探す場所。** マニフェストは*プロジェクト*に対して capability を登録するものなので、`.kumiki` ファイルのあるディレクトリから 1 階層ずつ上へ、プロジェクトルート（最も近い `package.json` を持つディレクトリ。無ければファイルシステムのルート）まで含めて探索する。この上限はどのツールでも同じで、ホスト側のプロジェクトルート（Vite の `root`。`kumiki dev` では `.kumiki` ファイル自身のディレクトリ）で狭められることはない — 1 つのファイルは、どのツールが読んでも 1 つのマニフェストに解決されなければならない。読まれるのは**最も近い**マニフェスト 1 つだけで、それより上は参照しない。探索経路上に存在するが壊れているマニフェストは、そのファイル名を挙げたエラーになる — 黙って上のマニフェストへ落ちることはない。それでも `app.caps` の名前が未登録なら [E0302](./errors.md#e0302-unknown-capability) が報告され、`kumiki check` / `kumiki build` と Vite プラグインは読んだマニフェスト、または探索したディレクトリを併せて示す。

これは **capability 境界の登録、すなわち宣言的マニフェストであって、新しい構文や任意コードではない** — Kumiki の非ゴール「マクロ/DSL 拡張をしない」と整合する。動く例：[27-custom-capability](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/27-custom-capability.kumiki)（+ その `kumiki.caps.json`）。

**未処理の effect エラーは surface され、決して silent にならない。** `err` に解決した effect は、対応するすべての `.err` reducer へ配送される。プログラムがその effect に `.err` reducer を**一切**配線していない場合、捨てられたエラーは `console.error`（`[kumiki] effect "<name>" returned an error with no .err reducer: …`）で報告され、検証 tier（`console.error` を捕捉する `smoke` / `runScenario`）が検知する — live panic モデル（[エラー処理](./lifecycle.md#_7-2-error-handling)）と整合する。失敗した capability が no-op に見えてはならない：storage 利用不可ケース（opaque-origin サンドボックス、プライベートモード）がまさにこれで、`storage.read` / `storage.write` は `err` を返し、`.ok` だけを扱うアプリは黙って何もしないことになる。よってデフォルト契約は **`err` + surface された報告**であり、プログラムは `.err` reducer（空でもよい）を配線してエラーを処理（または意図的に無視）することを選ぶ。in-memory storage フォールバックはデフォルト挙動では**ない**（契約を覆い隠すため）；欲しいホストは `storage.*` provider で明示的に供給する。

---

## 2.6 標準 effect

各 capability に対応する標準 effect。`app.caps` に capability があれば自動で使える。

逆向きも検査される：これらを capability 無しで emit すると [E0301](./errors.md#e0301-missing-capability) になる。これらには `cap=` を読み取る `effect` 宣言が無い — ランタイム自身が登録するものだからである — ので、要求元は各 effect が登録されているケイパビリティであり、以下の各 effect に併記してある。この節はその全件であり、コンパイラが保持している一覧そのものである。

→ 詳細仕様は [HTTP / Storage](./http.md)。

### 2.6.1 ナビゲーション

```kumiki fragment
effect navigate    cap=nav.push     in={path: Text, params: Map(Text, Text)}  out=Unit
effect navigate-replace cap=nav.replace in={path: Text, params: Map(Text, Text)} out=Unit
effect navigate-back   cap=nav.back  in=Unit  out=Unit
```

### 2.6.2 トースト

ランタイムが描画するバナーは `data-kumiki-toast`（テストが選択に使うマーカ）と `data-level` を持つ。

```kumiki fragment
effect toast       cap=notification.show
                   in={kind: Text, text: Text, duration: Option(Duration)}
                   out=Unit
```

### 2.6.3 ログ

```kumiki fragment
effect log         cap=log.write    in={level: Text, message: Text, data: Map(Text, Text)}  out=Unit
```

### 2.6.4 スクロール

```kumiki snippet
effect scroll-to   in={x: Int, y: Int}  out=Unit
```

ケイパビリティを要求しない唯一の標準 effect。ユーザーが既に見ているページのビューポートを動かすだけで、その外側には何も届かないからである。→ [ルーティング §3.9](./routing.md#_3-9-スクロール復元)。

### 2.6.5 確認ダイアログ

```kumiki fragment
effect confirm     cap=notification.show  in={title: Text, onYes: Reducer, onNo: Reducer}  out=Unit
```

ネイティブの `confirm` ではなくモーダルダイアログの tile として描画され、答えは戻り値ではなく reducer に届く。→ [ライフサイクル §7.6](./lifecycle.md#_7-6-confirmation-dialogs)。

---

## 2.7 数値・通貨など、よく欲しがる型は意図的に未提供

`Money`, `Percent`, `Decimal` などはアプリ側で `nominal` を使って定義する。Kumiki は意見を持たない。

```kumiki fragment
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
```
