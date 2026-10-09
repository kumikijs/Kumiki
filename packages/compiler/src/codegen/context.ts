import type { EffectDef, FnDef, ReducerDef, SlotDef, TileDef, TypeDef } from "../ast.ts";
import { isPerTileFamily, TILE_FAMILY, type TileFamily } from "../builtins.ts";
import type { ParseReading } from "../parse-reading.ts";
import type { NestedRefinements } from "./nested-refinements.ts";

export type GenCtx = {
  slots: SlotDef[];
  fns: FnDef[];
  tiles: TileDef[];
  reducers: ReducerDef[];
  effects: EffectDef[];
  types: Map<string, TypeDef>;
  /** Built-in tile kinds the generated code emits (filled during generation, #71). */
  usedTiles: Set<string>;
  usedIcons: Set<string>;
  refinements: NestedRefinements;
  usedReaders: Set<ParseReading>;
  expectedTree?: boolean;
};

export type BindScope = Map<string, string>;

export type EvalCtx = {
  gen: GenCtx;
  localBinds: BindScope;
  /** When set, Ref(slot) reads from `_next` first, falling back to `_live`. */
  reducerScope?: boolean;
};

export function makeEvalCtx(
  gen: GenCtx,
  locals: Iterable<string> | BindScope,
  reducerScope = false,
): EvalCtx {
  const localBinds: BindScope =
    locals instanceof Map ? new Map(locals) : new Map([...locals].map((n) => [n, jsBinding(n)]));
  return { gen, localBinds, reducerScope };
}

export function childCtx(ctx: EvalCtx): EvalCtx {
  return makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
}

/** A copy of `ctx` with `name` declared in it — see {@link declareBind}. */
export function addBind(ctx: EvalCtx, name: string): EvalCtx {
  const out = childCtx(ctx);
  declareBind(out, name);
  return out;
}

export function declareBind(ctx: EvalCtx, name: string): string {
  const js = freshBinding(ctx.localBinds, name);
  ctx.localBinds.set(name, js);
  return js;
}

/** The identifier a read of an in-scope `name` resolves to. */
export function bindRef(ctx: EvalCtx, name: string): string {
  return ctx.localBinds.get(name) ?? jsBinding(name);
}

function freshBinding(scope: BindScope, name: string): string {
  const base = jsBinding(name);
  if (!scope.has(name)) return base;
  const taken = new Set(scope.values());
  for (let n = 1; ; n++) {
    const candidate = `${base}$${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function mapSpecialChars(name: string): string {
  return name.replace(/^\$/, "_d_").replace(/-/g, "_").replace(/\./g, "_");
}

export function jsProperty(name: string): string {
  return mapSpecialChars(name);
}

export function fieldKey(name: string): string {
  return JSON.stringify(name);
}

export function tileFamilyVar(f: TileFamily): string {
  return `${f}Tiles`;
}

export function tilePatcherFamilyVar(f: TileFamily): string {
  return `${f}Patchers`;
}

export function tileVar(kind: string): string {
  return `${camelKind(kind)}Tile`;
}

/** The patcher companion to {@link tileVar}. */
export function tilePatcherVar(kind: string): string {
  return `${camelKind(kind)}Patcher`;
}

function camelKind(kind: string): string {
  return kind.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

export const EMITTED_MODULE_BINDINGS: readonly string[] = [
  "App",
  "createApp",
  "mountCore",
  "routing",
  "httpFetch",
  "installToast",
  "installConfirm",
  "storageRead",
  "storageWrite",
  "storageClear",
  "sessionRead",
  "sessionWrite",
  "sessionClear",
  "indexedRead",
  "indexedWrite",
  "indexedDelete",
  ...new Set(
    Object.values(TILE_FAMILY).flatMap((f) => [tileFamilyVar(f), tilePatcherFamilyVar(f)]),
  ),
  ...Object.keys(TILE_FAMILY)
    .filter((k) => isPerTileFamily(TILE_FAMILY[k]))
    .flatMap((k) => [tileVar(k), tilePatcherVar(k)]),
];

const JS_RESERVED_WORDS: readonly string[] = [
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
];

const JS_GLOBALS: readonly string[] = [
  "AbortController",
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "Infinity",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "RangeError",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "TypeError",
  "URL",
  "WeakMap",
  "WeakSet",
  "clearInterval",
  "clearTimeout",
  "console",
  "document",
  "fetch",
  "globalThis",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "queueMicrotask",
  "setInterval",
  "setTimeout",
  "structuredClone",
  "undefined",
  "window",
];

/** Every name a user binding must not become. */
const JS_UNSAFE_BINDINGS: ReadonlySet<string> = new Set([
  ...JS_RESERVED_WORDS,
  ...JS_GLOBALS,
  ...EMITTED_MODULE_BINDINGS,
]);

export const HANDLER_MEMO_PREAMBLE = [
  "const _handlerCache = new Map();",
  "function _h(...names) {",
  '  const key = names.join("|");',
  "  let fn = _handlerCache.get(key);",
  "  if (fn === undefined) {",
  "    fn = (el) => { for (const n of names) App._dispatch(n, el); };",
  "    _handlerCache.set(key, fn);",
  "  }",
  "  return fn;",
  "}",
].join("\n");

/** A reference to the memoised handler for `names`, as emitted in tile props. */
export function handlerRef(names: readonly string[]): string {
  return `_h(${names.map((n) => JSON.stringify(n)).join(", ")})`;
}

export function jsBinding(name: string): string {
  // The `$…` namespace is the compiler's own and already lands in `_d_…`.
  if (name.startsWith("$")) return mapSpecialChars(name);
  const mapped = name.replace(/_/g, "_$").replace(/[-.]/g, "_");
  return JS_UNSAFE_BINDINGS.has(mapped) ? `${mapped}$` : mapped;
}

export type EnclosingTiles = readonly string[];
