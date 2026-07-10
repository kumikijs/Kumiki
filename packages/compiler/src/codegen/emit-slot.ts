import type { SlotDef } from "../ast.ts";
import { type GenCtx, makeEvalCtx } from "./context.ts";
import { refinementJs, slotRefinement } from "./emit-type.ts";
import { jsOfExpr } from "./expr.ts";

/** Emit the `_slots = { ... }` object literal body for all slot definitions. */
export function emitSlots(slots: SlotDef[], gen: GenCtx): string[] {
  const lines: string[] = [];
  lines.push("const _slots = {");
  for (const s of slots) {
    const refine = refinementJs(s.type, gen);
    const r = slotRefinement(s.type, gen);
    const init = jsOfExpr(s.init, makeEvalCtx(gen, new Set()));
    // `refineKind`/`refineArgs` let the `error` tile resolve the failed
    // predicate's message at runtime (default text + `theme.errors` override).
    const meta = [`value: ${init}`];
    if (refine) meta.push(`refine: ${refine}`);
    if (r) {
      meta.push(`refineKind: ${JSON.stringify(r.pred)}`);
      meta.push(`refineArgs: ${JSON.stringify(r.args)}`);
    }
    // `volatile` (language.md §175): excludes the slot from SlotDiff records
    // and from SSR snapshots (runtime.md §10.6.1). The runtime reads this off
    // SlotMeta.volatile — emit it so the live mount and `renderToString`
    // agree on the exact set of persisted slots.
    if (s.modifier === "volatile") meta.push("volatile: true");
    lines.push(`  ${JSON.stringify(s.name)}: { ${meta.join(", ")} },`);
  }
  lines.push("};");
  return lines;
}
