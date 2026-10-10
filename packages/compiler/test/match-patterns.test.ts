import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

describe("match-pattern type integrity", () => {
  it("reports tuple-arity mismatch in fn MatchExpr (E0207)", () => {
    const src = `
      fn f(p: Tuple(Int, Int)) -> Int = match p with | (a, b, c) -> a + b + c
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) =>
          e.code === "E0207" && e.kind === "pat-arity-mismatch" && /Tuple|tuple/.test(e.message),
      ),
    ).toBe(true);
  });

  it("does not flag a well-formed tuple pattern (E0207 absent)", () => {
    const src = `
      fn f(p: Tuple(Int, Int)) -> Int = match p with | (a, b) -> a + b
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0207")).toBe(false);
    expect(errors.some((e) => e.code === "E0208")).toBe(false);
  });

  it("reports tuple-pattern against non-Tuple scrutinee (E0208)", () => {
    const src = `
      fn f(p: Int) -> Int = match p with | (a, b) -> a + b
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0208" && e.kind === "pat-type-mismatch")).toBe(true);
  });

  it("reports variant-arity mismatch in reducer MatchStmt (E0207)", () => {
    const src = `
      slot sel : Option(Int) = None
      slot n   : Int         = 0
      reducer r on=ui.click(B) do=
        match sel with | Some(x, y) -> n := x | None -> n := 0
      tile B = button(text="r", onClick=r)
      tile App = column(B, text(n.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0207" && e.kind === "pat-arity-mismatch" && /Some/.test(e.message),
      ),
    ).toBe(true);
  });

  it("reports unknown variant tag against scrutinee union (E0209)", () => {
    const src = `
      slot sel : Option(Int) = None
      slot n   : Int         = 0
      reducer r on=ui.click(B) do=
        match sel with | Loaded(x) -> n := x | None -> n := 0
      tile B = button(text="r", onClick=r)
      tile App = column(B, text(n.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0209" && e.kind === "pat-unknown-variant" && /Loaded/.test(e.message),
      ),
    ).toBe(true);
  });

  it("reports unknown variant tag in user TypeUnion (E0209)", () => {
    const src = `
      type Light = Red | Green
      fn label(l: Light) -> Text = match l with
        | Red -> "STOP"
        | Yellow -> "?"
        | Green -> "GO"
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0209" && e.kind === "pat-unknown-variant" && /Yellow/.test(e.message),
      ),
    ).toBe(true);
  });

  it("reports tuple-arity mismatch in TileMatch (E0207)", () => {
    const src = `
      type Tag = A | B
      tile Row in=Tuple(Tag, Text)
        = match $1 with
            | (A, _, extra) -> text("nope")
            | (B, _) -> text("b")
      slot xs : List(Text) = ["x"]
      slot ts : List(Tag) = [A]
      tile App = column(for p in ts.zip(xs) Row(p))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0207" && e.kind === "pat-arity-mismatch")).toBe(true);
  });

  it("registers PVariant binds into localTypes so arm body sees the inner type", () => {
    const src = `
      fn label(sel: Option(Int)) -> Text = match sel with
        | None -> "none"
        | Some(x) -> x.show
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0108")).toBe(false);
    expect(errors.some((e) => e.code.startsWith("E02"))).toBe(false);
  });

  it("registers PTuple element binds into localTypes (regression)", () => {
    const src = `
      fn sumPair(p: Tuple(Int, Int)) -> Text = match p with
        | (a, b) -> (a + b).show
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0108")).toBe(false);
  });

  it("reports Result Err-arity mismatch (E0207)", () => {
    const src = `
      fn label(r: Result(Int, Text)) -> Int = match r with
        | Ok(n)      -> n
        | Err(e, x)  -> 0
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0207" && e.kind === "pat-arity-mismatch" && /Err/.test(e.message),
      ),
    ).toBe(true);
  });

  it("reports unknown variant tag against Result (E0209)", () => {
    const src = `
      fn label(r: Result(Int, Text)) -> Int = match r with
        | Ok(n)    -> n
        | Pending  -> 0
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0209" && e.kind === "pat-unknown-variant" && /Pending/.test(e.message),
      ),
    ).toBe(true);
  });

  it("accepts a user generic union instantiation (LoadResult(Post)) — regression", () => {
    const src = `
      type Post = {id: Text, body: Text}
      type LoadResult(T) = Idle | Loading | Loaded(T) | Failed(Text)
      slot s : LoadResult(Post) = Idle
      fn label(r: LoadResult(Post)) -> Text = match r with
        | Idle       -> "idle"
        | Loading    -> "loading"
        | Loaded(p)  -> p.body
        | Failed(e)  -> e
      tile App = column(text(label(s)))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0208")).toBe(false);
    expect(errors.some((e) => e.code === "E0209")).toBe(false);
  });

  it("reports nested PTuple element mismatch (PTuple inside PTuple)", () => {
    const src = `
      fn label(p: Tuple(Tuple(Int, Int), Int)) -> Int = match p with
        | ((a, b, c), n) -> a + b + c + n
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0207" && e.kind === "pat-arity-mismatch")).toBe(true);
  });

  it("preserves the user alias name in diagnostic messages", () => {
    const src = `
      type Light = Red | Green
      fn label(l: Light) -> Text = match l with
        | Red    -> "STOP"
        | Yellow -> "?"
        | Green  -> "GO"
      slot x : Int = 0
      tile App = column(text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const e0209 = errors.find((e) => e.code === "E0209" && e.kind === "pat-unknown-variant");
    expect(e0209).toBeDefined();
    expect(e0209!.message).toContain("Light");
    expect(e0209!.message).not.toContain("Red | Green");
  });

  it("reports E0210 type-arity mismatch for user generic types", () => {
    const src = `
      type Box(A, B) = {a: A, b: B}
      slot s : Box(Int) = {a: 0, b: ""}
      tile App = column(text(s.b))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0210" && e.kind === "type-arity-mismatch" && /Box/.test(e.message),
      ),
    ).toBe(true);
  });

  it("does not infinite-recurse on a self-cycling user type", () => {
    const src = `
      type Cycle(T) = X(T)
      slot s : Cycle(Int) = X(0)
      fn label(c: Cycle(Int)) -> Int = match c with | X(n) -> n
      tile App = column(text(label(s).show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(Array.isArray(errors)).toBe(true);
  });
});
