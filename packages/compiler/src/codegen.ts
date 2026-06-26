// AST → self-contained ES module that uses the runtime API.

import type {
  AppDef,
  EffectDef,
  Expr,
  FnDef,
  Lvalue,
  Pattern,
  PolicyExpr,
  Program,
  ReducerDef,
  Refinement,
  RetryExpr,
  SlotDef,
  Statement,
  TestDef,
  TileDef,
  TileExpr,
  TypeDef,
  TypeExpr,
} from "./ast.ts";
import { BUILTIN_TILES, TILE_FAMILY, type TileFamily } from "./builtins.ts";

export type CodegenOptions = {
  runtimeSpecifier: string;
  /** Emit the in-language `test` definitions (`__kumikiTests`). Off for production builds. */
  includeTests?: boolean;
  /**
   * Emit `export default App;` instead of auto-mounting to `#root`. Use when the
   * module is imported (e.g. the Vite plugin / Web Component embedding) rather
   * than run as a standalone page bundle.
   */
  exportApp?: boolean;
  /**
   * Per-app DCE (#71): when set (e.g. `"./runtime"`), import the granular
   * runtime feature modules from this directory — `<dir>/core.js`,
   * `<dir>/tiles-<family>.js`, … — instead of the single `runtimeSpecifier`
   * module, and mount via `mountCore` with only the modules the app uses.
   * `runtimeModules` on the result lists which files the output imports.
   * Incompatible with `bundle: true` (the inlining path needs the one-import
   * monolith shape).
   */
  runtimeModulesDir?: string;
  /**
   * Resolve an `episode-test load = "<path>"` directive (spec §8.6) to its
   * file contents — the compiler inlines the parsed log into codegen so the
   * runtime test harness does not need filesystem access. Optional; emit a
   * placeholder when omitted and no `episode-test` appears.
   */
  readEpisodeLog?: (relativePath: string) => string;
  /**
   * Optional built-in icon registry (#101). Maps spec-form icon names
   * (e.g. `"check"`, `"chevron-down"`) to single-path SVG `d` data. When
   * provided, only entries whose name appears in `usedIcons` (literal
   * `icon(name="<name>")` references) are baked into the emitted
   * `App.icons`. Apps that don't reference icons pay zero bundle cost.
   * `@kumikijs/vite` and the `kumiki` CLI thread `@kumikijs/icons` through
   * automatically when it is resolvable from the project.
   */
  icons?: Record<string, string>;
};

export type CodegenResult = {
  js: string;
  /**
   * The granular runtime modules (file basenames under `runtimeModulesDir`,
   * without extension) the generated code imports — what `kumiki build` must
   * ship next to the app. Computed in both modes; only meaningful for the
   * modular one.
   */
  runtimeModules: string[];
  /**
   * Icon names referenced by `icon(name="<literal>")` somewhere in the program
   * (#101). The toolchain (`@kumikijs/vite`, `kumiki` CLI) reads this to look
   * up the matching SVG path data in `@kumikijs/icons` and re-run codegen with
   * the `icons` option so only used paths reach the bundle.
   */
  usedIcons: string[];
};

export function codegen(program: Program, opts: CodegenOptions): CodegenResult {
  const types = new Map(
    program.defs.filter((d): d is TypeDef => d.kind === "TypeDef").map((d) => [d.name, d]),
  );
  const slots = program.defs.filter((d): d is SlotDef => d.kind === "SlotDef");
  const effects = program.defs.filter((d): d is EffectDef => d.kind === "EffectDef");
  const reducers = program.defs.filter((d): d is ReducerDef => d.kind === "ReducerDef");
  const fns = program.defs.filter((d): d is FnDef => d.kind === "FnDef");
  const tiles = program.defs.filter((d): d is TileDef => d.kind === "TileDef");
  const apps = program.defs.filter((d): d is AppDef => d.kind === "AppDef");
  const themes = program.defs.filter(
    (d): d is import("./ast.ts").ThemeDef => d.kind === "ThemeDef",
  );
  const motions = program.defs.filter(
    (d): d is import("./ast.ts").MotionDef => d.kind === "MotionDef",
  );
  const tests = program.defs.filter((d): d is TestDef => d.kind === "TestDef");
  const app = apps[0];
  if (!app) throw new Error("No app definition found");

  const ctx: GenCtx = {
    slots,
    fns,
    tiles,
    reducers,
    effects,
    types,
    usedTiles: new Set(),
    usedIcons: new Set(),
  };

  // The import header is emitted AFTER the body below — generating the body
  // fills `ctx.usedTiles`, which (with caps/emits) decides the modular imports.
  const lines: string[] = [];

  // Everything that closes over slot state lives inside `createApp()` so each
  // call produces an independent instance (its own `live` + closures). Multiple
  // mounts / Web Component instances therefore never share state. Pure module
  // data (`_s`) stays outside.
  lines.push("function createApp() {");

  // fn definitions
  for (const fn of fns) {
    lines.push(genFn(fn, ctx));
  }

  // App-wide HTTP config (#78). Emitted unconditionally so the http effect
  // handler's `httpFetch(method, req, _http)` reference never trips TDZ even
  // when an app declares `caps=[http.get]` without an `http={...}` block.
  // `headers` is a closure to re-evaluate slot references per request.
  lines.push(httpConfigJs(app.http, ctx));
  // App-wide IndexedDB config (#79). Always emitted so indexed-* effect calls
  // resolve `_idb`; absent declarations produce `undefined`, which the runtime
  // handlers turn into a clean error (consistent with the storage-unavailable
  // contract from #37).
  lines.push(indexedDbConfigJs(app.indexedDb));
  lines.push("");

  // effect handlers (per capability, statically dispatched)
  lines.push("const _effects = {");
  for (const eff of effects) {
    lines.push(`  ${JSON.stringify(eff.name)}: ${genEffect(eff, ctx)},`);
  }
  lines.push("};");
  lines.push("");

  // Slots
  lines.push("const _slots = {");
  for (const s of slots) {
    const refine = refinementJs(s.type, ctx);
    const r = slotRefinement(s.type, ctx);
    const init = jsOfExpr(s.init, makeEvalCtx(ctx, new Set()));
    // `refineKind`/`refineArgs` let the `error` tile resolve the failed
    // predicate's message at runtime (default text + `theme.errors` override).
    const meta = [`value: ${init}`];
    if (refine) meta.push(`refine: ${refine}`);
    if (r) {
      meta.push(`refineKind: ${JSON.stringify(r.pred)}`);
      meta.push(`refineArgs: ${JSON.stringify(r.args)}`);
    }
    // `volatile` (language.md §175): excludes the slot from SlotDiff records
    // and from SSR snapshots (runtime.md §10.6.1). The runtime reads this off
    // SlotMeta.volatile — emit it so the live mount and `renderToString`
    // agree on the exact set of persisted slots.
    if (s.modifier === "volatile") meta.push("volatile: true");
    lines.push(`  ${JSON.stringify(s.name)}: { ${meta.join(", ")} },`);
  }
  lines.push("};");
  lines.push("");

  // Live slot values
  lines.push("const _live = {};");
  lines.push("for (const [k, v] of Object.entries(_slots)) _live[k] = v.value;");
  lines.push("");

  // Reducers
  lines.push("const _reducers = [");
  for (const r of reducers) lines.push(genReducer(r, ctx));
  lines.push("];");
  lines.push("");

  // Routes table — each route entry produces either a tile factory or a redirect.
  // If the parent tile declares `sub-routes`, attach a nested route table
  // (spec/routing.md §3.6) so the runtime can re-match the path inside the
  // parent's wildcard pattern and inject the matched child into `route-outlet`.
  lines.push("const _routes = [");
  for (const r of app.routes) {
    if (r.tile.startsWith(">>")) {
      const target = r.tile.slice(2);
      lines.push(
        `  { pattern: ${JSON.stringify(r.path)}, redirectTo: ${JSON.stringify(target)} },`,
      );
    } else {
      const tile = tiles.find((t) => t.name === r.tile);
      if (!tile) throw new Error(`Route ${r.path} targets undefined tile "${r.tile}"`);
      const sr = tile.scrollRestoration === false ? ", scrollRestoration: false" : "";
      if (tile.subRoutes && tile.subRoutes.length > 0) {
        lines.push(
          `  { pattern: ${JSON.stringify(r.path)}, tile: () => ${genTile(tile, ctx)}${sr}, subRoutes: [`,
        );
        for (const subR of tile.subRoutes) {
          if (subR.tile.startsWith(">>")) {
            lines.push(
              `    { pattern: ${JSON.stringify(subR.path)}, redirectTo: ${JSON.stringify(subR.tile.slice(2))} },`,
            );
          } else {
            const childTile = tiles.find((t) => t.name === subR.tile);
            if (!childTile)
              throw new Error(
                `Sub-route ${subR.path} in tile "${tile.name}" targets undefined tile "${subR.tile}"`,
              );
            const csr = childTile.scrollRestoration === false ? ", scrollRestoration: false" : "";
            lines.push(
              `    { pattern: ${JSON.stringify(subR.path)}, tile: () => ${genTile(childTile, ctx)}${csr} },`,
            );
          }
        }
        lines.push(`  ] },`);
      } else {
        lines.push(
          `  { pattern: ${JSON.stringify(r.path)}, tile: () => ${genTile(tile, ctx)}${sr} },`,
        );
      }
    }
  }
  lines.push("];");
  lines.push("");

  // Theme registry — the app's chosen theme is selected at mount time.
  lines.push("const _themes = {");
  for (const t of themes) {
    lines.push(`  ${JSON.stringify(t.name)}: ${JSON.stringify(t.body)},`);
  }
  lines.push("};");
  const themeRef = app.theme ? JSON.stringify(app.theme) : "null";
  lines.push("");

  // Motion registry — reusable, scoped animations (M5). The runtime turns each
  // into a `@keyframes` + class block at mount. See ADR-001.
  lines.push("const _motions = {");
  for (const m of motions) {
    lines.push(`  ${JSON.stringify(m.name)}: ${JSON.stringify(m.body)},`);
  }
  lines.push("};");
  lines.push("");

  // App object for this instance (its closures above bind to this call's `_live`).
  lines.push("const App = {");
  lines.push("  slots: _slots,");
  lines.push(`  caps: ${JSON.stringify(app.caps)},`);
  lines.push("  reducers: _reducers,");
  lines.push("  effects: _effects,");
  lines.push(`  init: [${app.init.map((e) => emitFromInitExpr(e)).join(", ")}],`);
  lines.push("  routes: _routes,");
  lines.push("  live: _live,");
  lines.push("  themes: _themes,");
  lines.push(`  themeName: ${themeRef},`);
  lines.push("  motions: _motions,");
  lines.push("  http: _http,");
  lines.push("  indexedDb: _idb,");
  if (app.meta) lines.push(`  meta: ${JSON.stringify(appMetaJson(app.meta))},`);
  if (app.analytics) lines.push(`  analytics: ${JSON.stringify(appAnalyticsJson(app.analytics))},`);
  lines.push("};");

  // Bake-only-what's-used built-in icon registry (#101). The toolchain passes
  // `opts.icons` (from @kumikijs/icons) on the second codegen pass; we emit
  // only the entries whose name appears in a literal `icon(name=...)` call.
  // The runtime renderer (`tiles-text.ts#icon`) falls back through this map
  // when `theme.icons[name]` is unset.
  if (opts.icons && ctx.usedIcons.size > 0) {
    const entries: string[] = [];
    for (const name of [...ctx.usedIcons].sort()) {
      const path = opts.icons[name];
      if (typeof path === "string") {
        entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(path)},`);
      }
    }
    if (entries.length > 0) {
      lines.push("App.icons = {");
      for (const e of entries) lines.push(e);
      lines.push("};");
    }
  }

  // In-language test tile factories close over this instance's live state, so
  // they are built inside the factory and attached to the app.
  if (opts.includeTests && tests.length > 0) {
    lines.push("const _tilesById = {");
    for (const tile of tiles) {
      lines.push(`  ${JSON.stringify(tile.name)}: (${jsName("$1")}) => ${genTile(tile, ctx)},`);
    }
    lines.push("};");
    lines.push("App._tilesById = _tilesById;");
  }

  lines.push("  return App;");
  lines.push("}"); // end createApp
  lines.push("");
  // The default instance — used by auto-mount, the embedding host, and tooling.
  lines.push("const App = createApp();");
  lines.push("globalThis.__kumikiApp = App;");

  // In-language tests (`kumiki test`) run against the default instance.
  if (opts.includeTests && tests.length > 0) {
    lines.push("");
    lines.push("const __kumikiTests = [");
    for (const t of tests) lines.push(genTest(t, ctx, opts));
    lines.push("];");
    lines.push("globalThis.__kumikiTests = __kumikiTests;");
    // Static coverage for `kumiki test --coverage` (§8.7).
    lines.push(`globalThis.__kumikiCoverage = ${coverageJs(tests, reducers, tiles, effects)};`);
  }
  lines.push("");

  // ----- runtime usage analysis (#71) — the body above is fully generated, so
  // `ctx.usedTiles` is complete. -----
  const usage = analyzeRuntimeUsage(app, reducers, effects, ctx.usedTiles, opts, tests.length > 0);

  const header: string[] = [];
  if (opts.runtimeModulesDir) {
    const dir = opts.runtimeModulesDir.replace(/\/+$/, "");
    header.push(`import { mountCore } from "${dir}/core.js";`);
    header.push(`import { _stdlibCore } from "${dir}/stdlib.js";`);
    if (usage.testkit) header.push(`import { _stdlibTest } from "${dir}/testkit.js";`);
    if (usage.router) header.push(`import { routing } from "${dir}/router.js";`);
    if (usage.storage.length > 0)
      header.push(`import { ${usage.storage.join(", ")} } from "${dir}/effects-storage.js";`);
    if (usage.indexed.length > 0)
      header.push(`import { ${usage.indexed.join(", ")} } from "${dir}/effects-indexed.js";`);
    if (usage.http) header.push(`import { httpFetch } from "${dir}/effects-http.js";`);
    if (usage.toast) header.push(`import { installToast } from "${dir}/effects-toast.js";`);
    if (usage.confirm) header.push(`import { installConfirm } from "${dir}/effects-confirm.js";`);
    for (const f of usage.families) {
      header.push(`import { ${tileFamilyVar(f)} } from "${dir}/tiles-${f}.js";`);
    }
    header.push("");
    header.push(
      usage.testkit ? "const _s = { ..._stdlibCore, ..._stdlibTest };" : "const _s = _stdlibCore;",
    );
    header.push(
      `const _tiles = { ${usage.families.map((f) => `...${tileFamilyVar(f)}`).join(", ")} };`,
    );
    header.push("");
  } else {
    // Monolith mode: ONE import line — `inlineRuntime` (bundle: true) strips
    // exactly this line and resolves the names against the inlined bundle's
    // top-level bindings, so everything must ride on a single statement.
    const names = [
      "mount",
      "_stdlib",
      ...usage.storage,
      ...usage.indexed,
      ...(usage.http ? ["httpFetch"] : []),
    ];
    header.push(`import { ${names.join(", ")} } from "${opts.runtimeSpecifier}";`);
    header.push("");
    header.push("const _s = _stdlib;");
    header.push("");
  }

  if (opts.exportApp) {
    // Module mode: the importer (Vite plugin / embedding host) owns mounting.
    // `createApp` lets a host spin up multiple independent instances.
    lines.push("export default App;");
    lines.push("export { createApp };");
  } else if (opts.runtimeModulesDir) {
    // Auto-mount through the granular core: pass exactly the tile renderers /
    // routing / builtin-effect installers this app imports. Host overrides
    // (`__kumikiProviders` / `__kumikiMount`) work as in monolith mode.
    const mountOpts = [
      "tiles: _tiles",
      ...(usage.router ? ["routing"] : []),
      ...(usage.toast || usage.confirm
        ? [
            `builtins: [${[
              ...(usage.toast ? ["installToast"] : []),
              ...(usage.confirm ? ["installConfirm"] : []),
            ].join(", ")}]`,
          ]
        : []),
      "providers: globalThis.__kumikiProviders",
      "...globalThis.__kumikiMount",
    ];
    lines.push(`mountCore(App, document.getElementById("root"), { ${mountOpts.join(", ")} });`);
  } else {
    // Auto-mount. A host embedding the bundle can register custom-capability
    // providers by assigning `globalThis.__kumikiProviders`, and pass any other
    // MountOptions (e.g. `{ router: "memory" }` for a sandboxed preview that
    // doesn't own the URL, #36) via `globalThis.__kumikiMount`, before this
    // module loads (the inbound ecosystem seam; see runtime CapabilityProvider).
    lines.push(
      `mount(App, document.getElementById("root"), { providers: globalThis.__kumikiProviders, ...globalThis.__kumikiMount });`,
    );
  }

  return {
    js: [...header, ...lines].join("\n"),
    runtimeModules: usage.modules,
    usedIcons: [...ctx.usedIcons].sort(),
  };
}

/** The generated identifier holding one tile family's renderer map. */
function tileFamilyVar(f: TileFamily): string {
  return `${f}Tiles`;
}

type IndexedHandler = "indexedRead" | "indexedWrite" | "indexedDelete";

type RuntimeUsage = {
  /** Tile family modules the app renders, in stable order. */
  families: TileFamily[];
  /** True when the app actually routes — see the rules below. */
  router: boolean;
  /** The storage effect handlers referenced by generated invokes
   * (localStorage + sessionStorage share the `effects-storage` module). */
  storage: ("storageRead" | "storageWrite" | "sessionRead" | "sessionWrite")[];
  /** The IndexedDB effect handlers referenced by generated invokes. */
  indexed: IndexedHandler[];
  http: boolean;
  toast: boolean;
  confirm: boolean;
  testkit: boolean;
  /** Runtime module file basenames the generated imports reference. */
  modules: string[];
};

const TILE_FAMILY_ORDER: TileFamily[] = [
  "layout",
  "text",
  "input",
  "collection",
  "overlay",
  "media",
  "status",
];

/**
 * Decide which runtime feature modules a compiled app needs (#71).
 *
 * The router is included only when the app can actually navigate: nav.* caps,
 * `navigate*` emits, a `link` / `route-outlet` tile, a redirect route, or any
 * route pattern beyond the `"/"` + `"/404"` boilerplate every app declares.
 * A counter-class app (static single route, no navigation) therefore renders
 * its `"/"` tile without any router code; the URL is never read, so a deep
 * link to an unknown path shows the root tile instead of the 404 tile — an
 * accepted trade-off recorded in the #71 acceptance.
 */
function analyzeRuntimeUsage(
  app: AppDef,
  reducers: ReducerDef[],
  effects: EffectDef[],
  usedTiles: Set<string>,
  opts: CodegenOptions,
  hasTests: boolean,
): RuntimeUsage {
  const emits = new Set<string>();
  for (const r of reducers) for (const e of collectEmits(r.do)) emits.add(e);
  for (const e of app.init) if (e.kind === "Call") emits.add(e.callee);

  const families = TILE_FAMILY_ORDER.filter((f) =>
    [...usedTiles].some((t) => TILE_FAMILY[t] === f),
  );
  const router =
    app.caps.some((c) => c.startsWith("nav.")) ||
    emits.has("navigate") ||
    emits.has("navigate-replace") ||
    emits.has("navigate-back") ||
    emits.has("scroll-to") ||
    usedTiles.has("link") ||
    usedTiles.has("route-outlet") ||
    app.routes.some((r) => r.tile.startsWith(">>") || (r.path !== "/" && r.path !== "/404"));
  const storage: ("storageRead" | "storageWrite" | "sessionRead" | "sessionWrite")[] = [];
  if (effects.some((e) => e.cap === "storage.read")) storage.push("storageRead");
  if (effects.some((e) => e.cap === "storage.write")) storage.push("storageWrite");
  if (effects.some((e) => e.cap === "session.read")) storage.push("sessionRead");
  if (effects.some((e) => e.cap === "session.write")) storage.push("sessionWrite");
  const indexed: IndexedHandler[] = [];
  // `indexed.read` is dispatched at runtime by input shape (point vs range
  // query), so cap → one handler is enough. Spec §6.7.4.
  if (effects.some((e) => e.cap === "indexed.read")) indexed.push("indexedRead");
  if (effects.some((e) => e.cap === "indexed.write")) indexed.push("indexedWrite");
  if (effects.some((e) => e.cap === "indexed.delete")) indexed.push("indexedDelete");
  const http = effects.some((e) => e.cap.startsWith("http."));
  const toast = app.caps.includes("notification.show") || emits.has("toast");
  // confirm is gated on actual usage (not the cap alone): a `notification.show`
  // app that only emits toast shouldn't ship the modal renderer.
  const confirm = emits.has("confirm");
  const testkit = !!opts.includeTests && hasTests;

  const modules = [
    "core",
    "stdlib",
    ...(testkit ? ["testkit"] : []),
    ...(router ? ["router"] : []),
    ...(storage.length > 0 ? ["effects-storage"] : []),
    ...(indexed.length > 0 ? ["effects-indexed"] : []),
    ...(http ? ["effects-http"] : []),
    ...(toast ? ["effects-toast"] : []),
    ...(confirm ? ["effects-confirm"] : []),
    ...families.map((f) => `tiles-${f}`),
  ];
  return { families, router, storage, indexed, http, toast, confirm, testkit, modules };
}

// ----- test layer -----

function recordField(e: Expr | TileExpr, name: string): Expr | undefined {
  if ((e as Expr).kind !== "RecordLit") return undefined;
  return (e as Expr & { kind: "RecordLit" }).fields.find((f) => f.name === name)?.value;
}

/** All effect names emitted anywhere in a reducer body (descends into control flow). */
function collectEmits(stmts: Statement[]): string[] {
  const out: string[] = [];
  const visitExpr = (e: Expr | undefined): void => {
    if (!e) return;
    switch (e.kind) {
      case "BinOp":
        visitExpr(e.lhs);
        visitExpr(e.rhs);
        return;
      case "UnaryOp":
        visitExpr(e.rhs);
        return;
      case "FieldAccess":
        visitExpr(e.base);
        return;
      case "Index":
        visitExpr(e.base);
        visitExpr(e.index);
        return;
      case "Call":
        for (const a of e.args) visitExpr(a);
        return;
      case "MethodCall":
        visitExpr(e.receiver);
        for (const a of e.args) visitExpr(a);
        return;
      case "RecordLit":
        for (const f of e.fields) visitExpr(f.value);
        return;
      case "ListLit":
        for (const it of e.items) visitExpr(it);
        return;
      case "MapLit":
        for (const en of e.entries) {
          visitExpr(en.key);
          visitExpr(en.value);
        }
        return;
      case "MatchExpr":
        visitExpr(e.scrutinee);
        for (const a of e.arms) visitExpr(a.body);
        return;
      case "IfExpr":
        visitExpr(e.cond);
        visitExpr(e.consequent);
        visitExpr(e.alternate);
        return;
      case "LetIn":
        visitExpr(e.value);
        visitExpr(e.body);
        return;
      case "Variant":
        for (const p of e.payload) visitExpr(p);
        return;
      case "EmitExpr":
        out.push(e.effect);
        for (const a of e.args) visitExpr(a);
        return;
    }
  };
  const walk = (ss: Statement[]): void => {
    for (const s of ss) {
      if (s.kind === "Emit") {
        out.push(s.effect);
        for (const a of s.args) visitExpr(a);
      } else if (s.kind === "LetStmt") visitExpr(s.rhs);
      else if (s.kind === "SlotAssign") visitExpr(s.rhs);
      else if (s.kind === "ForStmt") {
        visitExpr(s.iter);
        walk(s.body);
      } else if (s.kind === "IfStmt") {
        visitExpr(s.cond);
        walk(s.consequent);
        walk(s.alternate);
      } else if (s.kind === "MatchStmt") {
        visitExpr(s.scrutinee);
        for (const a of s.arms) walk(a.body);
      }
    }
  };
  walk(stmts);
  return out;
}

/** Invoke `cb` with each `run-reducer(name)` target inside an expression. */
function scanRunReducers(e: Expr | undefined, cb: (name: string) => void): void {
  if (!e) return;
  if (e.kind === "Call" && e.callee === "run-reducer") cb(reducerNameArg(e.args[0]));
  if (e.kind === "MethodCall" && e.method === "run-reducer") cb(reducerNameArg(e.args[0]));
  switch (e.kind) {
    case "BinOp":
      scanRunReducers(e.lhs, cb);
      scanRunReducers(e.rhs, cb);
      break;
    case "UnaryOp":
      scanRunReducers(e.rhs, cb);
      break;
    case "FieldAccess":
      scanRunReducers(e.base, cb);
      break;
    case "Index":
      scanRunReducers(e.base, cb);
      scanRunReducers(e.index, cb);
      break;
    case "Call":
      for (const a of e.args) scanRunReducers(a, cb);
      break;
    case "MethodCall":
      scanRunReducers(e.receiver, cb);
      for (const a of e.args) scanRunReducers(a, cb);
      break;
    case "RecordLit":
      for (const f of e.fields) scanRunReducers(f.value, cb);
      break;
    case "ListLit":
      for (const it of e.items) scanRunReducers(it, cb);
      break;
    case "MapLit":
      for (const en of e.entries) {
        scanRunReducers(en.key, cb);
        scanRunReducers(en.value, cb);
      }
      break;
    case "MatchExpr":
      scanRunReducers(e.scrutinee, cb);
      for (const a of e.arms) scanRunReducers(a.body, cb);
      break;
    case "IfExpr":
      scanRunReducers(e.cond, cb);
      scanRunReducers(e.consequent, cb);
      scanRunReducers(e.alternate, cb);
      break;
    case "LetIn":
      scanRunReducers(e.value, cb);
      scanRunReducers(e.body, cb);
      break;
    case "Variant":
      for (const p of e.payload) scanRunReducers(p, cb);
      break;
  }
}

/**
 * Static `--coverage` data (§8.7): which reducers / tiles / effects the test
 * suite exercises. A reducer-test/property-test covers its target reducer(s)
 * and the effects those reducers emit; a tile-test covers its tile; mocked
 * effects count as covered too.
 */
function coverageJs(
  tests: TestDef[],
  reducers: ReducerDef[],
  tiles: TileDef[],
  effects: EffectDef[],
): string {
  const usedReducers = new Set<string>();
  const usedTiles = new Set<string>();
  const usedEffects = new Set<string>();
  const byName = new Map(reducers.map((r) => [r.name, r]));
  const markReducer = (name: string): void => {
    const r = byName.get(name);
    if (!r) return;
    usedReducers.add(name);
    for (const eff of collectEmits(r.do)) usedEffects.add(eff);
  };
  // A mocked effect result drives its `.ok`/`.err` reducers, so those count too.
  const markEffectReducers = (effect: string, outcome: "ok" | "err"): void => {
    for (const r of reducers) {
      if (r.on.kind === "EffectEvent" && r.on.effect === effect && r.on.outcome === outcome) {
        markReducer(r.name);
      }
    }
  };
  for (const t of tests) {
    if (t.testKind === "reducer-test") {
      if (t.target) markReducer(t.target);
      const mocks = recordField(t.given, "mocks");
      if (mocks?.kind === "RecordLit") {
        for (const f of mocks.fields) {
          usedEffects.add(f.name);
          const outcome = mockOutcome(f.value);
          if (outcome) markEffectReducers(f.name, outcome);
        }
      }
    } else if (t.testKind === "tile-test") {
      if (t.target) usedTiles.add(t.target);
    } else if (t.testKind === "property-test") {
      scanRunReducers(t.invariant, markReducer);
    } else if (t.testKind === "episode-test") {
      // episode-test replays a log: every effect mocked is one the test exercises.
      if (t.mocks?.kind === "RecordLit") {
        for (const f of t.mocks.fields) {
          usedEffects.add(f.name);
          if (f.value.kind === "Ref" && f.value.name === "from-log") {
            markEffectReducers(f.name, "ok");
            markEffectReducers(f.name, "err");
          } else {
            const outcome = mockOutcome(f.value);
            if (outcome) markEffectReducers(f.name, outcome);
          }
        }
      }
    }
  }
  const cat = (all: string[], used: Set<string>): string =>
    `{ total: ${JSON.stringify(all)}, used: ${JSON.stringify(all.filter((n) => used.has(n)))} }`;
  return `{ reducers: ${cat(
    reducers.map((r) => r.name),
    usedReducers,
  )}, tiles: ${cat(
    tiles.map((t) => t.name),
    usedTiles,
  )}, effects: ${cat(
    effects.map((e) => e.name),
    usedEffects,
  )} }`;
}

function genTest(t: TestDef, gen: GenCtx, opts: CodegenOptions): string {
  const ctx = makeEvalCtx(gen, new Set());
  const nameJs = JSON.stringify(t.name);
  if (t.testKind === "episode-test") {
    // §8.6: load the episode log at compile time so the runtime test harness
    // never touches the filesystem. The reader is injected via CodegenOptions
    // (Node-only callers pass `nodeEpisodeLogReader`); without it we emit a
    // failing stub so a misconfigured CLI surfaces the gap loudly.
    let episodesJs = "[]";
    if (opts.readEpisodeLog && t.load) {
      const raw = opts.readEpisodeLog(t.load);
      const parsed = parseEpisodeLog(raw);
      episodesJs = JSON.stringify(parsed);
    }
    const mocksJsStr = t.mocks ? episodeMockJs(t.mocks, ctx) : "{}";
    const expectJs = t.expect ? episodeExpectJs(t.expect as Expr, ctx) : "{}";
    return `  {
    name: ${nameJs},
    kind: "episode-test",
    run: () => _s.runEpisodeTest({
      name: ${nameJs},
      app: App,
      episodes: ${episodesJs},
      mocks: ${mocksJsStr},
      expect: ${expectJs},
    }),
  },`;
  }
  if (t.testKind === "property-test") {
    const forAll = t.forAll ?? [];
    // forAll var names are local binds, so invariant/given refs lower to the
    // `const <name> = _b[...]` we destructure at the top of the trial fn.
    const pctx = makeEvalCtx(gen, new Set(forAll.map((f) => f.name)));
    const varsJs = forAll
      .map(
        (f) =>
          `${JSON.stringify(f.name)}: ${JSON.stringify(typeToGenDesc(f.type, gen, new Set()))}`,
      )
      .join(", ");
    const binds = forAll
      .map((f) => `const ${jsName(f.name)} = _b[${JSON.stringify(f.name)}];`)
      .join(" ");
    const givenSlots = recordField(t.given, "slots");
    const initSlotsJs = givenSlots ? jsOfExpr(givenSlots, pctx) : "({})";
    const event = recordField(t.given, "event");
    const eventJs = eventPayloadJs(event, pctx);
    const invariantJs = t.invariant ? jsOfExpr(t.invariant, pctx) : "true";
    const opts = [
      t.count !== undefined ? `count: ${t.count}` : null,
      t.shrink !== undefined ? `shrink: ${t.shrink}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `  {
    name: ${nameJs},
    kind: "property-test",
    run: () => _s.runPropertyTest({
      name: ${nameJs},
      vars: { ${varsJs} },
      trial: (_b) => {
        ${binds}
        const _init = { slots: ${initSlotsJs} };
        const _event = ${eventJs};
        return ${invariantJs};
      },${opts ? ` ${opts},` : ""}
    }),
  },`;
  }
  if (t.testKind === "reducer-test") {
    // A reducer-test always has an Expr `expect` (only property-test omits it).
    const expectExpr = t.expect as Expr;
    const slots = recordField(t.given, "slots");
    const event = recordField(t.given, "event");
    const slotsJs = slots ? jsOfExpr(slots, ctx) : "({})";
    const elJs = eventPayloadJs(event, ctx);
    const panic = recordField(expectExpr, "panic");
    let expectJs: string;
    if (panic) {
      expectJs = `{ kind: "panic", message: ${jsOfExpr(panic, ctx)} }`;
    } else {
      const xs = recordField(expectExpr, "slots");
      const xe = recordField(expectExpr, "effects");
      const xsJs = xs ? jsOfExpr(xs, ctx) : "({})";
      const effectsJs = xe ? effectListJs(xe, ctx) : "[]";
      expectJs = `{ kind: "state", slots: ${xsJs}, effects: ${effectsJs} }`;
    }
    // §8.5: with `given.mocks`, drive the multi-step emit→result→reducer flow
    // (effect results injected from the mocks) instead of a single reducer apply.
    const mocks = recordField(t.given, "mocks");
    if (mocks) {
      return `  {
    name: ${nameJs},
    kind: "reducer-test",
    run: () => {
      _s.resetLive(App.live, App.slots, ${slotsJs});
      const _el = ${elJs};
      return _s.runReducerTestFlow({ name: ${nameJs}, app: App, target: ${JSON.stringify(t.target)}, el: _el, mocks: ${mocksJs(mocks, ctx)}, expect: ${expectJs} });
    },
  },`;
    }
    return `  {
    name: ${nameJs},
    kind: "reducer-test",
    run: () => {
      _s.resetLive(App.live, App.slots, ${slotsJs});
      const _el = ${elJs};
      const _r = App.reducers.find((r) => r.name === ${JSON.stringify(t.target)});
      if (!_r) throw new Error("reducer ${t.target} not found");
      let _res = null, _panic = null;
      try { _res = _r.apply(App.live, { $el: _el, $event: _el }); }
      catch (e) { _panic = (e && e.message) ? e.message : String(e); }
      return _s.runReducerTest({ name: ${nameJs}, givenSlots: { ...App.live }, result: _res, panic: _panic, expect: ${expectJs} });
    },
  },`;
  }
  // tile-test
  const slots = recordField(t.given, "slots");
  const slotsJs = slots ? jsOfExpr(slots, ctx) : "({})";
  const inField = recordField(t.given, "in");
  const inJs = inField ? jsOfExpr(inField, ctx) : "undefined";
  const expectedJs = tileExprJs(t.expect as TileExpr, gen, ctx);
  return `  {
    name: ${nameJs},
    kind: "tile-test",
    run: () => {
      _s.resetLive(App.live, App.slots, ${slotsJs});
      const _actual = App._tilesById[${JSON.stringify(t.target)}](${inJs});
      const _expected = ${expectedJs};
      return _s.runTileTest({ name: ${nameJs}, actual: _actual, expected: _expected });
    },
  },`;
}

/**
 * Compile a `[eff(a), ...]` expect.effects list into `[{effect, args, argsSpecified}]`.
 * A bare name (`persist`) matches by name only (`argsSpecified: false`); a call
 * (`persist(x)`, even `persist()`) pins the exact arguments (`argsSpecified: true`).
 */
function effectListJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "ListLit") return "[]";
  const items = e.items.map((it) => {
    if (it.kind === "Call") {
      const args = it.args.map((a) => jsOfExpr(a, ctx)).join(", ");
      return `{ effect: ${JSON.stringify(it.callee)}, args: [${args}], argsSpecified: true }`;
    }
    if (it.kind === "Ref") {
      return `{ effect: ${JSON.stringify(it.name)}, args: [], argsSpecified: false }`;
    }
    return `{ effect: "?", args: [], argsSpecified: false }`;
  });
  return `[${items.join(", ")}]`;
}

/**
 * Compile a reducer-test `given.mocks` record into a `{effect: {outcome, value, delayMs?}}`
 * map for the flow runner (§8.5). Each value is `ok(v)` / `err(e)` / `delay(ms, ok(v)|err(e))`.
 */
/**
 * Parse an episode log (one JSON Episode per line — JSONL — or a JSON array).
 * Surfaces malformed lines as a compile-time throw rather than smuggling them
 * into the generated test: a corrupted fixture means the test would lie.
 */
function parseEpisodeLog(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("episode log: JSON root must be an array");
    return arr;
  }
  const out: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    out.push(JSON.parse(s));
  }
  return out;
}

/**
 * Lower an `episode-test`'s `mocks = { effect: from-log | ignore | ok(v) | err(e) }`
 * record into the runtime call shape. `from-log` and `ignore` arrive as bare
 * identifiers (Ref nodes); `ok` / `err` carry a payload Expr that we evaluate
 * in the test's binding context.
 */
function episodeMockJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "RecordLit") return "{}";
  const parts = e.fields.map((f) => {
    const v = f.value;
    const key = JSON.stringify(f.name);
    if (v.kind === "Ref" && v.name === "from-log") return `${key}: { policy: "from-log" }`;
    if (v.kind === "Ref" && v.name === "ignore") return `${key}: { policy: "ignore" }`;
    if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) {
      const value = v.args[0] ? jsOfExpr(v.args[0], ctx) : "null";
      return `${key}: { policy: "fixed", outcome: ${JSON.stringify(v.callee)}, value: ${value} }`;
    }
    // Defense-in-depth: typecheck (E0712) rejects this before we get here.
    // If a caller skips check() the loud throw beats silently treating a
    // typo'd `from_log` as `ignore` and passing the test.
    throw new Error(
      `episode-test mock for "${f.name}" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``,
    );
  });
  return `{ ${parts.join(", ")} }`;
}

/**
 * Lower an `episode-test`'s `expect = { slots-equal, no-panics, no-errors }`.
 * `slots-equal` accepts either the literal `from-log` (use the log's recorded
 * final slot values) or a record of expected slot → value pairs.
 */
function episodeExpectJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "RecordLit") return "{}";
  const parts: string[] = [];
  for (const f of e.fields) {
    if (f.name === "slots-equal" || f.name === "slotsEqual") {
      if (f.value.kind === "Ref" && f.value.name === "from-log") {
        parts.push(`slotsEqual: "from-log"`);
      } else {
        parts.push(`slotsEqual: ${jsOfExpr(f.value, ctx)}`);
      }
    } else if (f.name === "no-panics" || f.name === "noPanics") {
      parts.push(`noPanics: ${jsOfExpr(f.value, ctx)}`);
    } else if (f.name === "no-errors" || f.name === "noErrors") {
      parts.push(`noErrors: ${jsOfExpr(f.value, ctx)}`);
    }
  }
  return `{ ${parts.join(", ")} }`;
}

function mocksJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "RecordLit") return "{}";
  const parts = e.fields.map((f) => `${JSON.stringify(f.name)}: ${mockScriptJs(f.value, ctx)}`);
  return `{ ${parts.join(", ")} }`;
}

function mockScriptJs(v: Expr, ctx: EvalCtx): string {
  if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) {
    const value = v.args[0] ? jsOfExpr(v.args[0], ctx) : "null";
    return `{ outcome: ${JSON.stringify(v.callee)}, value: ${value} }`;
  }
  if (v.kind === "Call" && v.callee === "delay") {
    const ms = v.args[0] ? jsOfExpr(v.args[0], ctx) : "0";
    const inner = v.args[1];
    if (inner?.kind === "Call" && (inner.callee === "ok" || inner.callee === "err")) {
      const value = inner.args[0] ? jsOfExpr(inner.args[0], ctx) : "null";
      return `{ outcome: ${JSON.stringify(inner.callee)}, value: ${value}, delayMs: ${ms} }`;
    }
  }
  return `{ outcome: "ok", value: null }`;
}

/**
 * The reducer payload (`$el` / `$event`) for a reducer-test's `given.event`.
 * Uses `el` when present (spec §8.5), otherwise the event's other fields
 * (everything except `type` / `target`) so flat `{type, target, value}` forms
 * still reach the reducer.
 */
function eventPayloadJs(event: Expr | undefined, ctx: EvalCtx): string {
  if (event?.kind !== "RecordLit") return "({})";
  const el = event.fields.find((f) => f.name === "el");
  if (el) return jsOfExpr(el.value, ctx);
  const rest = event.fields.filter((f) => f.name !== "type" && f.name !== "target");
  if (rest.length === 0) return "({})";
  return jsOfExpr({ kind: "RecordLit", fields: rest, pos: event.pos }, ctx);
}

type GenCtx = {
  slots: SlotDef[];
  fns: FnDef[];
  tiles: TileDef[];
  reducers: ReducerDef[];
  effects: EffectDef[];
  types: Map<string, TypeDef>;
  /** Built-in tile kinds the generated code emits (filled during generation, #71). */
  usedTiles: Set<string>;
  /**
   * Icon names referenced by `icon(name="<literal>")` (#101). Collected during
   * tile-body generation and used to bake only the referenced entries from
   * `opts.icons` into the emitted `App.icons` map. Dynamic `name=<expr>` calls
   * are not captured — they resolve via `theme.icons` at runtime.
   */
  usedIcons: Set<string>;
};

type EvalCtx = {
  gen: GenCtx;
  localBinds: Set<string>;
  /** When set, Ref(slot) reads from `_next` first, falling back to `_live`. */
  reducerScope?: boolean;
};

function makeEvalCtx(gen: GenCtx, locals: Set<string>, reducerScope = false): EvalCtx {
  return { gen, localBinds: new Set(locals), reducerScope };
}

function _findTile(tiles: TileDef[], name: string): TileDef {
  const t = tiles.find((x) => x.name === name);
  if (!t) throw new Error(`Tile "${name}" not found`);
  return t;
}

// ----- app.http (#78) -----

function httpConfigJs(http: AppDef["http"], gen: GenCtx): string {
  if (!http) return "const _http = undefined;";
  // Plain (non-reducer) scope: slot refs lower to `_live[name]`, not
  // `_next[name] ?? _live[name]` — `_next` is local to each reducer's
  // generated body and out of reach from `_http`'s closures.
  const ctx = makeEvalCtx(gen, new Set(), false);
  const fields: string[] = [];
  if (http.baseUrl) fields.push(`baseUrl: ${jsOfExpr(http.baseUrl, ctx)}`);
  if (http.headers) fields.push(`headers: () => (${jsOfExpr(http.headers, ctx)})`);
  if (http.timeout) fields.push(`timeout: ${jsOfExpr(http.timeout, ctx)}`);
  if (http.credentials) fields.push(`credentials: ${jsOfExpr(http.credentials, ctx)}`);
  if (http.on401) fields.push(`on401: ${JSON.stringify(http.on401)}`);
  if (http.on403) fields.push(`on403: ${JSON.stringify(http.on403)}`);
  if (http.on5xx) fields.push(`on5xx: ${JSON.stringify(http.on5xx)}`);
  return `const _http = { ${fields.join(", ")} };`;
}

// ----- app.indexed-db (#79) -----

function indexedDbConfigJs(idb: AppDef["indexedDb"]): string {
  if (!idb) return "const _idb = undefined;";
  return `const _idb = ${JSON.stringify({ name: idb.name, version: idb.version, stores: idb.stores })};`;
}

// ----- app.meta / app.analytics (#80) -----

function appMetaJson(meta: NonNullable<AppDef["meta"]>): Record<string, string> {
  const out: Record<string, string> = {};
  if (meta.title !== undefined) out.title = meta.title;
  if (meta.description !== undefined) out.description = meta.description;
  if (meta.ogImage !== undefined) out.ogImage = meta.ogImage;
  if (meta.favicon !== undefined) out.favicon = meta.favicon;
  return out;
}

function appAnalyticsJson(analytics: NonNullable<AppDef["analytics"]>): Record<string, string> {
  const out: Record<string, string> = { provider: analytics.provider };
  if (analytics.appId !== undefined) out.appId = analytics.appId;
  return out;
}

// ----- fn -----

function genFn(fn: FnDef, gen: GenCtx): string {
  const params = fn.params.map((p) => p.name).join(", ");
  const ctx = makeEvalCtx(gen, new Set([...fn.params.map((p) => p.name), "$1", "$2"]));
  return `function ${jsName(fn.name)}(${params}) { return ${jsOfExpr(fn.body, ctx)}; }`;
}

// ----- effect -----

/**
 * The built-in implementation call for a standard capability, given the request
 * variable name. Returns null for custom capabilities (no built-in — a host
 * provider is required).
 */
function builtinEffectCall(eff: EffectDef, reqVar: string): string | null {
  // Bare names (not `builtinEffects.*`) so the modular build can import each
  // handler from its feature module; the assembled runtime entry exports the
  // same names top-level for the monolith/inlining path (#71).
  if (eff.cap === "storage.read") {
    return `storageRead(${eff.mapRequest ? `{ key: ${reqVar}.key }` : reqVar})`;
  }
  if (eff.cap === "storage.write") {
    return `storageWrite(${
      eff.mapRequest ? `{ key: ${reqVar}.key, value: ${reqVar}.value }` : reqVar
    })`;
  }
  if (eff.cap === "session.read") {
    return `sessionRead(${eff.mapRequest ? `{ key: ${reqVar}.key }` : reqVar})`;
  }
  if (eff.cap === "session.write") {
    return `sessionWrite(${
      eff.mapRequest ? `{ key: ${reqVar}.key, value: ${reqVar}.value }` : reqVar
    })`;
  }
  if (eff.cap === "indexed.read") return `indexedRead(${reqVar}, _idb)`;
  if (eff.cap === "indexed.write") return `indexedWrite(${reqVar}, _idb)`;
  if (eff.cap === "indexed.delete") return `indexedDelete(${reqVar}, _idb)`;
  if (eff.cap === "http.cancel") {
    // cap=http.cancel is a meta-effect — the dispatcher special-cases it and
    // never reaches the invoke. Codegen still needs SOME `invoke` so the
    // EffectSpec shape stays uniform; an immediate `ok` keeps a host
    // provider's mocked behaviour honest if it's ever called through tests.
    return `{ kind: "ok", value: null }`;
  }
  if (eff.cap.startsWith("http.")) {
    const method = eff.cap.slice("http.".length).toUpperCase();
    return `httpFetch(${JSON.stringify(method)}, ${reqVar}, _http, signal)`;
  }
  return null;
}

function genEffect(eff: EffectDef, gen: GenCtx): string {
  // Every effect invoke follows one shape: (1) map the request if `map-request`
  // is present, (2) consult the host provider for this capability and delegate
  // to it if registered (the ecosystem seam — lets a host swap the HTTP
  // transport, inject auth, mock, etc.), (3) otherwise fall back to the built-in
  // implementation. Custom capabilities have no built-in, so their fallback is a
  // clear "no provider" error.
  const capJs = JSON.stringify(eff.cap);
  const reqVar = eff.mapRequest ? "req" : "input";
  const builtin = builtinEffectCall(eff, reqVar);
  const fallback =
    builtin ??
    `{ kind: "err", value: { message: ${JSON.stringify(`Capability ${eff.cap} has no provider`)} } }`;
  const tail = `const p = caps.provider(${capJs}); if (p) return p(${reqVar}, caps, signal); return ${fallback};`;

  let invokeBody: string;
  if (eff.mapRequest) {
    const mapJs = jsOfExpr(eff.mapRequest, makeEvalCtx(gen, new Set(["$1"])));
    invokeBody = `async (${jsName("$1")}, caps, signal) => { const req = ${mapJs}; ${tail} }`;
  } else {
    invokeBody = `async (input, caps, signal) => { ${tail} }`;
  }

  return `{
    name: ${JSON.stringify(eff.name)},
    cap: ${JSON.stringify(eff.cap)},
    policy: ${policyJs(eff.policy)},
    retry: ${retryJs(eff.retry)},
    invoke: ${invokeBody},
  }`;
}

function retryJs(r?: RetryExpr): string {
  if (!r || r.kind === "RetryNone") return "undefined";
  if (r.kind === "RetryLinear") return `{ kind: "linear", n: ${r.n}, ms: ${r.ms} }`;
  return `{ kind: "exponential", n: ${r.n}, ms: ${r.ms}, factor: ${r.factor} }`;
}

function policyJs(p?: PolicyExpr): string {
  if (!p) return "undefined";
  switch (p.kind) {
    case "PolLatest":
      return `{ kind: "latest" }`;
    case "PolLatestKey":
      return `{ kind: "latest-per-key", keyOf: ((${jsName("$1")}) => String(${jsOfExpr(p.key, { gen: {} as GenCtx, localBinds: new Set(["$1"]) })})) }`;
    case "PolQueue":
      return `{ kind: "queue" }`;
    case "PolDebounce":
      return `{ kind: "debounce", ms: ${p.ms} }`;
    case "PolThrottle":
      return `{ kind: "throttle", ms: ${p.ms} }`;
    case "PolOnce":
      return `{ kind: "once" }`;
  }
}

// ----- reducer -----

function genReducer(r: ReducerDef, gen: GenCtx): string {
  const locals = new Set<string>(["$el", "$event", "$route"]);
  if (r.on.kind === "EffectEvent") for (const b of r.on.binds) if (b !== "_") locals.add(b);
  const ctx = makeEvalCtx(gen, locals, true);

  // event descriptor
  let eventJs: string;
  let selectorJs = "undefined";
  if (r.on.kind === "UiEvent") {
    eventJs = `{ kind: "ui", ev: ${JSON.stringify(r.on.ev)} }`;
    selectorJs = `{ tile: ${JSON.stringify(r.on.selector.tile)}${r.on.selector.id ? `, id: ${JSON.stringify(r.on.selector.id)}` : ""} }`;
  } else if (r.on.kind === "EffectEvent") {
    eventJs = `{ kind: "effect", effect: ${JSON.stringify(r.on.effect)}, outcome: ${JSON.stringify(r.on.outcome)} }`;
  } else if (r.on.kind === "TimerEvent") {
    const nameJs = r.on.name !== undefined ? `, name: ${JSON.stringify(r.on.name)}` : "";
    eventJs = `{ kind: "timer", intervalMs: ${r.on.intervalMs}${nameJs} }`;
  } else {
    eventJs = `{ kind: "lifecycle", name: ${JSON.stringify(r.on.name)} }`;
  }

  // emits collection
  const stmtLines: string[] = [];
  stmtLines.push(`const _next = {};`);
  stmtLines.push(`const _emits = [];`);
  stmtLines.push(`const _stops = [];`);
  // bind payload positional args. For effect events, $1, $2, etc. are payload props.
  if (r.on.kind === "EffectEvent") {
    for (let i = 0; i < r.on.binds.length; i++) {
      const name = r.on.binds[i]!;
      if (name === "_") continue;
      stmtLines.push(`const ${jsName(name)} = _payload[${JSON.stringify(`$${i + 1}`)}];`);
    }
  }
  stmtLines.push(`const ${jsName("$el")} = _payload.$el || {};`);
  stmtLines.push(`const ${jsName("$event")} = _payload.$event || _payload || {};`);
  stmtLines.push(`const ${jsName("$route")} = _payload.$route || {};`);

  for (const st of r.do) stmtLines.push(genStatement(st, ctx));

  stmtLines.push(`return { slots: _next, emits: _emits, stopTimers: _stops };`);

  return `  {
    name: ${JSON.stringify(r.name)},
    selector: ${selectorJs},
    event: ${eventJs},
    apply: (_slotsLive, _payload) => {
      ${stmtLines.join("\n      ")}
    },
  },`;
}

function genStatement(s: Statement, ctx: EvalCtx): string {
  if (s.kind === "ForStmt") {
    const iter = jsOfExpr(s.iter, ctx);
    const inner = makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
    inner.localBinds.add(s.bind);
    const body = s.body.map((b) => genStatement(b, inner)).join("\n  ");
    return `for (const ${jsName(s.bind)} of ((${iter}) || [])) {\n  ${body}\n}`;
  }
  if (s.kind === "IfStmt") {
    const cond = jsOfExpr(s.cond, ctx);
    const thenBody = s.consequent.map((b) => genStatement(b, ctx)).join("\n  ");
    const elseBody = s.alternate.map((b) => genStatement(b, ctx)).join("\n  ");
    return `if (${cond}) {\n  ${thenBody}\n} else {\n  ${elseBody}\n}`;
  }
  if (s.kind === "MatchStmt") {
    const sc = jsOfExpr(s.scrutinee, ctx);
    const arms = s.arms
      .map((arm) => {
        if (arm.pattern.kind === "PVariant") {
          const inner = makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
          for (const b of arm.pattern.binds) if (b !== "_") inner.localBinds.add(b);
          const binds = arm.pattern.binds
            .map((b, i) =>
              b !== "_" ? `const ${jsName(b)} = _v[${JSON.stringify(`_${i}`)}];` : "",
            )
            .join(" ");
          const body = arm.body.map((b) => genStatement(b, inner)).join("\n  ");
          return `if (_s.variantIs(_v, ${JSON.stringify(arm.pattern.name)})) { ${binds}\n  ${body}\n}`;
        }
        if (arm.pattern.kind === "PBind") {
          const inner = makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
          inner.localBinds.add(arm.pattern.name);
          const body = arm.body.map((b) => genStatement(b, inner)).join("\n  ");
          return `if (true) { const ${jsName(arm.pattern.name)} = _v;\n  ${body}\n}`;
        }
        if (arm.pattern.kind === "PTuple") {
          const { guard, binds, inner } = tupleArm(arm.pattern, ctx, "_v", true);
          const body = arm.body.map((b) => genStatement(b, inner)).join("\n  ");
          return `if (${guard}) { ${binds}\n  ${body}\n}`;
        }
        const body = arm.body.map((b) => genStatement(b, ctx)).join("\n  ");
        return `if (true) {\n  ${body}\n}`;
      })
      .join(" else ");
    return `{ const _v = ${sc};\n  ${arms}\n}`;
  }
  if (s.kind === "NoopStmt") {
    return `/* no-op */`;
  }
  if (s.kind === "LetStmt") {
    const rhs = jsOfExpr(s.rhs, ctx);
    ctx.localBinds.add(s.name);
    return `const ${jsName(s.name)} = ${rhs};`;
  }
  if (s.kind === "Emit") {
    // `confirm` (lifecycle §7.6) carries `onYes`/`onNo` reducer references —
    // bare identifiers naming a top-level reducer. Encode those fields as
    // string literals so the runtime can dispatch by name; everything else
    // (title/message and any non-Ref values) takes the normal expression path.
    if (s.effect === "confirm") {
      const args = s.args.map((a) => jsOfConfirmArg(a, ctx)).join(", ");
      return `_emits.push({ effect: "confirm", args: [${args}] });`;
    }
    const args = s.args.map((a) => jsOfExpr(a, ctx)).join(", ");
    return `_emits.push({ effect: ${JSON.stringify(s.effect)}, args: [${args}] });`;
  }
  if (s.kind === "StopTimer") {
    return `_stops.push(${JSON.stringify(s.name)});`;
  }
  return genSlotAssign(s.lvalue, s.rhs, ctx);
}

function genSlotAssign(lv: Lvalue, rhs: Expr, ctx: EvalCtx): string {
  const rhsJs = jsOfExpr(rhs, ctx);
  if (lv.kind === "LSlot") {
    return `_next[${JSON.stringify(lv.name)}] = ${rhsJs};`;
  }
  // Build update for nested lvalue.
  // The root slot name + path → produce a new object.
  const root = lvalueRootName(lv);
  const path: ({ kind: "field"; name: string } | { kind: "index"; expr: Expr })[] = [];
  let cur: Lvalue = lv;
  while (cur.kind !== "LSlot") {
    if (cur.kind === "LField") path.unshift({ kind: "field", name: cur.field });
    else path.unshift({ kind: "index", expr: cur.index });
    cur = cur.base;
  }
  // Generate an inline `setPath(root, path, value)` expression. Inside a reducer
  // body we read from `_next` first so successive writes in a `for` loop see
  // the previous iteration's updates.
  const rootKey = JSON.stringify(root);
  const baseJs = ctx.reducerScope
    ? `(((_next[${rootKey}] !== undefined) ? _next[${rootKey}] : _live[${rootKey}]) ?? {})`
    : `(_live[${rootKey}] ?? {})`;
  let pathExpr = "";
  for (const seg of path) {
    if (seg.kind === "field") pathExpr += `, ${JSON.stringify(seg.name)}`;
    else pathExpr += `, ${jsOfExpr(seg.expr, ctx)}`;
  }
  return `_next[${JSON.stringify(root)}] = _setPath(${baseJs}, [${pathExpr.replace(/^, /, "")}], ${rhsJs});`;
}

function lvalueRootName(lv: Lvalue): string {
  while (lv.kind !== "LSlot") lv = lv.base;
  return lv.name;
}

// ----- expressions -----

/**
 * Encode an argument to `emit confirm`. The single positional arg is a record
 * literal whose `onYes` / `onNo` fields name reducers; encode those as string
 * literals so the runtime can dispatch by name. Everything else falls back to
 * the normal expression path.
 */
function jsOfConfirmArg(a: Expr, ctx: EvalCtx): string {
  if (a.kind !== "RecordLit") return jsOfExpr(a, ctx);
  const parts = a.fields.map((f) => {
    const v = f.value;
    if ((f.name === "onYes" || f.name === "onNo") && v.kind === "Ref") {
      const refName = v.name;
      const isReducer = ctx.gen.reducers?.some((r) => r.name === refName);
      if (isReducer) {
        return `${JSON.stringify(f.name)}: ${JSON.stringify(refName)}`;
      }
    }
    return `${JSON.stringify(f.name)}: ${jsOfExpr(v, ctx)}`;
  });
  return `{ ${parts.join(", ")} }`;
}

function jsOfExpr(e: Expr, ctx: EvalCtx): string {
  switch (e.kind) {
    case "Num":
      return String(e.value);
    case "Str":
      return JSON.stringify(e.value);
    case "Bool":
      return e.value ? "true" : "false";
    case "Unit":
      return "null";
    case "Ref": {
      if (ctx.localBinds.has(e.name)) return jsName(e.name);
      if (e.name === "now") return `_s.now()`;
      // `route` is an auto-managed slot maintained by the runtime.
      if (e.name === "route") {
        return ctx.reducerScope
          ? `((_next["route"] !== undefined) ? _next["route"] : _live["route"])`
          : `_live["route"]`;
      }
      const isSlot = ctx.gen.slots?.some((s) => s.name === e.name);
      if (isSlot) {
        const key = JSON.stringify(e.name);
        return ctx.reducerScope
          ? `((_next[${key}] !== undefined) ? _next[${key}] : _live[${key}])`
          : `_live[${key}]`;
      }
      return jsName(e.name);
    }
    case "BinOp": {
      const l = jsOfExpr(e.lhs, ctx);
      const r = jsOfExpr(e.rhs, ctx);
      if (e.op === "+") return `_s.add(${l}, ${r})`;
      if (e.op === "&") return `(${l} && ${r})`;
      if (e.op === "|") return `(${l} || ${r})`;
      if (e.op === "==") return `_s.eq(${l}, ${r})`;
      if (e.op === "!=") return `(!_s.eq(${l}, ${r}))`;
      return `(${l} ${e.op} ${r})`;
    }
    case "UnaryOp":
      return `(${e.op === "!" ? "!" : "-"}${jsOfExpr(e.rhs, ctx)})`;
    case "FieldAccess": {
      const baseJs = jsOfExpr(e.base, ctx);
      // ADR-002 (#23): when the checker has inferred that the receiver is a
      // record with this field, read the field — do NOT let a same-named method
      // shortcut shadow it. `accessKind` is only set when `check()` ran; absent,
      // we keep the historical name-based dispatch below (back-compat).
      if (e.accessKind === "field") return `(${baseJs})[${JSON.stringify(e.field)}]`;
      // For Option/Result values stored as {_tag,_0}, accessing common fields like
      // ".get" needs unwrapping. We special-case ".get" / ".is-some" / ".is-none" /
      // ".is-ok" / ".is-err".
      if (e.field === "get") return `_s.unwrap(${baseJs})`;
      if (e.field === "is-some") return `(_s.variantIs(${baseJs}, "Some"))`;
      if (e.field === "is-none") return `(_s.variantIs(${baseJs}, "None"))`;
      if (e.field === "is-ok") return `(_s.variantIs(${baseJs}, "Ok"))`;
      if (e.field === "is-err") return `(_s.variantIs(${baseJs}, "Err"))`;
      if (e.field === "keys") return `_s.mapKeys(${baseJs})`;
      if (e.field === "values") return `_s.mapValues(${baseJs})`;
      if (e.field === "entries") return `_s.mapEntries(${baseJs})`;
      if (e.field === "size") return `_s.mapSize(${baseJs})`;
      if (e.field === "to-ms" || e.field === "ms") return `(${baseJs})`;
      // .show on values (variants → _tag, numbers/strings → String)
      if (e.field === "show") return `_s.show(${baseJs})`;
      // .length on text/list/string
      if (e.field === "length") return `((${baseJs}) ?? "").length`;
      if (e.field === "is-empty")
        return `(((${baseJs}) ?? []).length === 0 || ((${baseJs}) ?? "") === "")`;
      // .lower / .upper on Text
      if (e.field === "lower") return `(String((${baseJs}) ?? "")).toLowerCase()`;
      if (e.field === "upper") return `(String((${baseJs}) ?? "")).toUpperCase()`;
      if (e.field === "trim") return `(String((${baseJs}) ?? "")).trim()`;
      // Zero-arg list / string method shorthands (callable without parens)
      if (e.field === "unique") return `[...new Set((${baseJs}) ?? [])]`;
      if (e.field === "reverse") return `[...((${baseJs}) ?? [])].reverse()`;
      if (e.field === "sort") return `_s.listSort(${baseJs})`;
      // Issue #7: argument-less spec stdlib methods in the parenthesis-free form
      // (docs/spec/stdlib.md §2.2.3 — the recommended shortcut). Kept in exact sync
      // with the MethodCall (paren) cases in methodCallJs + KNOWN_METHODS.
      if (e.field === "head") return `_s.listHead(${baseJs})`;
      if (e.field === "tail") return `_s.listTail(${baseJs})`;
      if (e.field === "last") return `_s.listLast(${baseJs})`;
      if (e.field === "to-list") return `_s.toList(${baseJs})`;
      if (e.field === "get-err") return `_s.getErr(${baseJs})`;
      if (e.field === "to-option") return `_s.toOption(${baseJs})`;
      if (e.field === "parse-int") return `_s.parseIntOpt(${baseJs})`;
      if (e.field === "parse-float") return `_s.parseFloatOpt(${baseJs})`;
      if (e.field === "abs") return `Math.abs(${baseJs})`;
      if (e.field === "neg") return `(-(${baseJs}))`;
      if (e.field === "to-float") return `(${baseJs})`;
      if (e.field === "to-int") return `Math.trunc(${baseJs})`;
      return `(${baseJs})[${JSON.stringify(e.field)}]`;
    }
    case "Index": {
      return `(${jsOfExpr(e.base, ctx)})[${jsOfExpr(e.index, ctx)}]`;
    }
    case "Call": {
      const cn = e.callee;
      // `run-reducer(name)` inside a property-test invariant (§8.3): apply the
      // named reducer to the trial's initial state (`_init` / `_event` are bound
      // in the generated trial fn). Chained `.run-reducer(...)` is in methodCallJs.
      if (cn === "run-reducer") {
        return `_s.runReducerStep(App, _init, ${JSON.stringify(reducerNameArg(e.args[0]))}, _event)`;
      }
      // Module calls like TodoId.fresh, now, etc.
      if (cn === "now") return `_s.now()`;
      if (/^[A-Z][A-Za-z0-9_]*\.fresh$/.test(cn)) return `_s.freshId()`;
      if (/^[A-Z][A-Za-z0-9_]*\.parse$/.test(cn)) {
        // `T.parse(text)` → Option<T>. Numeric types coerce to a number so
        // arithmetic (e.g. fold/sum) works; other types keep the string.
        const a = e.args[0] ? jsOfExpr(e.args[0], ctx) : '""';
        const qualifier = cn.split(".")[0];
        if (qualifier === "Int") {
          return `((_v) => { const _n = Number(_v); return (String(_v).trim() !== "" && Number.isFinite(_n)) ? _s.Some(Math.trunc(_n)) : _s.None; })(${a})`;
        }
        if (qualifier === "Float") {
          return `((_v) => { const _n = Number(_v); return (String(_v).trim() !== "" && Number.isFinite(_n)) ? _s.Some(_n) : _s.None; })(${a})`;
        }
        return `((_v) => (typeof _v === "string" && _v.length > 0) ? _s.Some(_v) : _s.None)(${a})`;
      }
      if (/^[A-Z][A-Za-z0-9_]*\.show$/.test(cn)) {
        const a = e.args[0] ? jsOfExpr(e.args[0], ctx) : '""';
        return `_s.show(${a})`;
      }
      // Duration constructors → milliseconds (Time is stored as a raw ms number).
      if (cn === "Duration.ms") return `(${e.args[0] ? jsOfExpr(e.args[0], ctx) : "0"})`;
      if (cn === "Duration.s") return `((${e.args[0] ? jsOfExpr(e.args[0], ctx) : "0"}) * 1000)`;
      if (cn === "Duration.m" || cn === "Duration.min")
        return `((${e.args[0] ? jsOfExpr(e.args[0], ctx) : "0"}) * 60000)`;
      if (cn === "Duration.h") return `((${e.args[0] ? jsOfExpr(e.args[0], ctx) : "0"}) * 3600000)`;
      if (cn === "Duration.d" || cn === "Duration.days")
        return `((${e.args[0] ? jsOfExpr(e.args[0], ctx) : "0"}) * 86400000)`;
      // Bytes constructors (docs/spec/stdlib.md §2.1.1 / §2.2.10).
      // Bytes is represented as Uint8Array at runtime.
      if (cn === "Bytes.from-text")
        return `_s.bytesFromText(${e.args[0] ? jsOfExpr(e.args[0], ctx) : '""'})`;
      if (cn === "Bytes.from-base64")
        return `_s.bytesFromBase64(${e.args[0] ? jsOfExpr(e.args[0], ctx) : '""'})`;
      if (cn === "Bytes.from-bytes")
        return `_s.bytesFromBytes(${e.args[0] ? jsOfExpr(e.args[0], ctx) : "[]"})`;
      // `EffectId.none` — empty-handle sentinel (spec stdlib §2.1.1.1). The
      // runtime treats falsy / unknown ids as silent no-ops, so the empty
      // string doubles as a valid slot-initial value AND a guaranteed-no-op
      // cancel target.
      if (cn === "EffectId.none") return `""`;
      // Decoder.* — codegen treats decoders as a sentinel string; the builtin storage handler
      // ignores everything except "json".
      if (cn === "Decoder.Json") return `"json"`;
      if (cn === "Decoder.Text") return `"text"`;
      if (cn === "Decoder.Bytes") return `"bytes"`;
      if (cn === "Decoder.None") return `"none"`;
      if (cn === "fmt") {
        // fmt(template, ...args) — very simple {0} {1} substitution
        const args = e.args.map((a) => jsOfExpr(a, ctx));
        return `_s.fmt ? _s.fmt(${args.join(", ")}) : ${args[0] ?? '""'}`;
      }
      // `panic(message)` — Kumiki's controlled stop-the-program signal
      // (docs/spec/stdlib.md §2.2). Lowers to the runtime helper that throws a
      // KumikiPanic, which the live dispatch / render boundary catches.
      if (cn === "panic") {
        const a = e.args[0] ? jsOfExpr(e.args[0], ctx) : '""';
        return `_s.panic(${a})`;
      }
      // `file-url(file)` — URL.createObjectURL equivalent (forms.md §5.10).
      // The runtime helper is None-safe so `file-url(avatar.get)` does not
      // throw before `is-some` guards inside `when(...)` short-circuit.
      if (cn === "file-url") {
        const a = e.args[0] ? jsOfExpr(e.args[0], ctx) : "undefined";
        return `_s.fileUrl(${a})`;
      }
      const args = e.args.map((a) => jsOfExpr(a, ctx)).join(", ");
      // Otherwise treat as user-defined fn
      return `${jsName(cn)}(${args})`;
    }
    case "MethodCall": {
      return methodCallJs(e.receiver, e.method, e.args, ctx);
    }
    case "RecordLit": {
      const parts = e.fields.map((f) => `${JSON.stringify(f.name)}: ${jsOfExpr(f.value, ctx)}`);
      return `{ ${parts.join(", ")} }`;
    }
    case "ListLit":
      return `[${e.items.map((it) => jsOfExpr(it, ctx)).join(", ")}]`;
    case "MapLit": {
      const parts = e.entries.map((en) => {
        // A `<any-id>` map key (test expect, §8.2.2) lowers to the runtime's
        // wild-key sentinel so the matcher pairs it with the one generated entry.
        const keyJs =
          en.key.kind === "Wildcard" && en.key.wild === "any-id"
            ? "[_s.WILD_KEY]"
            : `[${jsOfExpr(en.key, ctx)}]`;
        return `${keyJs}: ${jsOfExpr(en.value, ctx)}`;
      });
      return `{ ${parts.join(", ")} }`;
    }
    case "Wildcard":
      // Value-position wildcard (`<any-id>` / `<slots.X>`) → a runtime sentinel
      // that `wcEqual` recognises during reducer-test comparison.
      return e.wild === "any-id"
        ? `_s.wild("any-id")`
        : `_s.wild("slot", ${JSON.stringify(e.slot)})`;
    case "EmitExpr":
      return emitExprJs(e, ctx);
    case "MatchExpr":
      return matchExprJs(e, ctx);
    case "IfExpr":
      return `((${jsOfExpr(e.cond, ctx)}) ? (${jsOfExpr(e.consequent, ctx)}) : (${jsOfExpr(e.alternate, ctx)}))`;
    case "LetIn": {
      const inner = makeEvalCtx(ctx.gen, ctx.localBinds);
      inner.localBinds.add(e.name);
      return `(() => { const ${jsName(e.name)} = ${jsOfExpr(e.value, ctx)}; return ${jsOfExpr(e.body, inner)}; })()`;
    }
    case "Variant":
      return variantJs(e.name, e.payload, ctx);
    case "TokenRef": {
      // Theme-token reference (spec/style.md §4.3): lowers to the unified
      // runtime resolver which walks the active theme and falls back to the
      // built-in defaults baked into mapColor/mapToken/mapSize.
      const pathJs = `[${e.path.map((p) => JSON.stringify(p)).join(", ")}]`;
      return `_s.token(${JSON.stringify(e.group)}, ${pathJs})`;
    }
  }
}

/**
 * Methods the code generator actually implements (the `methodCallJs` switch
 * cases below). This is the single source of truth for what `obj.method(...)`
 * calls are runnable; the typechecker uses it to flag unimplemented methods
 * (E0801) at `check` time instead of letting them throw or misbehave at runtime.
 * Keep this in exact sync with the `switch (method)` cases.
 */
export const KNOWN_METHODS: ReadonlySet<string> = new Set([
  "filter",
  "map",
  "flat-map",
  "size",
  "keys",
  "has",
  "toggle",
  "get",
  "get-or",
  "remove",
  "insert",
  "sort-by",
  "fold",
  "show",
  "is-some",
  "is-none",
  "is-empty",
  "to-ms",
  "copy",
  "find",
  "push",
  "unique",
  "reverse",
  "join",
  "split",
  "contains",
  "starts-with",
  "ends-with",
  "length",
  "slice",
  "trim",
  "format",
  "plus",
  "minus",
  "diff",
  // Issue #5: docs/spec/stdlib.md §2.2 methods that were missing here and therefore
  // wrongly rejected with E0801. All take ≥1 argument, so they always parse as
  // MethodCall (never the parenthesis-free FieldAccess form).
  "concat", // List(T).concat(other)
  "prepend", // List(T).prepend(x)
  "chunk", // List(T).chunk(n)
  "zip", // List(T).zip(other)
  "merge", // Map(K,V).merge(other)
  "update", // Map(K,V).update(k, expr)  — $1 is the current value inside expr
  "add", // Set(T).add(x)
  "union", // Set(T).union(other)
  "intersect", // Set(T).intersect(other)
  "or", // Option(T).or(other) / Result(T,E).or(other)
  "map-err", // Result(T,E).map-err(expr)
  "replace", // Text.replace(from, to)
  "min", // Int/Float.min(b)
  "max", // Int/Float.max(b)
  "clamp", // Int/Float.clamp(lo, hi)
  // Issue #7: docs/spec/stdlib.md §2.2 argument-less methods. These also parse as the
  // parenthesis-free FieldAccess form (handled in jsOfExpr); listing them here
  // makes the `recv.method()` shape compile instead of tripping E0801.
  "head", // List(T).head → Option(T)
  "tail", // List(T).tail → List(T)
  "last", // List(T).last → Option(T)
  "to-list", // Set(T).to-list / Option(T).to-list → List(T)
  "get-err", // Result(T,E).get-err → E (panics if Ok)
  "to-option", // Result(T,E).to-option → Option(T)
  "parse-int", // Text.parse-int → Option(Int)
  "parse-float", // Text.parse-float → Option(Float)
  "abs", // Int/Float.abs
  "neg", // Int/Float.neg
  "to-float", // Int.to-float → Float
  "to-int", // Float.to-int → Int (truncated)
  // Issue #92: stdlib methods that also have FieldAccess shortcuts (see
  // FIELD_ACCESS_SHORTCUTS / jsOfExpr). Both shapes lower to the same `_s.*`
  // helper via the matching cases in methodCallJs — keeps FIELD_ACCESS_SHORTCUTS
  // ⊆ KNOWN_METHODS and stops the paren form from falling through to native JS.
  "is-ok", // Result(T,E).is-ok → Bool
  "is-err", // Result(T,E).is-err → Bool
  "values", // Map(K,V).values → List(V)
  "entries", // Map(K,V).entries → List([K,V])
  "lower", // Text.lower → Text
  "upper", // Text.upper → Text
  "sort", // List(T).sort → List(T)
  "ms", // Time/Duration.ms → Int
]);

/**
 * The method names codegen lowers in the parenthesis-free `recv.m` (FieldAccess)
 * form — kept in sync with the `if (e.field === …)` chain in jsOfExpr's
 * FieldAccess case. A subset of KNOWN_METHODS (enforced by a test): every
 * no-paren shortcut must also accept the `recv.m()` shape.
 */
export const FIELD_ACCESS_SHORTCUTS: ReadonlySet<string> = new Set([
  "get",
  "is-some",
  "is-none",
  "is-ok",
  "is-err",
  "keys",
  "values",
  "entries",
  "size",
  "to-ms",
  "ms",
  "show",
  "length",
  "is-empty",
  "lower",
  "upper",
  "trim",
  "unique",
  "reverse",
  "sort",
  "head",
  "tail",
  "last",
  "to-list",
  "get-err",
  "to-option",
  "parse-int",
  "parse-float",
  "abs",
  "neg",
  "to-float",
  "to-int",
]);

/**
 * Every member name the runtime understands on a stdlib receiver — the union of
 * the method-call methods and the no-paren shortcuts. Used by the type checker
 * (ADR-002) to decide whether `recv.m` on a *known* receiver type is a real
 * member (→ shortcut) or an unknown one (→ E0108). Flat, not per-type.
 */
export const KNOWN_MEMBERS: ReadonlySet<string> = new Set([
  ...KNOWN_METHODS,
  ...FIELD_ACCESS_SHORTCUTS,
]);

function methodCallJs(recv: Expr, method: string, args: Expr[], ctx: EvalCtx): string {
  // Chained `recv.run-reducer(name)` in a property-test invariant (§8.3): apply
  // the reducer to the receiver state. `_event` is bound in the generated trial.
  if (method === "run-reducer") {
    return `_s.runReducerStep(App, ${jsOfExpr(recv, ctx)}, ${JSON.stringify(reducerNameArg(args[0]))}, _event)`;
  }
  // Build inner ctx with $1, $2 bound for predicate expression fragments.
  const inner = makeEvalCtx(ctx.gen, ctx.localBinds);
  inner.localBinds.add("$1");
  inner.localBinds.add("$2");

  const recvJs = jsOfExpr(recv, ctx);
  // For list ops, the element may be a plain T or a [K, V] tuple (from .entries).
  // Generate a lambda that binds `$1` and `$2` accordingly: for a 2-tuple we
  // bind ($1=k, $2=v); for any other element we bind $1=elem, $2=undefined.
  const argFnList = (a: Expr): string =>
    `((__x, __y) => { const _isPair = (Array.isArray(__x) && __x.length === 2); const ${jsName("$1")} = _isPair ? __x[0] : __x; const ${jsName("$2")} = _isPair ? __x[1] : (__y !== undefined ? __y : __x); return ${jsOfExpr(a, inner)}; })`;
  // Map predicate form (k, v) → boolean, used by mapFilter's object branch.
  const _argFn = argFnList;
  const argRaw = (a: Expr): string => jsOfExpr(a, ctx);

  switch (method) {
    case "filter":
      // The receiver may be a List (incl. .entries → [k,v] tuples) or a Map.
      // Dispatch at runtime; the lambda destructures tuples and also accepts
      // the (k, v) calling convention used by mapFilter.
      return `_s.filter(${recvJs}, ${argFnList(args[0]!)})`;
    case "map":
      // Polymorphic: List(T).map (over elements, incl. .entries [k,v] tuples)
      // or Option(T).map (over Some). Runtime distinguishes by variant `_tag`.
      return `_s.mapOver(${recvJs}, ${argFnList(args[0]!)})`;
    case "flat-map":
      // Option(T).flat-map(f): Some(v) -> f(v) (which itself returns Option), None -> None.
      return `_s.flatMapOption(${recvJs}, ((${jsName("$1")}) => ${jsOfExpr(args[0]!, inner)}))`;
    case "size":
      return `_s.mapSize(${recvJs})`;
    case "keys":
      return `_s.mapKeys(${recvJs})`;
    case "has":
      return `_s.setHas(${recvJs}, ${argRaw(args[0]!)})`;
    case "toggle":
      return `_s.setToggle(${recvJs}, ${argRaw(args[0]!)})`;
    case "get":
      // Spec: Map(K,V).get returns Option(V). Wrap the raw lookup result.
      return `((_v) => _v === undefined ? _s.None : _s.Some(_v))(_s.mapGet(${recvJs}, ${argRaw(args[0]!)}))`;
    case "get-or":
      // Two shapes:
      //   Option(T).get-or(default)    → returns T (unwrap or default)
      //   Map(K,V).get-or(key, default) → returns V (lookup or default)
      // Dispatch at runtime so we don't need static type info.
      if (args.length === 1) {
        return `_s.getOr(${recvJs}, ${argRaw(args[0]!)})`;
      }
      return `_s.mapGetOr(${recvJs}, ${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "remove":
      return `_s.mapRemove(${recvJs}, ${argRaw(args[0]!)})`;
    case "insert":
      return `_s.mapInsert(${recvJs}, ${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "sort-by":
      return `_s.listSortBy(${recvJs}, ${argFnList(args[0]!)})`;
    case "fold":
      // List(T).fold(init, expr) — expr binds $1=acc, $2=elem (distinct from the
      // $1=elem/$2=value convention of filter/map), so emit its own lambda.
      return `_s.listFold(${recvJs}, ${argRaw(args[0]!)}, (${jsName("$1")}, ${jsName("$2")}) => ${jsOfExpr(args[1]!, inner)})`;
    case "show":
      return `_s.show(${recvJs})`;
    case "is-some":
      return `_s.variantIs(${recvJs}, "Some")`;
    case "is-none":
      return `_s.variantIs(${recvJs}, "None")`;
    case "is-empty":
      return `(_s.mapSize(${recvJs}) === 0)`;
    case "to-ms":
      return `(${recvJs})`;
    case "copy":
      // record.copy(field=value, ...) → record with patches
      // args expected to be a single RecordLit with the patch.
      if (args[0] && args[0].kind === "RecordLit") {
        return `_s.recordCopy(${recvJs}, ${jsOfExpr(args[0], ctx)})`;
      }
      return `_s.recordCopy(${recvJs}, {})`;
    case "find":
      return `((${recvJs}) || []).find(${argFnList(args[0]!)})`;
    case "push":
      return `[...(${recvJs} ?? []), ${argRaw(args[0]!)}]`;
    case "unique":
      return `[...new Set((${recvJs} ?? []))]`;
    case "reverse":
      return `[...(${recvJs} ?? [])].reverse()`;
    case "join":
      return `((${recvJs}) ?? []).join(${argRaw(args[0]!)})`;
    case "split":
      return `((${recvJs}) ?? "").split(${argRaw(args[0]!)})`;
    case "contains":
      return `(typeof (${recvJs}) === "string" ? ((${recvJs}) ?? "").includes(${argRaw(args[0]!)}) : ((${recvJs}) ?? []).includes(${argRaw(args[0]!)}))`;
    case "starts-with":
      return `((${recvJs}) ?? "").startsWith(${argRaw(args[0]!)})`;
    case "ends-with":
      return `((${recvJs}) ?? "").endsWith(${argRaw(args[0]!)})`;
    case "length":
      return `((${recvJs}) || "").length`;
    case "slice":
      return `((${recvJs}) || "").slice(${args.map(argRaw).join(", ")})`;
    case "trim":
      return `((${recvJs}) || "").trim()`;
    case "format":
      // Time.format(pattern) — minimal: produce the ISO date portion regardless of pattern.
      return `(new Date(${recvJs})).toISOString().slice(0, 10)`;
    case "plus":
      // Time.plus(durationMs) / Duration.plus — both stored as raw ms numbers.
      return `((${recvJs}) + (${argRaw(args[0]!)}))`;
    case "minus":
      return `((${recvJs}) - (${argRaw(args[0]!)}))`;
    case "diff":
      // Polymorphic: Time/Duration → numeric magnitude; Set(T) → set difference.
      return `_s.diff(${recvJs}, ${argRaw(args[0]!)})`;
    // ----- Issue #5: previously-missing stdlib methods -----
    case "concat":
      // List(T).concat(other)
      return `[...((${recvJs}) ?? []), ...((${argRaw(args[0]!)}) ?? [])]`;
    case "prepend":
      // List(T).prepend(x)
      return `[${argRaw(args[0]!)}, ...((${recvJs}) ?? [])]`;
    case "chunk":
      // List(T).chunk(n) → List(List(T))
      return `_s.listChunk(${recvJs}, ${argRaw(args[0]!)})`;
    case "zip":
      // List(T).zip(other) → List(Tuple(T, U))
      return `_s.listZip(${recvJs}, ${argRaw(args[0]!)})`;
    case "merge":
      // Map(K,V).merge(other) — right side wins on key conflicts. Wrapped in
      // parens so the object literal is safe in arrow-body position.
      return `({ ...((${recvJs}) ?? {}), ...((${argRaw(args[0]!)}) ?? {}) })`;
    case "update":
      // Map(K,V).update(k, expr) — within expr, $1 is the current value.
      return `_s.mapUpdate(${recvJs}, ${argRaw(args[0]!)}, ((${jsName("$1")}) => (${jsOfExpr(args[1]!, inner)})))`;
    case "add":
      // Set(T).add(x)
      return `_s.setAdd(${recvJs}, ${argRaw(args[0]!)})`;
    case "union":
      // Set(T).union(other)
      return `_s.setUnion(${recvJs}, ${argRaw(args[0]!)})`;
    case "intersect":
      // Set(T).intersect(other)
      return `_s.setIntersect(${recvJs}, ${argRaw(args[0]!)})`;
    case "or":
      // Option(T).or(other) / Result(T,E).or(other)
      return `_s.or(${recvJs}, ${argRaw(args[0]!)})`;
    case "map-err":
      // Result(T,E).map-err(expr) — within expr, $1 is the current Err payload.
      return `_s.mapErr(${recvJs}, ((${jsName("$1")}) => (${jsOfExpr(args[0]!, inner)})))`;
    case "replace":
      // Text.replace(from, to) — replaces every occurrence.
      return `String((${recvJs}) ?? "").replaceAll(${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "min":
      return `Math.min((${recvJs}), (${argRaw(args[0]!)}))`;
    case "max":
      return `Math.max((${recvJs}), (${argRaw(args[0]!)}))`;
    case "clamp":
      // Int/Float.clamp(lo, hi)
      return `Math.min(Math.max((${recvJs}), (${argRaw(args[0]!)})), (${argRaw(args[1]!)}))`;
    // ----- Issue #92: paren-form stdlib methods kept in sync with the
    // FieldAccess (no-paren) cases in jsOfExpr. Without these the calls fall
    // through to the generic `(recv).method(...)` fallback and delegate to
    // native JS — silent failure for `.is-ok()` / `.values()` / `.lower()` etc. -----
    case "is-ok":
      return `(_s.variantIs(${recvJs}, "Ok"))`;
    case "is-err":
      return `(_s.variantIs(${recvJs}, "Err"))`;
    case "values":
      return `_s.mapValues(${recvJs})`;
    case "entries":
      return `_s.mapEntries(${recvJs})`;
    case "lower":
      return `(String((${recvJs}) ?? "")).toLowerCase()`;
    case "upper":
      return `(String((${recvJs}) ?? "")).toUpperCase()`;
    case "sort":
      return `_s.listSort(${recvJs})`;
    case "ms":
      return `(${recvJs})`;
    // ----- Issue #7: argument-less stdlib methods (parenthesized form). Kept in
    // sync with the FieldAccess (no-paren) cases in jsOfExpr + KNOWN_METHODS. -----
    case "head":
      return `_s.listHead(${recvJs})`;
    case "tail":
      return `_s.listTail(${recvJs})`;
    case "last":
      return `_s.listLast(${recvJs})`;
    case "to-list":
      return `_s.toList(${recvJs})`;
    case "get-err":
      return `_s.getErr(${recvJs})`;
    case "to-option":
      return `_s.toOption(${recvJs})`;
    case "parse-int":
      return `_s.parseIntOpt(${recvJs})`;
    case "parse-float":
      return `_s.parseFloatOpt(${recvJs})`;
    case "abs":
      return `Math.abs(${recvJs})`;
    case "neg":
      return `(-(${recvJs}))`;
    case "to-float":
      return `(${recvJs})`;
    case "to-int":
      return `Math.trunc(${recvJs})`;
    default:
      // generic fallback: receiver.method(...args)
      return `(${recvJs}).${jsName(method)}(${args.map(argRaw).join(", ")})`;
  }
}

function variantJs(name: string, payload: Expr[], ctx: EvalCtx): string {
  // Treat capital-letter bare ident as a variant tag (already in payload form).
  if (payload.length === 0) {
    if (name === "None") return `_s.None`;
    return `({ _tag: ${JSON.stringify(name)} })`;
  }
  if (name === "Some") return `_s.Some(${jsOfExpr(payload[0]!, ctx)})`;
  if (name === "Ok") return `_s.Ok(${jsOfExpr(payload[0]!, ctx)})`;
  if (name === "Err") return `_s.Err(${jsOfExpr(payload[0]!, ctx)})`;
  return `_s.variant(${JSON.stringify(name)}, ${payload.map((p) => jsOfExpr(p, ctx)).join(", ")})`;
}

/**
 * `emit X(args)` used as an expression (spec http.md §6.4, stdlib §2.1.1.1)
 * — push the same `{effect, args}` record the statement form pushes, then
 * yield the dispatched effect's `EffectId`. The id format mirrors the
 * runtime dispatcher (`packages/runtime/src/core.ts:1324-1329`): `name:_`
 * by default, `name:String(keyOf(input))` for `latest-per-key`. Each arg is
 * lowered ONCE into a local (`__a0` / `__a1` / …) so a side-effecting expr
 * (`now()`, `T.fresh()`, …) cannot diverge between the value pushed onto
 * `_emits` and the value the EffectId is computed from — otherwise the
 * reducer's captured id wouldn't match the inflight key the launch path
 * registers, and `emit cancel(id)` would silently no-op.
 */
function emitExprJs(e: Expr & { kind: "EmitExpr" }, ctx: EvalCtx): string {
  const effect = e.effect;
  const effectJson = JSON.stringify(effect);
  const argBinds = e.args.map((a, i) => `const __a${i} = ${jsOfExpr(a, ctx)};`).join(" ");
  const argRefs = e.args.map((_, i) => `__a${i}`).join(", ");
  const inputRef = e.args[0] ? "__a0" : "null";
  const eff = ctx.gen.effects.find((d) => d.name === effect);
  let keyJs: string;
  if (eff?.policy?.kind === "PolLatestKey") {
    const keyCtx: EvalCtx = { gen: ctx.gen, localBinds: new Set(["$1"]) };
    keyJs = `String((((${jsName("$1")}) => ${jsOfExpr(eff.policy.key, keyCtx)})(${inputRef})))`;
  } else {
    keyJs = `"_"`;
  }
  return `((() => { ${argBinds} _emits.push({ effect: ${effectJson}, args: [${argRefs}] }); return ${JSON.stringify(`${effect}:`)} + ${keyJs}; })())`;
}

function matchExprJs(e: Expr & { kind: "MatchExpr" }, ctx: EvalCtx): string {
  const sc = jsOfExpr(e.scrutinee, ctx);
  // Generate an IIFE that destructures the scrutinee and matches each arm.
  const armsJs = e.arms.map((arm) => matchArmJs(arm.pattern, arm.body, ctx, "_v")).join(" else ");
  return `((_v) => { ${armsJs} else { return undefined; } })(${sc})`;
}

function matchArmJs(p: Pattern, body: Expr, ctx: EvalCtx, scVar: string): string {
  if (p.kind === "PWildcard") {
    return `if (true) { return ${jsOfExpr(body, ctx)}; }`;
  }
  if (p.kind === "PBind") {
    const inner = makeEvalCtx(ctx.gen, ctx.localBinds);
    inner.localBinds.add(p.name);
    return `if (true) { const ${jsName(p.name)} = ${scVar}; return ${jsOfExpr(body, inner)}; }`;
  }
  if (p.kind === "PTuple") {
    const { guard, binds, inner } = tupleArm(p, ctx, scVar, false);
    return `if (${guard}) { ${binds} return ${jsOfExpr(body, inner)}; }`;
  }
  // PVariant
  const tag = p.name;
  const inner = makeEvalCtx(ctx.gen, ctx.localBinds);
  const bindAssigns: string[] = [];
  for (let i = 0; i < p.binds.length; i++) {
    const name = p.binds[i]!;
    if (name === "_") continue;
    inner.localBinds.add(name);
    bindAssigns.push(`const ${jsName(name)} = (${scVar})[${JSON.stringify(`_${i}`)}];`);
  }
  return `if (_s.variantIs(${scVar}, ${JSON.stringify(tag)})) { ${bindAssigns.join(" ")} return ${jsOfExpr(body, inner)}; }`;
}

// Lower a tuple pattern into: a runtime guard (Array.isArray + length check + any
// nested element guards) and a series of `const … = scVar[i]…;` bindings.
// Nested PTuple / PVariant inside the tuple are recursively unrolled by walking
// the indexed access path. `inheritReducerScope` lets MatchStmt callers carry
// the reducer's slot-write scope through; matchExpr / TileMatch leave it off.
function tupleArm(
  p: Pattern & { kind: "PTuple" },
  ctx: EvalCtx,
  scVar: string,
  inheritReducerScope: boolean,
): { guard: string; binds: string; inner: EvalCtx } {
  const inner = makeEvalCtx(
    ctx.gen,
    ctx.localBinds,
    inheritReducerScope ? ctx.reducerScope : undefined,
  );
  const guards: string[] = [`Array.isArray(${scVar})`, `(${scVar}).length === ${p.items.length}`];
  const binds: string[] = [];
  for (let i = 0; i < p.items.length; i++) {
    walkPatternForTupleArm(p.items[i]!, `(${scVar})[${i}]`, inner, guards, binds);
  }
  return { guard: guards.join(" && "), binds: binds.join(" "), inner };
}

function walkPatternForTupleArm(
  p: Pattern,
  accessor: string,
  inner: EvalCtx,
  guards: string[],
  binds: string[],
): void {
  switch (p.kind) {
    case "PWildcard":
      return;
    case "PBind":
      inner.localBinds.add(p.name);
      binds.push(`const ${jsName(p.name)} = ${accessor};`);
      return;
    case "PVariant":
      guards.push(`_s.variantIs(${accessor}, ${JSON.stringify(p.name)})`);
      for (let i = 0; i < p.binds.length; i++) {
        const name = p.binds[i]!;
        if (name === "_") continue;
        inner.localBinds.add(name);
        binds.push(`const ${jsName(name)} = (${accessor})[${JSON.stringify(`_${i}`)}];`);
      }
      return;
    case "PTuple":
      guards.push(`Array.isArray(${accessor})`, `(${accessor}).length === ${p.items.length}`);
      for (let i = 0; i < p.items.length; i++) {
        walkPatternForTupleArm(p.items[i]!, `(${accessor})[${i}]`, inner, guards, binds);
      }
      return;
    default: {
      const _exhaustive: never = p;
      throw new Error(`unreachable pattern kind: ${(_exhaustive as Pattern).kind}`);
    }
  }
}

// ----- tiles -----

function genTile(tile: TileDef, gen: GenCtx): string {
  const ctx = makeEvalCtx(gen, new Set(tile.in ? ["$1"] : []));
  return tileExprJs(tile.body, gen, ctx, tile.name);
}

function tileExprJs(t: TileExpr, gen: GenCtx, ctx: EvalCtx, enclosingTile?: string): string {
  switch (t.kind) {
    case "TileFor": {
      const iter = jsOfExpr(t.iter, ctx);
      const inner = makeEvalCtx(gen, ctx.localBinds);
      inner.localBinds.add(t.bind);
      // Returns Array<Node|Node[]>. Caller (collectChildren / _children) flattens.
      return `((${iter}) || []).map((${jsName(t.bind)}) => (${tileExprJs(t.body, gen, inner, enclosingTile)}))`;
    }
    case "TileWhen":
      // Returns a Node or null. Caller flattens nulls away.
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.body, gen, ctx, enclosingTile)}) : null)`;
    case "TileIf":
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.consequent, gen, ctx, enclosingTile)}) : (${tileExprJs(t.alternate, gen, ctx, enclosingTile)}))`;
    case "TileMatch": {
      const sc = jsOfExpr(t.scrutinee, ctx);
      const arms = t.arms
        .map((arm) => {
          if (arm.pattern.kind === "PVariant") {
            const inner = makeEvalCtx(gen, ctx.localBinds);
            for (const b of arm.pattern.binds) if (b !== "_") inner.localBinds.add(b);
            const binds = arm.pattern.binds
              .map((b, i) =>
                b !== "_" ? `const ${jsName(b)} = _v[${JSON.stringify(`_${i}`)}];` : "",
              )
              .join(" ");
            return `if (_s.variantIs(_v, ${JSON.stringify(arm.pattern.name)})) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTile)}; }`;
          }
          if (arm.pattern.kind === "PBind") {
            const inner = makeEvalCtx(gen, ctx.localBinds);
            inner.localBinds.add(arm.pattern.name);
            return `if (true) { const ${jsName(arm.pattern.name)} = _v; return ${tileExprJs(arm.body, gen, inner, enclosingTile)}; }`;
          }
          if (arm.pattern.kind === "PWildcard") {
            return `if (true) { return ${tileExprJs(arm.body, gen, ctx, enclosingTile)}; }`;
          }
          // PTuple — TileMatch reuses the shared `tupleArm` helper. `ctx` carries
          // no reducerScope here (tile-match runs in pure render context), so the
          // helper's `inheritReducerScope=false` path is what we want.
          {
            const { guard, binds, inner } = tupleArm(arm.pattern, ctx, "_v", false);
            return `if (${guard}) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTile)}; }`;
          }
        })
        .join(" else ");
      // The no-match fallback renders an empty `text` tile, so the text family
      // must ship whenever a tile-match exists (#71).
      gen.usedTiles.add("text");
      return `((_v) => { ${arms} else { return { kind: "text", text: "" }; } })(${sc})`;
    }
    case "TileCall":
      return tileCallJs(t as TileExpr & { kind: "TileCall" }, gen, ctx, enclosingTile);
  }
}

/**
 * For `bind=draft` or `bind=draft.title.deeper`, extract the root slot name,
 * the static path (string field names), and a JS expression to read the value.
 * Only static field-access paths are supported (no Index, no dynamic lookups).
 * Returns null if no `bind=` arg exists or the path isn't statically resolvable.
 */
function extractBindPath(
  args: { name?: string; value: unknown }[],
): { root: string; path: string[]; readJs: string; readJsRaw: string } | null {
  const bindArg = args.find((a) => a.name === "bind");
  if (!bindArg) return null;
  let cur = bindArg.value as Expr;
  const reverseSegments: string[] = [];
  while (cur.kind === "FieldAccess") {
    reverseSegments.push((cur as Expr & { field: string }).field);
    cur = (cur as Expr & { base: Expr }).base;
  }
  if (cur.kind !== "Ref") return null;
  const root = (cur as Expr & { name: string }).name;
  const path = reverseSegments.reverse();
  // Build a safe reader: `((_live["root"] ?? {})["a"] ?? {})["b"] ...` then unwrap.
  let readRaw = `_live[${JSON.stringify(root)}]`;
  for (const seg of path) {
    readRaw = `((${readRaw}) ?? {})[${JSON.stringify(seg)}]`;
  }
  return { root, path, readJs: readRaw, readJsRaw: readRaw };
}

function tileCallJs(
  t: TileExpr & { kind: "TileCall" },
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTile?: string,
): string {
  const name = t.name;

  if (!BUILTIN_TILES.has(name)) {
    const def = gen.tiles.find((x) => x.name === name);
    if (!def) throw new Error(`Tile "${name}" not found`);
    const inner = makeEvalCtx(gen, ctx.localBinds);
    const arg1 = t.args[0];
    const TILE_KINDS = new Set(["TileCall", "TileFor", "TileWhen", "TileIf", "TileMatch"]);
    const wrapBoundary = (body: string): string => {
      if (!def.errorBoundary) return body;
      const fb = gen.tiles.find((x) => x.name === def.errorBoundary);
      if (!fb) return body;
      const fbCtx = makeEvalCtx(gen, new Set(["$1"]));
      const fbBody = tileExprJs(fb.body, gen, fbCtx, fb.name);
      return `((() => { try { return ${body}; } catch (_err) { const ${jsName("$1")} = { message: String(_err && _err.message || _err), location: ${JSON.stringify(def.name)} }; return ${fbBody}; } })())`;
    };
    // Each user-tile call site wraps its rendered output with `_named(…, "X")`
    // so the runtime can diff `tile.mount(X)` / `tile.unmount(X)` against the
    // rendered tree (lifecycle.md §7.1.6). Builtin tiles are NOT named — only
    // user-defined tile boundaries fire mount/unmount.
    const nameLit = JSON.stringify(def.name);
    if (arg1) {
      const v = arg1.value;
      const isTile = TILE_KINDS.has((v as { kind?: string }).kind ?? "");
      if (isTile) {
        return wrapBoundary(
          `_named(${tileExprJs(v as TileExpr, gen, inner, def.name)}, ${nameLit})`,
        );
      }
      // Evaluate the positional arg and props in the OUTER context (where
      // `_d_1` still refers to the enclosing tile's `$1`), then pass them in
      // as arguments so the inner IIFE can rebind `_d_1` without colliding
      // with the outer scope.
      const oneJs = jsOfExpr(v as Expr, ctx);
      const propsJs = propsFor(t, ctx);
      const bodyJs = tileExprJs(def.body, gen, addBind(inner, "$1"), def.name);
      return wrapBoundary(
        `((_arg, _propsOuter) => { const ${jsName("$1")} = _arg; return _named(_attachProps(${bodyJs}, _propsOuter), ${nameLit}); })(${oneJs}, ${propsJs})`,
      );
    }
    const propsJs = propsFor(t, ctx);
    const bodyJs = tileExprJs(def.body, gen, inner, def.name);
    return wrapBoundary(`_named(_attachProps(${bodyJs}, ${propsJs}), ${nameLit})`);
  }

  // Builtin tiles
  gen.usedTiles.add(name);
  const propsObj = propsFor(t, ctx, enclosingTile);
  switch (name) {
    case "page":
    case "row":
    case "column":
    case "card":
    case "box":
    case "grid":
    case "stack":
    case "overlay":
    case "region":
    case "scroll":
    case "divider":
    case "fieldset":
    case "list-item":
    case "table":
    case "table-head":
    case "table-body":
    case "table-row":
    case "panel": {
      const children = collectChildren(t.args, gen, ctx, enclosingTile);
      return `({ kind: ${JSON.stringify(name)}, children: [${children}], props: ${propsObj} })`;
    }
    case "heading": {
      const text = t.args[0] ? jsOfExpr(asExpr(t.args[0].value), ctx) : '""';
      return `({ kind: "heading", text: _s.show(${text}), props: ${propsObj} })`;
    }
    case "text": {
      const text = t.args[0] ? jsOfExpr(asExpr(t.args[0].value), ctx) : '""';
      return `({ kind: "text", text: _s.show(${text}), props: ${propsObj} })`;
    }
    case "button": {
      const textArg = t.args.find((a) => a.name === "text");
      const textJs = textArg ? jsOfExpr(asExpr(textArg.value), ctx) : '""';
      return `({ kind: "button", text: _s.show(${textJs}), props: ${propsObj} })`;
    }
    case "input": {
      const fields: string[] = [`kind: "input"`];
      const bindInfo = extractBindPath(t.args);
      for (const arg of t.args) {
        if (!arg.name || arg.name === "bind") continue;
        const valJs = jsOfExpr(asExpr(arg.value), ctx);
        if (arg.name === "value") fields.push(`value: _s.show(${valJs})`);
        else if (arg.name === "placeholder") fields.push(`placeholder: ${valJs}`);
        else if (arg.name === "type") fields.push(`type: ${valJs}`);
        else if (arg.name === "id") fields.push(`id: ${valJs}`);
        else if (arg.name === "auto-focus") fields.push(`autoFocus: ${valJs}`);
        else if (arg.name === "required") fields.push(`required: ${valJs}`);
        else if (arg.name === "accept") fields.push(`accept: ${valJs}`);
        else if (arg.name === "multiple") fields.push(`multiple: ${valJs}`);
      }
      if (bindInfo) {
        fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
        if (bindInfo.path.length > 0) {
          fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
        }
        fields.push(`value: _s.show(${bindInfo.readJs})`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "textarea": {
      const fields: string[] = [`kind: "textarea"`];
      const bindInfo = extractBindPath(t.args);
      for (const arg of t.args) {
        if (!arg.name || arg.name === "bind") continue;
        const valJs = jsOfExpr(asExpr(arg.value), ctx);
        if (arg.name === "value") fields.push(`value: _s.show(${valJs})`);
        else if (arg.name === "placeholder") fields.push(`placeholder: ${valJs}`);
        else if (arg.name === "id") fields.push(`id: ${valJs}`);
        else if (arg.name === "rows") fields.push(`rows: ${valJs}`);
      }
      if (bindInfo) {
        fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
        if (bindInfo.path.length > 0) {
          fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
        }
        fields.push(`value: _s.show(${bindInfo.readJs})`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "check": {
      const valArg = t.args.find((a) => a.name === "value");
      const checked = valArg ? jsOfExpr(asExpr(valArg.value), ctx) : "false";
      return `({ kind: "check", checked: !!(${checked}), props: ${propsObj} })`;
    }
    case "select": {
      const fields: string[] = [`kind: "select"`];
      const bindInfo = extractBindPath(t.args);
      if (bindInfo) {
        fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
        if (bindInfo.path.length > 0) {
          fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
        }
        fields.push(`value: ${bindInfo.readJsRaw}`);
      } else {
        // No bind=; allow `value=<expr>` for read-only / dispatch-via-reducer selects.
        const valArg = t.args.find((a) => a.name === "value");
        if (valArg) fields.push(`value: ${jsOfExpr(asExpr(valArg.value), ctx)}`);
      }
      const optionsArg = t.args.find((a) => a.name === "options");
      if (optionsArg) {
        fields.push(`options: ${jsOfExpr(asExpr(optionsArg.value), ctx)}`);
      } else {
        fields.push(`options: []`);
      }
      const placeholderArg = t.args.find((a) => a.name === "placeholder");
      if (placeholderArg) {
        fields.push(`placeholder: ${jsOfExpr(asExpr(placeholderArg.value), ctx)}`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "radio": {
      const fields: string[] = [`kind: "radio"`];
      for (const arg of t.args) {
        if (!arg.name) continue;
        const valJs = jsOfExpr(asExpr(arg.value), ctx);
        if (arg.name === "group") fields.push(`group: ${valJs}`);
        else if (arg.name === "value") fields.push(`value: ${valJs}`);
        else if (arg.name === "selected") fields.push(`selected: !!(${valJs})`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "spinner":
      return `({ kind: "spinner", props: ${propsObj} })`;
    case "form": {
      const children = collectChildren(t.args, gen, ctx, enclosingTile);
      return `({ kind: "form", children: [${children}], props: ${propsObj} })`;
    }
    case "label": {
      const text = t.args.find((a) => a.name === "text");
      const textJs = text ? jsOfExpr(asExpr(text.value), ctx) : '""';
      return `({ kind: "label", text: _s.show(${textJs}), props: ${propsObj} })`;
    }
    case "link": {
      const toArg = t.args.find((a) => a.name === "to");
      const to = toArg ? jsOfExpr(asExpr(toArg.value), ctx) : '""';
      // Label is the `text=` argument (canonical, consistent with `button`); the
      // `{text: …}` prop form is also accepted for back-compat (§1.7.1).
      const textArg = t.args.find((a) => a.name === "text");
      const textProp = t.props.find((p) => p.name === "text");
      const textExpr = textArg ? asExpr(textArg.value) : textProp ? textProp.value : undefined;
      const text = textExpr ? jsOfExpr(textExpr, ctx) : '""';
      // §3.8 prefetch — the prop value is a bare reducer ident (Ref) or a
      // string literal. We surface it as a literal string so the runtime can
      // route it through `_dispatch` without re-resolving identifiers.
      const fields = [`kind: "link"`, `text: _s.show(${text})`, `to: _s.show(${to})`];
      const prefetchProp = t.props.find((p) => p.name === "prefetch");
      if (prefetchProp) {
        const v = prefetchProp.value as Expr;
        if (v.kind === "Ref") {
          fields.push(`prefetch: ${JSON.stringify((v as Expr & { name: string }).name)}`);
        } else if (v.kind === "Str") {
          fields.push(`prefetch: ${JSON.stringify((v as Expr & { value: string }).value)}`);
        } else {
          fields.push(`prefetch: ${jsOfExpr(v, ctx)}`);
        }
      }
      const prefetchArgsProp = t.props.find((p) => p.name === "prefetch-args");
      if (prefetchArgsProp) {
        fields.push(`prefetchArgs: ${jsOfExpr(prefetchArgsProp.value, ctx)}`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "markdown": {
      const text = t.args[0] ? jsOfExpr(asExpr(t.args[0].value), ctx) : '""';
      return `({ kind: "markdown", text: _s.show(${text}), props: ${propsObj} })`;
    }
    case "skeleton":
      return `({ kind: "skeleton", props: ${propsObj} })`;
    case "image": {
      const src = t.args.find((a) => a.name === "src");
      const srcJs = src ? jsOfExpr(asExpr(src.value), ctx) : '""';
      return `({ kind: "image", src: _s.show(${srcJs}), props: ${propsObj} })`;
    }
    case "icon": {
      const name = t.args.find((a) => a.name === "name");
      const nameExpr = name ? asExpr(name.value) : null;
      // String-literal names get captured so the toolchain can bake matching
      // entries from the project's icon registry into `App.icons` (#101). Other
      // forms (Ref, expression) resolve dynamically through `theme.icons` at
      // runtime — no compile-time bundling.
      if (nameExpr && nameExpr.kind === "Str") {
        const literal = (nameExpr as Expr & { value: string }).value;
        if (literal) ctx.gen.usedIcons.add(literal);
      }
      const nameJs = nameExpr ? jsOfExpr(nameExpr, ctx) : '""';
      return `({ kind: "icon", name: _s.show(${nameJs}), props: ${propsObj} })`;
    }
    case "code": {
      const arg0 = t.args.find((a) => !a.name);
      const text = arg0 ? jsOfExpr(asExpr(arg0.value), ctx) : '""';
      const langArg = t.args.find((a) => a.name === "lang");
      const lang = langArg ? `_s.show(${jsOfExpr(asExpr(langArg.value), ctx)})` : "undefined";
      return `({ kind: "code", text: _s.show(${text}), lang: ${lang}, props: ${propsObj} })`;
    }
    case "video": {
      const fields: string[] = [`kind: "video"`];
      const src = t.args.find((a) => a.name === "src");
      if (src) fields.push(`src: _s.show(${jsOfExpr(asExpr(src.value), ctx)})`);
      const controls = t.args.find((a) => a.name === "controls");
      if (controls) fields.push(`controls: !!(${jsOfExpr(asExpr(controls.value), ctx)})`);
      const autoplay = t.args.find((a) => a.name === "autoplay");
      if (autoplay) fields.push(`autoplay: !!(${jsOfExpr(asExpr(autoplay.value), ctx)})`);
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "list": {
      const children = collectChildren(t.args, gen, ctx, enclosingTile);
      const ordered = t.args.find((a) => a.name === "ordered");
      const ord = ordered ? `!!(${jsOfExpr(asExpr(ordered.value), ctx)})` : "false";
      return `({ kind: "list", ordered: ${ord}, children: [${children}], props: ${propsObj} })`;
    }
    case "table-cell": {
      const children = collectChildren(t.args, gen, ctx, enclosingTile);
      const fields: string[] = [`kind: "table-cell"`, `children: [${children}]`];
      const colspan = t.args.find((a) => a.name === "colspan");
      if (colspan) fields.push(`colspan: ${jsOfExpr(asExpr(colspan.value), ctx)}`);
      const rowspan = t.args.find((a) => a.name === "rowspan");
      if (rowspan) fields.push(`rowspan: ${jsOfExpr(asExpr(rowspan.value), ctx)}`);
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "modal":
    case "drawer":
    case "popover": {
      const children = collectChildren(t.args, gen, ctx, enclosingTile);
      const fields: string[] = [`kind: ${JSON.stringify(name)}`, `children: [${children}]`];
      const open = t.args.find((a) => a.name === "open");
      fields.push(`open: ${open ? `!!(${jsOfExpr(asExpr(open.value), ctx)})` : "true"}`);
      for (const key of ["title", "side", "placement"]) {
        const a = t.args.find((x) => x.name === key);
        if (a) fields.push(`${key}: _s.show(${jsOfExpr(asExpr(a.value), ctx)})`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "tooltip": {
      const children = collectChildren(t.args, gen, ctx, enclosingTile);
      const fields: string[] = [`kind: "tooltip"`, `children: [${children}]`];
      const text = t.args.find((a) => a.name === "text");
      if (text) fields.push(`text: _s.show(${jsOfExpr(asExpr(text.value), ctx)})`);
      const placement = t.args.find((a) => a.name === "placement");
      if (placement) fields.push(`placement: _s.show(${jsOfExpr(asExpr(placement.value), ctx)})`);
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "toast": {
      const fields: string[] = [`kind: "toast"`];
      const level = t.args.find((a) => a.name === "kind");
      if (level) fields.push(`level: _s.show(${jsOfExpr(asExpr(level.value), ctx)})`);
      const text = t.args.find((a) => a.name === "text");
      if (text) fields.push(`text: _s.show(${jsOfExpr(asExpr(text.value), ctx)})`);
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "progress": {
      const fields: string[] = [`kind: "progress"`];
      const value = t.args.find((a) => a.name === "value");
      if (value) fields.push(`value: ${jsOfExpr(asExpr(value.value), ctx)}`);
      const max = t.args.find((a) => a.name === "max");
      if (max) fields.push(`max: ${jsOfExpr(asExpr(max.value), ctx)}`);
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "slider": {
      const fields: string[] = [`kind: "slider"`];
      const bindInfo = extractBindPath(t.args);
      for (const arg of t.args) {
        if (!arg.name || arg.name === "bind") continue;
        const valJs = jsOfExpr(asExpr(arg.value), ctx);
        if (arg.name === "min") fields.push(`min: ${valJs}`);
        else if (arg.name === "max") fields.push(`max: ${valJs}`);
        else if (arg.name === "step") fields.push(`step: ${valJs}`);
      }
      if (bindInfo) {
        fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
        if (bindInfo.path.length > 0) fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
        fields.push(`value: ${bindInfo.readJsRaw}`);
      }
      fields.push(`props: ${propsObj}`);
      return `({ ${fields.join(", ")} })`;
    }
    case "switch": {
      const valArg = t.args.find((a) => a.name === "value");
      const checked = valArg ? jsOfExpr(asExpr(valArg.value), ctx) : "false";
      return `({ kind: "switch", checked: !!(${checked}), props: ${propsObj} })`;
    }
    case "error": {
      const fieldArg = t.args.find((a) => a.name === "field");
      const fieldName =
        fieldArg && (fieldArg.value as Expr).kind === "Ref"
          ? (fieldArg.value as Expr & { name: string }).name
          : "";
      return `({ kind: "error", field: ${JSON.stringify(fieldName)}, props: ${propsObj} })`;
    }
    case "route-outlet":
      return `({ kind: "route-outlet", children: [], props: ${propsObj} })`;
  }
  throw new Error(`Unsupported builtin tile "${name}"`);
}

function asExpr(v: Expr | TileExpr): Expr {
  return v as Expr;
}

function collectChildren(
  args: { kind: "TileArg"; name?: string; value: Expr | TileExpr }[],
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTile?: string,
): string {
  const parts: string[] = [];
  for (const a of args) {
    if (a.name) continue; // skip named args at container level
    const v = a.value;
    if (
      (v as TileExpr).kind === "TileCall" ||
      (v as TileExpr).kind === "TileFor" ||
      (v as TileExpr).kind === "TileWhen" ||
      (v as TileExpr).kind === "TileIf" ||
      (v as TileExpr).kind === "TileMatch"
    ) {
      parts.push(tileExprJs(v as TileExpr, gen, ctx, enclosingTile));
    } else if ((v as Expr).kind === "Ref") {
      const refName = (v as Expr & { name: string }).name;
      const def = gen.tiles.find((x) => x.name === refName);
      if (def) {
        parts.push(tileExprJs(def.body, gen, ctx, def.name));
      } else {
        parts.push("null");
      }
    }
  }
  // Wrap in _children(...) so the runtime can flatten arrays and drop nulls.
  return `..._children(${parts.join(", ")})`;
}

function propsFor(
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  enclosingTile?: string,
): string {
  const entries: string[] = [];
  // event handler args (onClick=remove etc) attach as props for that tile.
  for (const a of t.args) {
    if (!a.name) continue;
    if (
      a.name === "onClick" ||
      a.name === "onSubmit" ||
      a.name === "onChange" ||
      a.name === "onInput" ||
      a.name === "onClose"
    ) {
      if ((a.value as Expr).kind === "Ref") {
        const reducerName = (a.value as Expr & { name: string }).name;
        entries.push(
          `${a.name}: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(reducerName)}, el)`,
        );
      }
    }
  }
  // props block
  for (const p of t.props) {
    if (
      p.name === "onClick" ||
      p.name === "onSubmit" ||
      p.name === "onChange" ||
      p.name === "onInput" ||
      p.name === "onClose" ||
      p.name === "onKeyDown" ||
      p.name === "onMouseEnter"
    ) {
      if ((p.value as Expr).kind === "Ref") {
        const reducerName = (p.value as Expr as Expr & { name: string }).name;
        entries.push(
          `${p.name}: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(reducerName)}, el)`,
        );
      }
      continue;
    }
    // §3.8 link prefetch — the link tile lifts these into top-level fields, so
    // do not also echo them through `props` (the bare-ident `prefetch: foo`
    // value would otherwise emit as a JS variable reference at codegen).
    if (t.name === "link" && (p.name === "prefetch" || p.name === "prefetch-args")) continue;
    // event handler from enclosing tile (e.g. ResetBtn has no onClick but reducer subscribes to ui.click(ResetBtn))
    entries.push(`${jsName(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }
  // Implicit onClick from reducers subscribing to this enclosing tile name
  if (t.name === "button" && enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "click" && rr.on.selector.tile === enclosingTile,
    );
    if (r && !entries.some((e) => e.startsWith("onClick"))) {
      entries.push(
        `onClick: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
    }
  }
  // Implicit onClick for `check` / `switch` when reducer subscribes via enclosing tile
  if ((t.name === "check" || t.name === "switch") && enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "click" && rr.on.selector.tile === enclosingTile,
    );
    if (r && !entries.some((e) => e.startsWith("onClick"))) {
      entries.push(
        `onClick: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
    }
  }
  // Implicit onSubmit for form when reducer subscribes to enclosing user tile
  if (t.name === "form" && enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "submit" && rr.on.selector.tile === enclosingTile,
    );
    if (r)
      entries.push(
        `onSubmit: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
  }
  // Implicit onChange for select / input / textarea when reducer subscribes to ui.change(EnclosingTile)
  if ((t.name === "select" || t.name === "input" || t.name === "textarea") && enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "change" && rr.on.selector.tile === enclosingTile,
    );
    if (r && !entries.some((e) => e.startsWith("onChange"))) {
      entries.push(
        `onChange: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
    }
  }
  // Implicit onInput for input / textarea when reducer subscribes to ui.input(EnclosingTile)
  if ((t.name === "input" || t.name === "textarea") && enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "input" && rr.on.selector.tile === enclosingTile,
    );
    if (r && !entries.some((e) => e.startsWith("onInput"))) {
      entries.push(
        `onInput: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
    }
  }
  // Implicit onKeyDown for input / textarea / button when reducer subscribes to
  // ui.key(EnclosingTile). The runtime exposes `el.key` (the KeyboardEvent.key
  // value) so reducers can branch on which key was pressed.
  if ((t.name === "input" || t.name === "textarea" || t.name === "button") && enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "key" && rr.on.selector.tile === enclosingTile,
    );
    if (r && !entries.some((e) => e.startsWith("onKeyDown"))) {
      entries.push(
        `onKeyDown: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
    }
  }
  // Implicit onMouseEnter for any tile when reducer subscribes to
  // ui.hover(EnclosingTile). Hover is broadly applicable so no tile-name filter.
  if (enclosingTile) {
    const r = ctx.gen.reducers.find(
      (rr) =>
        rr.on.kind === "UiEvent" && rr.on.ev === "hover" && rr.on.selector.tile === enclosingTile,
    );
    if (r && !entries.some((e) => e.startsWith("onMouseEnter"))) {
      entries.push(
        `onMouseEnter: (el) => globalThis.__kumikiApp._dispatch(${JSON.stringify(r.name)}, el)`,
      );
    }
  }
  // Build `el` from explicit {key: expr} that aren't handlers
  const elProps: string[] = [];
  for (const p of t.props) {
    if (
      p.name === "onClick" ||
      p.name === "onSubmit" ||
      p.name === "onChange" ||
      p.name === "onInput" ||
      p.name === "onClose" ||
      p.name === "onKeyDown" ||
      p.name === "onMouseEnter"
    )
      continue;
    // §3.8 link prefetch — these are runtime-side fields, not slot data; their
    // value space (reducer-name ident / argument record) doesn't belong in `el`.
    if (t.name === "link" && (p.name === "prefetch" || p.name === "prefetch-args")) continue;
    // §4.3 style block — a CSS prop bag the runtime applies to el.style. It's
    // not reducer data, and shipping it twice (top-level + el) re-evaluates
    // every `@token` ref needlessly.
    if (p.name === "style") continue;
    elProps.push(`${jsName(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }
  if (elProps.length > 0) {
    entries.push(`el: { ${elProps.join(", ")} }`);
  }
  return `{ ${entries.join(", ")} }`;
}

function addBind(ctx: EvalCtx, name: string): EvalCtx {
  const out = makeEvalCtx(ctx.gen, ctx.localBinds);
  out.localBinds.add(name);
  return out;
}

// ----- helpers -----

function jsName(name: string): string {
  // Map kebab-case and Kumiki-special names to safe JS identifiers.
  return name.replace(/^\$/, "_d_").replace(/-/g, "_").replace(/\./g, "_");
}

/** The outcome of a mock value `ok(v)` / `err(e)` / `delay(ms, ok(v)|err(e))`. */
function mockOutcome(v: Expr): "ok" | "err" | undefined {
  if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) return v.callee;
  if (v.kind === "Call" && v.callee === "delay") {
    const inner = v.args[1];
    if (inner?.kind === "Call" && (inner.callee === "ok" || inner.callee === "err")) {
      return inner.callee;
    }
  }
  return undefined;
}

/** Extract the reducer name from a `run-reducer(name)` argument (a bare ref). */
function reducerNameArg(e: Expr | undefined): string {
  if (e?.kind === "Ref") return e.name;
  if (e?.kind === "Variant") return e.name;
  return "";
}

type GenDescData = { t: string; [k: string]: unknown };

/** Translate a type into a property-test generation descriptor (spec §8.3.2). */
function typeToGenDesc(t: TypeExpr, gen: GenCtx, seen: Set<string>): GenDescData {
  switch (t.kind) {
    case "TypePrim":
      return primGenDesc(t.name);
    case "TypeApp": {
      const a = t.args;
      const d = (x: TypeExpr | undefined): GenDescData =>
        x ? typeToGenDesc(x, gen, seen) : { t: "Unknown" };
      if (t.name === "List") return { t: "List", elem: d(a[0]) };
      if (t.name === "Set") return { t: "Set", elem: d(a[0]) };
      if (t.name === "Map") return { t: "Map", key: d(a[0]), val: d(a[1]) };
      if (t.name === "Option") return { t: "Option", inner: d(a[0]) };
      if (t.name === "Result") return { t: "Result", ok: d(a[0]), err: d(a[1]) };
      return { t: "Unknown" };
    }
    case "TypeRef": {
      if (seen.has(t.name)) return { t: "Unknown" };
      const def = gen.types.get(t.name);
      if (!def) return { t: "Unknown" };
      const next = new Set(seen);
      next.add(t.name);
      return typeToGenDesc(def.body, gen, next);
    }
    case "TypeNominal":
    case "TypeRefinement":
      return applyRefine(typeToGenDesc(t.inner, gen, seen), t.refinement);
    case "TypeRecord":
      return {
        t: "Record",
        fields: t.fields.map((f) => ({ name: f.name, desc: typeToGenDesc(f.type, gen, seen) })),
      };
    case "TypeUnion":
      return {
        t: "Union",
        variants: t.variants.map((v) => ({
          name: v.name,
          payloads: v.payloads.map((p) => typeToGenDesc(p, gen, seen)),
        })),
      };
    default:
      return { t: "Unknown" };
  }
}

function primGenDesc(name: string): GenDescData {
  if (name === "Int" || name === "Time") return { t: "Int" };
  if (name === "Float") return { t: "Float" };
  if (name === "Text" || name === "Bytes") return { t: "Text" };
  if (name === "Bool") return { t: "Bool" };
  return { t: "Unknown" };
}

/** Fold a refinement into a base descriptor so generation respects it (§8.3.2). */
function applyRefine(desc: GenDescData, r: Refinement | undefined): GenDescData {
  if (!r) return desc;
  const num = (i: number): number => (typeof r.args[i] === "number" ? (r.args[i] as number) : 0);
  switch (r.pred) {
    case "between":
      return desc.t === "Int" || desc.t === "Float" ? { ...desc, min: num(0), max: num(1) } : desc;
    case "positive":
      if (desc.t === "Int") return { ...desc, min: 1 };
      if (desc.t === "Float") return { ...desc, min: 0 };
      return desc;
    case "nonempty":
      return desc.t === "Text" ? { ...desc, minLen: 1 } : desc;
    case "len-eq":
      return desc.t === "Text" ? { ...desc, minLen: num(0), maxLen: num(0) } : desc;
    case "len-gt":
      return desc.t === "Text" ? { ...desc, minLen: num(0) + 1 } : desc;
    case "len-lt":
      return desc.t === "Text" ? { ...desc, maxLen: Math.max(0, num(0) - 1) } : desc;
    default:
      return desc;
  }
}

/** Resolve a slot/type's refinement (through a TypeRef), for the `error` tile. */
function slotRefinement(t: TypeExpr, gen: GenCtx): Refinement | undefined {
  let target = t;
  if (t.kind === "TypeRef") {
    const def = gen.types.get(t.name);
    if (!def) return undefined;
    target = def.body;
  }
  if (target.kind === "TypeNominal" || target.kind === "TypeRefinement") {
    return (target as { refinement?: Refinement }).refinement;
  }
  return undefined;
}

function refinementJs(t: TypeExpr, gen: GenCtx): string | undefined {
  let target = t;
  if (t.kind === "TypeRef") {
    const def = gen.types.get(t.name);
    if (!def) return undefined;
    target = def.body;
  }
  if (target.kind === "TypeNominal" || target.kind === "TypeRefinement") {
    const r = (target as { refinement?: Refinement }).refinement;
    if (r) return refinementToJs(r);
  }
  return undefined;
}

function refinementToJs(r: Refinement): string | undefined {
  switch (r.pred) {
    case "between": {
      const a = r.args[0] as number;
      const b = r.args[1] as number;
      return `(v) => typeof v === "number" && v >= ${a} && v <= ${b}`;
    }
    case "nonempty":
      return `(v) => typeof v === "string" && v.length > 0`;
    case "len-lt":
      return `(v) => typeof v === "string" && v.length < ${r.args[0] as number}`;
    case "len-gt":
      return `(v) => typeof v === "string" && v.length > ${r.args[0] as number}`;
    case "len-eq":
      return `(v) => typeof v === "string" && v.length === ${r.args[0] as number}`;
    default:
      return `(_v) => true`;
  }
}

function emitFromInitExpr(e: Expr): string {
  if (e.kind === "Call") {
    return `{ effect: ${JSON.stringify(e.callee)}, args: [${e.args.map((a) => jsOfExpr(a, { gen: {} as GenCtx, localBinds: new Set() })).join(", ")}] }`;
  }
  return "null";
}

export const RUNTIME_HELPERS = `
function _setPath(obj, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const cur = obj ?? {};
  return { ...cur, [head]: _setPath(cur[head], rest, value) };
}
function _children(...xs) {
  const out = [];
  for (const x of xs) {
    if (x === null || x === undefined) continue;
    if (Array.isArray(x)) {
      for (const y of x) if (y !== null && y !== undefined) out.push(y);
    } else {
      out.push(x);
    }
  }
  return out;
}
function _attachProps(node, props) {
  if (!node || !props) return node;
  return { ...node, props: { ...(node.props || {}), ...props } };
}
function _named(node, name) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((n) => _named(n, name));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  return { ...node, props: { ...(node.props || {}), _tile: name } };
}
`;
