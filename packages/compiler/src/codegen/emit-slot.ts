import type { SlotDef, TypeExpr } from "../ast.ts";
import { carriesNestedRefinement } from "../refinement-positions.ts";
import { type GenCtx, makeEvalCtx } from "./context.ts";
import { refinementJs, refinementsOf, refinementToJs } from "./emit-type.ts";
import { jsOfExpr } from "./expr.ts";

export function slotGate(t: TypeExpr, gen: GenCtx): "walk" | "chain" | "none" {
  if (carriesNestedRefinement(t, gen)) return "walk";
  return refinementJs(t, gen) !== undefined ? "chain" : "none";
}

/** Emit the `_slots = { ... }` object literal body for all slot definitions. */
export function emitSlots(slots: SlotDef[], gen: GenCtx): string[] {
  const lines: string[] = [];
  const nested = gen.refinements;
  lines.push("const _slots = {");
  for (const s of slots) {
    const gate = slotGate(s.type, gen);
    const deep = gate === "walk" ? nested.explainerOf(s.type) : undefined;
    if (gate === "walk" && deep === undefined) {
      throw new Error(`slot "${s.name}": a type carrying a nested refinement lowered to no walk`);
    }
    const refine = gate === "chain" ? refinementJs(s.type, gen) : undefined;
    const rs = refinementsOf(s.type, gen);
    const first = rs[0];
    const init = jsOfExpr(s.init, makeEvalCtx(gen, new Set()));
    const meta = [`value: ${init}`];
    if (refine) meta.push(`refine: ${refine}`);
    if (deep) meta.push(`refineFailure: ${deep}`);
    if (first && gate === "chain") {
      meta.push(`refineKind: ${JSON.stringify(first.pred)}`);
      meta.push(`refineArgs: ${JSON.stringify(first.args)}`);
    }
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
    if (s.modifier === "volatile") meta.push("volatile: true");
    lines.push(`  ${JSON.stringify(s.name)}: { ${meta.join(", ")} },`);
  }
  lines.push("};");
  return lines;
}
