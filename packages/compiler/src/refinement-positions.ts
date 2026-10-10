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

// A type's own chain is followed in a loop: nothing bounds how many definitions it passes through.
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
  const followChain = (
    x: TypeExpr,
    visiting: ReadonlyMap<string, number>,
    generics: readonly string[],
  ): { end: Walked; entered: { key: string; depth: number }[]; refinedAfter: number } => {
    const entered: { key: string; depth: number }[] = [];
    let refinedAfter = -1;
    let inChain: Map<string, number> | null = null;
    let gens = generics;
    let cur = x;
    const ending = (end: Walked) => ({ end, entered, refinedAfter });
    for (;;) {
      const vis = inChain ?? visiting;
      switch (cur.kind) {
        case "TypeNominal":
        case "TypeRefinement":
          if (cur.refinement !== undefined) refinedAfter = entered.length;
          cur = cur.inner;
          continue;
        case "TypePrim":
          return ending(none);
        case "TypeRecord":
          return ending(join(cur.fields.map((f) => walk(f.type, vis, gens))));
        case "TypeUnion":
          return ending(
            join(cur.variants.flatMap((v) => v.payloads.map((p) => walk(p, vis, gens)))),
          );
        case "TypeRef":
        case "TypeApp": {
          const body = expandNamed(cur, env);
          if (!body) {
            return ending(
              cur.kind === "TypeApp"
                ? join(containerPositions(cur, env).map((a) => walk(a, vis, gens)))
                : none,
            );
          }
          const key = typeKey(cur);
          const onStack = vis.get(key);
          if (onStack !== undefined) return ending({ carries: false, back: onStack });
          const known = done.get(key);
          if (known !== undefined) {
            return ending({ carries: known, back: Number.POSITIVE_INFINITY });
          }
          let spelled = mentions.get(key);
          if (spelled === undefined) {
            spelled = mentionsRefinement(cur, env);
            mentions.set(key, spelled);
          }
          if (!spelled) return ending(none);
          const g = genericName(cur, env);
          if (g !== undefined && gens.filter((n) => n === g).length >= GENERIC_SELF_NESTING_LIMIT) {
            cut ??= g;
            return ending(none);
          }
          inChain ??= new Map(visiting);
          const depth = inChain.size;
          inChain.set(key, depth);
          entered.push({ key, depth });
          if (g !== undefined) gens = [...gens, g];
          cur = body;
          continue;
        }
        default:
          assertNever(cur);
          return ending(none);
      }
    }
  };
  const walk = (
    x: TypeExpr,
    visiting: ReadonlyMap<string, number>,
    generics: readonly string[],
  ): Walked => {
    const { end, entered, refinedAfter } = followChain(x, visiting, generics);
    for (const [i, { key, depth }] of entered.entries()) {
      const carries = end.carries || refinedAfter > i;
      if (carries || end.back >= depth) done.set(key, carries);
    }
    return { carries: end.carries || refinedAfter >= 0, back: end.back };
  };
  return { carries: walk(t, new Map(), []).carries, cut };
}

export function carriesNestedRefinement(t: TypeExpr, env: TypeEnv): boolean {
  const body = unaliasType(t, env);
  return body !== null && scanPositions(body, env).carries;
}

type Unwrapped = Exclude<TypeExpr, { kind: "TypeNominal" | "TypeRefinement" }>;

export function firstRefinement(t: TypeExpr, env: TypeEnv): Refinement | undefined {
  const walk = (x: TypeExpr, visiting: ReadonlySet<string>): Refinement | undefined => {
    let innermost: Refinement | undefined;
    let inChain: Set<string> | null = null;
    let cur = x;
    for (;;) {
      if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
        innermost = cur.refinement ?? innermost;
        cur = cur.inner;
        continue;
      }
      const body = expandNamed(cur, env);
      if (!body) return positions(cur, inChain ?? visiting) ?? innermost;
      const key = typeKey(cur);
      if ((inChain ?? visiting).has(key)) return innermost;
      inChain ??= new Set(visiting);
      inChain.add(key);
      cur = body;
    }
  };
  const positions = (x: Unwrapped, visiting: ReadonlySet<string>): Refinement | undefined => {
    switch (x.kind) {
      case "TypePrim":
      case "TypeRef":
        return undefined;
      case "TypeApp":
        for (const a of containerPositions(x, env)) {
          const r = walk(a, visiting);
          if (r) return r;
        }
        return undefined;
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

// A worklist rather than a recursion: what it reaches by name is as large as the program.
function mentionsRefinement(t: TypeExpr, env: TypeEnv): boolean {
  const seen = new Set<string>();
  const todo: TypeExpr[] = [t];
  for (let x = todo.pop(); x !== undefined; x = todo.pop()) {
    switch (x.kind) {
      case "TypePrim":
        break;
      case "TypeRef":
      case "TypeApp": {
        if (x.kind === "TypeApp") todo.push(...x.args);
        if (seen.has(x.name)) break;
        seen.add(x.name);
        const def = env.types.get(x.name);
        if (def) todo.push(def.body);
        break;
      }
      case "TypeNominal":
      case "TypeRefinement":
        if (x.refinement !== undefined) return true;
        todo.push(x.inner);
        break;
      case "TypeRecord":
        for (const f of x.fields) todo.push(f.type);
        break;
      case "TypeUnion":
        for (const v of x.variants) todo.push(...v.payloads);
        break;
      default:
        assertNever(x);
    }
  }
  return false;
}
