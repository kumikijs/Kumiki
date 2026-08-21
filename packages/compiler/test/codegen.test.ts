import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const COUNTER_PATH = resolve(__dirname, "../../examples/apps/01-counter/app.kumiki");

// Write under the package dir (not the OS temp dir) so the generated module's
// `import "@kumikijs/runtime"` resolves via the workspace node_modules.
const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

/** Write generated ESM to a temp file and import it. */
async function importGenerated(
  js: string,
): Promise<{ default: AppShape; createApp: () => AppShape }> {
  const dir = mkdtempSync(join(TMP_ROOT, "codegen-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, js);
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
}

describe("codegen", () => {
  it("compiles counter to a runnable JS module", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/import \{ mount[^}]*\} from "\.\/runtime\.js"/);
    expect(result.js).toContain('"count":');
    expect(result.js).toContain("_reducers");
    // Handlers dispatch through the instance's own `App`; the global stays as
    // a tooling state oracle only.
    expect(result.js).toContain('_h("inc")');
    expect(result.js).toContain("App._dispatch(n, el)");
    expect(result.js).toContain("globalThis.__kumikiApp = App;");
  });

  it("compiles a program that uses .concat (issue #5 regression)", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      slot ys : List(Int) = [4, 5]
      reducer r on=ui.click(B) do= xs := xs.concat(ys)
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    // Before the fix this failed typecheck with E0801 (.concat unimplemented).
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // concat lowers to an array spread of both lists.
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('name: "t"');
    expect(result.js).toContain('_stops.push("t")');
    expect(result.js).toContain("stopTimers: _stops");
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('kind: "overlay"');
    expect(result.js).toContain('"top"');
  });

  it("keeps a bare tile-ref base child in overlay (parser builtin registration)", () => {
    // Regression: `overlay` must be in the parser's BUILTIN_TILES too, so its
    // children are parsed in tile context. Before the fix, the bare ref
    // `Content` parsed as a value expression and was dropped by
    // collectChildren, leaving the base layer empty.
    const src = `
      slot open : Bool = false
      reducer show on=ui.click(OpenBtn) do= open := true
      tile OpenBtn = button(text="Open", onClick=show)
      tile Content = column(heading("BASE-LAYER"))
      tile Modal = card(text("modal"))
      tile App = overlay(Content, when(open, Modal()))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const overlayPart = result.js.split('kind: "overlay"')[1] ?? "";
    expect(overlayPart).toContain("BASE-LAYER");
  });

  it("lowers panic(msg) to the runtime helper, not an undefined fn call (#24)", () => {
    const src = `
      slot draft : Text = ""
      reducer save on=ui.click(B) do= draft := if draft.is-empty then panic("draft cannot be empty") else draft
      tile B = button(text="save", onClick=save)
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Before M1, panic() fell through to a user-fn call (`panic(...)`) — an
    // undefined reference at runtime. It must lower to the runtime helper, and
    // EVERY `panic(` in the output must be the `_s.panic(` form (no bare call).
    expect(result.js).toContain('_s.panic("draft cannot be empty")');
    const total = (result.js.match(/panic\(/g) ?? []).length;
    const helper = (result.js.match(/_s\.panic\(/g) ?? []).length;
    expect(helper).toBeGreaterThan(0);
    expect(total).toBe(helper);
  });

  it("lowers a user fn whose name shadows a builtin tile in value position to a fn call (#03 regression)", () => {
    // `label` is both a VALUE_ARG_BUILTIN tile and, here, a user `fn`. Inside
    // `heading(...)` (a value-arg position) the call must parse as an EXPRESSION,
    // not a nested tile. Before the fix the arg was parsed as a builtin tile and
    // codegen emitted `_s.show(undefined)` — an always-empty heading.
    const src = `
      type Light = Red | Green
      slot light : Light = Red
      fn label(l: Light) -> Text = match l with | Red -> "STOP" | Green -> "GO"
      reducer advance on=ui.click(B) do= light := light
      tile B = button(text="next", onClick=advance)
      tile App = column(heading(label(light)), B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('_s.show(label(_live["light"]))');
    expect(result.js).not.toContain("_s.show(undefined)");
  });

  it("lowers a custom-capability effect to a host provider lookup, not a stub", () => {
    // A custom cap (registered via kumiki.caps.json → `capabilities`) has no
    // built-in implementation. Instead of the old "not implemented" stub, the
    // generated invoke resolves the host-supplied provider at the capability
    // boundary (_caps.provider(cap)) and errors clearly when none is registered.
    const src = `
      slot sent : Int = 0
      effect track cap=telemetry.track in={name: Text} out=Unit
      reducer fire   on=ui.click(B)      do= emit track({name: "click"})
      reducer onSent on=track.ok(_, _)   do= sent := sent + 1
      tile B = button(text="track", onClick=fire)
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, {
      runtimeSpecifier: "./runtime.js",
      capabilities: ["telemetry.track"],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('_caps.provider("telemetry.track")');
    expect(result.js).toContain("Capability telemetry.track has no provider");
    expect(result.js).not.toContain("not implemented");
    // The auto-mount call threads host providers through.
    expect(result.js).toContain("providers: globalThis.__kumikiProviders");
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
    const result = compile(src, {
      runtimeSpecifier: "./runtime.js",
      capabilities: ["telemetry.track"],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('_caps.provider("telemetry.track")');
    expect(result.js).toMatch(/const _req = .*;\s*const _provider = _caps\.provider/s);
  });

  it("emits a default-exported App module instead of auto-mounting when exportApp is set", () => {
    // Build integration (Vite plugin) imports `.kumiki` as a module: it needs an
    // exported AppShape, not a side-effecting auto-mount to #root.
    const src = readFileSync(COUNTER_PATH, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js", exportApp: true });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("export default App;");
    expect(result.js).not.toContain("mount(App, document.getElementById");
  });

  it("auto-mounts (no export) by default", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("mount(App, document.getElementById");
    expect(result.js).not.toContain("export default App;");
  });

  it("makes a standard http effect provider-overridable (provider checked before the builtin)", () => {
    // A host can swap the HTTP transport (axios/ofetch) or inject auth by
    // registering a provider for the standard capability; absent one, the
    // built-in fetch path still runs.
    const src = `
      slot xs : List(Int) = []
      effect load cap=http.get in={url: Url} out=Unit
      reducer go on=ui.click(B) do= emit load({url: "https://example.com/x"})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('_caps.provider("http.get")');
    expect(result.js).toContain("httpFetch(");
    // the handler is imported (modular: its feature module; monolith: the runtime entry)
    expect(result.js).toMatch(/import \{[^}]*httpFetch[^}]*\}/);
    // provider is consulted before the builtin fallback
    expect(result.js).toMatch(/caps\.provider\("http\.get"\)[\s\S]*httpFetch\(/);
  });

  it("wraps per-instance state in a createApp() factory and exports it under exportApp", () => {
    // Multiple independent instances require each mount to get its own live state;
    // the compiled module exposes a factory whose closures bind to that copy.
    const src = readFileSync(COUNTER_PATH, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js", exportApp: true });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("function createApp()");
    expect(result.js).toContain("const App = createApp();");
    expect(result.js).toContain("export { createApp };");
  });

  // Same reason as `js-identifier-safety.test.ts`: a real module load on a
  // cold cache, not a slow compiler.
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
    const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const mod = await importGenerated(result.js);
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // request is mapped, THEN the provider is consulted with the mapped req
    expect(result.js).toMatch(/const _req = [\s\S]*_caps\.provider\("storage\.write"\)/);
    expect(result.js).toContain("storageWrite(");
    expect(result.js).toMatch(/import \{[^}]*storageWrite[^}]*\}/);
  });

  it("dispatches session.read/write to sessionRead/sessionWrite handlers (#84)", () => {
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("sessionRead(");
    expect(result.js).toContain("sessionWrite(");
    expect(result.js).toMatch(/import \{[^}]*sessionRead[^}]*\}/);
    expect(result.js).toMatch(/import \{[^}]*sessionWrite[^}]*\}/);
    // session.* must NOT spuriously pull in the localStorage handlers
    expect(result.js).not.toContain("storageRead");
    expect(result.js).not.toContain("storageWrite");
  });

  // Issue #85: a parent route whose tile declares `sub-routes` must emit a
  // nested `subRoutes:` array on the route entry so the runtime can re-match.
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('pattern: "/settings/*"');
    expect(result.js).toContain("subRoutes:");
    expect(result.js).toContain('pattern: "/settings/account"');
    expect(result.js).toContain('pattern: "/settings"');
  });

  it("lowers `@token` refs in a style block to runtime `_s.token(...)` calls (§4.3)", () => {
    const src = `
      tile Card = box() {style: {background: @colors.surface, padding: @spacing.md, radius: @radius.md, shadow: @shadow.sm, font-size: @typography.size.lg}}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('_s.token("colors", ["surface"])');
    expect(result.js).toContain('_s.token("spacing", ["md"])');
    expect(result.js).toContain('_s.token("radius", ["md"])');
    expect(result.js).toContain('_s.token("shadow", ["sm"])');
    expect(result.js).toContain('_s.token("typography", ["size", "lg"])');
    // `style` is a CSS prop bag the runtime applies to el.style — it must NOT
    // also ride the `el` reducer bag, where it would re-evaluate every
    // `@token` ref for no consumer. The source has two routes pointing at the
    // same App, so each `_s.token(...)` appears exactly once per route (2 ×).
    const colorsHits = (result.js.match(/_s\.token\("colors"/g) ?? []).length;
    expect(colorsHits).toBe(2);
    // And the per-tile `el: { ... }` bag — built only when extra props exist —
    // must not be present (style is the only prop and we drop it from el).
    expect(result.js).not.toMatch(/el: \{ style:/);
  });

  // issue #91 — language.md §1.6.1 + §1.9.
  it("emits onKeyDown for ui.key(EnclosingTile) on an input (§1.6.1)", () => {
    const src = `
      slot k : Text = ""
      reducer onKey on=ui.key(Box) do= k := "hit"
      tile Box = input(bind=k)
      tile App = column(Box)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onKeyDown: _h\("onKey"\)/);
  });

  it("emits onMouseEnter for ui.hover(EnclosingTile) on a box (§1.6.1)", () => {
    const src = `
      slot h : Bool = false
      reducer onHover on=ui.hover(Card) do= h := true
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onMouseEnter: _h\("onHover"\)/);
  });

  // issue #122 — §1.6.1 ui.focus / ui.blur. Parser/AST already accepted
  // these; codegen now lifts them into onFocus / onBlur on focusable tiles
  // (input / textarea / button / select) and skips non-focusable tiles so the
  // runtime never wires a listener that the DOM cannot fire.
  //
  // Reducer names are deliberately NOT `onFocus` / `onBlur` here — those are
  // the emitted prop names, so collision-naming would mask a take-the-wrong-
  // string bug in either the matcher or the dispatch.
  it("emits onFocus for ui.focus(EnclosingTile) on an input (§1.6.1)", () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(InputX) do= f := "focused"
      tile InputX = input(bind=f)
      tile App = column(InputX)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onFocus: _h\("recordFocus"\)/);
  });

  it("emits onBlur for ui.blur(EnclosingTile) on an input (§1.6.1)", () => {
    const src = `
      slot b : Text = ""
      reducer markBlur on=ui.blur(InputX) do= b := "blurred"
      tile InputX = input(bind=b)
      tile App = column(InputX)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onBlur: _h\("markBlur"\)/);
  });

  it("emits onFocus on a textarea (one of the focusable tile gates) (§1.6.1)", () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(NoteArea) do= f := "focused"
      tile NoteArea = textarea(bind=f)
      tile App = column(NoteArea)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onFocus: _h\("recordFocus"\)/);
  });

  // The "non-focusable" guard is a deliberate codegen design choice: a
  // `ui.focus(Card)` subscription targeting a `box` is silently dropped
  // because DOM `focus` would never fire on a non-focusable element anyway.
  // The typecheck pass now also surfaces the same condition as `W0212`
  // (issue #143), so both layers — silent codegen drop AND typecheck
  // warning — are asserted here in lock-step.
  it("does not emit onFocus on a non-focusable tile (box) and surfaces W0212 (§1.6.1)", () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(Card) do= f := "focused"
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).not.toMatch(/onFocus:/);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "W0212", kind: "ui-event-tile-mismatch" }),
      ]),
    );
  });

  it("does not emit onBlur on a non-focusable tile (box) and surfaces W0212 (§1.6.1)", () => {
    const src = `
      slot b : Text = ""
      reducer markBlur on=ui.blur(Card) do= b := "blurred"
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).not.toMatch(/onBlur:/);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "W0212", kind: "ui-event-tile-mismatch" }),
      ]),
    );
  });

  // Explicit-prop passthrough: `input(onFocus=recordFocus)` is a hand-authored
  // wiring that bypasses the implicit-lift block, so the args / props
  // passthrough lists must include onFocus / onBlur. This covers the
  // codegen.ts `for (const a of t.args)` and `for (const p of t.props)` paths.
  it("emits onFocus from explicit `tile = input(onFocus=Reducer)` arg syntax (§1.6.1)", () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(Other) do= f := "focused"
      tile Other = button("noop")
      tile MyInput = input(onFocus=recordFocus)
      tile App = column(MyInput, Other)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onFocus: _h\("recordFocus"\)/);
  });

  it("emits onClick on a radio tile so `ui.click(Radio)` reducers fire (§1.6.1)", () => {
    const src = `
      slot picked : Text = ""
      reducer pick on=ui.click(R) do= picked := "red"
      tile R = radio(group="color")
      tile App = column(R)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onClick: _h\("pick"\)/);
  });

  it("emits onChange on form-control tiles (check / radio / switch / slider) — `ui.change(Tile)` reducers fire (§1.6.1)", () => {
    const cases = [
      { tile: `check(checked=false)`, reducer: "tc" },
      { tile: `radio(group="g")`, reducer: "tr" },
      { tile: `switch(checked=false)`, reducer: "ts" },
      { tile: `slider(min=0, max=10)`, reducer: "tl" },
    ];
    for (const { tile, reducer } of cases) {
      const src = `
        slot v : Text = ""
        reducer ${reducer} on=ui.change(T) do= v := "x"
        tile T = ${tile}
        tile App = column(T)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") continue;
      expect(result.js).toMatch(new RegExp(`onChange: _h\\("${reducer}"\\)`));
    }
  });

  it("emits onBlur from explicit `tile = input(){onBlur: Reducer}` props syntax (§1.6.1)", () => {
    const src = `
      slot b : Text = ""
      reducer markBlur on=ui.blur(Other) do= b := "blurred"
      tile Other = button("noop")
      tile MyInput = input() {onBlur: markBlur}
      tile App = column(MyInput, Other)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onBlur: _h\("markBlur"\)/);
  });

  it("emits an Array.isArray guard for a tuple pattern arm (§1.9)", () => {
    const src = `
      type Light = Red | Green
      fn f(p: Tuple(Light, Light)) -> Text = match p with
        | (Red, Green) -> "rg"
        | (x, y) -> "other"
      slot label : Text = ""
      tile App = text(label)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("Array.isArray");
    expect(result.js).toContain(".length === 2");
    expect(result.js).toContain('_s.variantIs((_v)[0], "Red")');
    expect(result.js).toContain('_s.variantIs((_v)[1], "Green")');
  });

  // issue #91 — tile-match must accept tuple patterns too (§1.4 grammar now
  // mirrors §1.9). Covers the TileMatch lowering path that delegates to the
  // shared `tupleArm` helper.
  it("emits an Array.isArray guard for a tuple pattern in tile-match (§1.4)", () => {
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("Array.isArray");
    expect(result.js).toContain(".length === 2");
    expect(result.js).toContain('_s.variantIs((_v)[0], "A")');
    expect(result.js).toContain('_s.variantIs((_v)[0], "B")');
  });

  // issue #102 — http.cancel + EffectId returned at emit time.
  it("lowers `let id = emit X()` to push + EffectId expression (#102)", () => {
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // The let rhs is an IIFE that pushes the emit AND yields `"search:" + key`.
    expect(result.js).toContain('_emits.push({ effect: "search"');
    expect(result.js).toContain('"search:"');
    // EffectId.none lowers to the empty-string sentinel.
    expect(result.js).toContain('"stored": { value: "" }');
  });

  it("lowers EmitExpr args ONCE so a side-effectful arg matches the runtime id (#102 review)", () => {
    // Before the fix, `let id = emit X(now())` lowered `now()` twice — once
    // for `__input` (drives the EffectId codegen returns) and once for
    // `_emits.push({args: [...]})` (drives the runtime keyOf). Two `now()`
    // values → two different ids → `emit cancel(id)` would silently no-op.
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
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Each arg is lowered into a __a<i> binding once; both the push and the
    // EffectId expression reuse that local.
    expect(result.js).toMatch(/const __a0 = _s\.now\(\);/);
    expect(result.js).toContain('_emits.push({ effect: "search", args: [__a0] })');
    expect(result.js).toContain("(__a0)");
    expect(result.js).toMatch(/"search:" \+ String/);
    // _s.now() must appear exactly once in the generated reducer body —
    // double-eval would surface as two occurrences.
    const occurrences = (result.js.match(/_s\.now\(\)/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("includes effects-http when an effect uses cap=http.cancel (#102)", () => {
    const src = `
      slot stored : EffectId = EffectId.none
      effect cancel cap=http.cancel in=EffectId out=Unit
      reducer go on=ui.click(Btn) do= emit cancel(stored)
      tile Btn = button(text="cancel", onClick=go)
      tile App = column(Btn)
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // The dispatcher special-cases cap=http.cancel — we just need the
    // capability to be wired into the registry and the emit to be present.
    expect(result.js).toContain('"http.cancel"');
    expect(result.js).toContain('_emits.push({ effect: "cancel"');
  });

  it("does not change shorthand-prop codegen — `bg`/`pad` stay as plain string fields (§4.3.1)", () => {
    // Regression guard: shorthand props are still resolved at runtime by
    // applyContainerProps/applyTextProps, NOT desugared at codegen time.
    const src = `
      tile Card = box(text("hi")) {bg: "surface", pad: "md"}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('bg: "surface"');
    expect(result.js).toContain('pad: "md"');
    expect(result.js).not.toContain('_s.token("colors"');
    expect(result.js).not.toContain('_s.token("spacing"');
  });

  it("promotes a11y warnings to compile errors when strictA11y is set (§10.7)", () => {
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

  it("dispatches every reducer subscribing to the same (tile, ui.click) in source order (§1.6.4)", () => {
    // §1.6.4 Invariant 3: "Multiple reducers matching the same event run in
    // definition order". A handler must dispatch every match, not just one.
    const src = `
      slot hits  : Int = 0
      slot saves : Int = 0
      slot logs  : Int = 0
      reducer logHit on=ui.click(SubmitBtn) do= hits  := hits  + 1
      reducer save   on=ui.click(SubmitBtn) do= saves := saves + 1
      reducer audit  on=ui.click(SubmitBtn) do= logs  := logs  + 1
      tile SubmitBtn = button(text="go")
      tile App = column(SubmitBtn, text(hits.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Anchor on dispatch occurrences in the full emitted module (not a regex
    // slice — a `}` inside a future dispatch payload would cut the slice early
    // and silently pass even after a regression).
    // The memoised handler's argument list is the dispatch order.
    const chain = /onClick: _h\(([^)]*)\)/.exec(result.js)?.[1];
    expect(chain).toBe('"logHit", "save", "audit"');
  });

  it("emits a single onClick that wraps the one dispatch when only one reducer matches", () => {
    const src = `
      slot x : Int = 0
      reducer inc on=ui.click(B) do= x := x + 1
      tile B = button(text="+")
      tile App = column(B, text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toMatch(/onClick: _h\("inc"\)/);
  });

  it("chains explicit `onClick=fn` and a separate ui.click reducer on the same tile (§1.6.4)", () => {
    // Explicit-then-implicit on the same handler: spec §1.6.4 says both fire.
    // Explicit goes first (it's declared on the tile that mounts the element),
    // then the implicit subscriber. A skipping carve-out — emitting only the
    // explicit and silently dropping the reducer — would be a spec violation.
    const src = `
      slot x : Int = 0
      slot y : Int = 0
      reducer onExplicit on=app.start do= x := 0
      reducer onImplicit on=ui.click(B) do= y := y + 1
      tile B = button(text="go", onClick=onExplicit)
      tile App = column(B, text(x.show), text(y.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Both dispatches present, explicit before implicit — the chained
    // handler below carries them in that order.
    // Per element they collapse into one chained handler. Guards against a
    // duplicate-key object literal (`{ onClick: a, onClick: b }`) by checking
    // the explicit dispatch and the implicit dispatch land in the same body.
    expect(result.js).toMatch(/onClick: _h\("onExplicit", "onImplicit"\)/);
  });

  it("dedupes overlapping explicit + implicit wiring of the same reducer (no double-fire)", () => {
    // `onClick=inc` and `reducer inc on=ui.click(B)` both target the SAME
    // reducer. Without dedup the chain would dispatch `inc` twice per click
    // — the counter would tick by 2 instead of 1. (Counter example
    // 01-slot-and-reducer.kumiki uses exactly this overlap.)
    const src = `
      slot count : Int = 0
      reducer inc on=ui.click(B) do= count := count + 1
      tile B = button(text="+", onClick=inc)
      tile App = column(B, text(count.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // `inc` is wired once, not twice, so the handler takes a single name.
    const matches = result.js.match(/_h\("inc"\)/g) ?? [];
    // One per route (/, /404) — both renderings emit the same chain.
    expect(matches.length).toBe(2);
    expect(result.js).not.toContain('_h("inc", "inc")');
  });

  it("dispatches every reducer subscribing to the same (tile, ui.submit) in source order (§1.6.4)", () => {
    const src = `
      slot saved : Int = 0
      slot logged : Int = 0
      reducer save  on=ui.submit(LoginForm) do= saved  := saved  + 1
      reducer audit on=ui.submit(LoginForm) do= logged := logged + 1
      tile LoginForm = form(text="login")
      tile App = column(LoginForm, text(saved.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Source order, and a single chained handler rather than two props.
    expect(result.js).toMatch(/onSubmit: _h\("save", "audit"\)/);
  });

  it("dispatches every reducer subscribing to the same (tile, ui.hover) in source order (§1.6.4)", () => {
    // ui.hover lifts onto any tile (no tile-name filter), so this also guards
    // against regressing the broad-applicability rule for the hover path.
    const src = `
      slot warm : Int = 0
      slot logs : Int = 0
      reducer wake on=ui.hover(Card) do= warm := warm + 1
      reducer note on=ui.hover(Card) do= logs := logs + 1
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Source order, carried by the chained handler's argument list.
    expect(result.js).toMatch(/onMouseEnter: _h\("wake", "note"\)/);
  });

  // Issue #188 — the compiler lifts author-written `{key: expr}` from tile
  // props to a top-level `key` field on the emitted TileNode, and synthesizes
  // an implicit key (`_s.show(<loopVar>)`) for tile calls inside `for`
  // iteration bodies that don't declare their own. The runtime uses these
  // keys for stable child reuse across reorder/insert/remove.
  describe("issue #188 — stable tile identity (key)", () => {
    // Helper: user-tile emissions in the codegen output are large parenthetical
    // expressions. Nested `_wk(...)` calls make regex matching brittle, so this
    // helper scans the emitted JS for a `_wk(` call whose payload contains the
    // named boundary and whose key expression matches — using bracket-depth
    // parsing rather than a fragile regex.
    function findWkForBoundary(
      js: string,
      boundaryName: string,
    ): Array<{ payload: string; key: string }> {
      const marker = `"${boundaryName}"`;
      const results: Array<{ payload: string; key: string }> = [];
      for (let i = 0; i < js.length; i++) {
        if (!js.startsWith("_wk(", i)) continue;
        // Walk to the matching close paren of the _wk( call.
        let depth = 1;
        let j = i + 4;
        const start = j;
        for (; j < js.length && depth > 0; j++) {
          const c = js[j];
          if (c === "(") depth++;
          else if (c === ")") depth--;
          if (depth === 0) break;
        }
        const args = js.slice(start, j);
        // Split at the top-level comma (depth 0) between payload and key.
        let d = 0;
        let splitAt = -1;
        for (let k = 0; k < args.length; k++) {
          const c = args[k];
          if (c === "(") d++;
          else if (c === ")") d--;
          else if (c === "," && d === 0) {
            splitAt = k;
            break;
          }
        }
        if (splitAt === -1) continue;
        const payload = args.slice(0, splitAt).trim();
        const key = args.slice(splitAt + 1).trim();
        // Only DIRECT wraps of THIS boundary count. `_named(inner, "Name")`
        // — the second argument to the outermost `_named(` in the payload
        // must be the marker literal. This rejects an outer `_wk` around a
        // container (`_wk(_named(<column with Cell inside>, "Outer"), ...)`)
        // that happens to contain the target name deep in its subtree.
        let directNamedName: string | null = null;
        // Strip a leading error-boundary IIFE if present: `((() => { try { return _named(...)...`
        let scan = payload;
        const iifeMatch = scan.match(/^\(\(\(\)\s*=>\s*\{\s*try\s*\{\s*return\s+/);
        if (iifeMatch) scan = scan.slice(iifeMatch[0].length);
        if (scan.startsWith("_named(")) {
          // Walk to the matching close paren of _named(
          let dd = 1;
          let k = "_named(".length;
          const s2 = k;
          for (; k < scan.length && dd > 0; k++) {
            const c = scan[k];
            if (c === "(") dd++;
            else if (c === ")") dd--;
            if (dd === 0) break;
          }
          const namedArgs = scan.slice(s2, k);
          // Split at top-level comma to isolate the boundary name (second arg).
          let d2 = 0;
          let split2 = -1;
          for (let p = 0; p < namedArgs.length; p++) {
            const c = namedArgs[p];
            if (c === "(") d2++;
            else if (c === ")") d2--;
            else if (c === "," && d2 === 0) {
              split2 = p;
              break;
            }
          }
          if (split2 !== -1) directNamedName = namedArgs.slice(split2 + 1).trim();
        }
        if (directNamedName === marker) {
          results.push({ payload, key });
        }
      }
      return results;
    }

    it("lifts an explicit {key: expr} on a builtin tile call to a top-level `key` field", () => {
      const src = `
        slot xs : List(Int) = [1, 2, 3]
        tile Row = text("row")
        tile App = column(for x in xs Row {key: x.show})
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const wraps = findWkForBoundary(result.js, "Row");
      expect(wraps.length).toBeGreaterThan(0);
      // Every Row wrap for this program derives its key from `x` — either the
      // explicit `x.show` (which lowers to `_s.show(x)`) or the equivalent.
      for (const w of wraps) expect(w.key).toContain("_s.show(x)");
      // The key must NOT leak into `el` (which is the selector-matching
      // payload bag, unrelated to reconcile identity).
      expect(result.js).not.toMatch(/el:\s*\{[^}]*key:/);
    });

    it("synthesizes an implicit key from the loop variable when the tile-for body omits {key: ...}", () => {
      const src = `
        slot xs : List(Int) = [1, 2, 3]
        tile Row = text("row")
        tile App = column(for x in xs Row)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const wraps = findWkForBoundary(result.js, "Row");
      expect(wraps.length).toBeGreaterThan(0);
      for (const w of wraps) expect(w.key).toBe("_s.show(x)");
    });

    it("does not synthesize an implicit key outside of a for iteration", () => {
      // A top-level tile call with no explicit `{key: ...}` should NOT get an
      // implicit key — implicit keys are a for-scope feature and adding one
      // uninvited would pollute the emitted output for every non-iterated tile.
      const src = `
        tile Row = text("row")
        tile App = column(Row)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      // The Row call inside App must not be wrapped in _wk.
      expect(findWkForBoundary(result.js, "Row").length).toBe(0);
    });

    it("nested for-iteration uses the innermost loop variable for the implicit key", () => {
      const src = `
        slot outer : List(Int) = [1]
        slot inner : List(Int) = [2]
        tile Cell = text("c")
        tile App = column(for o in outer row(for i in inner Cell))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const wraps = findWkForBoundary(result.js, "Cell");
      expect(wraps.length).toBeGreaterThan(0);
      // The Cell call sits under the inner `for i in inner` — its implicit
      // key must be `_s.show(i)`, not `_s.show(o)`.
      for (const w of wraps) {
        expect(w.key).toBe("_s.show(i)");
        expect(w.key).not.toBe("_s.show(o)");
      }
    });

    it("propagates the implicit key through TileWhen (for x in xs when(cond, Row))", () => {
      const src = `
        slot xs : List(Int) = [1, 2, 3]
        tile Row = text("row")
        tile App = column(for x in xs when(x > 0, Row))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const wraps = findWkForBoundary(result.js, "Row");
      expect(wraps.length).toBeGreaterThan(0);
      for (const w of wraps) expect(w.key).toBe("_s.show(x)");
    });

    it("propagates the implicit key through TileMatch (for id in ids match kind with |A -> Row)", () => {
      const src = `
        type Kind = A | B
        slot kind : Kind = A
        slot ids : List(Int) = [1, 2, 3]
        tile Row = text("row")
        tile App = column(for id in ids match kind with |A -> Row |B -> Row)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const wraps = findWkForBoundary(result.js, "Row");
      expect(wraps.length).toBeGreaterThan(0);
      // Both match arms sit under \`for id in ids\` — every Row emission must
      // carry the loop var's key, not undefined.
      for (const w of wraps) expect(w.key).toBe("_s.show(id)");
    });

    it("resets the implicit key at user-tile boundaries (inner for uses its own loop var)", () => {
      // Critical invariant: an implicit key introduced by an outer for must
      // NOT leak into the body of a user tile it wraps. Otherwise an inner
      // for in that user tile would silently reuse the outer loop var.
      const src = `
        slot outer : List(Int) = [1]
        slot inner : List(Int) = [2, 3]
        tile Cell = text("c")
        tile Inner = column(for i in inner Cell)
        tile Outer = column(Inner)
        tile App = column(for o in outer Outer)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      // The Outer boundary itself is the target of the outer for → key = o.
      const outerWraps = findWkForBoundary(result.js, "Outer");
      expect(outerWraps.length).toBeGreaterThan(0);
      for (const w of outerWraps) expect(w.key).toBe("_s.show(o)");
      // Cell sits inside Inner's for-body — its key must derive from the
      // inner loop var i, not the outer o (which would be a scope leak).
      const cellWraps = findWkForBoundary(result.js, "Cell");
      expect(cellWraps.length).toBeGreaterThan(0);
      for (const w of cellWraps) {
        expect(w.key).toBe("_s.show(i)");
        expect(w.key).not.toBe("_s.show(o)");
      }
    });
  });
});

// `app.init` arguments and an effect's `latest-per-key` key expression are the
// two places codegen lowers an expression outside any reducer body. Both were
// lowered against a fabricated empty `GenCtx`, so a slot reference had no slot
// table to resolve against and came out as a bare identifier. They fail in
// different places, which matters when one recurs: an init argument sits in the
// app object literal, so the module throws on import; a key expression sits in
// an arrow body, so the app imports and renders and throws on first dispatch.
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

  /** The one emitted line starting with `label`. Line-wise, so a second entry
   *  on the same line cannot slip past a match that stopped at the first `]`. */
  function emittedLine(js: string, label: string): string {
    const line = js.split(/\r?\n/).find((l) => l.includes(label));
    if (line === undefined) throw new Error(`no emitted line contains ${label}`);
    return line;
  }

  it("lowers a slot reference in an app.init argument to the live map", () => {
    const result = compile(SRC, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const init = emittedLine(result.js, "init: [");
    expect(init).toContain('args: [_live["noteKey"]]');
    expect(init).not.toMatch(/args: \[\s*noteKey/);
  });

  it("lowers a slot reference in latest-per-key to the live map", () => {
    const result = compile(SRC, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const keyOf = emittedLine(result.js, "keyOf:");
    expect(keyOf).toContain('String(_live["noteKey"])');
  });

  // Not a regression guard for the bug above — `jsOfExpr` checks `localBinds`
  // before the slot table, so this emits the same text either way. It guards
  // the fix from over-reaching and turning the lambda's own parameter into a
  // slot read, which would break every `latest-per-key($1)` in the corpus.
  it("still binds the key lambda's own $1", () => {
    const result = compile(
      `
      slot got : Text = "none"
      effect load cap=http.get in=Text out=Result(Text, Text) policy=latest-per-key($1)
      reducer onOk on=load.ok($v, _) do= got := $v
      tile App = column(text(got))
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
      `,
      { runtimeSpecifier: "./runtime.js" },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const keyOf = emittedLine(result.js, "keyOf:");
    expect(keyOf).toContain("_d_1");
    expect(keyOf).not.toContain("_live");
  });
});
