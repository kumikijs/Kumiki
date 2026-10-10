import {
  assignable,
  recordFieldType,
  typeToString,
  unaliasType,
  unknownType,
} from "../assignable.ts";
import type { Expr, Lvalue, Pos, TypeExpr } from "../ast.ts";
import { BUILTIN_EFFECTS, builtinFieldOmittable, REDUCER_REF } from "../capabilities.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { letInScope, type MismatchCode, pushMismatch } from "./expr.ts";
import { inferType, isKnown, isPrimNamed } from "./infer.ts";
import { armScope } from "./patterns.ts";

export function checkAgainst(
  e: Expr,
  declared: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode = "E0201",
  omittable?: Omittable,
): void {
  if (declared === null) return;
  if (declared === REDUCER_REF) {
    checkReducerRef(e, sym, errors, ctx, code);
    return;
  }
  const d = unaliasType(declared, sym);
  if (d === null || d.kind === "TypeRef") return; // opaque: a type parameter, or a name that resolves to nothing

  const mismatch = (at: Expr, actual: TypeExpr): void => {
    pushMismatch(
      errors,
      code,
      `Expected ${typeToString(declared)} but got ${typeToString(actual)}`,
      at.pos,
    );
  };

  if (d.kind === "TypeApp" && (d.name === "List" || d.name === "Set") && e.kind === "ListLit") {
    if (d.name === "Set") e.asSet = true;
    for (const item of e.items) checkAgainst(item, d.args[0] ?? null, sym, errors, ctx, code);
    return;
  }
  if (d.kind === "TypeApp" && d.name === "Tuple" && e.kind === "TupleLit") {
    if (e.items.length !== d.args.length) {
      pushMismatch(
        errors,
        code,
        `Expected ${typeToString(declared)} but got a tuple of ${e.items.length} item(s)`,
        e.pos,
      );
      return;
    }
    for (let i = 0; i < e.items.length; i++) {
      checkAgainst(e.items[i] as Expr, d.args[i] ?? null, sym, errors, ctx, code);
    }
    return;
  }
  if (d.kind === "TypeApp" && e.kind === "MapLit") {
    if (d.name === "Set") return;
    if (d.name === "Map") {
      for (const ent of e.entries) {
        checkAgainst(ent.key, d.args[0] ?? null, sym, errors, ctx, code);
        checkAgainst(ent.value, d.args[1] ?? null, sym, errors, ctx, code);
      }
      return;
    }
  }
  if (d.kind === "TypeRecord" && e.kind === "RecordLit") {
    checkRecordLit(e, d, sym, errors, ctx, code, omittable);
    return;
  }
  if (e.kind === "Variant") {
    checkVariantAgainst(e, d, declared, sym, errors, ctx, code);
    return;
  }
  if (e.kind === "IfExpr") {
    checkAgainst(e.consequent, declared, sym, errors, ctx, code, omittable);
    checkAgainst(e.alternate, declared, sym, errors, ctx, code, omittable);
    return;
  }
  if (e.kind === "LetIn") {
    // The body is the value that lands here, read with the name bound.
    checkAgainst(e.body, declared, sym, errors, letInScope(e, sym, ctx), code, omittable);
    return;
  }
  if (e.kind === "MatchExpr") {
    const scrutType = inferType(e.scrutinee, sym, ctx);
    for (const arm of e.arms) {
      const scope = armScope(arm, scrutType, sym, ctx);
      checkAgainst(arm.body, declared, sym, errors, scope, code, omittable);
    }
    return;
  }
  if (
    e.kind === "Num" &&
    d.kind === "TypePrim" &&
    d.name === "Int" &&
    Number.isInteger(e.value) &&
    !Number.isSafeInteger(e.value)
  ) {
    errors.push({
      code: "E0217",
      kind: "int-literal-precision",
      message: `Int literal ${e.raw ?? e.value} is not exactly representable and was rounded to ${e.value}`,
      pos: e.pos,
    });
    return;
  }

  const actual = inferType(e, sym, ctx);
  if (actual === null || !isKnown(actual, sym)) return;
  const want = omittable ? withoutOmitted(d, actual, sym, omittable) : declared;
  if (!assignable(actual, want ?? declared, sym)) mismatch(e, actual);
}

function withoutOmitted(
  d: TypeExpr,
  actual: TypeExpr,
  sym: SymbolTable,
  omittable: Omittable,
): TypeExpr | null {
  const a = unaliasType(actual, sym);
  if (d.kind !== "TypeRecord" || a?.kind !== "TypeRecord") return null;
  const has = new Set(a.fields.map((f) => f.name));
  return { ...d, fields: d.fields.filter((f) => has.has(f.name) || !omittable(f)) };
}

function checkReducerRef(
  e: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode,
): void {
  if (e.kind === "Ref") return;
  const actual = inferType(e, sym, ctx);
  pushMismatch(
    errors,
    code,
    `Expected ${typeToString(REDUCER_REF)} but got ${actual ? typeToString(actual) : "an expression that is not a reducer name"}`,
    e.pos,
  );
}

export function checkRecordUpdate(
  e: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const patch = e.args[0];
  if (patch?.kind !== "RecordLit") return;
  const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
  if (recv?.kind !== "TypeRecord") return;
  for (const f of patch.fields) {
    const want = recordFieldType(recv, f.name);
    if (want === null) {
      errors.push({
        code: "E0215",
        kind: "unknown-record-field",
        message: `Record type has no field "${f.name}"`,
        pos: f.value.pos,
      });
      continue;
    }
    checkAgainst(f.value, want, sym, errors, ctx);
  }
}

function checkRecordLit(
  e: Expr & { kind: "RecordLit" },
  d: TypeExpr & { kind: "TypeRecord" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode,
  omittable?: Omittable,
): void {
  const given = new Set(e.fields.map((f) => f.name));
  for (const declaredField of d.fields) {
    if (given.has(declaredField.name) || omittable?.(declaredField)) continue;
    errors.push({
      code: "E0214",
      kind: "missing-record-field",
      message: `Record literal is missing field "${declaredField.name}" of type ${typeToString(declaredField.type)}`,
      pos: e.pos,
    });
  }
  for (const f of e.fields) {
    const want = recordFieldType(d, f.name);
    if (want === null) {
      errors.push({
        code: "E0215",
        kind: "unknown-record-field",
        message: `Record type has no field "${f.name}"`,
        pos: f.value.pos,
      });
      continue;
    }
    checkAgainst(f.value, want, sym, errors, ctx, code);
  }
}

function checkVariantAgainst(
  e: Expr & { kind: "Variant" },
  d: TypeExpr,
  declared: TypeExpr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode,
): void {
  const payloadsOf = (): TypeExpr[] | "unknown-tag" | null => {
    if (d.kind === "TypeUnion") {
      const v = d.variants.find((variant) => variant.name === e.name);
      return v ? v.payloads : "unknown-tag";
    }
    if (d.kind === "TypeApp" && d.name === "Option") {
      if (e.name === "None") return [];
      if (e.name === "Some") return [d.args[0] ?? unknownType(e.pos)];
      return "unknown-tag";
    }
    if (d.kind === "TypeApp" && d.name === "Result") {
      if (e.name === "Ok") return [d.args[0] ?? unknownType(e.pos)];
      if (e.name === "Err") return [d.args[1] ?? unknownType(e.pos)];
      return "unknown-tag";
    }
    return null;
  };

  const payloads = payloadsOf();
  if (payloads === null) {
    // The declared type is not a union at all — `slot n : Int = Idle`.
    pushMismatch(
      errors,
      code,
      `Expected ${typeToString(declared)} but got variant "${e.name}"`,
      e.pos,
    );
    return;
  }
  if (payloads === "unknown-tag") {
    errors.push({
      code: "E0216",
      kind: "unknown-variant",
      message: `Variant "${e.name}" is not a member of type "${typeToString(declared)}"`,
      pos: e.pos,
    });
    return;
  }
  if (payloads.length !== e.payload.length) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Variant "${e.name}" carries ${payloads.length} payload(s) but got ${e.payload.length}`,
      pos: e.pos,
    });
    return;
  }
  e.payload.forEach((p, i) => {
    checkAgainst(p, payloads[i] ?? null, sym, errors, ctx, code);
  });
}

export function unwrappedType(t: TypeExpr): TypeExpr | null {
  if (t.kind !== "TypeApp") return null;
  if (t.name !== "Option" && t.name !== "Result") return null;
  return t.args[0] ?? null;
}

export function checkGetOrArity(
  e: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
  const isMap = recv?.kind === "TypeApp" && recv.name === "Map";
  const unwraps = recv?.kind === "TypeApp" && (recv.name === "Option" || recv.name === "Result");

  if (recv?.kind === "TypeApp" && (isMap || unwraps)) {
    const want = isMap ? 2 : 1;
    if (e.args.length === want) return;

    const taken = isMap ? "(key, default)" : "(default)";
    const other = isMap
      ? '".get-or(default)" is the "Option" / "Result" reading'
      : '".get-or(key, default)" is the "Map" reading';
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Method ".get-or" on "${recv.name}" expects ${want} argument(s) ${taken} but got ${e.args.length} — ${other}`,
      pos: e.pos,
    });
    return;
  }

  if (e.args.length > 2) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Method ".get-or" expects 1 argument(s) (default) or 2 (key, default) but got ${e.args.length} — no receiver has a reading that takes more`,
      pos: e.pos,
    });
  }
}

export function checkGetArity(
  e: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
  const keyed = recv?.kind === "TypeApp" && (recv.name === "Map" || recv.name === "List");
  const unwraps = recv?.kind === "TypeApp" && (recv.name === "Option" || recv.name === "Result");

  if (recv?.kind === "TypeApp" && (keyed || unwraps)) {
    if (e.args.length === (keyed ? 1 : 0)) return;
    const message = keyed
      ? `Method ".get" on "${recv.name}" expects 1 argument (${
          recv.name === "Map" ? "key" : "index"
        }) but got ${e.args.length} — ".get" with no arguments is the "Option" / "Result" reading`
      : `Method ".get" on "${recv.name}" takes no arguments and unwraps, but got ${e.args.length} — ".get(key)" is the "Map" reading and ".get(index)" the "List" one`;
    errors.push({ code: "E0213", kind: "call-arity-mismatch", message, pos: e.pos });
    return;
  }

  if (e.args.length > 1) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Method ".get" takes no arguments or one, but got ${e.args.length} — no receiver has a reading that takes more`,
      pos: e.pos,
    });
  }
}

export function getOrResultType(recv: TypeExpr | null, argCount: number): TypeExpr | null {
  if (recv?.kind !== "TypeApp") return null;
  if (recv.name === "Map") return argCount === 2 ? (recv.args[1] ?? null) : null;
  return argCount === 1 ? unwrappedType(recv) : null;
}

export function lvalueType(lv: Lvalue, sym: SymbolTable): TypeExpr | null {
  if (lv.kind === "LSlot") return sym.slots.get(lv.name)?.type ?? null;
  const base = unaliasType(lvalueType(lv.base, sym), sym);
  if (!base) return null;
  if (lv.kind === "LField") {
    if (base.kind === "TypeRecord") return recordFieldType(base, lv.field);
    if (lv.field === "get") return unwrappedType(base);
    return null;
  }
  return indexedType(base);
}

/**
 * A `Set` index names nothing, so it has no type on either side of `:=`: a
 * position that takes the read would otherwise report the one mistake twice.
 */
export function indexedType(base: TypeExpr | null): TypeExpr | null {
  if (base?.kind !== "TypeApp") return null;
  if (base.name === "List") return base.args[0] ?? null;
  if (base.name === "Map") return base.args[1] ?? null;
  return null;
}

export function checkEmitTarget(
  effect: string,
  args: Expr[],
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  pos: Pos,
): void {
  const input = effectInput(effect, sym);
  if (!input) {
    errors.push({
      code: "E0104",
      kind: "undef-effect",
      message: `Reference to undefined effect "${effect}"`,
      pos,
    });
    return;
  }
  const { cap, inType, omittable } = input;
  if (cap !== null && ctx.capsAvailable && !ctx.capsAvailable.has(cap)) {
    errors.push({
      code: "E0301",
      kind: "missing-capability",
      message: `Effect "${effect}" requires capability "${cap}" which is not declared in app.caps`,
      pos,
    });
  }
  const wants = isPrimNamed(inType, sym, "Unit") ? 0 : 1;
  if (args.length !== wants) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Effect "${effect}" expects ${wants} argument(s) but got ${args.length}`,
      pos,
    });
    return;
  }
  const arg = args[0];
  if (!arg) return;
  if (isPrimNamed(inType, sym, "EffectId")) {
    const actual = inferType(arg, sym, ctx);
    if (actual && !isPrimNamed(actual, sym, "EffectId")) {
      errors.push({
        code: "E0202",
        kind: "emit-arg-type-mismatch",
        message: `emit "${effect}" expects an EffectId argument`,
        pos,
      });
    }
    return;
  }
  checkAgainst(arg, inType, sym, errors, ctx, "E0202", omittable);
}

type Omittable = (field: { readonly name: string; readonly type: TypeExpr }) => boolean;

export function effectInput(
  name: string,
  sym: SymbolTable,
): { cap: string | null; inType: TypeExpr; omittable: Omittable | undefined } | undefined {
  const eff = sym.effects.get(name);
  if (eff) return { cap: eff.cap, inType: eff.inType, omittable: undefined };
  const builtin = BUILTIN_EFFECTS.get(name);
  if (!builtin) return undefined;
  return {
    cap: builtin.cap,
    inType: builtin.inType,
    omittable: (f) => builtinFieldOmittable(builtin, f),
  };
}
