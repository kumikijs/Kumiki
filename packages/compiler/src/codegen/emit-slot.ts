import type { SlotDef } from "../ast.ts";
import { type GenCtx, makeEvalCtx } from "./context.ts";
import { refinementJs, refinementsOf, refinementToJs } from "./emit-type.ts";
import { jsOfExpr } from "./expr.ts";

/** Emit the `_slots = { ... }` object literal body for all slot definitions. */
export function emitSlots(slots: SlotDef[], gen: GenCtx): string[] {
  const lines: string[] = [];
  lines.push("const _slots = {");
  for (const s of slots) {
    const refine = refinementJs(s.type, gen);
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
    if (first) {
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
    if (parts.length > 1) {
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
  return lines;
}
