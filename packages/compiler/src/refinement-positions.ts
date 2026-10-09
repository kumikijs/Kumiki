import { paramSubstitution, substituteType, type TypeEnv, unaliasType } from "./assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "./ast.ts";
import { keyRepresentation } from "./key-representation.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/**
 * Where inside a value of a type a refinement can sit, and whether one does —
 * the analysis the slot gate's lowering (`codegen/nested-refinements.ts`) and
 * the checker's report of a type too self-nested to lower (E0803) both read,
 * so the two cannot disagree about a type (spec/language.md §1.3.3).
 *
 * A position is a record's field, a union variant's payload, or a builtin
 * container's element: a `List` / `Set` member, a `Map` key or value,
 * `Option`'s `Some`, `Result`'s `Ok` / `Err`, a `Tuple`'s member.
 */

/**
 * How many times one program generic may be expanding inside itself before
 * the walk stops. A named type that recurses under the *same* key becomes a
 * call to the function it is already being lowered into, and the number of
 * distinct named types is finite, so neither of those is ever cut, however
 * deep they nest. Only a generic that applies itself to a *growing* argument
 * (`type T(A) = {v: A, next: Option(T(List(A)))}`) keeps producing new keys,
 * and that is what this bounds; reaching it is E0803 at build time rather than
 * a gate that checks less than the type says.
 */
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

/**
 * Is `t` a program generic being applied — the only expansion whose keys can
 * keep growing, and so the only one {@link GENERIC_SELF_NESTING_LIMIT} counts.
 */
const genericName = (t: TypeExpr, env: TypeEnv): string | undefined =>
  t.kind === "TypeApp" && env.types.has(t.name) ? t.name : undefined;

/**
 * A `Set`'s members as the runtime stores them are the keys of an object
 * (`entryKey`), so a member is recoverable only when its type is one a key
 * reads back as (`keyRepresentation`): text, a number, a boolean, or a
 * structured value read back from its JSON — not a type parameter or a
 * primitive such as `Bytes`, whose stored string is not a value of the type.
 */
export function setMemberIsRecoverable(member: TypeExpr, env: TypeEnv): boolean {
  return keyRepresentation(member, env) !== null;
}

/**
 * The argument types of a builtin container that are positions of its value.
 * Every constructor in {@link BUILTIN_TYPE_CONSTRUCTORS} is one, so a
 * constructor added there is walked here without being listed twice; `Set`
 * drops a member type {@link setMemberIsRecoverable} cannot read back.
 */
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
  /**
   * The generic whose self-application the walk stopped at, when it had to:
   * the lowering cannot follow it, so the type has a check it cannot build.
   */
  readonly cut: string | undefined;
};

/**
 * Walk every position of `t`, its own chain included, through names,
 * generics and recursion. A name met again under the same key is a cycle
 * that adds nothing new, so it answers `false` there.
 *
 * A type's own chain — each `nominal` / `where` wrapper and each name it is
 * declared through — is followed in a loop, and only the type it ends at is
 * walked for positions: nothing bounds how long a chain is, since the depth
 * budget is per type expression and a chain passes through as many
 * definitions as the program declares.
 */
export function scanPositions(t: TypeExpr, env: TypeEnv): PositionScan {
  let cut: string | undefined;
  // A named type's answer, once its walk is complete. `true` holds from any
  // entry point; `false` is kept only when the walk met no key still being
  // walked above it, since a cycle answers `false` at the back edge and the
  // refinement it would have found belongs to the ancestor. This is what keeps
  // a type that shares a name at many positions linear rather than exponential.
  const done = new Map<string, boolean>();
  const mentions = new Map<string, boolean>();
  type Walked = { readonly carries: boolean; readonly back: number };
  const none: Walked = { carries: false, back: Number.POSITIVE_INFINITY };
  const join = (xs: readonly Walked[]): Walked => ({
    carries: xs.some((w) => w.carries),
    back: Math.min(Number.POSITIVE_INFINITY, ...xs.map((w) => w.back)),
  });
  /**
   * What the chain from `x` ends at: how that type walks, the names entered
   * on the way with the depth each was entered at, and how many of them had
   * been entered when the innermost refinement on the chain was met (-1 for
   * none) — every name entered before that point carries it.
   */
  const followChain = (
    x: TypeExpr,
    visiting: ReadonlyMap<string, number>,
    generics: readonly string[],
  ): { end: Walked; entered: { key: string; depth: number }[]; refinedAfter: number } => {
    const entered: { key: string; depth: number }[] = [];
    let refinedAfter = -1;
    // `visiting` with the names this chain has entered, copied at the first.
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
          // A type none of whose reachable definitions spells a `where` has
          // nothing to find, however far it could be expanded — which keeps a
          // refinement-free generic recursion clear of the cut below.
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
    // Each name on the chain answers for what lies beyond it: the refinements
    // met after it was entered, and whatever the chain ends at.
    for (const [i, { key, depth }] of entered.entries()) {
      const carries = end.carries || refinedAfter > i;
      if (carries || end.back >= depth) done.set(key, carries);
    }
    return { carries: end.carries || refinedAfter >= 0, back: end.back };
  };
  return { carries: walk(t, new Map(), []).carries, cut };
}

/**
 * Does `t` carry a refinement anywhere below its own chain — which is what
 * decides that a slot is gated by a walk of its value rather than by the
 * chain's predicates alone. `unaliasType` is the type's structural body with
 * every wrapper stripped and every generic instantiated, so what it carries
 * sits below the chain.
 */
export function carriesNestedRefinement(t: TypeExpr, env: TypeEnv): boolean {
  const body = unaliasType(t, env);
  return body !== null && scanPositions(body, env).carries;
}

/** A type that is no `nominal` or `where` wrapper: one a chain of them can end at. */
type Unwrapped = Exclude<TypeExpr, { kind: "TypeNominal" | "TypeRefinement" }>;

/**
 * The first refinement a walk of `t`'s positions reaches, in the order the
 * lowering checks them — what a value of the wrong shape is reported against
 * (§1.3.3: a predicate answers a value of the wrong shape with `false`).
 */
export function firstRefinement(t: TypeExpr, env: TypeEnv): Refinement | undefined {
  const walk = (x: TypeExpr, visiting: ReadonlySet<string>): Refinement | undefined => {
    // `x`'s own chain, followed in a loop as `scanPositions` follows it: the
    // innermost refinement on it comes first, after anything the type it ends
    // at carries.
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
  /** The first refinement at a position of `x`, the type a chain ends at. */
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

/**
 * Does a `where` appear anywhere in `t` or in a definition it reaches by name?
 * Syntactic, so it terminates on any recursion; a `false` here is exact.
 *
 * A search for any one node, with nothing to carry along a path, so it keeps a
 * list of what is left to look at rather than recursing: what it reaches by
 * name is as large as the program.
 */
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
