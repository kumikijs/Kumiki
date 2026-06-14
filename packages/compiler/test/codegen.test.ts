import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

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
    expect(result.js).toContain("__kumikiApp._dispatch");
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
    // boundary (caps.provider(cap)) and errors clearly when none is registered.
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
    expect(result.js).toContain('caps.provider("telemetry.track")');
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
    expect(result.js).toContain('caps.provider("telemetry.track")');
    expect(result.js).toMatch(/const req = .*;\s*const p = caps\.provider/s);
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
      reducer go on=ui.click(B) do= emit load({url: Url})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('caps.provider("http.get")');
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

  it("produces independent live state from two createApp() instances", async () => {
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
    expect(a.live).not.toBe(b.live);
    a.live.n = 5;
    expect(b.live.n).toBe(0); // mutation of one instance must not leak to the other
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
    expect(result.js).toMatch(/const req = [\s\S]*caps\.provider\("storage\.write"\)/);
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
});
