// AST → self-contained ES module that uses the runtime API.
//
// The compile pipeline is `lex → parse → check → codegen`. This entry file
// assembles the app: it drives the per-definition emitters — slot / effect /
// reducer / tile / fn (and the test DSL) — from `./codegen/`, threads their
// output into the `createApp()` factory, builds the routes / theme / motion
// registries + `App` object, bakes the used-icon subset (#101), and emits
// the mount call. The import-header analysis and selector dispatch wiring
// also live under `./codegen/`. Expression lowering (`jsOfExpr`) is shared
// by every layer via `./codegen/expr.ts`. See `docs/spec/index.md` for the
// layer semantics and `packages/runtime/src/tiles-*.ts` / `effects-*.ts`
// for the runtime modules the granular per-feature build imports here.

import type {
  AppDef,
  EffectDef,
  FnDef,
  Program,
  ReducerDef,
  SlotDef,
  TestDef,
  TileDef,
  TypeDef,
} from "./ast.ts";
import type { GenCtx } from "./codegen/context.ts";
import { HANDLER_MEMO_PREAMBLE, jsBinding } from "./codegen/context.ts";
import {
  appAnalyticsJson,
  appMetaJson,
  emitFromInitExpr,
  httpConfigJs,
  indexedDbConfigJs,
} from "./codegen/emit-app.ts";
import { genEffect } from "./codegen/emit-effect.ts";
import { genFn } from "./codegen/emit-fn.ts";
import { genReducer } from "./codegen/emit-reducer.ts";
import { emitSlots } from "./codegen/emit-slot.ts";
import { coverageJs, genTest } from "./codegen/emit-test.ts";
import { genTile } from "./codegen/emit-tile.ts";
import { analyzeRuntimeUsage, emitImportHeader } from "./codegen/imports.ts";

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
   * runtime test harness does not need filesystem access. Optional. When
   * omitted, an `episode-test load = "..."` still emits (with an empty
   * `episodes: []`), so callers that actually run episode tests must
   * provide this — otherwise the replay loop is skipped and `from-log`
   * expectations degenerate into no-ops.
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
  lines.push(HANDLER_MEMO_PREAMBLE);

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
  for (const line of emitSlots(slots, ctx)) lines.push(line);
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
  // they are built inside the factory and attached to the app. The test bodies
  // themselves go here for the same reason and one more: a `tile-test`'s
  // `expect` is lowered through the full tile pipeline, so it can emit `_h(...)`
  // — and `_h` is this scope's handler memo. Emitting the tests at module scope
  // put those calls where the memo does not exist.
  if (opts.includeTests && tests.length > 0) {
    lines.push("const _tilesById = {");
    for (const tile of tiles) {
      lines.push(`  ${JSON.stringify(tile.name)}: (${jsBinding("$1")}) => ${genTile(tile, ctx)},`);
    }
    lines.push("};");
    lines.push("App._tilesById = _tilesById;");
    lines.push("App._tests = [");
    for (const t of tests) lines.push(genTest(t, ctx, opts));
    lines.push("];");
    // Static coverage for `kumiki test --coverage` (§8.7).
    lines.push(`App._coverage = ${coverageJs(tests, reducers, tiles, effects)};`);
  }

  lines.push("  return App;");
  lines.push("}"); // end createApp
  lines.push("");
  // The default instance — used by auto-mount, the embedding host, and tooling.
  // The global is a state oracle for smoke/scenario/e2e/benchmark harnesses
  // ONLY: the runtime and the generated event handlers do not read it (app
  // resolution goes through the runtime's mount-root registry / the instance's
  // own `App` reference). The exact spelling of the next two emitted lines is
  // load-bearing: cli/test/helpers/build-and-load.ts, tests/helpers/load.ts,
  // and e2e/src/browser.ts patch them with verbatim string replaces.
  lines.push("const App = createApp();");
  lines.push("globalThis.__kumikiApp = App;");

  // In-language tests (`kumiki test`) run against the default instance — the
  // bodies are built inside `createApp()` above, so this only publishes the
  // default instance's copy.
  if (opts.includeTests && tests.length > 0) {
    lines.push("");
    lines.push("globalThis.__kumikiTests = App._tests;");
    lines.push("globalThis.__kumikiCoverage = App._coverage;");
  }
  lines.push("");

  // ----- runtime usage analysis (#71) — the body above is fully generated, so
  // `ctx.usedTiles` is complete. -----
  const usage = analyzeRuntimeUsage(
    app,
    reducers,
    effects,
    ctx.usedTiles,
    !!opts.includeTests,
    tests.length > 0,
  );

  const header = emitImportHeader(usage, opts);

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
      // Companion to `tiles`: without it `mountCore` defaults to an empty
      // patcher registry and every data-prop change tears its tile down and
      // rebuilds it, so the granular build would silently lose the in-place
      // patch guarantees (focus, caret, <select> open, <video> playback) that
      // the monolith mount path provides.
      "tilePatchers: _patchers",
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

export { FIELD_ACCESS_SHORTCUTS, KNOWN_MEMBERS, KNOWN_METHODS } from "./codegen/expr.ts";
export { RUNTIME_HELPERS } from "./codegen/runtime-helpers.ts";
