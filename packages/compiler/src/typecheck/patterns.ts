import {
  assignable,
  paramSubstitution,
  substituteType,
  typeToString,
  unaliasType,
  writtenVariants,
} from "../assignable.ts";
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

const BUILTIN_TAGS: ReadonlyMap<string, readonly string[]> = new Map([
  ["Option", ["Some", "None"]],
  ["Result", ["Ok", "Err"]],
]);

/**
 * The type a match with these `arms` reads a scrutinee of type `t` as. A value written as a tag a
 * union of the program's own declares too is its `Option` / `Result` unless an arm names a tag
 * that type lacks; then it is the first such union that has every arm's tag and a variant holding
 * the value (language.md, Built-in Generic Types).
 */
export function matchedType(
  t: TypeExpr | null,
  arms: readonly { readonly pattern: Pattern }[],
  sym: SymbolTable,
): TypeExpr | null {
  return readAs(
    t,
    arms.map((arm) => arm.pattern),
    sym,
  );
}

function readAs(
  t: TypeExpr | null,
  patterns: readonly Pattern[],
  sym: SymbolTable,
): TypeExpr | null {
  if (t?.kind !== "TypeApp") return t;
  if (t.name === "Tuple") {
    const columns = patterns.flatMap((p) =>
      p.kind === "PTuple" && p.items.length === t.args.length ? [p.items] : [],
    );
    if (columns.length === 0) return t;
    const args = t.args.map(
      (a, i) =>
        readAs(
          a,
          columns.map((items) => items[i] as Pattern),
          sym,
        ) ?? a,
    );
    return args.every((a, i) => a === t.args[i]) ? t : { ...t, args };
  }
  const written = writtenVariants(t)?.[0];
  const builtin = BUILTIN_TAGS.get(t.name);
  if (written === undefined || builtin === undefined) return t;
  const tags = patterns.flatMap((p) => (p.kind === "PVariant" ? [p.name] : []));
  if (tags.every((tag) => builtin.includes(tag))) return t;
  const hasEveryTag = (u: TypeExpr | null): boolean =>
    u?.kind === "TypeUnion" && tags.every((tag) => u.variants.some((v) => v.name === tag));
  const unions = sym.unionsByTag.get(written.tag) ?? [];
  return unions.find((u) => hasEveryTag(unaliasType(u, sym)) && assignable(t, u, sym)) ?? t;
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

/**
 * In declaration order, the built-ins included: `Option(T) ; None | Some(T)` and
 * `Result(T, E) ; Ok(T) | Err(E)` (language.md). `null` when the type is undecidable.
 */
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
      { name: "None", payloads: [] },
      { name: "Some", payloads: inner ? [inner] : [] },
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

/** How many of the values a match leaves out E0227 names; the rest are summed up as "among others". */
const WITNESSES_SHOWN = 8;

/**
 * Callers run this only once every arm's pattern fits: a pattern that does not is E0207 / E0208 /
 * E0209 already, and coverage counted against it would repeat that.
 */
export function checkMatchCovers(
  e: Expr & { kind: "MatchExpr" },
  scrutType: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (scrutType === null) return;
  // One past what is shown, so the message knows whether there are others.
  const uncovered = uncoveredRows(
    e.arms.map((arm) => [arm.pattern]),
    [scrutType],
    sym,
    WITNESSES_SHOWN + 1,
  );
  if (uncovered === null || uncovered.length === 0) return;
  const shown = uncovered.slice(0, WITNESSES_SHOWN).map((w) => w.join(", "));
  const others = uncovered.length > WITNESSES_SHOWN ? ", among others" : "";
  errors.push({
    code: "E0227",
    kind: "non-exhaustive-match",
    message:
      `This match on "${typeToString(scrutType)}" has no arm for ${shown.join(", ")}${others}, ` +
      "and a match used as a value has to evaluate to one of its arms. Add the missing arms, " +
      "or end with `_ -> …`",
    pos: e.pos,
  });
}

const isIrrefutable = (p: Pattern): boolean => p.kind === "PWildcard" || p.kind === "PBind";

/**
 * Up to `limit` of the values no row matches, one pattern per column of `types`, in the order the
 * types declare their variants; `[]` when the rows cover every value, `null` when every value they
 * miss hinges on an undecidable type. A variant pattern's payloads are binds, so a variant arm
 * covers its whole variant, and with no literal patterns a type that is neither a union nor a
 * tuple is matched only by `_` or a name. An undecidable type whose column holds a variant or
 * tuple pattern answers `null` unless its `_`-or-name rows cover the rest on their own, since
 * nothing says which values such a pattern leaves out; a column of only `_` or names is matched
 * as `_`. A variant that answers `null` is passed over when another one has values to name, and
 * the search stops at `limit`, so the work is bounded by the values named, not by all of them.
 */
function uncoveredRows(
  rows: readonly (readonly Pattern[])[],
  types: readonly (TypeExpr | null)[],
  sym: SymbolTable,
  limit: number,
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
    let undecided = false;
    for (const v of variants) {
      if (out.length >= limit) break;
      const sub = uncoveredRows(
        narrow((p) =>
          isIrrefutable(p) || (p.kind === "PVariant" && p.name === v.name) ? [] : null,
        ),
        rest,
        sym,
        limit - out.length,
      );
      if (sub === null) {
        undecided = true;
        continue;
      }
      const shown =
        v.payloads.length === 0 ? v.name : `${v.name}(${v.payloads.map(() => "_").join(", ")})`;
      for (const w of sub) out.push([shown, ...w]);
    }
    return out.length === 0 && undecided ? null : out;
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
      limit,
    );
    if (sub === null) return null;
    return sub.map((w) => [`(${w.slice(0, n).join(", ")})`, ...w.slice(n)]);
  }

  const sub = uncoveredRows(
    narrow((p) => (isIrrefutable(p) ? [] : null)),
    rest,
    sym,
    limit,
  );
  if (sub === null || sub.length === 0) return sub;
  if (variants === null && rows.some((row) => row[0] !== undefined && !isIrrefutable(row[0]))) {
    return null;
  }
  return sub.map((w) => ["_", ...w]);
}
