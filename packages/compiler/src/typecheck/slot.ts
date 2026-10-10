import type { Expr, SlotDef } from "../ast.ts";
import { type DefIndex, referencesIn } from "../references.ts";
import { ROUTE_TYPE } from "../stdlib-types.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { checkExpr } from "./expr.ts";
import {
  type RouteChainResolver,
  routeInSlotInitMessage,
  routeReachedThroughCalls,
  routeReadsIn,
} from "./route-chain.ts";
import { checkNestedLowering, resolveType } from "./types.ts";

export const RESERVED_SLOT_NAMES: ReadonlyMap<string, string> = new Map([
  ["route", "the router-maintained route slot"],
]);

export function isTestSlot(name: string, sym: SymbolTable): boolean {
  return sym.slots.has(name) || RESERVED_SLOT_NAMES.has(name);
}

/** Must equal the keys of the runtime's `emptyRoute()`, or a test's `route` seed is refused or left partly undefined. */
export const ROUTE_SLOT_FIELDS: ReadonlySet<string> = new Set(ROUTE_TYPE.fields.map((f) => f.name));

/** Fields are typed by the runtime's `Route`, not by name: the slot holds the runtime's route whatever a program's own `type Route` says. */
export function checkRouteSeed(
  value: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (value.kind !== "RecordLit") {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message:
        `The "route" slot takes a record of ` +
        `${[...ROUTE_SLOT_FIELDS].map((f) => `"${f}"`).join(" / ")}, ` +
        "naming as many of them as the test needs",
      pos: value.pos,
    });
    return;
  }
  for (const f of value.fields) {
    const field = ROUTE_TYPE.fields.find((d) => d.name === f.name);
    if (field) {
      checkAgainst(f.value, field.type, sym, errors, ctx);
      continue;
    }
    errors.push({
      code: "E0108",
      kind: "undef-member",
      message:
        `The "route" slot has no field "${f.name}" ` +
        `(${[...ROUTE_SLOT_FIELDS].map((x) => `"${x}"`).join(" / ")})`,
      pos: f.pos,
    });
  }
}

export function checkSlot(
  slot: SlotDef,
  sym: SymbolTable,
  errors: KumikiError[],
  index: DefIndex,
  routeChain: RouteChainResolver,
): void {
  const reserved = RESERVED_SLOT_NAMES.get(slot.name);
  if (reserved !== undefined) {
    errors.push({
      code: "E0115",
      kind: "reserved-slot-name",
      message: `Slot "${slot.name}" collides with ${reserved}; reads of it never see this slot`,
      pos: slot.pos,
    });
  }
  resolveType(slot.type, sym, errors);
  checkNestedLowering(slot, sym, errors);
  for (const ref of referencesIn(slot, index)) {
    if (ref.layer !== "slot") continue;
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: `Slot "${slot.name}" reads slot "${ref.name}" in its initial value; derived slots are prohibited — compute it in a fn instead`,
      pos: ref.pos ?? slot.pos,
    });
  }
  for (const read of routeReadsIn(slot.init, sym)) {
    if (read.name !== "route") continue;
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: routeInSlotInitMessage(slot.name, read.name),
      pos: read.pos,
    });
  }
  for (const hop of routeReachedThroughCalls(slot.init, sym, routeChain)) {
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: routeInSlotInitMessage(slot.name, hop.name, hop.chain),
      pos: hop.pos,
    });
  }
  const ctx: Ctx = {
    kind: "slot-init",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  checkExpr(slot.init, sym, errors, ctx);
  checkAgainst(slot.init, slot.type, sym, errors, ctx);
}
