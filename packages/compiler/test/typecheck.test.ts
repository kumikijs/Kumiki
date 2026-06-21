import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const COUNTER_PATH = resolve(__dirname, "../../examples/apps/01-counter/app.kumiki");

const checkSrc = (src: string) => check(parse(lex(src)));

describe("typecheck", () => {
  it("accepts the counter example", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const errors = check(parse(lex(src)));
    expect(errors).toEqual([]);
  });

  it("reports an unimplemented method (E0801)", () => {
    const src = `
      slot raw : Text = ""
      slot n : Result(Int, Text) = Ok(0)
      reducer e on=ui.input(In) do= n := Int.parse(raw).to-result("nope")
      tile In = input(bind=raw)
      tile App = column(In)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0801" && e.message.includes("to-result"))).toBe(true);
  });

  it("does not flag implemented methods", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      fn s(ys: List(Int)) -> Int = ys.fold(0, $1 + $2)
      reducer r on=ui.click(B) do= xs := xs.filter($1 > 1)
      tile B = button(text="b")
      tile App = column(B, text(s(xs).show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSrc(src).some((e) => e.code === "E0801")).toBe(false);
  });

  it("accepts a named timer with a matching stop-timer", () => {
    const src = `
      slot x : Int = 0
      reducer tick on=timer(1s, name=t) do= x := x + 1
      reducer stop on=ui.click(B) do= stop-timer(t)
      tile B = button(text="stop", onClick=stop)
      tile App = column(B, text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSrc(src)).toEqual([]);
  });

  it("reports stop-timer to an undefined timer name (E0106)", () => {
    const src = `
      slot x : Int = 0
      reducer tick on=timer(1s, name=t) do= x := x + 1
      reducer stop on=ui.click(B) do= stop-timer(nope)
      tile B = button(text="stop", onClick=stop)
      tile App = column(B, text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0106" && e.message.includes("nope"))).toBe(true);
  });

  it("reports duplicate timer names (E0002)", () => {
    const src = `
      slot x : Int = 0
      slot y : Int = 0
      reducer a on=timer(1s, name=dup) do= x := x + 1
      reducer b on=timer(2s, name=dup) do= y := y + 1
      tile App = column(text(x.show), text(y.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0002" && e.message.includes("dup"))).toBe(true);
  });

  it("accepts a `@token` reference under a known group (§4.3)", () => {
    const src = `
      tile Card = box() {style: {background: @colors.surface, padding: @spacing.md, radius: @radius.md, shadow: @shadow.sm}}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSrc(src)).toEqual([]);
  });

  it("reports an unknown token group as E0110 (§4.3)", () => {
    const src = `
      tile Card = box() {style: {background: @nope.foo}}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0110" && e.message.includes("nope"))).toBe(true);
  });

  it("accepts the overlay builtin", () => {
    const src = `
      slot open : Bool = false
      reducer show on=ui.click(B) do= open := true
      tile B = button(text="open", onClick=show)
      tile M = card(text("modal"))
      tile App = overlay(B, when(open, M())) {align: "top"}
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSrc(src)).toEqual([]);
  });

  it("reports undefined slot reference (E0103)", () => {
    const src = `
      slot count : Int = 0
      reducer r on=ui.click(B) do= count := usres
      tile B = button(text="b")
      app A caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0103" && e.message.includes("usres"))).toBe(true);
  });

  it("reports undefined tile in body (E0105)", () => {
    const src = `
      tile A = column(MissingThing)
      app App caps=[] routes={"/" -> A, "/404" -> A} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0105" && e.message.includes("MissingThing"))).toBe(true);
  });

  it("reports undefined route target (E0105)", () => {
    const src = `
      tile A = column()
      app App caps=[] routes={"/" -> A, "/x" -> Ghost, "/404" -> A} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0105" && e.message.includes("Ghost"))).toBe(true);
  });

  it("reports duplicate slot writes in one reducer (E0601)", () => {
    const src = `
      slot count : Int = 0
      tile B = button(text="b")
      reducer r on=ui.click(B) do= count := count + 1; count := 0
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(true);
  });

  it("reports undefined reducer in event handler (E0102)", () => {
    const src = `
      tile B = button(text="b") {onClick: nope}
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0102" && e.message.includes("nope"))).toBe(true);
  });

  it("requires /404 route entry", () => {
    const src = `
      tile A = column()
      app App caps=[] routes={"/" -> A} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0001")).toBe(true);
  });

  it("allows the same slot to be written in both if/else branches", () => {
    const src = `
      slot x : Int = 0
      slot y : Bool = true
      reducer r on=ui.click(B) do=
        if y
          then x := 1
          else x := 2
      tile B = button(text="b")
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(false);
  });

  it("still flags duplicate writes on the same sequential path", () => {
    const src = `
      slot x : Int = 0
      reducer r on=ui.click(B) do=
        x := 1
        x := 2
      tile B = button(text="b")
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(true);
  });

  it("flags writing the same slot after an if/else that already wrote it", () => {
    const src = `
      slot x : Int = 0
      slot y : Bool = true
      reducer r on=ui.click(B) do=
        if y then x := 1 else x := 2
        x := 3
      tile B = button(text="b")
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSrc(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(true);
  });

  it("does not flag the stdlib methods restored in issue #5 (no E0801)", () => {
    // Each fn exercises one previously-missing docs/spec/stdlib.md §2.2 method.
    const decls = [
      `fn f(xs: List(Int), ys: List(Int)) -> List(Int) = xs.concat(ys)`,
      `fn f(xs: List(Int)) -> List(Int) = xs.prepend(0)`,
      `fn f(xs: List(Int)) -> List(List(Int)) = xs.chunk(2)`,
      `fn f(xs: List(Int), ys: List(Int)) -> List(Tuple(Int, Int)) = xs.zip(ys)`,
      `fn f(a: Map(Text, Int), b: Map(Text, Int)) -> Map(Text, Int) = a.merge(b)`,
      `fn f(a: Map(Text, Int)) -> Map(Text, Int) = a.update("k", $1 + 1)`,
      `fn f(s: Set(Text)) -> Set(Text) = s.add("x")`,
      `fn f(a: Set(Text), b: Set(Text)) -> Set(Text) = a.union(b)`,
      `fn f(a: Set(Text), b: Set(Text)) -> Set(Text) = a.intersect(b)`,
      `fn f(o: Option(Int), p: Option(Int)) -> Option(Int) = o.or(p)`,
      `fn f(r: Result(Int, Text)) -> Result(Int, Text) = r.map-err($1)`,
      `fn f(t: Text) -> Text = t.replace("a", "b")`,
      `fn f(a: Int, b: Int) -> Int = a.min(b)`,
      `fn f(a: Int, b: Int) -> Int = a.max(b)`,
      `fn f(a: Int) -> Int = a.clamp(0, 10)`,
    ];
    const wrap = (decl: string) =>
      `${decl}\n      tile App = column(text("x"))\n      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const failing = decls.filter((decl) => checkSrc(wrap(decl)).some((e) => e.code === "E0801"));
    expect(failing).toEqual([]);
  });

  it("still flags genuinely unknown methods (E0801)", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      fn f(ys: List(Int)) -> List(Int) = ys.frobnicate(1)
      tile App = column(text("x"))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSrc(src).some((e) => e.code === "E0801" && e.message.includes("frobnicate"))).toBe(
      true,
    );
  });

  // Issue #85: nested routes — the spec/§3.6 contract is enforced at the type
  // check layer so a misuse fails before it reaches the runtime.
  describe("sub-routes (issue #85)", () => {
    const nested = (parentPath: string, extra = "") => `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("account"))
      tile SettingsHome = page(heading("home"))
      tile SettingsLayout
        sub-routes = {
          "/settings/account" -> Account,
          "/settings"         -> SettingsHome${extra}
        }
        = page(route-outlet())
      app A caps=[] routes={
        "${parentPath}" -> SettingsLayout,
        "/404" -> NotFound
      } init=[]
    `;

    it("accepts a wildcard parent with valid sub-routes", () => {
      expect(checkSrc(nested("/settings/*"))).toEqual([]);
    });

    it("reports an undefined sub-route target as E0105", () => {
      const src = `
        tile NotFound = page(heading("404"))
        tile Layout sub-routes = { "/x" -> Missing } = page(route-outlet())
        app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0105" && e.message.includes("Missing"))).toBe(true);
    });

    it("reports a non-wildcard parent as E0110", () => {
      const errors = checkSrc(nested("/settings"));
      expect(
        errors.some((e) => e.code === "E0110" && e.kind === "sub-routes-without-wildcard-parent"),
      ).toBe(true);
    });

    it("reports orphan sub-routes (tile not reachable from app.routes) as E0111", () => {
      const src = `
        tile NotFound = page(heading("404"))
        tile Account = page(heading("a"))
        tile Orphan sub-routes = { "/x" -> Account } = page(route-outlet())
        tile App = page(heading("root"))
        app A caps=[] routes={ "/" -> App, "/404" -> NotFound } init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0111" && e.kind === "orphan-sub-routes")).toBe(true);
    });

    it("reports duplicate sub-route paths as E0112", () => {
      const src = `
        tile NotFound = page(heading("404"))
        tile Account = page(heading("a"))
        tile Layout
          sub-routes = {
            "/x/a" -> Account,
            "/x/a" -> Account
          }
          = page(route-outlet())
        app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0112" && e.kind === "duplicate-sub-route")).toBe(true);
    });

    it("reports a parent without route-outlet in its body as E0113", () => {
      // sub-routes declared but the body just has a heading — the matched
      // child would have nowhere to render.
      const src = `
        tile NotFound = page(heading("404"))
        tile Account = page(heading("a"))
        tile Layout
          sub-routes = { "/x/a" -> Account }
          = page(heading("settings"))
        app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0113" && e.kind === "sub-routes-without-outlet")).toBe(
        true,
      );
    });
  });

  describe("episode-test mocks (issue #90)", () => {
    const PREAMBLE = `
      slot count : Int = 0
      effect persist cap=storage.write in=Int out=Result(Unit, Text)
      reducer inc on=ui.click(B) do=
          count := count + 1
          emit persist(count)
      reducer persistFailed on=persist.err($e, _) do= count := 0
      tile B = button(text="+")
      tile App = column(B, heading(count.show))
      app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
    `;

    it("accepts from-log / ignore / ok(...) / err(...)", () => {
      const src = `
        ${PREAMBLE}
        test t = episode-test
          load   = "x.jsonl"
          mocks  = {persist: from-log}
          expect = {slots-equal: from-log}
        test u = episode-test
          load   = "x.jsonl"
          mocks  = {persist: ignore}
          expect = {slots-equal: from-log}
        test v = episode-test
          load   = "x.jsonl"
          mocks  = {persist: ok(unit)}
          expect = {slots-equal: from-log}
        test w = episode-test
          load   = "x.jsonl"
          mocks  = {persist: err("nope")}
          expect = {slots-equal: from-log}
      `;
      expect(checkSrc(src).some((e) => e.code === "E0712")).toBe(false);
    });

    it("rejects an unknown mock policy value (E0712)", () => {
      // `from_log` (underscore) is the classic typo of `from-log`. Before
      // typecheck caught it, codegen silently lowered to `{policy: "ignore"}`
      // and the test would pass while skipping the very effect being replayed.
      const src = `
        ${PREAMBLE}
        test t = episode-test
          load   = "x.jsonl"
          mocks  = {persist: from_log}
          expect = {slots-equal: from-log}
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0712" && e.kind === "episode-mock-invalid")).toBe(
        true,
      );
    });
  });

  // issue #102 — http.cancel + EffectId returned at emit time.
  describe("http.cancel + EffectId (#102)", () => {
    const CANCEL_PREAMBLE = `
      slot id : EffectId = EffectId.none
      effect search cap=http.get
                    in=Text
                    out=Result(Text, HttpError)
                    policy=latest
      effect cancel cap=http.cancel in=EffectId out=Unit
    `;

    it("accepts EffectId slot init = EffectId.none and let id = emit search(...)", () => {
      const src = `
        ${CANCEL_PREAMBLE}
        reducer go on=ui.click(Btn) do= let h = emit search("q")
                                       id := h
        reducer cancelIt on=ui.click(Cancel) do= emit cancel(id)
                                                id := EffectId.none
        tile Btn = button(text="go", onClick=go)
        tile Cancel = button(text="cancel", onClick=cancelIt)
        tile App = column(Btn, Cancel)
        app A caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkSrc(src)).toEqual([]);
    });

    it("rejects cap=http.cancel with in≠EffectId or out≠Unit (E0303)", () => {
      const src = `
        slot s : Text = ""
        effect cancel cap=http.cancel in=Text out=Unit
        tile App = text(s)
        app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0303" && e.kind === "invalid-cancel-target")).toBe(
        true,
      );
    });

    it("rejects emit cancel(non-EffectId) with E0202 emit-arg-type-mismatch", () => {
      const src = `
        slot s : Text = "abc"
        effect cancel cap=http.cancel in=EffectId out=Unit
        reducer go on=ui.click(B) do= emit cancel(s)
        tile B = button(text="x", onClick=go)
        tile App = column(B, text(s))
        app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0202" && e.kind === "emit-arg-type-mismatch")).toBe(
        true,
      );
    });

    it("rejects arithmetic on EffectId (E0204 effect-id-misuse)", () => {
      const src = `
        slot id : EffectId = EffectId.none
        slot tag : Text = ""
        reducer go on=ui.click(B) do= tag := id + "x"
        tile B = button(text="go", onClick=go)
        tile App = column(B)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0204" && e.kind === "effect-id-misuse")).toBe(true);
    });

    it("accepts == / != comparison on EffectId", () => {
      const src = `
        slot id : EffectId = EffectId.none
        slot active : Bool = false
        reducer go on=ui.click(B) do= active := (id != EffectId.none)
        tile B = button(text="go", onClick=go)
        tile App = column(B)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkSrc(src)).toEqual([]);
    });

    it("rejects emit X(...) used as an expression outside a reducer (E0305)", () => {
      const src = `
        effect search cap=http.get in=Text out=Result(Text, HttpError)
        fn f() -> EffectId = emit search("q")
        tile App = text("x")
        app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0305")).toBe(true);
    });
  });
});
