# スタイル・レイアウト・テーマ

## 4.1 方針

Kumiki は **CSS を直接書かせない**。CSS のカスケード・特異度・継承は AI にとって最大の隠れた依存源で、Kumiki の「副作用静的追跡」原則と相反する。

代わりに：

1. **デザイントークン** をテーマで宣言
2. **意味タグ** にトークンを参照させる
3. **レイアウトはタイルプリミティブ**（`row` / `column` / `grid`）の props で表現
4. **どうしても必要なときだけ** `class` / `style` props で素通し

これで普通の SPA に必要な見た目はカバーできる。再利用可能で任意のアニメーションは [`motion` 定義](#_4-9-1-the-motion-definition) が提供する。

---

## 4.2 デザイントークン {#_4-2-design-tokens}

`theme` 定義で宣言する：

```kumiki
theme DefaultTheme = {
    colors: {
        bg:        "#ffffff",
        fg:        "#1a1a1a",
        muted:     "#666666",
        primary:   "#0070f3",
        success:   "#0a7c2f",
        warning:   "#b07c00",
        danger:    "#c4222a",
        surface:   "#f7f7f7",
        border:    "#e0e0e0"
    },
    spacing: {
        xs: "4px",  sm: "8px",  md: "16px",
        lg: "24px", xl: "40px", xxl: "64px"
    },
    radius: {
        none: "0",   sm: "4px",   md: "8px",
        lg: "16px",  pill: "999px"
    },
    typography: {
        family: "system-ui, sans-serif",
        size: {
            xs: "12px", sm: "14px", md: "16px",
            lg: "20px", xl: "28px", xxl: "40px"
        },
        weight: {
            normal: "400", medium: "500", bold: "700"
        },
        line-height: "1.5"
    },
    shadow: {
        none: "none",
        sm:   "0 1px 2px rgba(0,0,0,0.1)",
        md:   "0 4px 8px rgba(0,0,0,0.1)",
        lg:   "0 8px 24px rgba(0,0,0,0.15)"
    },
    breakpoints: {
        sm: "640px", md: "768px", lg: "1024px", xl: "1280px"
    }
}
```

### 4.2.1 構文

```
theme-def ::= 'theme' identifier '=' '{' theme-section (',' theme-section)* '}'
theme-section ::= identifier ':' '{' theme-entry (',' theme-entry)* '}'
theme-entry ::= identifier ':' (string | '{' theme-entry (',' theme-entry)* '}')
```

`theme` は型 `Theme` の単一値。複数 theme を定義してダーク/ライトを切り替えられる。

### 4.2.2 app への適用

```kumiki
app TodoApp
    caps   = []
    routes = {"/" -> Home, "/404" -> NotFound}
    init   = []
    theme  = DefaultTheme
```

---

## 4.3 トークン参照

tile prop の中でトークンを参照する場合、`@` 接頭辞を使う：

```kumiki
tile Card = box(
              column(
                heading("Title"),
                text("body"))) {
              style: {
                background: @colors.surface,
                padding:    @spacing.md,
                radius:     @radius.md,
                shadow:     @shadow.sm
              }
            }
```

`@colors.surface` は theme から解決される。テーマ切り替え時に自動で再描画される。

### 4.3.1 短縮プロパティ

頻出のスタイル props は **共通 props** として提供され、`@` を書かなくても解決される：

| prop | 型 | 例 |
|---|---|---|
| `bg` | color token name | `bg: "surface"` → `@colors.surface` |
| `color` | color token name | `color: "muted"` |
| `pad` | spacing token name | `pad: "md"` |
| `pad-x`, `pad-y` | spacing token name | `pad-x: "lg"` |
| `gap` | spacing token name | `gap: "sm"` |
| `radius` | radius token name | `radius: "md"` |
| `shadow` | shadow token name | `shadow: "sm"` |
| `size` | typography.size token name | `size: "lg"` |
| `weight` | typography.weight token name | `weight: "bold"` |

```kumiki
tile Card = box(
              column(
                heading("Title") {size: "lg", weight: "bold"},
                text("body") {color: "muted"})) {
              bg: "surface",
              pad: "md",
              radius: "md",
              shadow: "sm",
              gap: "sm"
            }
```

これにより、AI が書く UI のトークン消費が大幅に減る。

---

## 4.4 レイアウト

レイアウトは CSS ではなく **タイルの構造**で表現する。

### 4.4.1 row / column

```kumiki
row(A, B, C) {gap: "md", align: "center", justify: "between"}
column(A, B, C) {gap: "sm", align: "stretch"}
```

| prop | 値 |
|---|---|
| `gap` | spacing token name |
| `align` | `start` / `center` / `end` / `stretch` / `baseline` |
| `justify` | `start` / `center` / `end` / `between` / `around` / `evenly` |
| `wrap` | `true` / `false` |

### 4.4.2 grid

```kumiki
grid(A, B, C, D) {cols: 2, gap: "md"}
grid(A, B, C) {cols: [1, "auto", 1], gap: "sm"}     ; 数値 or 配列
```

| prop | 値 |
|---|---|
| `cols` | 数値（等分） or `List(Text)`（CSS grid-template-columns 風） |
| `rows` | 同上 |
| `gap` | spacing token name |
| `gap-x`, `gap-y` | 個別指定 |

### 4.4.3 stack

`stack` は **vertical stack** — `column` と意味的に同等のレイアウト（子を縦並びに積む）。視覚的な「積み重ね」のニュアンスがほしい時に使う。

```kumiki
stack(Card1, Card2, Card3) {gap: "md"}
```

**オーバーレイ（z 軸方向の重ね配置）.** z 軸方向に子を重ねるには `overlay` builtin を使う：

```kumiki
overlay(Content, when(modalOpen, Modal())) {align: "center"}
```

`overlay(...children)` は `position: relative` のコンテナをレンダリングする。**最初の子がベース層**（通常の文書フロー）、**以降の子はオーバーレイ**としてコンテナ上に絶対配置されるため、ベース層のレイアウトをずらさない。モーダル・トースト・ドロップダウン・ツールチップの土台となる。`align` prop が重ねる子を配置する：縦方向（`top` / `bottom`、既定は中央）と横方向（`left` / `right`、既定は中央）を `-` で連結する（例：`top-left`、`bottom`、`center`〔既定〕）。認識できないトークンは `center` にフォールバックする。`when(...)` でオーバーレイの子を切り替えると、ベース層を乱さずに mount/unmount される。

### 4.4.4 panel / region / scroll / fieldset

| builtin | 用途 |
|---|---|
| `panel` | グループ化ボックス。視覚的な境界 (border) や見出しを持つ |
| `region` | a11y 上の名前付き領域。スクリーンリーダー向け landmark |
| `scroll` | overflow auto なコンテナ。`h` 指定で固定高スクロール |
| `fieldset` | form 内のフィールドグループ。`<fieldset>` 相当 |

```kumiki
panel(heading("Settings"), settingsForm) {bg: "surface", pad: "md"}
region(navList) {role: "navigation", aria-label: "Main"}
scroll(longList) {h: 400}
```

### 4.4.5 divider

区切り線（`<hr>`）：

```kumiki
column(A, divider(), B)
row(A, divider() {orientation: "vertical"}, B)
```

`orientation` は `horizontal`（既定）または `vertical` を取る。垂直の線は入っている行の高さいっぱいに伸びる。

### 4.4.6 box

汎用コンテナ。pad/bg/radius/shadow などで装飾する：

```kumiki
box(content) {
    pad: "lg",
    bg: "primary",
    color: "bg",
    radius: "md"
}
```

### 4.4.7 サイズ

| prop | 意味 |
|---|---|
| `w` | width。`"full"`（包含ボックス全体）/ 数値（px）/ 任意の CSS 長さ |
| `h` | height |
| `min-w`, `min-h`, `max-w`, `max-h` | min/max |
| `aspect` | `"1/1"` / `"16/9"` 等 |

`pad` / `gap` / `radius` / `shadow` と違い、これらはトークン名ではない——テーマに幅のスケールは存在せず、ここでの `"sm"` は中身のない名前になる。数値は px、それ以外は CSS としてそのまま渡る（`"auto"`、`"50vh"`、`"32rem"`）。唯一の略記が `"full"` である。

```kumiki
image(src=url) {w: "full", max-w: 600, aspect: "16/9"}
```

---

## 4.5 レスポンシブ

スタイル props はオブジェクトでブレイクポイント分岐できる：

```kumiki
column(A, B, C) {
    gap: {base: "sm", md: "md", lg: "lg"},
    pad: {base: "md", lg: "xl"}
}

grid(A, B, C, D) {
    cols: {base: 1, md: 2, lg: 4}
}
```

キーは `base` + theme.breakpoints のキー（`sm`, `md`, `lg`, `xl`）。

---

## 4.6 ダークモード

複数 theme を定義し、`slot theme-name` を切り替える：

```kumiki
theme Light = {colors: {bg: "#fff", fg: "#000", ...}, ...}
theme Dark  = {colors: {bg: "#0a0a0a", fg: "#fff", ...}, ...}

slot themeName : Text = "Light"

reducer toggleTheme
    on=ui.click(ThemeBtn)
    do= themeName := if themeName == "Light" then "Dark" else "Light"

app App
    caps   = []
    routes = {"/" -> Home, "/404" -> NotFound}
    init   = []
    theme  = themeName        ; slot を直接指す
```

`theme = themeName` のように slot を指定すると、その値が変わるたびにテーマが切り替わる。

この節に書く名前はコンパイラが解決する：宣言済みの `theme` か宣言済みの slot でなければならず、それ以外は [E0118](./errors.md#e0118-undef-theme) になる。一方、その slot が保持する**値**は検査しない。宣言された theme 名のいずれかであるべきで — 上の例もそうなっている — しかし常にそうである必要はない：`app.start` でテーマを決めるアプリ（§4.6.1）は、ヘルパが動かなかったことを可視化するために、どの theme も指さないセンチネルから slot を始めてよい。センチネルと綴り間違いは同じプログラムであり、区別には意図が要る。どの theme にも一致しない値は、組み込みの既定値で描画される。

### 4.6.1 OS 設定への追従

```kumiki
reducer initTheme
    on=app.start
    do= themeName := if prefers-dark() then "Dark" else "Light"
```

`prefers-dark()` は組み込みヘルパ（`prefers-color-scheme: dark` を読む）。

---

## 4.7 状態スタイル（hover, focus, etc.）

タイルプリミティブは状態別 props を持つ：

```kumiki
button(text="Save") {
    bg: "primary",
    color: "bg",
    hover: {bg: "primary-dark"},      ; トークン未定義なら警告
    focus: {shadow: "md"},
    disabled: {bg: "muted", color: "border"}
}
```

サポートされる状態キー：`hover` / `focus` / `active` / `disabled` / `selected` / `checked`。

---

## 4.8 アイコン

`icon` 要素は名前で参照する：

```kumiki
icon(name="check") {size: "md", color: "success"}
```

組み込みアイコンセットを提供予定（リストは後日）。カスタムアイコンは `theme.icons` でパス登録：

```kumiki
theme MyTheme = {
    ...,
    icons: {
        logo: "M3 3h18v18H3z..."     ; SVG path
    }
}
```

---

## 4.9 アニメーション

| prop | 効果 |
|---|---|
| `transition: "fade"` | フェードイン/アウト |
| `transition: "slide-up"` | 下からスライド |
| `transition: "slide-down"` | 上からスライド |
| `transition-duration: "fast"` / `"normal"` / `"slow"` | 速度 |

`when` で表示切替したタイルに自動適用される：

```kumiki
when(modalOpen, Modal() {transition: "slide-up", transition-duration: "normal"})
```

### 4.9.1 `motion` 定義 {#_4-9-1-the-motion-definition}

再利用可能で任意（ただし閉じた文法）のアニメーション — スピナー、パルス、独自の入退場 — には **`motion`** を宣言する。これは `theme` と同格のトップレベル定義（純粋に表示用の定義で、7 つのロジックレイヤーには**含めない** — [レイヤ一覧](./language.md#_1-1-1-list-of-layers) 参照）であり、任意の tile の `motion` プロップから参照する。

```kumiki
motion Spin = {
    keyframes: {from: {rotate: 0}, to: {rotate: 360}},
    duration:  "slow",        # "fast" | "normal" | "slow"、または正の Int（ミリ秒）
    easing:    "linear",      # linear | ease | ease-in | ease-out | ease-in-out
    iteration: "infinite",    # 正の Int、または "infinite"
    direction: "normal"       # normal | reverse | alternate | alternate-reverse
}

tile Loader = box(icon(name="spinner")) {motion: "Spin"}
```

- **`keyframes`**（必須）は `from` と `to` のレコードを持ち、各々は**閉じたアニメ可能プロパティ集合**上のレコード（生 CSS 無し）：

  | プロパティ | 単位 | アニメ対象 |
  |---|---|---|
  | `opacity` | 0..1 | 不透明度 |
  | `translate-x` / `translate-y` | px（数値） | 位置 |
  | `scale` | 数値 | 大きさ |
  | `rotate` | deg（数値） | 回転 |

  1 ストップ上の複数 transform プロパティは、記述順によらず**固定順** — `translate-x` → `translate-y` → `scale` → `rotate` — で単一の `transform` に合成される（CSS `transform` は非可換なので、決定論のため順序を固定している）。未知プロパティはコンパイルエラー（**E0401**）、不正な keyframes（`from`/`to` 無し）は **E0403**。
- タイミングフィールドは任意（既定 `duration:"normal"`、`easing:"ease"`、`iteration:1`、`direction:"normal"`）。閉じた集合外の値は **E0402**。
- 未定義の motion を指す `motion: "X"` プロップは **E0107**。
- body はリテラルレコードなので、motion は **slot の読み書きや effect emit ができない** — 純粋に表示用。`when(...)` や `overlay` と合成でき、生成 keyframes はスコープされる（グローバル CSS を漏らさない、[グローバル CSS / リセット](#_4-10-global-css-reset) 参照）。`prefers-reduced-motion: reduce` で motion と上記 transition を無効化する。

繰り延べ：多段パーセンテージ keyframes、色/blur/skew プロパティ。

---

## 4.10 グローバル CSS / リセット

ランタイムは最小リセット CSS を埋め込む。アプリ側からの追加は **意図的に不可能**。

理由：グローバル CSS は AI が追跡できない暗黙依存になる。すべての装飾はタイル props で完結させる。

例外：`<head>` への meta タグ・OG 画像などは `app.meta` で宣言：

```kumiki
app TodoApp
    ...
    meta = {
        title: "My Todos",
        description: "Personal todo app",
        og-image: "/og.png",
        favicon: "/favicon.ico"
    }
```
