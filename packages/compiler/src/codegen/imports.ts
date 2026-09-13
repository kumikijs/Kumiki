import type { AppDef, EffectDef, ReducerDef } from "../ast.ts";
import {
  PER_TILE_FAMILIES,
  PER_TILE_FAMILY_SHARED,
  TILE_FAMILY,
  type TileFamily,
  tileModule,
} from "../builtins.ts";
import { tileFamilyVar, tilePatcherFamilyVar, tilePatcherVar, tileVar } from "./context.ts";
import { collectEmits } from "./emit-reducer.ts";

type IndexedHandler = "indexedRead" | "indexedWrite" | "indexedDelete";

export type RuntimeUsage = {
  /** Tile family modules the app renders whole, in stable order. */
  families: TileFamily[];
  /**
   * Tile kinds the app renders that ship one module each (#71), in stable
   * order. Disjoint from `families`: a kind is in exactly one of the two,
   * according to `PER_TILE_FAMILIES`.
   */
  tiles: string[];
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

export const TILE_FAMILY_ORDER: TileFamily[] = [
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
export function analyzeRuntimeUsage(
  app: AppDef,
  reducers: ReducerDef[],
  effects: EffectDef[],
  usedTiles: Set<string>,
  includeTests: boolean,
  hasTests: boolean,
): RuntimeUsage {
  const emits = new Set<string>();
  for (const r of reducers) for (const e of collectEmits(r.do)) emits.add(e);
  for (const e of app.init) if (e.kind === "Call") emits.add(e.callee);

  // A family is shipped whole only when it is not one of the per-tile ones;
  // its tiles are listed individually otherwise. `usedTiles` can name a tile
  // the table does not know (a user-defined tile reaches codegen by name), so
  // both lists are built from the table rather than from the set.
  const families = TILE_FAMILY_ORDER.filter(
    (f) => !PER_TILE_FAMILIES.includes(f) && [...usedTiles].some((t) => TILE_FAMILY[t] === f),
  );
  const tiles = [...usedTiles]
    .filter((t) => PER_TILE_FAMILIES.includes(TILE_FAMILY[t] as TileFamily))
    .sort();
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
  const testkit = includeTests && hasTests;

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
    ...tiles.map((t) => tileModule(t) as string),
    // A per-tile family's shared module rides along once, for any of its tiles.
    ...[...new Set(tiles.map((t) => PER_TILE_FAMILY_SHARED[TILE_FAMILY[t] as TileFamily]))].filter(
      (m): m is string => m !== undefined,
    ),
  ];
  return { families, tiles, router, storage, indexed, http, toast, confirm, testkit, modules };
}

/** A tile kind as an object key: quoted only when it is not an identifier. */
function tileKey(kind: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(kind) ? kind : JSON.stringify(kind);
}

/**
 * Build the import header for the compiled module together with the `_s`
 * stdlib binding (and, in the granular path only, the `_tiles` renderer map).
 * `runtimeModulesDir` picks the per-feature granular path — one import per
 * runtime module that `analyzeRuntimeUsage` decided is needed. Otherwise a
 * single monolithic import from `runtimeSpecifier` covers everything;
 * `inlineRuntime` (`bundle: true`) then relies on that one-statement shape
 * to strip and inline the runtime bundle in place.
 */
export function emitImportHeader(
  usage: RuntimeUsage,
  opts: { runtimeModulesDir?: string; runtimeSpecifier: string },
): string[] {
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
      header.push(
        `import { ${tileFamilyVar(f)}, ${tilePatcherFamilyVar(f)} } from "${dir}/tiles-${f}.js";`,
      );
    }
    for (const t of usage.tiles) {
      header.push(
        `import { ${tileVar(t)}, ${tilePatcherVar(t)} } from "${dir}/${tileModule(t)}.js";`,
      );
    }
    header.push("");
    header.push(
      usage.testkit ? "const _s = { ..._stdlibCore, ..._stdlibTest };" : "const _s = _stdlibCore;",
    );
    const tileEntries = [
      ...usage.families.map((f) => `...${tileFamilyVar(f)}`),
      ...usage.tiles.map((t) => `${tileKey(t)}: ${tileVar(t)}`),
    ];
    const patcherEntries = [
      ...usage.families.map((f) => `...${tilePatcherFamilyVar(f)}`),
      ...usage.tiles.map((t) => `${tileKey(t)}: ${tilePatcherVar(t)}`),
    ];
    header.push(`const _tiles = { ${tileEntries.join(", ")} };`);
    header.push(`const _patchers = { ${patcherEntries.join(", ")} };`);
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
  return header;
}
