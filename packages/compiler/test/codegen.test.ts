import { readFileSync } from "node:fs";
import { compile } from "@kumikijs/compiler";
import { app } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { compileOrFail, importModule, loweredOf } from "./helpers/module.ts";
import { withRoot } from "./helpers/programs.ts";

const COUNTER_PATH = app("01-counter");

describe("codegen", () => {
  it("compiles counter to a runnable JS module", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const js = compileOrFail(src);
    expect(js).toMatch(/import \{ mount[^}]*\} from "\.\/runtime\.js"/);
    expect(js).toContain('"count":');
    expect(js).toContain("_reducers");
    expect(js).toContain('_h("inc")');
    expect(js).toContain("App._dispatch(n, el)");
    expect(js).toContain("globalThis.__kumikiApp = App;");
  });

  it("compiles a program that uses .concat", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      slot ys : List(Int) = [4, 5]
      reducer r on=ui.click(B) do= xs := xs.concat(ys)
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("[...(");
  });

  it("compiles a named timer + stop-timer", () => {
    const src = `
      slot x : Int = 0
      reducer tick on=timer(1s, name=t) do= x := x + 1
      reducer stop on=ui.click(B) do= stop-timer(t)
      tile B = button(text="stop", onClick=stop)
      tile App = column(B, text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('name: "t"');
    expect(js).toContain('_stops.push("t")');
    expect(js).toContain("stopTimers: _stops");
  });

  it("compiles overlay to a z-axis stacking node", () => {
    const src = `
      slot open : Bool = false
      reducer show on=ui.click(B) do= open := true
      tile B = button(text="open", onClick=show)
      tile M = card(text("modal"))
      tile App = overlay(B, when(open, M())) {align: "top"}
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('kind: "overlay"');
    expect(js).toContain('"top"');
  });

  it("keeps a bare tile-ref base child in overlay (parser builtin registration)", () => {
    const src = `
      slot open : Bool = false
      reducer show on=ui.click(OpenBtn) do= open := true
      tile OpenBtn = button(text="Open", onClick=show)
      tile Content = column(heading("BASE-LAYER"))
      tile Modal = card(text("modal"))
      tile App = overlay(Content, when(open, Modal()))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    const overlayPart = js.split('kind: "overlay"')[1] ?? "";
    expect(overlayPart).toContain("BASE-LAYER");
  });

  it("lowers panic(msg) to the runtime helper, not an undefined fn call", () => {
    const src = `
      slot draft : Text = ""
      reducer save on=ui.click(B) do= draft := if draft.is-empty then panic("draft cannot be empty") else draft
      tile B = button(text="save", onClick=save)
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('_s.panic("draft cannot be empty")');
    const total = (js.match(/panic\(/g) ?? []).length;
    const helper = (js.match(/_s\.panic\(/g) ?? []).length;
    expect(helper).toBeGreaterThan(0);
    expect(total).toBe(helper);
  });

  it("lowers a user fn whose name shadows a builtin tile in value position to a fn call", () => {
    const src = `
      type Light = Red | Green
      slot light : Light = Red
      fn label(l: Light) -> Text = match l with | Red -> "STOP" | Green -> "GO"
      reducer advance on=ui.click(B) do= light := light
      tile B = button(text="next", onClick=advance)
      tile App = column(heading(label(light)), B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('_s.show(label(_live["light"]))');
    expect(js).not.toContain("_s.show(undefined)");
  });

  it("lowers a custom-capability effect to a host provider lookup, not a stub", () => {
    const src = `
      slot sent : Int = 0
      effect track cap=telemetry.track in={name: Text} out=Unit
      reducer fire   on=ui.click(B)      do= emit track({name: "click"})
      reducer onSent on=track.ok(_, _)   do= sent := sent + 1
      tile B = button(text="track", onClick=fire)
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src, {
      runtimeSpecifier: "./runtime.js",
      capabilities: ["telemetry.track"],
    });
    expect(js).toContain('_caps.provider("telemetry.track")');
    expect(js).toContain("Capability telemetry.track has no provider");
    expect(js).not.toContain("not implemented");
    expect(js).toContain("providers: globalThis.__kumikiProviders");
  });

  it("maps the request before handing it to a custom-capability provider", () => {
    // With `map=...`, the mapped record (not the raw input) reaches the provider.
    const src = `
      slot sent : Int = 0
      effect track cap=telemetry.track in={n: Text} out=Unit map-request={name: $1.n}
      reducer fire on=ui.click(B) do= emit track({n: "click"})
      tile B = button(text="track", onClick=fire)
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src, {
      runtimeSpecifier: "./runtime.js",
      capabilities: ["telemetry.track"],
    });
    expect(js).toContain('_caps.provider("telemetry.track")');
    expect(js).toMatch(/const _req = .*;\s*const _provider = _caps\.provider/s);
  });

  it("emits a default-exported App module instead of auto-mounting when exportApp is set", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const js = compileOrFail(src, { runtimeSpecifier: "./runtime.js", exportApp: true });
    expect(js).toContain("export default App;");
    expect(js).not.toContain("mount(App, document.getElementById");
  });

  it("auto-mounts (no export) by default", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const js = compileOrFail(src);
    expect(js).toContain("mount(App, document.getElementById");
    expect(js).not.toContain("export default App;");
  });

  it("makes a standard http effect provider-overridable (provider checked before the builtin)", () => {
    const src = `
      slot xs : List(Int) = []
      effect load cap=http.get in={url: Url} out=Unit
      reducer go on=ui.click(B) do= emit load({url: "https://example.com/x"})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('_caps.provider("http.get")');
    expect(js).toContain("httpFetch(");
    expect(js).toMatch(/import \{[^}]*httpFetch[^}]*\}/);
    expect(js).toMatch(/caps\.provider\("http\.get"\)[\s\S]*httpFetch\(/);
  });

  it("wraps per-instance state in a createApp() factory and exports it under exportApp", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const js = compileOrFail(src, { runtimeSpecifier: "./runtime.js", exportApp: true });
    expect(js).toContain("function createApp()");
    expect(js).toContain("const App = createApp();");
    expect(js).toContain("export { createApp };");
  });

  it("produces independent live state from two createApp() instances", {
    timeout: 30_000,
  }, async () => {
    // Evaluate the generated factory and assert the two apps don't share `live`.
    const src = `
      slot n : Int = 0
      reducer inc on=ui.click(B) do= n := n + 1
      tile B = button(text="+", onClick=inc)
      tile App = column(B, text(n.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
    const mod = await importModule<{ default: AppShape; createApp: () => AppShape }>(js, "codegen");
    const a = mod.createApp();
    const b = mod.createApp();
    const aLive = defined(a.live, "the first instance's live map");
    const bLive = defined(b.live, "the second instance's live map");
    expect(aLive).not.toBe(bLive);
    aLive.n = 5;
    expect(bLive.n).toBe(0); // mutation of one instance must not leak to the other
  });

  it("makes a standard storage effect provider-overridable (with map-request mapping first)", () => {
    const src = `
      slot v : Text = ""
      effect save cap=storage.write in={k: Text, val: Text} out=Unit map-request={key: $1.k, value: $1.val}
      reducer go on=ui.click(B) do= emit save({k: "x", val: "y"})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toMatch(/const _req = [\s\S]*_caps\.provider\("storage\.write"\)/);
    expect(js).toContain("storageWrite(");
    expect(js).toMatch(/import \{[^}]*storageWrite[^}]*\}/);
  });

  it("dispatches session.read/write to sessionRead/sessionWrite handlers", () => {
    const src = `
      slot v : Text = ""
      effect load cap=session.read  in=Unit out=Result(Option(Text), Text) map-request={key: "v", decode: Decoder.Json(Text)}
      effect save cap=session.write in=Text out=Result(Unit, Text)        map-request={key: "v", value: $1}
      reducer boot on=app.start do= emit load()
      reducer loaded on=load.ok($o, _) do= v := $o.get-or("")
      reducer onClick on=ui.click(B) do= emit save(v)
      tile B = button(text="save")
      tile App = column(B)
      app A caps=[session.read, session.write] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain("sessionRead(");
    expect(js).toContain("sessionWrite(");
    expect(js).toMatch(/import \{[^}]*sessionRead[^}]*\}/);
    expect(js).toMatch(/import \{[^}]*sessionWrite[^}]*\}/);
    expect(js).not.toContain("storageRead");
    expect(js).not.toContain("storageWrite");
  });

  it("emits sub-routes on the parent route entry", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Home = page(heading("home"))
      tile Layout
        sub-routes = {
          "/settings/account" -> Account,
          "/settings"         -> Home
        }
        = page(route-outlet())
      app A caps=[nav.push] routes={
        "/settings/*" -> Layout,
        "/404"        -> NotFound
      } init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('pattern: "/settings/*"');
    expect(js).toContain("subRoutes:");
    expect(js).toContain('pattern: "/settings/account"');
    expect(js).toContain('pattern: "/settings"');
    expect(js).toContain('name: "Layout", tile: (_fill) =>');
    expect(js).toContain('name: "Account", tile: () =>');
    expect(js).toContain('name: "NotFound", tile: () =>');
  });

  it("lowers `@token` refs in a style block to runtime `_s.token(...)` calls", () => {
    const src = `
      tile Card = box() {style: {background: @colors.surface, padding: @spacing.md, radius: @radius.md, shadow: @shadow.sm, font-size: @typography.size.lg}}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('_s.token("colors", ["surface"])');
    expect(js).toContain('_s.token("spacing", ["md"])');
    expect(js).toContain('_s.token("radius", ["md"])');
    expect(js).toContain('_s.token("shadow", ["sm"])');
    expect(js).toContain('_s.token("typography", ["size", "lg"])');
    const colorsHits = (js.match(/_s\.token\("colors"/g) ?? []).length;
    expect(colorsHits).toBe(2);
    expect(js).not.toMatch(/el: \{ style:/);
  });

  it("emits an Array.isArray guard for a tuple pattern arm", () => {
    const src = `
      type Light = Red | Green
      fn f(p: Tuple(Light, Light)) -> Text = match p with
        | (Red, Green) -> "rg"
        | (x, y) -> "other"
      slot label : Text = ""
      tile App = text(label)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain("Array.isArray");
    expect(js).toContain(".length === 2");
    expect(js).toContain('_s.variantIs((_v)[0], "Red")');
    expect(js).toContain('_s.variantIs((_v)[1], "Green")');
  });

  it("emits an Array.isArray guard for a tuple pattern in tile-match", () => {
    const src = `
      type Tag = A | B
      tile Row in=Tuple(Tag, Text)
        = match $1 with
            | (A, _) -> text("a-row")
            | (B, _) -> text("b-row")
      slot rows : List(Text) = ["x", "y"]
      slot tags : List(Tag)  = [A, B]
      tile App = column(for p in tags.zip(rows) Row(p))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain("Array.isArray");
    expect(js).toContain(".length === 2");
    expect(js).toContain('_s.variantIs((_v)[0], "A")');
    expect(js).toContain('_s.variantIs((_v)[0], "B")');
  });

  it("lowers `let id = emit X()` to push + EffectId expression", () => {
    const src = `
      slot stored : EffectId = EffectId.none
      effect search cap=http.get
                    in=Text
                    out=Result(Text, HttpError)
      reducer go on=ui.click(Btn) do= let h = emit search("q")
                                     stored := h
      tile Btn = button(text="go", onClick=go)
      tile App = column(Btn)
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('_emits.push({ effect: "search"');
    expect(js).toContain('return "search:_";');
    expect(js).toContain('"stored": { value: "" }');
  });

  it("lowers EmitExpr args ONCE so a side-effectful arg matches the runtime id", () => {
    const src = `
      slot stored : EffectId = EffectId.none
      effect search cap=http.get
                    in=Time
                    out=Result(Text, HttpError)
                    policy=latest-per-key($1)
      reducer go on=ui.click(Btn) do= let h = emit search(now)
                                     stored := h
      tile Btn = button(text="go", onClick=go)
      tile App = column(Btn)
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toMatch(/const __a0 = _s\.now\(\);/);
    expect(js).toMatch(/const __k = \(\(\w+\) => _s\.entryKey\(\w+\)\)\(__a0\);/);
    expect(js).toContain('_emits.push({ effect: "search", args: [__a0], key: __k })');
    expect(js).toContain('return "search:" + __k;');
    const occurrences = (js.match(/_s\.now\(\)/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("includes effects-http when an effect uses cap=http.cancel", () => {
    const src = `
      slot stored : EffectId = EffectId.none
      effect cancel cap=http.cancel in=EffectId out=Unit
      reducer go on=ui.click(Btn) do= emit cancel(stored)
      tile Btn = button(text="cancel", onClick=go)
      tile App = column(Btn)
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('"http.cancel"');
    expect(js).toContain('_emits.push({ effect: "cancel"');
  });

  it("does not change shorthand-prop codegen — `bg`/`pad` stay as plain string fields", () => {
    const src = `
      tile Card = box(text("hi")) {bg: "surface", pad: "md"}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    expect(js).toContain('bg: "surface"');
    expect(js).toContain('pad: "md"');
    expect(js).not.toContain('_s.token("colors"');
    expect(js).not.toContain('_s.token("spacing"');
  });

  it("promotes a11y warnings to compile errors when strictA11y is set", () => {
    const src = `
      tile App = button()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const lax = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(lax.kind).toBe("ok");
    const strict = compile(src, { runtimeSpecifier: "./runtime.js", strictA11y: true });
    expect(strict.kind).toBe("fail");
    if (strict.kind !== "fail") return;
    expect(strict.errors.some((e) => e.code === "E0701")).toBe(true);
  });
});

describe("expressions outside a reducer body still see the slot table", () => {
  const SRC = `
    slot noteKey : Text = "kumiki:note"
    slot got     : Text = "none"
    effect loadNote cap=http.get
                    in=Text
                    out=Result(Text, Text)
                    policy=latest-per-key(noteKey)
    reducer onOk on=loadNote.ok($v, _) do= got := $v
    tile App = column(text(got))
    app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[loadNote(noteKey)]
  `;

  function emittedLine(js: string, label: string): string {
    const line = js.split(/\r?\n/).find((l) => l.includes(label));
    if (line === undefined) throw new Error(`no emitted line contains ${label}`);
    return line;
  }

  it("lowers a slot reference in an app.init argument to the live map", () => {
    const js = compileOrFail(SRC);
    const init = emittedLine(js, "init: [");
    expect(init).toContain('args: [_live["noteKey"]]');
    expect(init).not.toMatch(/args: \[\s*noteKey/);
  });

  it("lowers a slot reference in latest-per-key to the live map", () => {
    const js = compileOrFail(SRC);
    const keyOf = emittedLine(js, "keyOf:");
    expect(keyOf).toContain('_s.entryKey(_live["noteKey"])');
  });

  it("still binds the key lambda's own $1", () => {
    const js = compileOrFail(
      `
      slot got : Text = "none"
      effect load cap=http.get in=Text out=Result(Text, Text) policy=latest-per-key($1)
      reducer onOk on=load.ok($v, _) do= got := $v
      tile App = column(text(got))
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
      `,
      { runtimeSpecifier: "./runtime.js" },
    );
    const keyOf = emittedLine(js, "keyOf:");
    expect(keyOf).toContain("_d_1");
    expect(keyOf).not.toContain("_live");
  });
});

describe("Time lowers to the representation the spec gives it", () => {
  it("passes the pattern to the formatter instead of discarding it", () => {
    const src = withRoot(
      "text(stamp(Time.now))",
      `fn stamp(t: Time) -> Text = t.format("yyyy-MM-dd HH:mm")`,
    );
    const js = loweredOf(src);
    expect(js).toContain('_s.formatTime(t, "yyyy-MM-dd HH:mm")');
    expect(js).not.toContain("toISOString");
  });

  it("parses a Time into milliseconds, not into the text it was given", () => {
    const src = withRoot(
      "text(shown(iso))",
      `slot iso : Text = ""
fn shown(s: Text) -> Text = match Time.parse(s) with | Some(t) -> t.format("yyyy") | None -> "?"`,
    );
    const js = loweredOf(src);
    expect(js).toContain("_s.parseTime(");
    expect(js).not.toMatch(/_s\.Some\(String\(/);
    expect(js).toContain("_s.formatTime");
  });
});

describe("fmt lowers to the runtime helper, unguarded", () => {
  const source = `slot greeting : Text = ""
reducer greet on=app.start do= greeting := fmt("Hello {0}, you have {1}", "Ada", 3)
tile App = column(text(greeting))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("calls `_s.fmt` with the template and every argument after it", () => {
    expect(loweredOf(source)).toMatch(
      /(?<!\?\s)_s\.fmt\("Hello \{0\}, you have \{1\}", "Ada", 3\)/,
    );
  });

  it("emits no fallback to the template", () => {
    const js = loweredOf(source);
    expect(js).not.toContain("_s.fmt ?");
  });
});
