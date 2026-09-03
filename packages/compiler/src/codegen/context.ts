import type { EffectDef, FnDef, ReducerDef, SlotDef, TileDef, TypeDef } from "../ast.ts";
import { TILE_FAMILY, type TileFamily } from "../builtins.ts";

export type GenCtx = {
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

/**
 * The names in scope at one point in the emitted code, each mapped to the JS
 * identifier a read of it resolves to. A `Set` was enough while one Kumiki name
 * meant one JS name; it stopped being enough once a name could be declared
 * twice — see {@link declareBind}.
 */
export type BindScope = Map<string, string>;

export type EvalCtx = {
  gen: GenCtx;
  localBinds: BindScope;
  /** When set, Ref(slot) reads from `_next` first, falling back to `_live`. */
  reducerScope?: boolean;
};

/**
 * A scope holding `locals`. Pass a {@link BindScope} to continue an enclosing
 * scope — the identifiers its shadowed names resolve to come along, which is
 * what keeps a read inside a nested form pointing at the binding that is
 * actually in scope there. Pass names to open a fresh one, where each is its
 * own `jsBinding`.
 */
export function makeEvalCtx(
  gen: GenCtx,
  locals: Iterable<string> | BindScope,
  reducerScope = false,
): EvalCtx {
  const localBinds: BindScope =
    locals instanceof Map ? new Map(locals) : new Map([...locals].map((n) => [n, jsBinding(n)]));
  return { gen, localBinds, reducerScope };
}

/** A copy of `ctx` with `name` declared in it — see {@link declareBind}. */
export function addBind(ctx: EvalCtx, name: string): EvalCtx {
  const out = makeEvalCtx(ctx.gen, ctx.localBinds);
  declareBind(out, name);
  return out;
}

/**
 * Bring `name` into `ctx` and return the identifier to declare it under.
 *
 * A name declared over one already in scope shadows it (language.md §1.6.7),
 * and a Kumiki scope is not always a JS one: a reducer's top-level `let` lands
 * in the same JS block as the trigger's binds and the positional-binding
 * declarations, so `let $route = …` there used to emit a second `const
 * _d_route` and the module threw `SyntaxError` at load. The shadow takes an
 * identifier of its own instead, which is what makes the rule hold in the one
 * place the language's nesting does not reach.
 *
 * The declaration is what changes name; every read goes through
 * {@link bindRef}, so the two sides cannot drift apart.
 */
export function declareBind(ctx: EvalCtx, name: string): string {
  const js = freshBinding(ctx.localBinds, name);
  ctx.localBinds.set(name, js);
  return js;
}

/** The identifier a read of an in-scope `name` resolves to. */
export function bindRef(ctx: EvalCtx, name: string): string {
  return ctx.localBinds.get(name) ?? jsBinding(name);
}

/**
 * An identifier for a declaration of `name` in `scope` that no live binding is
 * already using.
 *
 * The `$<n>` suffix cannot be produced by {@link jsBinding} from any other
 * Kumiki name, which is what keeps two distinct names from converging on one
 * identifier. A `$` that `jsBinding` emits is either the second character of
 * the `_$` escape for a user `_` or the marker on an unsafe name; the one here
 * is followed by a digit, so it is not the marker, so it would have to be the
 * escape — which needs a `_` before it, i.e. a `jsBinding` output ending in
 * one. No output ends in `_`: a user `_` becomes `_$`, and the only other
 * source of one is `-` / `.`, neither of which can end an identifier the lexer
 * produces (`readIdentBody` continues a `-` only when an identifier character
 * follows it). `packages/compiler/test/js-identifier-safety.test.ts` brute-forces
 * the property over the identifiers the lexer accepts, because the argument
 * rests on that rule and on `jsBinding`'s mapping rather than on anything local.
 */
function freshBinding(scope: BindScope, name: string): string {
  const base = jsBinding(name);
  if (!scope.has(name)) return base;
  const taken = new Set(scope.values());
  for (let n = 1; ; n++) {
    const candidate = `${base}$${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The raw character mapping. `$…` is the compiler's own bind namespace ($1,
 * $event, effect binds) and lands in `_d_…`; `-` and `.` are legal in Kumiki
 * names but not in JS ones.
 */
function mapSpecialChars(name: string): string {
  return name.replace(/^\$/, "_d_").replace(/-/g, "_").replace(/\./g, "_");
}

/**
 * Map a Kumiki name for a *property* position — `recv.method()`, an object
 * literal key. Reserved words are legal there, and the emitted name has to be
 * exactly what the runtime defines, so nothing is escaped.
 *
 * For anything that becomes a JS binding, use {@link jsBinding} instead. The
 * two are deliberately named so the wrong one reads as wrong at the call site.
 */
export function jsProperty(name: string): string {
  return mapSpecialChars(name);
}

/**
 * The generated identifier holding one tile family's renderer map. It lives
 * here rather than next to the import header because the reserved-name list
 * below has to enumerate it, and `imports.ts` is downstream of this module.
 */
export function tileFamilyVar(f: TileFamily): string {
  return `${f}Tiles`;
}

/**
 * The generated identifier holding one tile family's patcher map — the
 * companion to `tileFamilyVar`. The reconcile mutates a mounted element in
 * place only when it finds a patcher for the tile's kind; a mount without them
 * falls back to rebuilding every changed subtree, discarding focus, caret,
 * `<select>` open state and `<video>` playback on every data-prop change.
 */
export function tilePatcherFamilyVar(f: TileFamily): string {
  return `${f}Patchers`;
}

/**
 * Identifiers the emitted module binds at its own top level: the two it
 * declares, plus every name `emitImportHeader` can import. Names starting with
 * `_` are omitted — {@link jsBinding} already keeps user names out of that
 * namespace. `packages/compiler/test/js-identifier-safety.test.ts` asserts this
 * list still covers what codegen actually emits.
 */
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
  "sessionRead",
  "sessionWrite",
  "indexedRead",
  "indexedWrite",
  "indexedDelete",
  ...new Set(
    Object.values(TILE_FAMILY).flatMap((f) => [tileFamilyVar(f), tilePatcherFamilyVar(f)]),
  ),
];

/**
 * Reserved words proper, plus the strict-mode reserved set and
 * `arguments` / `eval`, which are illegal as binding names under the
 * `"use strict"` semantics of an ES module.
 */
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

/**
 * Globals the emitted code and the runtime it calls into rely on. Binding one
 * of these does not throw at load time — it shadows the global, so the failure
 * surfaces later as `String is not a function` inside an unrelated stdlib call.
 * The list is deliberately wider than what codegen emits today: the cost of an
 * extra entry is one `$` in a name nobody writes, and the cost of a missing one
 * is a silent miscompile.
 */
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

/**
 * The emitted preamble backing {@link handlerRef}: one memoised closure per
 * reducer list, per app instance.
 *
 * Handlers used to be minted fresh on every render, which made them impossible
 * to compare — the reconciler's field comparison had to treat any two
 * functions as equal, so a conditional swapping two inline tiles that differ
 * only in their handler reused the element untouched and kept dispatching to
 * the reducer it was created with. Memoising by reducer list restores the
 * property the comparison needs: same handler ⇒ same reference.
 *
 * `App` is the enclosing `createApp()` scope's own instance, resolved at click
 * time, so several compiled apps on one page never cross-wire. Emitting this at
 * module scope instead would bind every instance's handlers to the first one.
 *
 * The cache key is the reducer list joined on `|`. That is injective because
 * the lexer restricts identifiers to `[A-Za-z_][A-Za-z0-9_-]*`, so no reducer
 * name can contain the separator — load-bearing, since two distinct handler
 * chains collapsing onto one entry is the same class of bug the memo exists to
 * fix.
 */
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

/**
 * Map a Kumiki identifier to a JS identifier for a *binding* position — a
 * declaration (`const x`, a parameter, a `for … of` head) or a reference to
 * one. The result is guaranteed to be
 *
 *  - a legal binding name that shadows nothing the emitted module depends on,
 *    so a slot or `let` called `new`, `String` or `httpFetch` still works;
 *  - outside the `_`-prefixed namespace that codegen and the runtime use for
 *    their own symbols (`_live`, `_s`, `_next`, …), so an author-chosen name
 *    can never shadow one and silently compute against the wrong value;
 *  - injective over the identifiers the lexer can produce
 *    (`[A-Za-z_][A-Za-z0-9_-]*`), so two distinct Kumiki names never converge
 *    on one JS name — `a-b` and `a_b` used to. Qualified builtin references
 *    such as `Decoder.Json` also reach this function as a callee; `.` and `-`
 *    share a mapping, which is unambiguous only because the lexer cannot put a
 *    `.` inside an identifier.
 */
export function jsBinding(name: string): string {
  // The `$…` namespace is the compiler's own and already lands in `_d_…`.
  if (name.startsWith("$")) return mapSpecialChars(name);
  // Escape `_` first so the following `-` → `_` cannot collide with it. Every
  // user `_` therefore becomes `_$`, which is also what keeps names that start
  // with `_` clear of the runtime's symbols.
  const mapped = name.replace(/_/g, "_$").replace(/[-.]/g, "_");
  // No unsafe name contains `_`, so `mapped === name` here and the `$` suffix
  // cannot be produced by any other input.
  return JS_UNSAFE_BINDINGS.has(mapped) ? `${mapped}$` : mapped;
}
