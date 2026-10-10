import { paramSubstitution, substituteType, typeToString, unaliasType } from "../assignable.ts";
import type { MatchArm, Pattern, Pos, TypeExpr } from "../ast.ts";
import { bindLocal, type Ctx, innerScope, type KumikiError, type SymbolTable } from "./context.ts";

export function armScope(
  arm: MatchArm,
  scrutType: TypeExpr | null,
  sym: SymbolTable,
  ctx: Ctx,
): Ctx {
  const inner = innerScope(ctx);
  checkPatternAgainstType(arm.pattern, scrutType, sym, [], inner);
  return inner;
}

export function checkPatternBindsAreDistinct(pat: Pattern, errors: KumikiError[]): void {
  const seen = new Set<string>();
  const walk = (p: Pattern): void => {
    switch (p.kind) {
      case "PWildcard":
        return;
      case "PBind":
        report(p.name, p.pos);
        return;
      case "PVariant":
        for (const b of p.binds) report(b, p.pos);
        return;
      case "PTuple":
        for (const it of p.items) walk(it);
        return;
      default: {
        const exhaustive: never = p;
        void exhaustive;
        return;
      }
    }
  };
  const report = (name: string, pos: Pos): void => {
    if (name === "_") return;
    if (seen.has(name)) {
      errors.push({
        code: "E0122",
        kind: "duplicate-pattern-bind",
        message:
          `"${name}" is bound twice in this pattern. The two binds are peers — nothing ` +
          `nests them, so the second does not shadow the first — and one of the two ` +
          `values the pattern names would be unreadable. Rename one`,
        pos,
      });
      return;
    }
    seen.add(name);
  };
  walk(pat);
}

export function checkPatternAgainstType(
  pat: Pattern,
  scrutType: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  scope: Ctx,
): void {
  const t = unaliasType(scrutType, sym);
  const display = scrutType ?? t;

  if (pat.kind === "PWildcard") return;

  if (pat.kind === "PBind") {
    bindLocal(scope, pat.name, t === null ? null : scrutType);
    return;
  }

  if (pat.kind === "PTuple") {
    const tupleT = resolveToTuple(t, sym);
    if (tupleT === null) {
      for (const it of pat.items) {
        checkPatternAgainstType(it, null, sym, errors, scope);
      }
      return;
    }
    if (tupleT === "not-a-tuple") {
      errors.push({
        code: "E0208",
        kind: "pat-type-mismatch",
        message: `Tuple pattern cannot match scrutinee of type "${typeToString(display as TypeExpr)}"`,
        pos: pat.pos,
      });
      for (const it of pat.items) {
        checkPatternAgainstType(it, null, sym, errors, scope);
      }
      return;
    }
    if (tupleT.args.length !== pat.items.length) {
      errors.push({
        code: "E0207",
        kind: "pat-arity-mismatch",
        message: `Tuple pattern has ${pat.items.length} item(s) but scrutinee type "${typeToString(tupleT)}" has ${tupleT.args.length}`,
        pos: pat.pos,
      });
    }
    for (let i = 0; i < pat.items.length; i++) {
      const item = pat.items[i];
      if (!item) continue;
      const elemType = tupleT.args[i] ?? null;
      checkPatternAgainstType(item, elemType, sym, errors, scope);
    }
    return;
  }

  if (!t) {
    // Undecidable scrutinee — register binds without types and stop.
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  const payloads = lookupVariantPayloads(pat.name, t, sym);
  if (payloads === null) {
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  if (payloads === "unknown-tag") {
    errors.push({
      code: "E0209",
      kind: "pat-unknown-variant",
      message: `Variant "${pat.name}" is not a member of scrutinee type "${typeToString(display as TypeExpr)}"`,
      pos: pat.pos,
    });
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  if (payloads === "not-a-union") {
    errors.push({
      code: "E0208",
      kind: "pat-type-mismatch",
      message: `Variant pattern "${pat.name}" cannot match scrutinee of type "${typeToString(display as TypeExpr)}"`,
      pos: pat.pos,
    });
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  if (pat.binds.length !== payloads.length) {
    errors.push({
      code: "E0207",
      kind: "pat-arity-mismatch",
      message: `Variant "${pat.name}" pattern has ${pat.binds.length} bind(s) but the variant carries ${payloads.length} payload(s)`,
      pos: pat.pos,
    });
  }
  for (let i = 0; i < pat.binds.length; i++) {
    const name = pat.binds[i];
    if (!name || name === "_") continue;
    bindLocal(scope, name, payloads[i] ?? null);
  }
}

/**
 * `t` with type definitions, nominals and refinements peeled off until `stop` holds or nothing
 * peels further; `null` when `t` is absent, opaque, or a definition loops.
 */
function peelTo(
  t: TypeExpr | null,
  sym: SymbolTable,
  stop: (t: TypeExpr) => boolean,
): TypeExpr | null {
  const seen = new Set<string>();
  let cur = t;
  while (cur) {
    if (stop(cur)) return cur;
    if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
      cur = cur.inner;
      continue;
    }
    if (cur.kind !== "TypeRef" && cur.kind !== "TypeApp") return cur;
    const def = sym.types.get(cur.name);
    if (!def) return cur.kind === "TypeRef" ? null : cur;
    if (seen.has(cur.name)) return null;
    seen.add(cur.name);
    cur =
      cur.kind === "TypeApp"
        ? substituteType(def.body, paramSubstitution(def.params, cur.args))
        : def.body;
  }
  return null;
}

const isVariantCarrier = (t: TypeExpr): boolean =>
  t.kind === "TypeUnion" || (t.kind === "TypeApp" && (t.name === "Option" || t.name === "Result"));

function lookupVariantPayloads(
  tag: string,
  scrut: TypeExpr | null,
  sym: SymbolTable,
): TypeExpr[] | "unknown-tag" | "not-a-union" | null {
  const t = peelTo(scrut, sym, isVariantCarrier);
  if (!t) return null;
  if (t.kind === "TypeUnion")
    return t.variants.find((x) => x.name === tag)?.payloads ?? "unknown-tag";
  if (t.kind !== "TypeApp") return "not-a-union";
  if (t.name === "Option") {
    if (tag === "Some") return t.args[0] ? [t.args[0]] : [];
    return tag === "None" ? [] : "unknown-tag";
  }
  if (t.name === "Result") {
    if (tag !== "Ok" && tag !== "Err") return "unknown-tag";
    const payload = t.args[tag === "Ok" ? 0 : 1];
    return payload ? [payload] : [];
  }
  return "not-a-union";
}

type TupleType = TypeExpr & { kind: "TypeApp"; name: "Tuple" };

const isTuple = (t: TypeExpr): t is TupleType => t.kind === "TypeApp" && t.name === "Tuple";

function resolveToTuple(
  scrut: TypeExpr | null,
  sym: SymbolTable,
): TupleType | "not-a-tuple" | null {
  const t = peelTo(scrut, sym, isTuple);
  if (!t) return null;
  return isTuple(t) ? t : "not-a-tuple";
}
