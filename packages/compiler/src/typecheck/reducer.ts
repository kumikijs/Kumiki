import { unaliasType } from "../assignable.ts";
import type { Expr, Lvalue, ReducerDef, Statement, TypeExpr } from "../ast.ts";
import { BUILTIN_EFFECTS } from "../capabilities.ts";
import { RESERVED_BIND_NAMES } from "../reserved-binds.ts";
import { UI_EVENT_TILE_KINDS } from "../ui-lifts.ts";
import { checkAgainst, checkEmitTarget, lvalueType, unwrappedType } from "./against.ts";
import { bindLocal, type Ctx, innerScope, type KumikiError, type SymbolTable } from "./context.ts";
import { effectPayloadType } from "./effect.ts";
import { checkCondition, checkExpr, checkIterationTarget, elementTypeOf } from "./expr.ts";
import { inferType, prim, typeName } from "./infer.ts";
import { classifyMember, receiverName, undefMemberError } from "./members.ts";
import { checkPatternAgainstType, checkPatternBindsAreDistinct } from "./patterns.ts";
import { bindsRoute, collectTileBuiltinKinds, collectTileDeclaredIds } from "./tile-collect.ts";

export function checkReducer(r: ReducerDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = {
    kind: "reducer",
    localBinds: new Set(),
    localTypes: new Map(),
    capsAvailable: new Set(sym.app?.caps ?? []),
    routeBind: bindsRoute(r, sym) ? "bound" : "unbound",
  };
  if (r.on.kind === "EffectEvent") {
    const boundAt = new Map<string, number>();
    const trigger = r.on;
    trigger.binds.forEach((b, i) => {
      if (b.name === "_") return;
      if (RESERVED_BIND_NAMES.has(b.name)) {
        errors.push({
          code: "E0121",
          kind: "reserved-bind-name",
          message:
            `"${b.name}" is a positional binding the compiler declares in every reducer ` +
            `body, so an effect-event bind cannot also take the name — the two declarations ` +
            `collide and the module does not load. Rename the bind`,
          pos: b.pos,
        });
      } else {
        const first = boundAt.get(b.name);
        if (first === undefined) boundAt.set(b.name, i + 1);
        else
          errors.push({
            code: "E0123",
            kind: "duplicate-effect-bind",
            message:
              `"${b.name}" is bound twice in this trigger: it names $${first} and then ` +
              `$${i + 1}, so the two binds are peers — nothing nests them, the second does ` +
              `not shadow the first, and $${first} has no name left to read it by. Rename ` +
              `one, or write "_" for a positional the reducer does not read`,
            pos: b.pos,
          });
      }
      const type =
        i === 0 && !RESERVED_BIND_NAMES.has(b.name)
          ? effectPayloadType(trigger.effect, trigger.outcome, sym)
          : null;
      bindLocal(ctx, b.name, type);
    });
    if (!sym.effects.has(r.on.effect) && !BUILTIN_EFFECTS.has(r.on.effect)) {
      errors.push({
        code: "E0104",
        kind: "undef-effect",
        message: `Reference to undefined effect "${r.on.effect}"`,
        pos: r.on.effectPos,
      });
    }
  }
  const lifecycleTile = r.on.kind === "LifecycleEvent" ? r.on.tileTarget : undefined;
  if (lifecycleTile && !sym.tiles.has(lifecycleTile.name)) {
    errors.push({
      code: "E0211",
      kind: "undef-tile-in-selector",
      message: `Reducer "${r.name}" subscribes to ${lifecycleTile.event}(${lifecycleTile.name}) but tile "${lifecycleTile.name}" is not declared`,
      pos: lifecycleTile.pos,
    });
  }
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_" && !sym.tiles.has(r.on.selector.tile)) {
    errors.push({
      code: "E0211",
      kind: "undef-tile-in-selector",
      message: `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}) but tile "${r.on.selector.tile}" is not declared`,
      pos: r.on.pos,
    });
  }
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_" && r.on.selector.id !== undefined) {
    const def = sym.tiles.get(r.on.selector.tile);
    if (def !== undefined) {
      const decl = collectTileDeclaredIds(def);
      if (decl.known && decl.ids.size > 0 && !decl.ids.has(r.on.selector.id)) {
        const actual = [...decl.ids].map((v) => `"${v}"`).join(" | ");
        errors.push({
          code: "E0212",
          kind: "selector-id-mismatch",
          message:
            `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}#${r.on.selector.id}) ` +
            `but tile "${r.on.selector.tile}" is declared with id ${actual} — this selector can never match`,
          pos: r.on.pos,
        });
      }
    }
  }
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_") {
    const allowed = UI_EVENT_TILE_KINDS[r.on.ev];
    if (allowed != null) {
      const descendants = collectTileBuiltinKinds(r.on.selector.tile, sym);
      const hasMatch = [...descendants].some((k) => allowed.has(k));
      if (descendants.size > 0 && !hasMatch) {
        errors.push({
          code: "W0212",
          kind: "ui-event-tile-mismatch",
          severity: "warning",
          message:
            `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}) ` +
            `but tile "${r.on.selector.tile}" has no descendant that fires "${r.on.ev}" ` +
            `(DOM-allowed: ${[...allowed].join(", ")}; observed in body: ${[...descendants].sort().join(", ")}). ` +
            `The handler is silently dropped.`,
          pos: r.on.pos,
        });
      }
    }
  }
  ctx.localBinds.add("$el");
  ctx.localBinds.add("$event");

  const writtenRoots = new Set<string>();
  for (const stmt of r.do) checkStmt(stmt, sym, errors, ctx, writtenRoots);
}

function checkStmt(
  s: Statement,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  writtenRoots: Set<string>,
): void {
  if (s.kind === "ForStmt") {
    checkIterationTarget(s.iter, sym, errors, ctx);
    const inner = innerScope(ctx);
    bindLocal(inner, s.bind, elementTypeOf(s.iter, sym, ctx));
    const bodyWrites = new Set<string>(writtenRoots);
    for (const st of s.body) checkStmt(st, sym, errors, inner, bodyWrites);
    for (const r of bodyWrites) writtenRoots.add(r);
    return;
  }
  if (s.kind === "IfStmt") {
    checkExpr(s.cond, sym, errors, ctx);
    checkCondition(s.cond, inferType(s.cond, sym, ctx), sym, errors, '"if"');
    const thenWrites = new Set<string>(writtenRoots);
    const thenScope = innerScope(ctx);
    for (const st of s.consequent) checkStmt(st, sym, errors, thenScope, thenWrites);
    const elseWrites = new Set<string>(writtenRoots);
    const elseScope = innerScope(ctx);
    for (const st of s.alternate) checkStmt(st, sym, errors, elseScope, elseWrites);
    for (const r of thenWrites) writtenRoots.add(r);
    for (const r of elseWrites) writtenRoots.add(r);
    return;
  }
  if (s.kind === "MatchStmt") {
    checkExpr(s.scrutinee, sym, errors, ctx);
    const scrutType = inferType(s.scrutinee, sym, ctx);
    // Arms are mutually exclusive — each starts fresh from the parent set.
    const armSets: Set<string>[] = [];
    for (const arm of s.arms) {
      const inner = innerScope(ctx);
      checkPatternBindsAreDistinct(arm.pattern, errors);
      checkPatternAgainstType(arm.pattern, scrutType, sym, errors, inner);
      const armWrites = new Set<string>(writtenRoots);
      for (const st of arm.body) checkStmt(st, sym, errors, inner, armWrites);
      armSets.push(armWrites);
    }
    for (const set of armSets) for (const r of set) writtenRoots.add(r);
    return;
  }
  if (s.kind === "NoopStmt") return;
  if (s.kind === "LetStmt") {
    checkExpr(s.rhs, sym, errors, ctx);
    bindLocal(ctx, s.name, inferType(s.rhs, sym, ctx));
    return;
  }
  if (s.kind === "Emit") {
    checkEmitTarget(s.effect, s.args, sym, errors, ctx, s.pos);
    const confirmArg = s.effect === "confirm" && s.args.length === 1 ? s.args[0] : undefined;
    if (confirmArg && confirmArg.kind === "RecordLit") {
      for (const f of confirmArg.fields) {
        if ((f.name === "onYes" || f.name === "onNo") && f.value.kind === "Ref") {
          if (!sym.reducers.has(f.value.name)) {
            errors.push({
              code: "E0103",
              kind: "undef-ref",
              message: `confirm "${f.name}" refers to undefined reducer "${f.value.name}"`,
              pos: f.value.pos,
            });
          }
          continue;
        }
        checkExpr(f.value, sym, errors, ctx);
      }
      return;
    }
    for (const a of s.args) checkExpr(a, sym, errors, ctx);
    return;
  }
  if (s.kind === "StopTimer") {
    if (!sym.timerNames.has(s.name)) {
      errors.push({
        code: "E0106",
        kind: "undef-timer",
        message: `stop-timer refers to undefined timer name "${s.name}"`,
        pos: s.pos,
      });
    }
    return;
  }
  if (s.kind === "PanicStmt") {
    checkExpr(s.message, sym, errors, ctx);
    checkAgainst(s.message, prim("Text", s.pos), sym, errors, ctx);
    return;
  }
  const root = lvalueRoot(s.lvalue);
  if (!sym.slots.has(root)) {
    errors.push({
      code: "E0103",
      kind: "undef-slot",
      message: `Assignment to undefined slot "${root}"`,
      pos: s.pos,
    });
  }
  const shape = lvalueShape(s.lvalue);
  if (writtenRoots.has(shape)) {
    errors.push({
      code: "E0601",
      kind: "duplicate-write",
      message: `Slot path "${shape}" is written more than once in this reducer`,
      pos: s.pos,
    });
  }
  writtenRoots.add(shape);
  checkLvalue(s.lvalue, sym, errors, ctx);
  checkExpr(s.rhs, sym, errors, ctx);
  checkAgainst(s.rhs, lvalueType(s.lvalue, sym), sym, errors, ctx);
}

function lvalueShape(lv: Lvalue): string {
  if (lv.kind === "LSlot") return lv.name;
  const parts: string[] = [];
  let cur: Lvalue = lv;
  while (cur.kind !== "LSlot") {
    if (cur.kind === "LField") parts.unshift(`.${cur.field}`);
    else parts.unshift("[]");
    cur = cur.base;
  }
  return cur.name + parts.join("");
}

function lvalueRoot(lv: Lvalue): string {
  while (lv.kind !== "LSlot") {
    lv = lv.base;
  }
  return lv.name;
}

function checkLvalue(lv: Lvalue, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (lv.kind === "LSlot") return;
  if (lv.kind === "LIndex") {
    checkExpr(lv.index, sym, errors, ctx);
    checkIndexLvalue(lv, sym, errors, ctx);
  } else {
    const raw = lvalueType(lv.base, sym);
    const base = unaliasType(raw, sym);
    if (base) {
      lv.accessKind = "shortcut";
      checkMemberLvalue(lv, raw, base, sym, errors);
    }
  }
  checkLvalue(lv.base, sym, errors, ctx);
}

function checkIndexLvalue(
  lv: Lvalue & { kind: "LIndex" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const base = unaliasType(lvalueType(lv.base, sym), sym);
  checkListIndex(base, lv.index, sym, errors, ctx);
  if (base?.kind !== "TypeApp" || base.name !== "Set") return;
  errors.push({
    code: "E0602",
    kind: "unassignable-member",
    message: `Cannot assign through an index into "${typeName(base, sym)}": a Set has members, not places — use .add / .remove / .toggle`,
    pos: lv.pos,
  });
}

export function checkListIndex(
  base: TypeExpr | null,
  index: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (base?.kind !== "TypeApp" || base.name !== "List") return;
  checkAgainst(index, prim("Int", index.pos), sym, errors, ctx);
}

function checkMemberLvalue(
  lv: Lvalue & { kind: "LField" },
  raw: TypeExpr | null,
  base: TypeExpr,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  switch (classifyMember(raw, lv.field, sym)) {
    case "field":
      lv.accessKind = "field";
      return;

    case "member":
      if (lv.field === "get" && unwrappedType(base) !== null) return;
      errors.push({
        code: "E0602",
        kind: "unassignable-member",
        message: `Cannot assign through ".${lv.field}": it is a member of "${receiverName(raw, base, sym)}", not a field`,
        pos: lv.pos,
      });
      return;

    case "unknown":
      errors.push(undefMemberError(raw, base, lv.field, lv.pos, sym));
      return;

    case "undecidable":
      // A receiver we do not fully understand. Silent, exactly as on the read
      // side: a false error on a dynamic receiver is worse than the silence.
      return;
  }
}
