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
import { failsWithText } from "./capabilities.ts";
import type { GenCtx } from "./codegen/context.ts";
import { HANDLER_MEMO_PREAMBLE, jsBinding } from "./codegen/context.ts";
import {
  appAnalyticsJson,
  appMetaJson,
  emitFromInitExpr,
  httpConfigJs,
  indexedDbConfigJs,
} from "./codegen/emit-app.ts";
import { genEffect, TEXT_FAILURE_HELPER } from "./codegen/emit-effect.ts";
import { genFn } from "./codegen/emit-fn.ts";
import { genReducer } from "./codegen/emit-reducer.ts";
import { emitSlots } from "./codegen/emit-slot.ts";
import { coverageJs, genTest } from "./codegen/emit-test.ts";
import { bindReaderDecls, genRouteTile, genTile } from "./codegen/emit-tile.ts";
import { analyzeRuntimeUsage, emitImportHeader } from "./codegen/imports.ts";
import { nestedRefinements } from "./codegen/nested-refinements.ts";
import { STDLIB_TYPES } from "./stdlib-types.ts";

export type CodegenOptions = {
  runtimeSpecifier: string;
  /** Emit the in-language `test` definitions (`__kumikiTests`). Off for production builds. */
  includeTests?: boolean;
  exportApp?: boolean;
  runtimeModulesDir?: string;
  /** Reads an `episode-test`'s `load` file; without it, such a test fails instead of replaying nothing. */
  readEpisodeLog?: (relativePath: string) => string;
  icons?: Record<string, string>;
};

export type CodegenResult = {
  js: string;
  runtimeModules: string[];
  usedIcons: string[];
};

export function codegen(program: Program, opts: CodegenOptions): CodegenResult {
  const types = new Map<string, TypeDef>(STDLIB_TYPES.map((d) => [d.name, d]));
  for (const d of program.defs) {
    if (d.kind === "TypeDef") types.set(d.name, d);
  }
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
    refinements: nestedRefinements({ types }),
    usedReaders: new Set(),
  };

  const lines: string[] = [];

  lines.push("function createApp() {");
  lines.push(HANDLER_MEMO_PREAMBLE);
  // The bound-input readers go here once the body below has said which it uses.
  const readersAt = lines.length;

  for (const fn of fns) {
    lines.push(genFn(fn, ctx));
  }

  const refinementsAt = lines.length;

  lines.push(httpConfigJs(app.http, ctx));
  lines.push(indexedDbConfigJs(app.indexedDb));
  lines.push("");

  if (effects.some((e) => failsWithText(e.cap))) lines.push(TEXT_FAILURE_HELPER);
  lines.push("const _effects = {");
  for (const eff of effects) {
    lines.push(`  ${JSON.stringify(eff.name)}: ${genEffect(eff, ctx)},`);
  }
  lines.push("};");
  lines.push("");

  for (const line of emitSlots(slots, ctx)) lines.push(line);
  lines.push("");

  lines.push("const _live = {};");
  lines.push("for (const [k, v] of Object.entries(_slots)) _live[k] = v.value;");
  lines.push("");

  lines.push("const _reducers = [");
  for (const r of reducers) lines.push(genReducer(r, ctx));
  lines.push("];");
  lines.push("");

  lines.push("const _routes = [");
  for (const r of app.routes) {
    if (r.tile.startsWith(">>")) {
      const target = r.tile.slice(2);
      lines.push(
        `  { pattern: ${JSON.stringify(r.path)}, redirectTo: ${JSON.stringify(target)} },`,
      );
    } else {
      const tile = tiles.find((t) => t.name === r.tile);
      const where = `Route ${r.path}`;
      if (!tile) throw new Error(`${where} targets undefined tile "${r.tile}"`);
      const sr = tile.scrollRestoration === false ? ", scrollRestoration: false" : "";
      const name = `name: ${JSON.stringify(tile.name)}`;
      if (tile.subRoutes && tile.subRoutes.length > 0) {
        lines.push(
          `  { pattern: ${JSON.stringify(r.path)}, ${name}, tile: (_fill) => ${genRouteTile(tile, ctx, where, "_fill")}${sr}, subRoutes: [`,
        );
        for (const subR of tile.subRoutes) {
          if (subR.tile.startsWith(">>")) {
            lines.push(
              `    { pattern: ${JSON.stringify(subR.path)}, redirectTo: ${JSON.stringify(subR.tile.slice(2))} },`,
            );
          } else {
            const childTile = tiles.find((t) => t.name === subR.tile);
            const childWhere = `Sub-route ${subR.path} in tile "${tile.name}"`;
            if (!childTile) throw new Error(`${childWhere} targets undefined tile "${subR.tile}"`);
            const csr = childTile.scrollRestoration === false ? ", scrollRestoration: false" : "";
            lines.push(
              `    { pattern: ${JSON.stringify(subR.path)}, name: ${JSON.stringify(childTile.name)}, tile: () => ${genRouteTile(childTile, ctx, childWhere)}${csr} },`,
            );
          }
        }
        lines.push(`  ] },`);
      } else {
        lines.push(
          `  { pattern: ${JSON.stringify(r.path)}, ${name}, tile: () => ${genRouteTile(tile, ctx, where)}${sr} },`,
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
  const themeRef = app.theme ? JSON.stringify(app.theme.name) : "null";
  lines.push("");

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
  lines.push(`  init: [${app.init.map((e) => emitFromInitExpr(e, ctx)).join(", ")}],`);
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
    // Static coverage for `kumiki test --coverage`.
    lines.push(`App._coverage = ${coverageJs(tests, reducers, tiles, effects)};`);
  }

  lines.splice(refinementsAt, 0, ...ctx.refinements.decls);
  lines.push("  return App;");
  lines.push("}"); // end createApp
  lines.push("");
  lines.push("const App = createApp();");
  lines.push("globalThis.__kumikiApp = App;");

  if (opts.includeTests && tests.length > 0) {
    lines.push("");
    lines.push("globalThis.__kumikiTests = App._tests;");
    lines.push("globalThis.__kumikiCoverage = App._coverage;");
  }
  lines.push("");

  // After the refinements splice above, which sits at a larger index.
  lines.splice(readersAt, 0, ...bindReaderDecls(ctx.usedReaders));

  const usage = analyzeRuntimeUsage(
    app,
    reducers,
    effects,
    ctx,
    ctx.usedTiles,
    !!opts.includeTests,
    tests.length > 0,
  );

  const header = emitImportHeader(usage, opts);

  if (opts.exportApp) {
    lines.push("export default App;");
    lines.push("export { createApp };");
  } else if (opts.runtimeModulesDir) {
    const mountOpts = [
      "tiles: _tiles",
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

export {
  FIELD_ACCESS_SHORTCUTS,
  FRAGMENT_ARGUMENTS,
  KNOWN_MEMBERS,
  KNOWN_METHODS,
  METHOD_MIN_ARGS,
} from "./codegen/expr.ts";
export { RUNTIME_HELPERS } from "./codegen/runtime-helpers.ts";
