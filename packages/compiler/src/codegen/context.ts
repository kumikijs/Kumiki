import type { EffectDef, FnDef, ReducerDef, SlotDef, TileDef, TypeDef } from "../ast.ts";

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

export type EvalCtx = {
  gen: GenCtx;
  localBinds: Set<string>;
  /** When set, Ref(slot) reads from `_next` first, falling back to `_live`. */
  reducerScope?: boolean;
};

export function makeEvalCtx(gen: GenCtx, locals: Set<string>, reducerScope = false): EvalCtx {
  return { gen, localBinds: new Set(locals), reducerScope };
}

export function addBind(ctx: EvalCtx, name: string): EvalCtx {
  const out = makeEvalCtx(ctx.gen, ctx.localBinds);
  out.localBinds.add(name);
  return out;
}

export function jsName(name: string): string {
  // Map kebab-case and Kumiki-special names to safe JS identifiers.
  return name.replace(/^\$/, "_d_").replace(/-/g, "_").replace(/\./g, "_");
}

/**
 * Words that cannot appear as a JS binding name. Reserved words proper, plus
 * the strict-mode reserved set and `arguments` / `eval`, which are illegal as
 * binding names under the `"use strict"` semantics of an ES module.
 */
const JS_RESERVED: ReadonlySet<string> = new Set([
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
]);

/**
 * Map a Kumiki identifier to a JS identifier for a *binding* position — a
 * declaration (`const x`, a parameter, a `for … of` head) or a reference to
 * one. Unlike {@link jsName}, the result is guaranteed to be
 *
 *  - a legal binding name, so a slot or `let` called `new` still emits;
 *  - outside the `_`-prefixed namespace that codegen and the runtime use for
 *    their own symbols (`_live`, `_s`, `_next`, …), so an author-chosen name
 *    can never shadow one and silently compute against the wrong value;
 *  - injective, so two distinct Kumiki names never converge on one JS name
 *    (`a-b` and `a_b` used to).
 *
 * {@link jsName} remains correct for *property* positions (`recv.method()`),
 * where reserved words are legal and the emitted name has to match what the
 * runtime actually defines.
 */
export function jsBinding(name: string): string {
  // `$…` is the compiler's own bind namespace ($1, $event, effect binds); it
  // already maps into `_d_…`, which no user identifier can reach.
  if (name.startsWith("$")) return jsName(name);
  // Escape `_` first so the following `-` → `_` cannot collide with it. Every
  // user `_` therefore becomes `_$`, which is also what keeps names that start
  // with `_` clear of the runtime's symbols.
  const mapped = name.replace(/_/g, "_$").replace(/[-.]/g, "_");
  // A reserved word contains no `_`, so `mapped === name` here and the `$`
  // suffix cannot be produced by any other input.
  return JS_RESERVED.has(mapped) ? `${mapped}$` : mapped;
}
