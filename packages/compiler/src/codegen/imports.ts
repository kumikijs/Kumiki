import type { TypeEnv } from "../assignable.ts";
import type { AppDef, EffectDef, ReducerDef } from "../ast.ts";
import {
  EFFECT_HANDLERS_SHARED,
  isPerTileFamily,
  PER_TILE_FAMILY_SHARED,
  TILE_FAMILY,
  type TileFamily,
  tileModule,
} from "../builtins.ts";
import { tileFamilyVar, tilePatcherFamilyVar, tilePatcherVar, tileVar } from "./context.ts";
import { type StorageHandler, storageHandlerOf } from "./emit-effect.ts";
import { collectEmits } from "./emit-reducer.ts";

type IndexedHandler = "indexedRead" | "indexedWrite" | "indexedDelete";

export type RuntimeUsage = {
  /** Tile family modules the app renders whole, in stable order. */
  families: TileFamily[];
  tiles: string[];
  /** True when the app actually routes — see the rules below. */
  router: boolean;
  storage: StorageHandler[];
  /** The IndexedDB effect handlers referenced by generated invokes. */
  indexed: IndexedHandler[];
  http: boolean;
  toast: boolean;
  confirm: boolean;
  testkit: boolean;
  /** Runtime module file basenames the generated imports reference. */
  modules: string[];
};

/** The order the storage handlers are imported in, so the header is stable. */
const STORAGE_HANDLER_ORDER: StorageHandler[] = [
  "storageRead",
  "storageWrite",
  "storageClear",
  "sessionRead",
  "sessionWrite",
  "sessionClear",
];

export const TILE_FAMILY_ORDER: TileFamily[] = [
  "layout",
  "text",
  "input",
  "collection",
  "overlay",
  "media",
  "status",
];

export function analyzeRuntimeUsage(
  app: AppDef,
  reducers: ReducerDef[],
  effects: EffectDef[],
  env: TypeEnv,
  usedTiles: Set<string>,
  includeTests: boolean,
  hasTests: boolean,
): RuntimeUsage {
  const emits = new Set<string>();
  for (const r of reducers) for (const e of collectEmits(r.do)) emits.add(e);
  for (const e of app.init) if (e.kind === "Call") emits.add(e.callee);

  const families = TILE_FAMILY_ORDER.filter(
    (f) => !isPerTileFamily(f) && [...usedTiles].some((t) => TILE_FAMILY[t] === f),
  );
  const tiles = [...usedTiles].filter((t) => isPerTileFamily(TILE_FAMILY[t])).sort();
  const router =
    app.caps.some((c) => c.startsWith("nav.")) ||
    emits.has("navigate") ||
    emits.has("navigate-replace") ||
    emits.has("navigate-back") ||
    emits.has("scroll-to") ||
    usedTiles.has("link") ||
    usedTiles.has("route-outlet") ||
    app.routes.some((r) => r.tile.startsWith(">>") || (r.path !== "/" && r.path !== "/404"));
  const handlers = new Set(effects.map((e) => storageHandlerOf(e, env)));
  const storage = STORAGE_HANDLER_ORDER.filter((h) => handlers.has(h));
  const indexed: IndexedHandler[] = [];
  if (effects.some((e) => e.cap === "indexed.read")) indexed.push("indexedRead");
  if (effects.some((e) => e.cap === "indexed.write")) indexed.push("indexedWrite");
  if (effects.some((e) => e.cap === "indexed.delete")) indexed.push("indexedDelete");
  const http = effects.some((e) => e.cap.startsWith("http."));
  const toast = app.caps.includes("notification.show") || emits.has("toast");
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
    ...(storage.length > 0 || indexed.length > 0 || http ? [EFFECT_HANDLERS_SHARED] : []),
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
