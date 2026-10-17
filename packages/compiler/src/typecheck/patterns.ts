import { paramSubstitution, substituteType, typeToString, unaliasType } from "../assignable.ts";
import type { Expr, MatchArm, Pattern, Pos, TypeExpr } from "../ast.ts";
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
): readonly TypeExpr[] | "unknown-tag" | "not-a-union" | null {
  const variants = variantsOf(scrut, sym);
  if (variants === null || variants === "not-a-union") return variants;
  return variants.find((v) => v.name === tag)?.payloads ?? "unknown-tag";
}

type VariantShape = { readonly name: string; readonly payloads: readonly TypeExpr[] };

/** In declaration order; `null` when the type is undecidable. */
function variantsOf(
  scrut: TypeExpr | null,
  sym: SymbolTable,
): readonly VariantShape[] | "not-a-union" | null {
  const t = peelTo(scrut, sym, isVariantCarrier);
  if (!t) return null;
  if (t.kind === "TypeUnion") return t.variants;
  if (t.kind !== "TypeApp") return "not-a-union";
  if (t.name === "Option") {
    const inner = t.args[0];
    return [
      { name: "Some", payloads: inner ? [inner] : [] },
      { name: "None", payloads: [] },
    ];
  }
  if (t.name === "Result") {
    const [okT, errT] = t.args;
    return [
      { name: "Ok", payloads: okT ? [okT] : [] },
      { name: "Err", payloads: errT ? [errT] : [] },
    ];
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

/** Only once every arm's pattern fits: a pattern that does not is E0207 / E0208 / E0209 already, and coverage counted against it would repeat that. */
export function checkMatchCovers(
  e: Expr & { kind: "MatchExpr" },
  scrutType: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (scrutType === null) return;
  const uncovered = uncoveredRows(
    e.arms.map((arm) => [arm.pattern]),
    [scrutType],
    sym,
  );
  if (uncovered === null || uncovered.length === 0) return;
  errors.push({
    code: "E0227",
    kind: "non-exhaustive-match",
    message:
      `This match on "${typeToString(scrutType)}" has no arm for ` +
      `${uncovered.map((w) => w.join(", ")).join(", ")}, and a match used as a value has to ` +
      "evaluate to one of its arms. Add the missing arms, or end with `_ -> …`",
    pos: e.pos,
  });
}

const isIrrefutable = (p: Pattern): boolean => p.kind === "PWildcard" || p.kind === "PBind";

/**
 * The values no row matches, one pattern per column of `types`; `[]` when the rows cover every
 * value, `null` when a type leaves that undecided. A variant pattern's payloads are binds, so a
 * variant arm covers its whole variant, and with no literal patterns a type that is neither a
 * union nor a tuple is matched only by `_` or a name. An undecidable type answers `null` unless
 * its `_`-or-name rows cover the rest on their own, since nothing says which values a variant or
 * tuple pattern of an unknown type leaves out.
 */
function uncoveredRows(
  rows: readonly (readonly Pattern[])[],
  types: readonly (TypeExpr | null)[],
  sym: SymbolTable,
): string[][] | null {
  if (rows.some((row) => row.every(isIrrefutable))) return [];
  if (rows.length === 0) return [types.map(() => "_")];
  const [first = null, ...rest] = types;
  const head = unaliasType(first, sym);
  const narrow = (open: (p: Pattern) => readonly Pattern[] | null): Pattern[][] =>
    rows.flatMap((row) => {
      const [p, ...tail] = row;
      const opened = p === undefined ? null : open(p);
      return opened === null ? [] : [[...opened, ...tail]];
    });

  const variants = variantsOf(head, sym);
  if (variants !== null && variants !== "not-a-union") {
    const out: string[][] = [];
    for (const v of variants) {
      const sub = uncoveredRows(
        narrow((p) =>
          isIrrefutable(p) || (p.kind === "PVariant" && p.name === v.name) ? [] : null,
        ),
        rest,
        sym,
      );
      if (sub === null) return null;
      const shown =
        v.payloads.length === 0 ? v.name : `${v.name}(${v.payloads.map(() => "_").join(", ")})`;
      for (const w of sub) out.push([shown, ...w]);
    }
    return out;
  }

  const tuple = resolveToTuple(head, sym);
  if (tuple !== null && tuple !== "not-a-tuple") {
    const n = tuple.args.length;
    const sub = uncoveredRows(
      narrow((p) => {
        if (isIrrefutable(p)) {
          return tuple.args.map((): Pattern => ({ kind: "PWildcard", pos: p.pos }));
        }
        return p.kind === "PTuple" && p.items.length === n ? p.items : null;
      }),
      [...tuple.args, ...rest],
      sym,
    );
    if (sub === null) return null;
    return sub.map((w) => [`(${w.slice(0, n).join(", ")})`, ...w.slice(n)]);
  }

  const sub = uncoveredRows(
    narrow((p) => (isIrrefutable(p) ? [] : null)),
    rest,
    sym,
  );
  if (sub === null || sub.length === 0) return sub;
  if (variants === null && rows.some((row) => row[0] !== undefined && !isIrrefutable(row[0]))) {
    return null;
  }
  return sub.map((w) => ["_", ...w]);
}
