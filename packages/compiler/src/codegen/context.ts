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
