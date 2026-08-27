// Narrowing an AST node to the shape a test is about.
//
// `expect(node.kind).toBe("UiEvent")` states the shape without telling the
// typechecker, so the reads that follow it stay unchecked — and a `?.` chain
// on top of that turns a wrong shape into a silently skipped assertion. These
// assert and narrow in one step.

import type { EventPattern, TileExpr } from "@kumikijs/compiler";

export type UiEvent = Extract<EventPattern, { kind: "UiEvent" }>;
export type TileCall = Extract<TileExpr, { kind: "TileCall" }>;

export function uiEvent(pattern: EventPattern): UiEvent {
  if (pattern.kind !== "UiEvent") throw new Error(`expected a UiEvent, found ${pattern.kind}`);
  return pattern;
}

export function tileCall(expr: TileExpr): TileCall {
  if (expr.kind !== "TileCall") throw new Error(`expected a TileCall, found ${expr.kind}`);
  return expr;
}
