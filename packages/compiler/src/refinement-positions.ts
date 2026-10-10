import { paramSubstitution, substituteType, type TypeEnv, unaliasType } from "./assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "./ast.ts";
import { keyRepresentation } from "./key-representation.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

export const GENERIC_SELF_NESTING_LIMIT = 32;

/** A key for a type expression, source positions stripped, refinements kept. */
export const typeKey = (t: TypeExpr): string =>
  JSON.stringify(t, (k, v) => (k === "pos" ? undefined : v));

/** The body a named type or applied program generic stands for, if any. */
export function expandNamed(t: TypeExpr, env: TypeEnv): TypeExpr | undefined {
  if (t.kind !== "TypeRef" && t.kind !== "TypeApp") return undefined;
  const def = env.types.get(t.name);
  if (!def) return undefined;
  return t.kind === "TypeApp"
    ? substituteType(def.body, paramSubstitution(def.params, t.args))
    : def.body;
}

const genericName = (t: TypeExpr, env: TypeEnv): string | undefined =>
  t.kind === "TypeApp" && env.types.has(t.name) ? t.name : undefined;

export function setMemberIsRecoverable(member: TypeExpr, env: TypeEnv): boolean {
  return keyRepresentation(member, env) !== null;
}

export function containerPositions(
  t: TypeExpr & { kind: "TypeApp" },
  env: TypeEnv,
): readonly TypeExpr[] {
  if (!BUILTIN_TYPE_CONSTRUCTORS.has(t.name)) return [];
  if (t.name === "Set") {
    const member = t.args[0];
    return member && setMemberIsRecoverable(member, env) ? [member] : [];
  }
  return t.args;
}

/** What a walk of a type's positions found. */
export type PositionScan = {
  /** Some position carries a refinement. */
  readonly carries: boolean;
  readonly cut: string | undefined;
};

export function scanPositions(t: TypeExpr, env: TypeEnv): PositionScan {
  let cut: string | undefined;
  const done = new Map<string, boolean>();
  const mentions = new Map<string, boolean>();
  type Walked = { readonly carries: boolean; readonly back: number };
  const none: Walked = { carries: false, back: Number.POSITIVE_INFINITY };
  const join = (xs: readonly Walked[]): Walked => ({
    carries: xs.some((w) => w.carries),
    back: Math.min(Number.POSITIVE_INFINITY, ...xs.map((w) => w.back)),
  });
  const walk = (
    x: TypeExpr,
    visiting: ReadonlyMap<string, number>,
    generics: readonly string[],
  ): Walked => {
    switch (x.kind) {
      case "TypePrim":
        return none;
      case "TypeRef":
      case "TypeApp": {
        const body = expandNamed(x, env);
        if (!body) {
          return x.kind === "TypeApp"
            ? join(containerPositions(x, env).map((a) => walk(a, visiting, generics)))
            : none;
        }
        const key = typeKey(x);
        const onStack = visiting.get(key);
        if (onStack !== undefined) return { carries: false, back: onStack };
        const known = done.get(key);
        if (known !== undefined) return { carries: known, back: Number.POSITIVE_INFINITY };
        let spelled = mentions.get(key);
        if (spelled === undefined) {
          spelled = mentionsRefinement(x, env);
          mentions.set(key, spelled);
        }
        if (!spelled) return none;
        const g = genericName(x, env);
        if (
          g !== undefined &&
          generics.filter((n) => n === g).length >= GENERIC_SELF_NESTING_LIMIT
        ) {
          cut ??= g;
          return none;
        }
        const depth = visiting.size;
        const inner = walk(
          body,
          new Map([...visiting, [key, depth]]),
          g === undefined ? generics : [...generics, g],
        );
        if (inner.carries || inner.back >= depth) done.set(key, inner.carries);
        return inner;
      }
      case "TypeNominal":
      case "TypeRefinement": {
        const inner = walk(x.inner, visiting, generics);
        return x.refinement !== undefined ? { ...inner, carries: true } : inner;
      }
      case "TypeRecord":
        return join(x.fields.map((f) => walk(f.type, visiting, generics)));
      case "TypeUnion":
        return join(x.variants.flatMap((v) => v.payloads.map((p) => walk(p, visiting, generics))));
      default:
        assertNever(x);
        return none;
    }
  };
  return { carries: walk(t, new Map(), []).carries, cut };
}

export function carriesNestedRefinement(t: TypeExpr, env: TypeEnv): boolean {
  const body = unaliasType(t, env);
  return body !== null && scanPositions(body, env).carries;
}

export function firstRefinement(t: TypeExpr, env: TypeEnv): Refinement | undefined {
  const walk = (x: TypeExpr, visiting: ReadonlySet<string>): Refinement | undefined => {
    switch (x.kind) {
      case "TypePrim":
        return undefined;
      case "TypeRef":
      case "TypeApp": {
        const body = expandNamed(x, env);
        if (!body) {
          if (x.kind !== "TypeApp") return undefined;
          for (const a of containerPositions(x, env)) {
            const r = walk(a, visiting);
            if (r) return r;
          }
          return undefined;
        }
        const key = typeKey(x);
        return visiting.has(key) ? undefined : walk(body, new Set([...visiting, key]));
      }
      case "TypeNominal":
      case "TypeRefinement":
        return walk(x.inner, visiting) ?? x.refinement;
      case "TypeRecord":
        for (const f of x.fields) {
          const r = walk(f.type, visiting);
          if (r) return r;
        }
        return undefined;
      case "TypeUnion":
        for (const v of x.variants) {
          for (const p of v.payloads) {
            const r = walk(p, visiting);
            if (r) return r;
          }
        }
        return undefined;
      default:
        assertNever(x);
        return undefined;
    }
  };
  return walk(t, new Set());
}

function mentionsRefinement(t: TypeExpr, env: TypeEnv): boolean {
  const seen = new Set<string>();
  const walk = (x: TypeExpr): boolean => {
    switch (x.kind) {
      case "TypePrim":
        return false;
      case "TypeRef":
      case "TypeApp": {
        if (x.kind === "TypeApp" && x.args.some(walk)) return true;
        if (seen.has(x.name)) return false;
        seen.add(x.name);
        const def = env.types.get(x.name);
        return def ? walk(def.body) : false;
      }
      case "TypeNominal":
      case "TypeRefinement":
        return x.refinement !== undefined || walk(x.inner);
      case "TypeRecord":
        return x.fields.some((f) => walk(f.type));
      case "TypeUnion":
        return x.variants.some((v) => v.payloads.some(walk));
      default:
        assertNever(x);
        return false;
    }
  };
  return walk(t);
}
