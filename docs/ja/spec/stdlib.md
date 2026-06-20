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
| `Bytes` | バイト列 | リテラルなし、`Bytes.from-text()` / `Bytes.from-base64()` / `Bytes.from-bytes()` で生成（§2.2.10 参照） |
| `Time` | UNIX ナノ秒 | リテラルなし、`now` または `Time.parse()` |

### 2.1.2 汎化型

| 型 | 用途 |
|---|---|
| `Map(K, V)` | キーは Eq、値は任意 |
| `Set(T)` | T は Eq |
| `List(T)` | 順序あり、インデックスアクセス可 |
| `Option(T)` | `None` または `Some(T)` |
| `Result(T, E)` | `Ok(T)` または `Err(E)` |
| `Tuple(T1, ..., Tn)` | 固定長 |

### 2.1.3 ドメイン型（標準提供）

| 型 | 定義 |
|---|---|
| `HttpStatus` | `nominal Int where between(100, 599)` |
| `HttpError` | `{status: HttpStatus, message: Text, body: Option(Text)}` |
| `Url` | `nominal Text where url` |
| `Email` | `nominal Text where email` |
| `Uuid` | `nominal Text where uuid` |
| `Duration` | `nominal Int` (ナノ秒) |
| `Route` | `{path: Text, params: Map(Text, Text), query: Map(Text, Text)}` |
| `FormData` | `Map(Text, FormValue)` |
| `FormValue` | `TextV(Text) \| NumberV(Float) \| BoolV(Bool) \| FileV(File)` |
| `File` | `{name: Text, size: Int, type: Text, content: Bytes}` |

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

```kumiki
fn sortedByCreatedAt(m: Map(Id, Item)) -> List(Id)
   = m.entries.sort-by($2.createdAt).map($1)
```

`get-or` は **Option 用にも使える** polymorphic method:

```kumiki
m.get-or(k, default)         ; Map: 値がなければ default
opt.get-or(default)          ; Option: None なら default、Some(v) なら v
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

```kumiki
slot todos : List(Todo) = []
fn count() -> Int = todos.length              ; 括弧なし OK
fn empty?() -> Bool = todos.is-empty          ; 同上
fn norm() -> List(Todo) = todos.reverse       ; 同上
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

> **panic 意味論.** `Option.get` / `Result.get`（多相 unwrap、カッコ無しで `value.get` とも書ける）は空ケース（`None` / `Err`）で panic し、`Result.get-err` は `Ok` で panic する。いずれも live runtime が扱う唯一の制御された panic シグナルを送出する — [エラー処理](./lifecycle.md#_7-2-エラー処理) を参照。reducer 外では `get-or(default)` を推奨。

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
show, to-float (Int), to-int (Float, 切り捨て)
```

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

```kumiki
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

### 2.3.4 入力要素

| 要素 | 役割 | 主な props |
|---|---|---|
| `button` | ボタン | `text`, `onClick`, `variant`, `disabled`, `loading` |
| `input` | テキスト入力 | `bind`, `placeholder`, `type` (text/email/password/...), `disabled` |
| `textarea` | 複数行入力 | `bind`, `rows`, `placeholder` |
| `check` | チェックボックス | `value`, `onClick`, `label` |
| `radio` | ラジオボタン | `name`, `value`, `selected`, `onClick` |
| `select` | セレクト | `bind`, `options` (List of `{label, value}`), `placeholder` |
| `slider` | スライダー | `bind`, `min`, `max`, `step` |
| `switch` | トグル | `value`, `onClick` |

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
| `modal` | モーダル | `open`, `onClose`, `title` |
| `drawer` | ドロワー | `open`, `onClose`, `side` |
| `tooltip` | ツールチップ | `text`, `placement` |
| `popover` | ポップオーバー | `open`, `onClose`, `placement` |
| `toast` | トースト通知 | `kind` (info/success/warn/error), `text` |

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

| prop | 型 | 意味 |
|---|---|---|
| `class` | `Text` | スタイルクラス名 |
| `style` | `Map(Text, Text)` | インラインスタイル（最小限の使用を推奨） |
| `aria` | `Map(Text, Text)` | ARIA 属性 |
| `key` | `Text` | for 内で要素を一意に識別 |
| `test-id` | `Text` | テスト用 ID |

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

### 2.4.4 数学

```
math.abs, math.min, math.max, math.clamp
math.floor, math.ceil, math.round
math.sqrt, math.pow, math.log, math.exp
math.random                : Float        ; reducer 内のみ呼び出し可（effect 扱い）
```

### 2.4.5 文字列フォーマット

```
fmt(template, ...args)     : Text         ; "Hello {0}, you have {1}"
```

`+` で `Text` と他型を結合した場合、自動で `show` 相当が呼ばれる。

### 2.4.6 デバッグ補助

```
trace(label, value)        : T            ; episode log にラベル付きで記録、値はそのまま返す
panic(message)             : never        ; プログラムを停止（reducer 内のみ）
```

---

## 2.5 標準 capability {#_2-5-standard-capabilities}

`app.caps` で宣言できる capability の標準セット：

| capability | 用途 |
|---|---|
| `http.get`, `http.post`, `http.put`, `http.patch`, `http.delete` | HTTP リクエスト |
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

プロジェクトは、`.kumiki` ファイルと同じディレクトリに **`kumiki.caps.json`** マニフェストを置くことで、受理される集合を拡張できる：

```json
{
  "capabilities": [
    { "name": "telemetry.track", "description": "..." }
  ]
}
```

各エントリは `group.action` 形式（小文字・ドット区切り）の capability 名で、裸の文字列でも `description` を持つオブジェクトでもよい。登録された名前は `app.caps` で受理され、それに紐づく effect（`effect track cap=telemetry.track …`）は emit 可能になり、capability 境界で dispatch される — 標準 effect と全く同様に scenario でモックできる。標準集合に既にある名前は再宣言してはならない。

これは **capability 境界の登録、すなわち宣言的マニフェストであって、新しい構文や任意コードではない** — Kumiki の非ゴール「マクロ/DSL 拡張をしない」と整合する。動く例：[27-custom-capability](https://github.com/kage1020/Kumiki/blob/main/packages/examples/features/27-custom-capability.kumiki)（+ その `kumiki.caps.json`）。

**未処理の effect エラーは surface され、決して silent にならない。** `err` に解決した effect は、対応するすべての `.err` reducer へ配送される。プログラムがその effect に `.err` reducer を**一切**配線していない場合、捨てられたエラーは `console.error`（`[kumiki] effect "<name>" returned an error with no .err reducer: …`）で報告され、検証 tier（`console.error` を捕捉する `smoke` / `runScenario`）が検知する — live panic モデル（[エラー処理](./lifecycle.md#_7-2-error-handling)）と整合する。失敗した capability が no-op に見えてはならない：storage 利用不可ケース（opaque-origin サンドボックス、プライベートモード）がまさにこれで、`storage.read` / `storage.write` は `err` を返し、`.ok` だけを扱うアプリは黙って何もしないことになる。よってデフォルト契約は **`err` + surface された報告**であり、プログラムは `.err` reducer（空でもよい）を配線してエラーを処理（または意図的に無視）することを選ぶ。in-memory storage フォールバックはデフォルト挙動では**ない**（契約を覆い隠すため）；欲しいホストは `storage.*` provider で明示的に供給する。

---

## 2.6 標準 effect

各 capability に対応する標準 effect。`app.caps` に capability があれば自動で使える。

→ 詳細仕様は [HTTP / Storage](./http.md)。

### 2.6.1 ナビゲーション

```kumiki
effect navigate    cap=nav.push     in={path: Text, params: Map(Text, Text)}  out=Unit
effect navigate-replace cap=nav.replace in={path: Text, params: Map(Text, Text)} out=Unit
effect navigate-back   cap=nav.back  in=Unit  out=Unit
```

### 2.6.2 トースト

```kumiki
effect toast       cap=notification.show  in={kind: Text, text: Text}  out=Unit
```

### 2.6.3 ログ

```kumiki
effect log         cap=log.write    in={level: Text, message: Text, data: Map(Text, Text)}  out=Unit
```

---

## 2.7 数値・通貨など、よく欲しがる型は意図的に未提供

`Money`, `Percent`, `Decimal` などはアプリ側で `nominal` を使って定義する。Kumiki は意見を持たない。

```kumiki
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
```
