# 最初のアプリ — Counter

7 レイヤを順に足しながら、動く Counter を組み立てます。完成形は [01-counter](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/apps/01-counter/app.kumiki) にあります。

## 1. 状態を宣言する（slot）

```kumiki fragment
slot count : Int = 0
```

`slot` はミュータブルな状態で、型と初期値を持ちます。

## 2. 更新を書く（reducer）

```kumiki fragment
reducer inc on=ui.click(IncBtn) do= count := count + 1
```

`on=` がイベント（ここでは tile `IncBtn` のクリック）、`do=` が状態更新です。`:=` は代入です。

## 3. UI を組む（tile）

```kumiki fragment
tile IncBtn = button(text="+1", onClick=inc)
tile App    = column(heading("Count: " + count.show), IncBtn)
```

`tile` は UI 部品です。`onClick=inc` でクリックを reducer に結び、`count.show` で数値を文字列にします。

## 4. まとめる（app）

```kumiki fragment
app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

`routes` には必ず `/404` を含めます（無いと [E0001](../spec/errors.md#e0001-missing-404-404-is-redirect-404-in-sub-routes) になります）。

## 5. 検査して動かす

```sh
kumiki check counter.kumiki
kumiki build counter.kumiki ./out
```

## 発展

- 値の範囲を縛りたい → nominal 型 + refinement（[02-nominal-type](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/02-nominal-type.kumiki)）
- 入力欄と双方向結合 → `bind`（[13-text-input-bind](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/13-text-input-bind.kumiki)）
- 一覧を描く → `for ... in`（[07-list](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/07-list.kumiki)）

考え方の全体像は [Kumiki の考え方](./thinking-in-kumiki.md) にあります。
