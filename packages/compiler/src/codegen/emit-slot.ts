import type { SlotDef, TypeExpr } from "../ast.ts";
import { carriesNestedRefinement } from "../refinement-positions.ts";
import { type GenCtx, makeEvalCtx } from "./context.ts";
import { refinementJs, refinementsOf, refinementToJs } from "./emit-type.ts";
import { jsOfExpr } from "./expr.ts";
import { nestedRefinements } from "./nested-refinements.ts";

/**
 * How a write to a slot of type `t` is checked: by a walk of the value, when
 * a predicate is written anywhere inside the type (language.md §1.3.3); by the
 * predicates on the type's own chain; or not at all. The one classification
 * both the slot table and the reducer's write wrapper read, so a slot cannot be
 * gated by one and waved through by the other. Pure — it reads the program's
 * types and builds nothing — so the reducer can ask it per write.
 */
export function slotGate(t: TypeExpr, gen: GenCtx): "walk" | "chain" | "none" {
  if (carriesNestedRefinement(t, gen)) return "walk";
  return refinementJs(t, gen) !== undefined ? "chain" : "none";
}

/** Emit the `_slots = { ... }` object literal body for all slot definitions. */
export function emitSlots(slots: SlotDef[], gen: GenCtx): string[] {
  const lines: string[] = [];
  const nested = nestedRefinements(gen);
  lines.push("const _slots = {");
  for (const s of slots) {
    // A predicate written inside the type — a record field, a union payload, a
    // container element — is a check on the value as much as one on the type
    // itself (language.md §1.3.3), and only a walk of the value can say where
    // it failed. Such a slot's gate is that walk, alone: the runtime reads it
    // through `slotAccepts`, so it carries no `refine` or `refineAll` to
    // disagree with it. One whose predicates all sit on its own chain keeps the
    // conjunction below, byte for byte.
    const gate = slotGate(s.type, gen);
    const deep = gate === "walk" ? nested.explainerOf(s.type) : undefined;
    if (gate === "walk" && deep === undefined) {
      throw new Error(`slot "${s.name}": a type carrying a nested refinement lowered to no walk`);
    }
    const refine = gate === "chain" ? refinementJs(s.type, gen) : undefined;
    const rs = refinementsOf(s.type, gen);
    const first = rs[0];
    const init = jsOfExpr(s.init, makeEvalCtx(gen, new Set()));
    // `refineKind`/`refineArgs` name one predicate — the first of the chain,
    // read from the base outward. They are what a reader falls back to when the
    // slot carries no `refineAll` (a single-predicate type, or a hand-written
    // `AppShape`); `failedRefinement` in the runtime is what actually resolves
    // the failed predicate's message (default text + `theme.errors` override).
    const meta = [`value: ${init}`];
    if (refine) meta.push(`refine: ${refine}`);
    if (deep) meta.push(`refineFailure: ${deep}`);
    if (first && gate === "chain") {
      meta.push(`refineKind: ${JSON.stringify(first.pred)}`);
      meta.push(`refineArgs: ${JSON.stringify(first.args)}`);
    }
    // A type may carry several predicates (language.md §1.3.1), and `refine`
    // above is their conjunction — which cannot say *which* one refused a
    // value. `refineAll` keeps them separate so the rejection report and the
    // `error` tile name the first one the value fails, in the order
    // `refinementsOf` collects them. Emitted only when there is more than one:
    // a single predicate is already named by the two fields above, every reader
    // falls back to them, and a one-predicate slot's descriptor then stays
    // byte-identical to what it was before #353.
    //
    // A predicate with no lowering contributes no entry, for the same reason it
    // contributes no conjunct to `refine` above: it is E0803 at build time, and
    // an entry whose `refine` answered `true` to everything would name it as
    // the predicate a value failed to fail (#352).
    const parts = rs.flatMap((r) => {
      const js = refinementToJs(r);
      return js === undefined
        ? []
        : [
            `{ kind: ${JSON.stringify(r.pred)}, args: ${JSON.stringify(r.args)}, ` +
              `refine: ${js} }`,
          ];
    });
    if (gate === "chain" && parts.length > 1) {
      meta.push(`refineAll: [${parts.join(", ")}]`);
    }
    // `volatile` (language.md §1.4.1): excludes the slot from SlotDiff records
    // and from SSR snapshots (runtime.md §10.6.1). The runtime reads this off
    // SlotMeta.volatile — emit it so the live mount and `renderToString`
    // agree on the exact set of persisted slots.
    if (s.modifier === "volatile") meta.push("volatile: true");
    lines.push(`  ${JSON.stringify(s.name)}: { ${meta.join(", ")} },`);
  }
  lines.push("};");
  return [...nested.decls, ...lines];
}
