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

    it("rejects cap=http.cancel with a policy (E0303)", () => {
      const src = `
        effect cancel cap=http.cancel
                      in=EffectId out=Unit
                      policy=debounce(200ms)
        tile App = text("x")
        app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0303" &&
            e.kind === "invalid-cancel-target" &&
            /cannot declare a policy/.test(e.message),
        ),
      ).toBe(true);
    });

    it("rejects cap=http.cancel with retry (E0303)", () => {
      const src = `
        effect cancel cap=http.cancel
                      in=EffectId out=Unit
                      retry=linear(3, 100ms)
        tile App = text("x")
        app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0303" &&
            e.kind === "invalid-cancel-target" &&
            /cannot declare retry/.test(e.message),
        ),
      ).toBe(true);
    });

    it("rejects cap=http.cancel with map-request (E0303)", () => {
      const src = `
        effect cancel cap=http.cancel
                      in=EffectId out=Unit
                      map-request={url: "/cancel"}
        tile App = text("x")
        app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0303" &&
            e.kind === "invalid-cancel-target" &&
            /cannot declare map-request/.test(e.message),
        ),
      ).toBe(true);
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

  describe('forms — input(type="file") bind=', () => {
    it("reports bind= on a file input (E0205)", () => {
      const src = `
        slot avatar : Option(File) = None
        tile AvatarPicker = input(type="file", bind=avatar, accept="image/*")
        tile App = column(AvatarPicker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0205" &&
            e.kind === "bind-on-file-input" &&
            e.message.includes("avatar") &&
            e.message.includes("$event.files.head"),
        ),
      ).toBe(true);
    });

    it("accepts a file input that uses ui.change instead of bind=", () => {
      const src = `
        slot avatar : Option(File) = None
        tile AvatarPicker = input(type="file", accept="image/*")
        reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
        tile App = column(AvatarPicker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkSrc(src)).toEqual([]);
    });

    it("does not flag bind= on a non-file input", () => {
      const src = `
        slot draft : Text = ""
        tile In = input(type="text", bind=draft)
        tile App = column(In)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkSrc(src)).toEqual([]);
    });
  });

  describe("forms — accept/multiple gated to file inputs (E0206)", () => {
    it("flags accept on a text input (E0206)", () => {
      const src = `
        tile Picker = input(type="text", accept="image/*")
        tile App = column(Picker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0206" &&
            e.kind === "file-only-prop" &&
            e.message.includes("accept") &&
            e.message.includes(`type="file"`),
        ),
      ).toBe(true);
    });

    it("flags accept when type is omitted (defaults to text)", () => {
      const src = `
        tile Picker = input(accept="image/*")
        tile App = column(Picker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) => e.code === "E0206" && e.kind === "file-only-prop" && e.message.includes("accept"),
        ),
      ).toBe(true);
    });

    it("flags multiple on a text input (E0206)", () => {
      const src = `
        tile Picker = input(type="text", multiple=true)
        tile App = column(Picker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0206" && e.kind === "file-only-prop" && e.message.includes("multiple"),
        ),
      ).toBe(true);
    });

    it("flags both accept and multiple independently on a text input", () => {
      const src = `
        tile Picker = input(type="text", accept="image/*", multiple=true)
        tile App = column(Picker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const codes = errors.filter((e) => e.code === "E0206");
      expect(codes.length).toBe(2);
      expect(codes.some((e) => e.message.includes("accept"))).toBe(true);
      expect(codes.some((e) => e.message.includes("multiple"))).toBe(true);
    });

    it("does not flag accept/multiple on a file input", () => {
      const src = `
        slot avatar : Option(File) = None
        tile Picker = input(type="file", accept="image/*", multiple=true)
        reducer pickFile on=ui.change(Picker) do= avatar := $event.files.head
        tile App = column(Picker)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkSrc(src)).toEqual([]);
    });
  });

  // issue #123 — match arm patterns must agree with the scrutinee's static
  // type. Until now `addPatternBinds` only collected bind names; tuple arity,
  // variant arity, and unknown tags all slipped through and turned into
  // silent "arm is always false" runtime mis-behaviour (the codegen falls
  // through to the next arm). The three new codes:
  //   E0207 pat-arity-mismatch   — tuple/variant arity differs from the type
  //   E0208 pat-type-mismatch    — pattern shape vs scrutinee type mismatch
  //   E0209 pat-unknown-variant  — variant tag not in the scrutinee union
  describe("issue #123 — match-pattern type integrity", () => {
    it("reports tuple-arity mismatch in fn MatchExpr (E0207)", () => {
      const src = `
        fn f(p: Tuple(Int, Int)) -> Int = match p with | (a, b, c) -> a + b + c
        slot x : Int = 0
        tile App = column(text(x.show))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0207" && e.kind === "pat-arity-mismatch")).toBe(true);
    });

    it("registers PVariant binds into localTypes so arm body sees the inner type", () => {
      // Regression: `Some(x)` against Option(Int) must bind `x` as Int, so a
      // call like `Int.show(x)` (or the `.show` shortcut) typechecks. Before
      // this issue, `x` was added to localBinds with no type — `.show` would
      // happen to lower correctly but `inferType` returned null for the ref.
      const src = `
        fn label(sel: Option(Int)) -> Text = match sel with
          | None -> "none"
          | Some(x) -> x.show
        slot x : Int = 0
        tile App = column(text(x.show))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      // The body must not raise E0108 (undef-member) or similar — `x.show`
      // is a known member on Int. We assert it stays green.
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
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
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) =>
            e.code === "E0209" && e.kind === "pat-unknown-variant" && /Pending/.test(e.message),
        ),
      ).toBe(true);
    });

    it("accepts a user generic union instantiation (LoadResult(Post)) — regression", () => {
      // The first cut of this PR rejected user generic union instantiations
      // (`type LoadResult(T) = Idle | Loading | Loaded(T) | Failed(Text)` used
      // as `LoadResult(Post)`) with E0208 because the TypeApp path didn't
      // substitute type params. Pin the fix.
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
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0208")).toBe(false);
      expect(errors.some((e) => e.code === "E0209")).toBe(false);
    });

    it("reports nested PTuple element mismatch (PTuple inside PTuple)", () => {
      // Variant-payload binds are bare identifiers in this grammar
      // (`Ok(n)`, never `Ok((a, b))`), so nested-pattern coverage is
      // exercised via tuple-of-tuple — the recursive call into the inner
      // PTuple element must propagate E0207 on its own arity.
      const src = `
        fn label(p: Tuple(Tuple(Int, Int), Int)) -> Int = match p with
          | ((a, b, c), n) -> a + b + c + n
        slot x : Int = 0
        tile App = column(text(x.show))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0207" && e.kind === "pat-arity-mismatch")).toBe(true);
    });

    it("preserves the user alias name in diagnostic messages", () => {
      // `type Light = Red | Green` should surface as "Light" in the
      // diagnostic, not the expanded body "Red | Green".
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
      const errors = checkSrc(src);
      const e0209 = errors.find((e) => e.code === "E0209" && e.kind === "pat-unknown-variant");
      expect(e0209).toBeDefined();
      expect(e0209!.message).toContain("Light");
      expect(e0209!.message).not.toContain("Red | Green");
    });

    it("reports E0210 type-arity mismatch for user generic types", () => {
      // A misuse of a user generic — passing the wrong number of type args —
      // would otherwise silently turn pattern checks into a no-op via
      // `paramSubstitution` producing a short map. Caught at resolveType.
      const src = `
        type Box(A, B) = {a: A, b: B}
        slot s : Box(Int) = {a: 0, b: ""}
        tile App = column(text(s.b))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(
        errors.some(
          (e) => e.code === "E0210" && e.kind === "type-arity-mismatch" && /Box/.test(e.message),
        ),
      ).toBe(true);
    });

    it("does not infinite-recurse on a self-cycling user type", () => {
      // `type Cycle(T) = Cycle(T)` self-refers through the same name. The
      // cycle-detection set in lookupVariantPayloads must short-circuit;
      // otherwise resolveToTuple / lookupVariantPayloads would recurse
      // forever. We assert that check() returns within the suite's timeout.
      const src = `
        type Cycle(T) = X(T)
        slot s : Cycle(Int) = X(0)
        fn label(c: Cycle(Int)) -> Int = match c with | X(n) -> n
        tile App = column(text(label(s).show))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      // Just confirm there's no internal stack overflow; specific error
      // content isn't required here.
      expect(Array.isArray(errors)).toBe(true);
    });
  });

  // Issue #131: previously `on=ui.click(NonExistent)` passed silently and
  // bound to nothing — a typo in a selector was indistinguishable from a
  // genuinely-unused reducer. The checker now requires the selector's tile
  // name to refer to a declared tile.
  describe("undefined tile in ui.* selector (E0211)", () => {
    it("reports a reducer that targets an undeclared tile", () => {
      const src = `
        slot x : Int = 0
        reducer r on=ui.click(NonExistent) do= x := x + 1
        tile B = button(text="b")
        tile App = column(B)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0211" && e.message.includes("NonExistent"))).toBe(
        true,
      );
    });

    it("accepts a reducer that targets a declared tile (with or without #id)", () => {
      const src = `
        slot x : Int = 0
        reducer rA on=ui.click(B)      do= x := x + 1
        reducer rB on=ui.click(B#main) do= x := x + 1
        tile B = button(text="b") {id: "main"}
        tile App = column(B)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0211")).toBe(false);
    });

    it("accepts the _ wildcard selector for indirectly-dispatched reducers", () => {
      // The `_` sentinel marks a reducer that has no UI subscription of its
      // own — it is invoked through an effect callback such as
      // `emit confirm({onYes: r, onNo: r})`. Treating it as an undeclared
      // tile would falsely diagnose every confirm/leave-guard pattern.
      const src = `
        slot x : Int = 0
        reducer cb on=ui.click(_) do= x := x + 1
        tile App = column()
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0211")).toBe(false);
    });
  });

  // #143 — typecheck-time guard that a `ui.<ev>(Tile)` reducer subscription
  // can actually fire on the target tile. Codegen drops the handler silently
  // for mismatches (e.g. `ui.focus(box)`), so without this warning the
  // reducer is dead code that compiles cleanly.
  describe("W0212 ui-event-tile-mismatch", () => {
    it("flags a direct builtin mismatch (ui.focus on a box)", () => {
      const src = `
        slot f : Text = ""
        reducer rf on=ui.focus(Card) do= f := "x"
        tile Card = box(text("hi"))
        tile App = column(Card)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const w = errors.find((e) => e.code === "W0212");
      expect(w).toBeDefined();
      expect(w?.severity).toBe("warning");
      expect(w?.message).toContain("observed in body");
      expect(w?.message).toContain("box");
    });

    it("suppresses the warning when a focusable descendant is in the cascade body", () => {
      // `ui.click(Outer)` cascades down to `check` which IS in click's
      // allowed set — codegen wires the handler on the descendant, so the
      // subscription is live and W0212 should not fire.
      const src = `
        slot x : Int = 0
        reducer rc on=ui.click(Outer) do= x := x + 1
        tile Outer = row(text("hi"), check(checked=false))
        tile App = column(Outer)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("accepts a direct builtin match (ui.focus on an input)", () => {
      const src = `
        slot f : Text = ""
        reducer rf on=ui.focus(In) do= f := "x"
        tile In = input(bind=f)
        tile App = column(In)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("walks an alias chain to find the builtin root (accepts Outer = Inner = input)", () => {
      const src = `
        slot f : Text = ""
        reducer rf on=ui.focus(Outer) do= f := "x"
        tile Inner = input(bind=f)
        tile Outer = Inner
        tile App = column(Outer)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("walks an alias chain to flag a mismatch (ui.click on Wrap → Box2 → box)", () => {
      const src = `
        slot x : Int = 0
        reducer rc on=ui.click(Wrap) do= x := x + 1
        tile Box2 = box(text("hi"))
        tile Wrap = Box2
        tile App = column(Wrap)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const w = errors.find((e) => e.code === "W0212");
      expect(w).toBeDefined();
      expect(w?.message).toContain("box");
    });

    it("never warns for ui.hover (any tile is allowed)", () => {
      const src = `
        slot x : Int = 0
        reducer rh on=ui.hover(Card) do= x := x + 1
        tile Card = box(text("hi"))
        tile App = column(Card)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("never warns for the wildcard selector ui.click(_)", () => {
      const src = `
        slot x : Int = 0
        reducer rc on=ui.click(_) do= x := x + 1
        tile App = column()
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("emits only E0211 (no W0212) when the selector tile is undeclared", () => {
      const src = `
        slot x : Int = 0
        reducer rc on=ui.click(Missing) do= x := x + 1
        tile App = column()
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "E0211")).toBe(true);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("descends into a TileFor body — `for ... box(...)` warns because box never fires click", () => {
      // Pins the actual descend behavior, not just "is the root statically
      // resolvable". A previous version of this test used `button` inside
      // the `for` body and the warning was suppressed by the accidental
      // overlap with click's allowed set — which would pass even if the
      // descent into TileFor never happened.
      const src = `
        slot xs : List(Int) = [1, 2]
        slot s : Text = ""
        reducer rc on=ui.click(Dyn) do= s := "x"
        tile Dyn = for n in xs box(text("n"))
        tile App = column(Dyn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const w = errors.find((e) => e.code === "W0212");
      expect(w).toBeDefined();
      expect(w?.message).toContain("box");
    });

    it("suppresses the warning when a TileFor body resolves to an allowed root", () => {
      const src = `
        slot xs : List(Int) = [1, 2]
        slot s : Text = ""
        reducer rc on=ui.click(Dyn) do= s := "x"
        tile Dyn = for n in xs button(text="n")
        tile App = column(Dyn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("descends into a TileWhen body — `when(...) box(...)` warns for ui.click", () => {
      const src = `
        slot c : Bool = true
        slot s : Text = ""
        reducer rc on=ui.click(Dyn) do= s := "x"
        tile Dyn = when(c, box(text("hi")))
        tile App = column(Dyn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(true);
    });

    it("descends into BOTH branches of a TileIf — accepts when either branch is allowed", () => {
      // `if then input(...) else button(...)` — both branches contribute an
      // allowed root, so W0212 must NOT fire. Catches a regression where the
      // walker only descended into `consequent`.
      const src = `
        slot c : Bool = true
        slot v : Text = ""
        reducer rf on=ui.focus(T) do= v := "x"
        tile T = if c then input(bind=v) else button(text="b")
        tile App = column(T)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("warns when BOTH branches of a TileIf are disallowed", () => {
      const src = `
        slot c : Bool = true
        slot s : Text = ""
        reducer rc on=ui.click(T) do= s := "x"
        tile T = if c then box(text("a")) else row(text("b"))
        tile App = column(T)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const w = errors.find((e) => e.code === "W0212");
      expect(w).toBeDefined();
      expect(w?.message).toContain("box");
      expect(w?.message).toContain("row");
    });

    it("descends into all arms of a TileMatch — accepts when any arm is allowed", () => {
      // Arm 1: button (allowed for click). Arm 2: box (disallowed). Mixed.
      // The aggregate observed set includes button, so warn must be silent.
      const src = `
        type Mode = A | B
        slot m : Mode = A
        slot s : Text = ""
        reducer rc on=ui.click(T) do= s := "x"
        tile T = match m with
                   | A -> button(text="ok")
                   | B -> box(text("x"))
        tile App = column(T)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((e) => e.code === "W0212")).toBe(false);
    });

    it("warns when EVERY arm of a TileMatch is disallowed", () => {
      const src = `
        type Mode = A | B
        slot m : Mode = A
        slot s : Text = ""
        reducer rc on=ui.click(T) do= s := "x"
        tile T = match m with
                   | A -> box(text("a"))
                   | B -> row(text("b"))
        tile App = column(T)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const w = errors.find((e) => e.code === "W0212");
      expect(w).toBeDefined();
    });

    it("warns on ui.click(<link tile>) — runtime reserves link click for nav", () => {
      // Pins the design choice in `UI_EVENT_TILE_KINDS`: `link` is intentionally
      // NOT in click's allowed set even though `<a>` fires click natively,
      // because the runtime intercepts click on links for navigation and does
      // not invoke user `onClick` reducers. Any future change that adds `link`
      // to the click allowed set without a matching runtime change must trip
      // this test.
      const src = `
        slot s : Text = ""
        reducer rc on=ui.click(L) do= s := "x"
        tile L = link(to="/x", text="x")
        tile App = column(L)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      const w = errors.find((e) => e.code === "W0212");
      expect(w).toBeDefined();
      expect(w?.message).toContain("link");
    });
  });

  // #149 — a typo in the `#id` portion of a `ui.<ev>(Tile#id)` selector was
  // silent: parser/checker/codegen accept it and runtime `_dispatch` drops the
  // event because `el.id !== selector.id`. E0212 is opt-in via
  // `strictSelectorId` so the PR #148 runtime-filter regression (which uses a
  // deliberate literal mismatch) still compiles by default.
  describe("selector id mismatch (E0212, strictSelectorId)", () => {
    const checkStrict = (src: string) => check(parse(lex(src)), { strictSelectorId: true });

    it("flags a literal id mismatch under strictSelectorId", () => {
      const src = `
        slot x : Int = 0
        reducer add on=ui.submit(NewForm#nw) do= x := x + 1
        tile NewForm = form(text="a") {id: "new"}
        tile App = column(NewForm)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkStrict(src);
      const e = errors.find((d) => d.code === "E0212");
      expect(e).toBeDefined();
      expect(e?.kind).toBe("selector-id-mismatch");
      expect(e?.message).toContain("NewForm#nw");
      expect(e?.message).toContain('"new"');
      expect(e?.message).toContain("can never match");
    });

    it("does NOT emit E0212 by default (default-off)", () => {
      const src = `
        slot x : Int = 0
        reducer add on=ui.submit(NewForm#nw) do= x := x + 1
        tile NewForm = form(text="a") {id: "new"}
        tile App = column(NewForm)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkSrc(src);
      expect(errors.some((d) => d.code === "E0212")).toBe(false);
    });

    it("accepts a literal id that matches", () => {
      const src = `
        slot x : Int = 0
        reducer add on=ui.submit(NewForm#new) do= x := x + 1
        tile NewForm = form(text="a") {id: "new"}
        tile App = column(NewForm)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });

    it("silently passes when the tile has no {id} prop (runtime filter is authoritative)", () => {
      const src = `
        slot x : Int = 0
        reducer add on=ui.submit(NewForm#any) do= x := x + 1
        tile NewForm = form(text="a")
        tile App = column(NewForm)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });

    it("silently passes when the tile's {id} value is a non-Str expression", () => {
      // A `Ref` id could resolve to anything at runtime — the runtime filter
      // is authoritative, so we do not flag it at compile time.
      const src = `
        slot x : Int = 0
        slot dynId : Text = "new"
        reducer add on=ui.submit(NewForm#anything) do= x := x + 1
        tile NewForm = form(text="a") {id: dynId}
        tile App = column(NewForm)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });

    it("silently passes when the selector has no #id", () => {
      const src = `
        slot x : Int = 0
        reducer add on=ui.click(NewBtn) do= x := x + 1
        tile NewBtn = button(text="a") {id: "new"}
        tile App = column(NewBtn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });

    it("silently passes for the _ wildcard selector", () => {
      const src = `
        slot x : Int = 0
        reducer cb on=ui.click(_) do= x := x + 1
        tile App = column()
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });

    it("prefers E0211 over E0212 when the tile itself is undeclared", () => {
      const src = `
        slot x : Int = 0
        reducer add on=ui.submit(Missing#nw) do= x := x + 1
        tile App = column()
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkStrict(src);
      expect(errors.some((d) => d.code === "E0211")).toBe(true);
      expect(errors.some((d) => d.code === "E0212")).toBe(false);
    });

    it("accepts a match with any literal id present in a TileIf branch", () => {
      const src = `
        slot mode : Bool = true
        slot x : Int = 0
        reducer add on=ui.click(NewBtn#alt) do= x := x + 1
        tile NewBtn = if mode then button(text="a") {id: "main"} else button(text="b") {id: "alt"}
        tile App = column(NewBtn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });

    it("flags a TileIf where NEITHER branch's literal id matches", () => {
      const src = `
        slot mode : Bool = true
        slot x : Int = 0
        reducer add on=ui.click(NewBtn#nope) do= x := x + 1
        tile NewBtn = if mode then button(text="a") {id: "main"} else button(text="b") {id: "alt"}
        tile App = column(NewBtn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const errors = checkStrict(src);
      const e = errors.find((d) => d.code === "E0212");
      expect(e).toBeDefined();
      expect(e?.message).toContain("main");
      expect(e?.message).toContain("alt");
    });

    it("stays silent when a TileIf branch has a computed {id} (dynamic-anywhere → skip)", () => {
      const src = `
        slot mode : Bool = true
        slot dynId : Text = "x"
        slot x : Int = 0
        reducer add on=ui.click(NewBtn#nope) do= x := x + 1
        tile NewBtn = if mode then button(text="a") {id: "main"} else button(text="b") {id: dynId}
        tile App = column(NewBtn)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
    });
  });
});
