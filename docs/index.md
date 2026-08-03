---
layout: home

hero:
  name: Kumiki
  text: A web framework of AI, by AI, for AI
  tagline: Definitions interlock like Japanese joinery (kumiki) so AI can write, edit, and reassemble an app in parallel.
  image:
    light: /kumiki-mark-animated.svg
    dark: /kumiki-mark-animated-dark.svg
    alt: Kumiki
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Playground
      link: /guide/playground
    - theme: alt
      text: Spec
      link: /spec/

features:
  - title: 7 layers
    details: type / slot / effect / reducer / tile / fn / app. State, side effects, and UI are split by role, with no implicit rules.
  - title: Easy for AI to edit in parts
    details: Each definition is independent and references are explicit. The CLI and MCP server provide per-definition list / view / add / replace / fix.
  - title: Measured ease of learning
    details: Cross-vendor (Claude / Codex / Gemini) — mid-size apps (~600 LOC) build from the spec alone in a single pass; larger ones still need an edit loop.
    link: /guide/benchmarks
    linkText: See the benchmarks
  - title: Answers everything with working examples
    details: Per-feature minimal examples and apps ordered by size. Questions and bugs are answered by adding an example and a test.
---

## Same UI, different philosophy

The same app in two worlds: [fetch example](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/19-effect-http.kumiki) on the left, an idiomatic React equivalent on the right.

<div class="home-compare">
<div class="home-compare-col">

**Kumiki** — 30 lines · 278 tokens

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

**React** — 40 lines · 328 tokens

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
    ctrl.current?.abort(); // "latest" policy, by hand
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

Want to change it? It's loaded in the [Playground](/guide/playground).

What to notice:

- **`policy=latest` is one annotation.** Dropping stale responses in React is a hand-written `AbortController` ritual — exactly the kind of outside-the-text machinery that breaks when an AI edits it.
- **The side effect is declared, not hidden.** `caps = [http.get]` is checked by the compiler; an effect with an undeclared capability is a compile error, not a surprise.
- **Every definition is flat and independent.** An AI can replace `reducer failed` or `tile App` alone — nothing else needs to move.

The gap grows with app size: on the [Benchmarks](/guide/benchmarks), Kumiki is **~1.4× fewer tokens and ~2× fewer lines** than the React equivalent.
