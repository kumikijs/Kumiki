---
layout: home

hero:
  name: Kumiki
  text: AI の、AI による、AI のための Web フレームワーク
  tagline: 定義同士は組木のように噛み合うから、AI が並列にアプリを書き・直し・組み替えられる。
  image:
    light: /kumiki-mark-animated.svg
    dark: /kumiki-mark-animated-dark.svg
    alt: Kumiki
  actions:
    - theme: brand
      text: はじめる
      link: /ja/guide/getting-started
    - theme: alt
      text: Playground
      link: /ja/guide/playground
    - theme: alt
      text: 仕様
      link: /ja/spec/

features:
  - title: 7 レイヤ
    details: type / slot / effect / reducer / tile / fn / app。状態・副作用・UI が役割ごとに分かれ、暗黙のルールがない。
  - title: AI が部分編集しやすい
    details: 各定義が独立し参照が明示的。CLI と MCP サーバーが定義単位の list / view / add / replace / fix を提供する。
  - title: 実測された学習しやすさ
    details: クロスベンダー（Claude / Codex / Gemini）実測 — 仕様書だけ・単一パスで中規模アプリ（〜600 行）はビルドが通る。大規模は編集ループが必要。
    link: /ja/guide/benchmarks
    linkText: ベンチマークを見る
  - title: 動く例ですべてに答える
    details: 機能別ミニマル例とサイズ順アプリを網羅。質問・バグは example と test を足して答える運用。
---

## 同じUI、違う思想

同じアプリを 2 つの世界で。左は Kumiki での [fetch example](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/19-effect-http.kumiki)、右はその慣用的な React 等価実装。

<div class="home-compare">
<div class="home-compare-col">

**Kumiki** — 30 行 · 278 トークン

```kumiki
type Quote = {text: Text, author: Text}
type Load  = Idle | Loading | Loaded(Quote) | Failed(Text)

slot state : Load = Idle

effect fetchQuote cap=http.get
                  in=Unit
                  out=Result(Quote, HttpError)
                  policy=latest
                  map-request={url: "/api/quote", decode: Decoder.Json(Quote)}

reducer load   on=ui.click(LoadBtn)        do= state := Loading
                                              emit fetchQuote()
reducer loaded on=fetchQuote.ok($q, _)     do= state := Loaded($q)
reducer failed on=fetchQuote.err($e, _)    do= state := Failed("request failed")

tile LoadBtn = button(text="Load quote", onClick=load)
tile App = column(
             LoadBtn,
             match state with
               | Idle        -> text("Click to load.")
               | Loading     -> spinner()
               | Loaded(q)   -> card(text(q.text), text("— " + q.author)) {pad: "md"}
               | Failed(msg) -> text(msg) {color: "danger"})
           {pad: "lg", gap: "md"}

app EffectHttp
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

</div>
<div class="home-compare-col">

**React** — 40 行 · 328 トークン

```tsx
import { useRef, useState } from "react";

type Quote = { text: string; author: string };
type Load =
  | { tag: "idle" } | { tag: "loading" }
  | { tag: "loaded"; quote: Quote }
  | { tag: "failed"; message: string };

export function App() {
  const [state, setState] = useState<Load>({ tag: "idle" });
  const ctrl = useRef<AbortController | null>(null);

  async function load() {
    ctrl.current?.abort(); // "latest" policy を手書き
    const c = (ctrl.current = new AbortController());
    setState({ tag: "loading" });
    try {
      const res = await fetch("/api/quote", { signal: c.signal });
      setState({ tag: "loaded", quote: await res.json() });
    } catch {
      if (!c.signal.aborted)
        setState({ tag: "failed", message: "request failed" });
    }
  }

  return (
    <div>
      <button onClick={load}>Load quote</button>
      {state.tag === "idle" && <p>Click to load.</p>}
      {state.tag === "loading" && <Spinner />}
      {state.tag === "loaded" && (
        <blockquote>
          <p>{state.quote.text}</p>
          <footer>— {state.quote.author}</footer>
        </blockquote>
      )}
      {state.tag === "failed" && <p className="error">{state.message}</p>}
    </div>
  );
}
```

</div>
</div>

<KumikiDemo example="19-effect-http.kumiki" height="240px" />

書き換えて試したくなったら [Playground](/ja/guide/playground) へ。

注目すべき点:

- **`policy=latest` はアノテーション 1 つ。** React で古いレスポンスを捨てるには `AbortController` の手書きの儀式が要る。まさに「テキストの外」にあって AI の編集で壊れる類の機構。
- **副作用は隠さず宣言する。** `caps = [http.get]` はコンパイラが検査し、未宣言 capability の effect はコンパイルエラーになる。
- **すべての定義がフラットで独立。** AI は `reducer failed` や `tile App` だけを差し替えられる。他は一切動かさなくてよい。

差はアプリの規模とともに開く。[ベンチマーク](/ja/guide/benchmarks)では、Kumiki は React 等価実装より**トークン約 1.4× 減・行数約 2× 減**。
