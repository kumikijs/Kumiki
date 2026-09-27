import { paramSubstitution, substituteType, type TypeEnv, unaliasType } from "./assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "./ast.ts";
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
 * (`setAdd`, `setToggle`: `String(x)`), so a member is recoverable only when
 * its type is one a key reads back as — text, or a number read back through
 * `Number`. A record's key is `"[object Object]"`, which no check can see the
 * record through; such a member is not a position this walk can reach.
 */
export function setMemberIsRecoverable(member: TypeExpr, env: TypeEnv): boolean {
  const base = unaliasType(member, env);
  return (
    base?.kind === "TypePrim" &&
    (base.name === "Text" || base.name === "Int" || base.name === "Float" || base.name === "Time")
  );
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
        // A type none of whose reachable definitions spells a `where` has
        // nothing to find, however far it could be expanded — which keeps a
        // refinement-free generic recursion clear of the cut below.
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

/**
 * The first refinement a walk of `t`'s positions reaches, in the order the
 * lowering checks them — what a value of the wrong shape is reported against
 * (§1.3.3: a predicate answers a value of the wrong shape with `false`).
 */
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

/**
 * Does a `where` appear anywhere in `t` or in a definition it reaches by name?
 * Syntactic, so it terminates on any recursion; a `false` here is exact.
 */
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
