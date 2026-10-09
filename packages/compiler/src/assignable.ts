// The assignability relation, and the type-level helpers it needs.
//
// `inferType` had existed since the receiver-inference work, but nothing ever
// compared its answer against a declared type — there was no `assignable` at
// all — so every promise in forms.md §5.6 was empty. The relation lives here,
// separate from `typecheck.ts`, because it is a pure question about two types:
// no symbol table beyond the type definitions, no expressions, no diagnostics.
// `typecheck.ts` owns the expression-directed half (`checkAgainst`), which is
// what produces positions and messages.
//
// Every rule is one-sided: it answers "is this definitely wrong?", never "is
// this definitely right?". An unresolvable name, an uninferable expression and
// an unsubstituted type parameter all read as `unknown`, and `unknown` is
// assignable in both directions. A false positive rejects a program that runs;
// a false negative only loses a diagnostic that never existed before.
//
// `nominal` is the deliberate exception: the only rule here that rejects when
// every value of the actual type is a valid value of the declared one. `1.5` is
// not an `Int` and `{a, b}` is not an `{a: Int}`, but every `Yen` is a perfectly
// good `Cents` — so what this reports is a mistake against the declaration
// rather than a value that would fail, which is the whole purpose of writing
// `nominal` (language.md §1.3.5). Every other rule keeps the reading above.

import type { Pos, TypeDef, TypeExpr } from "./ast.ts";
import { forwardedParams, type NominalReading } from "./def-graph.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/** The slice of the checker's symbol table the type relation needs. */
export type TypeEnv = { types: ReadonlyMap<string, TypeDef> };

/**
 * The type of an expression whose type could not be worked out. Spelled as a
 * `TypeRef` to a name the grammar cannot produce, so it takes the same
 * "unresolved name is opaque" path as a type parameter with no substitution —
 * one rule instead of a separate case in every comparison.
 *
 * `?` is also what a reader sees: nested inside a container it survives into
 * `typeToString`, and `Expected Int but got List(?)` is the honest rendering —
 * the value is a list, and its element type could not be decided. It cannot
 * appear on the declared side, which is the half `symbols.ts#variantTagsOf`
 * and `fix.ts` parse back out of a message.
 */
export const unknownType = (pos: Pos): TypeExpr => ({ kind: "TypeRef", name: "?", pos });

/**
 * True when nothing can be concluded about `t` — an unresolved name, bare or
 * applied, or absent.
 */
export function isOpaque(t: TypeExpr | null, env: TypeEnv): boolean {
  const u = unaliasType(t, env);
  return u === null || u.kind === "TypeRef";
}

/**
 * Reduce a type to the form comparisons are written against: aliases followed,
 * generic definitions instantiated, `nominal` / `where` wrappers stripped.
 *
 * A `TypeRef` that names nothing is returned as-is, which is how a type
 * parameter and a misspelling both become opaque. An application of a name
 * that is no type at all (`isKnownTypeName`) — `Foo(Int)`, a misspelt
 * `Lst(Int)`, a parameter applied to arguments — reduces to that name as a
 * `TypeRef` and is opaque the same way: arguments to no type describe nothing
 * to compare against.
 *
 * An alias that resolves to itself returns `null` rather than looping:
 * reporting the cycle is a separate check, and normalisation has to terminate
 * whether or not one exists.
 */
export function unaliasType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  return unaliasFrom(t, new Set(), newWalk(env));
}

/**
 * Where each argument substituted into a generic's body was written, as the
 * names already entered at that point.
 *
 * An argument is a sub-expression of the caller's syntax, not of the body it
 * is substituted into, so it is read with the caller's guard: in
 * `NonEmpty(NonEmpty(Short))` the inner application is the outer one's
 * argument and enters `NonEmpty` afresh. A parameter the body forwards into
 * another application (`type Outer(T) = NonEmpty(T)`) is substituted there
 * again, and keeps the guard it was first written under rather than taking
 * the body's — so `Outer(Outer(Text))` enters `Outer` afresh as well.
 *
 * The walk still ends — every argument is a strict part of the syntax it was
 * written in, and a name reached through a body rather than an argument
 * (`type Loop(T) = Loop(T)`) meets the body's guard. This is the reading
 * `refinementsOf` takes in codegen.
 *
 * Keyed on a fresh copy of each argument made at the application, so an
 * argument node shared by two applications carries the guard of each.
 */
type ArgOrigins = WeakMap<TypeExpr, ReadonlySet<string>>;

/**
 * One normalisation, or one nominal chain: the type definitions, where each
 * substituted argument was written, and which generics hand a parameter
 * straight back (`def-graph.ts#forwardedParams`) under each reading of
 * `nominal`.
 */
type Walk = {
  readonly env: TypeEnv;
  readonly origins: ArgOrigins;
  readonly forwarded: Forwarded;
};

type Forwarded = Readonly<Record<NominalReading, (def: TypeDef) => number | null>>;

/**
 * The forwarding classifiers, one pair per table of definitions. `TypeEnv`
 * hands this module the table read-only, so an answer read from it holds for
 * as long as the table does — and the checker asks the same few generics
 * again for every type it compares.
 */
const forwardedByTable = new WeakMap<TypeEnv["types"], Forwarded>();

function forwardedIn(env: TypeEnv): Forwarded {
  let forwarded = forwardedByTable.get(env.types);
  if (!forwarded) {
    const lookup = (name: string) => env.types.get(name);
    forwarded = {
      through: forwardedParams(lookup, "through"),
      stop: forwardedParams(lookup, "stop"),
    };
    forwardedByTable.set(env.types, forwarded);
  }
  return forwarded;
}

function newWalk(env: TypeEnv): Walk {
  return { env, origins: new WeakMap(), forwarded: forwardedIn(env) };
}

/**
 * `t` with each generic at its head that hands a parameter straight back
 * taken in one step, as `unaliasType` takes it: `D0(D0(Text))` with
 * `type D0(T) = T` is `Text`. Only the head moves — an argument written
 * inside a container or a record stays as written — so `unaliasType` of the
 * result is `unaliasType` of `t`, and so is `unaliasType` of anything that
 * substitutes it for a parameter: the head is the first thing normalisation
 * would have done with it. It is the `through` reading, so it looks through
 * `nominal` too, and `nominalDecl`, which stops there, cannot take its answer.
 */
export function forwardedHead(t: TypeExpr, env: TypeEnv): TypeExpr {
  // Asked of every argument a walk substitutes: one that is no application
  // is answered before the table is looked up.
  if (t.kind !== "TypeApp") return t;
  const forwarded = forwardedIn(env);
  let cur: TypeExpr = t;
  for (;;) {
    if (cur.kind !== "TypeApp") return cur;
    const def = env.types.get(cur.name);
    if (!def) return cur;
    const arg = forwardedArg(cur, def, forwarded.through);
    if (!arg) return cur;
    cur = arg;
  }
}

/**
 * The body of `def` as applied by `t`, with each argument recorded under the
 * guard in force where it was written.
 *
 * Substituted rather than read through a parameter map: a type parameter may
 * be spelled the same as a top-level definition, and an unsubstituted `TypeRef`
 * would resolve against that global instead — so `type Alias(Cents) = Cents`
 * would answer `Cents` for every argument.
 *
 * The record survives substitution only because `substituteType` hands back
 * the very node it was given for a parameter (`sub.get(name)`), not a copy of
 * it. A copy there would drop the guard without any error, and every argument
 * would be read under the body's guard again.
 */
function applyDef(
  t: TypeExpr & { kind: "TypeRef" | "TypeApp" },
  def: TypeDef,
  seen: ReadonlySet<string>,
  origins: ArgOrigins,
): TypeExpr {
  if (t.kind === "TypeRef") return def.body;
  const sub = new Map<string, TypeExpr>();
  def.params.forEach((p, i) => {
    const arg = t.args[i];
    if (!arg) return;
    const copy = { ...arg };
    origins.set(copy, origins.get(arg) ?? seen);
    sub.set(p, copy);
  });
  return substituteType(def.body, sub);
}

/**
 * The argument `t` hands straight back, when its generic is one that does,
 * or `null` when the body has to be expanded.
 *
 * Taking it in one step is what keeps normalisation linear: expanding
 * `type D1(T) = D0(D0(T))` walks `D0` twice, and a chain where each level
 * applies the one below twice or three times doubles or triples the walk at
 * every level. The argument is read where it was written, exactly as the
 * expansion would have reached it.
 */
function forwardedArg(
  t: TypeExpr & { kind: "TypeRef" | "TypeApp" },
  def: TypeDef,
  forwarded: (def: TypeDef) => number | null,
): TypeExpr | null {
  if (t.kind !== "TypeApp") return null;
  const i = forwarded(def);
  return i === null ? null : (t.args[i] ?? null);
}

function unaliasFrom(t: TypeExpr | null, outer: ReadonlySet<string>, walk: Walk): TypeExpr | null {
  if (!t) return null;
  const seen = walk.origins.get(t) ?? outer;
  if (t.kind === "TypeRef" || t.kind === "TypeApp") {
    const def = walk.env.types.get(t.name);
    // A stdlib constructor (`List`, `Option`, …) has no definition to expand
    // into and is already in its comparison form; any other name with no
    // definition is opaque, applied or not.
    if (!def) {
      return t.kind === "TypeApp" && !isKnownTypeName(t.name, walk.env)
        ? { kind: "TypeRef", name: t.name, pos: t.pos }
        : t;
    }
    // Re-entry answers `null` for both: the chain has closed on itself, so
    // there is no normal form to compare against. Returning the application
    // instead handed comparisons a type that looks usable and is not —
    // `type A = Alias(B)` / `type B = Alias(A)` reported `Expected A but got
    // Int` on the literal, blaming the value for a type with no body. E0009 is
    // what names that.
    if (seen.has(t.name)) return null;
    const arg = forwardedArg(t, def, walk.forwarded.through);
    if (arg) return unaliasFrom(arg, seen, walk);
    return unaliasFrom(applyDef(t, def, seen, walk.origins), new Set([...seen, t.name]), walk);
  }
  if (t.kind === "TypeNominal" || t.kind === "TypeRefinement")
    return unaliasFrom(t.inner, seen, walk);
  return t;
}

/**
 * Strip the `where` wrappers off a type expression. The first refinement on a
 * `nominal` is folded into the node as a property; a second one wraps it, so a
 * question about a body's shape has to look past however many are there.
 */
function bareType(t: TypeExpr): TypeExpr {
  let cur = t;
  while (cur.kind === "TypeRefinement") cur = cur.inner;
  return cur;
}

/**
 * The declaration that makes `t` nominal — its name, and the type it was
 * declared over — or `null` when nothing does.
 *
 * Nominality belongs to the definition, not to the type expression: two
 * definitions with byte-identical bodies are still two types, and an alias to
 * one of them is the same type. So the answer is the definition whose body *is*
 * a `nominal`, reached by following aliases and refinements — `type Money =
 * Cents` answers `Cents`, and `type P = Int where positive` answers nothing,
 * because a refinement on its own confers no identity.
 *
 * A `nominal` written inline at a use site (`slot x : nominal Int = 0`) has no
 * definition to name and so no identity; it is compared structurally.
 *
 * Deliberately independent of `unaliasType`, which strips `nominal` and must
 * keep doing so: method resolution, `elementType` and the arithmetic checks all
 * need to see the base.
 */
function nominalDecl(
  t: TypeExpr | null,
  outer: ReadonlySet<string>,
  walk: Walk,
): { readonly name: string; readonly over: TypeExpr } | null {
  if (!t) return null;
  const seen = walk.origins.get(t) ?? outer;
  if (t.kind === "TypeRefinement") return nominalDecl(t.inner, seen, walk);
  if (t.kind !== "TypeRef" && t.kind !== "TypeApp") return null;
  if (seen.has(t.name)) return null;
  const def = walk.env.types.get(t.name);
  if (!def) return null;
  // A generic that hands its argument back without passing a `nominal` on
  // the way declares nothing itself, so the answer is the argument's.
  const arg = forwardedArg(t, def, walk.forwarded.stop);
  if (arg) return nominalDecl(arg, seen, walk);
  const body = applyDef(t, def, seen, walk.origins);
  const bare = bareType(body);
  if (bare.kind === "TypeNominal") return { name: t.name, over: bare.inner };
  return nominalDecl(body, new Set([...seen, t.name]), walk);
}

/**
 * Every nominal name `t` is declared under, outermost first, ending where the
 * declarations reach a type that is not itself nominal.
 *
 * `type Deep = nominal Cents` over `type Cents = nominal Int` answers
 * `["Deep", "Cents"]`, which is what lets a `Deep` be accepted where a `Cents`
 * is required — it was declared as one — while a `Cents` is still refused
 * where a `Deep` is required.
 */
function nominalChain(t: TypeExpr | null, env: TypeEnv): string[] {
  const chain: string[] = [];
  // One walk for the whole chain: the `over` of a generic nominal is its
  // substituted argument, and only this walk's record knows where that
  // argument was written. A fresh record per step read `Tag(Tag(Cents))`'s
  // inner `Tag` under the chain's guard, met `Tag` again, and stopped at
  // `["Tag"]`.
  const walk = newWalk(env);
  let cur = t;
  for (;;) {
    // Re-entering a name means the declarations loop; the chain so far is the
    // whole finite answer, and reporting the loop belongs elsewhere. The
    // chain's names are the guard only for an `over` written in a definition's
    // own body: an `over` that is a substituted argument is read under the
    // guard it was written under, which `nominalDecl` looks up in the record
    // before falling back to this one.
    const decl = nominalDecl(cur, new Set(chain), walk);
    if (decl === null) return chain;
    chain.push(decl.name);
    // A chain this long is a generic nominal applied inside itself at every
    // level of a chain of definitions, which multiplies the names at each
    // level. Past the limit it answers "cannot tell", the one-sided reading,
    // rather than walk every one of them.
    if (chain.length > NOMINAL_CHAIN_LIMIT) return [];
    cur = decl.over;
  }
}

/** How many nominal names `nominalChain` lists before it stops and answers "cannot tell". */
const NOMINAL_CHAIN_LIMIT = 4096;

/**
 * May two types be compared — `==`, `!=`, `<`, … — as far as nominal identity
 * goes?
 *
 * `relate`'s nominal rule read symmetrically. A comparison has no destination,
 * so there is no side to call the actual one: either type standing in for the
 * other is enough. So a type carrying no nominal name of its own compares with
 * any nominal over it (`cents == 0`, `postId == ""`, exactly as they assign),
 * a `Deep` declared `nominal Cents` compares with a `Cents` in both
 * directions, and two declarations over one base are what this refuses.
 *
 * This is the whole of what nominality says about an operator. Whether the
 * operator is defined on the base the two share is a separate question, asked
 * by the ordering families in `typecheck.ts`, and `==` stays total over every
 * shape that carries no nominal name.
 */
export function nominallyComparable(a: TypeExpr | null, b: TypeExpr | null, env: TypeEnv): boolean {
  const [an, bn] = [nominalChain(a, env), nominalChain(b, env)];
  const [aName, bName] = [an[0], bn[0]];
  // One side with no identity of its own meets the other's, as in an
  // assignment — which is also how an undecidable type stays silent here.
  if (aName === undefined || bName === undefined) return true;
  return an.includes(bName) || bn.includes(aName);
}

export function paramSubstitution(params: string[], args: TypeExpr[]): Map<string, TypeExpr> {
  const sub = new Map<string, TypeExpr>();
  params.forEach((p, i) => {
    const a = args[i];
    if (a) sub.set(p, a);
  });
  return sub;
}

export function substituteType(t: TypeExpr, sub: ReadonlyMap<string, TypeExpr>): TypeExpr {
  switch (t.kind) {
    case "TypeRef":
      return sub.get(t.name) ?? t;
    case "TypeApp":
      return { ...t, args: t.args.map((a) => substituteType(a, sub)) };
    case "TypeRecord":
      return {
        ...t,
        fields: t.fields.map((f) => ({ ...f, type: substituteType(f.type, sub) })),
      };
    case "TypeUnion":
      return {
        ...t,
        variants: t.variants.map((v) => ({
          ...v,
          payloads: v.payloads.map((p) => substituteType(p, sub)),
        })),
      };
    case "TypeNominal":
    case "TypeRefinement":
      return { ...t, inner: substituteType(t.inner, sub) };
    default:
      return t;
  }
}

export function recordFieldType(
  rec: TypeExpr & { kind: "TypeRecord" },
  name: string,
): TypeExpr | null {
  return rec.fields.find((f) => f.name === name)?.type ?? null;
}

/**
 * What one iteration of `for x in <t>` binds, or `null` when the container's
 * element type is not decidable. `Map` is deliberately absent: what iterating a
 * Map yields is not settled anywhere in the spec, and a wrong answer here binds
 * the loop variable to a type it does not have.
 */
export function elementType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  const u = unaliasType(t, env);
  if (u?.kind !== "TypeApp") return null;
  if (u.name === "List" || u.name === "Set") return u.args[0] ?? null;
  return null;
}

/**
 * Numeric widening is the one implicit conversion in the language: an `Int`
 * flows into a `Float` position, never the reverse. Without it every `Float`
 * slot would have to be initialised `0.0`, and `slider(min=0)` on a `Float`
 * slot would be an error.
 */
const widensTo: ReadonlyMap<string, ReadonlySet<string>> = new Map([["Int", new Set(["Float"])]]);

/**
 * Is a value of type `actual` accepted where `declared` is required?
 *
 * `true` also means "cannot tell". Callers must not read a `true` as proof the
 * program is well typed.
 */
export function assignable(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
): boolean {
  return relate(actual, declared, env, new Set());
}

/**
 * Comparisons already in progress, keyed by the pair being compared as written.
 *
 * `unaliasType`'s own guard covers one normalisation and nothing more: the
 * moment `relate` descends into a field or a payload it starts a fresh one, so
 * `type Node = {value: Int, next: Node}` recurses until the stack gives out.
 * A comment tree, a file tree and a nested todo are all this shape.
 *
 * Re-entering a pair means the answer depends on itself, and the only
 * terminating answer that keeps the relation one-sided is "yes" — refusing
 * would reject every recursive type. That is the standard co-inductive reading
 * of structural equality on regular trees, and it is sound here because the
 * finite part of the comparison has already been checked on the way down.
 */
function relate(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
  seen: ReadonlySet<string>,
): boolean {
  if (actual !== null && declared !== null) {
    // Keyed on the types *as written*, not on the unaliased forms: a recursive
    // type is finite as written (the cycle is a `TypeRef` back to its own
    // name), so the key set is finite and this terminates. Keying on the
    // expansion would not.
    const key = `${typeToString(actual)} ⇒ ${typeToString(declared)}`;
    if (seen.has(key)) return true;
    seen = new Set([...seen, key]);
  }
  // Asked before the wrappers come off, because taking them off is exactly what
  // loses the answer.
  //
  // A value is refused only when it carries a nominal declaration of its own
  // and the required name is nowhere in that declaration's chain. So a type
  // with no nominal name meets any nominal over it — which is what lets
  // `slot c : Cents = 1` and `c := c + 1` stand — and a `Deep` declared
  // `nominal Cents` is accepted where a `Cents` is required, while a `Cents` is
  // still refused where a `Deep` is.
  //
  // A name that does match falls through rather than returning early, so
  // `Box(Int)` and `Box(Text)` are still told apart by their arguments.
  const required = nominalDecl(declared, new Set(), newWalk(env))?.name;
  if (required !== undefined) {
    const declaredAs = nominalChain(actual, env);
    if (declaredAs.length > 0 && !declaredAs.includes(required)) return false;
  }
  const a = unaliasType(actual, env);
  const d = unaliasType(declared, env);
  if (a === null || d === null) return true;
  // An unresolved name on either side (misspelling, type parameter) tells us
  // nothing, so it accepts and is accepted.
  if (a.kind === "TypeRef" || d.kind === "TypeRef") return true;

  switch (d.kind) {
    case "TypePrim":
      if (a.kind !== "TypePrim") return false;
      if (a.name === d.name) return true;
      return widensTo.get(a.name)?.has(d.name) ?? false;

    case "TypeApp": {
      if (a.kind !== "TypeApp" || a.name !== d.name) return false;
      // A constructor applied to the wrong number of arguments is E0210's
      // business; comparing the pairs we have keeps this from piling on.
      return d.args.every((darg, i) => {
        const aarg = a.args[i];
        return aarg === undefined || relate(aarg, darg, env, seen);
      });
    }

    case "TypeRecord": {
      if (a.kind !== "TypeRecord") return false;
      for (const f of d.fields) {
        const got = recordFieldType(a, f.name);
        if (got === null) return false;
        if (!relate(got, f.type, env, seen)) return false;
      }
      return a.fields.every((f) => recordFieldType(d, f.name) !== null);
    }

    case "TypeUnion": {
      if (a.kind !== "TypeUnion") return false;
      return a.variants.every((av) => {
        const dv = d.variants.find((v) => v.name === av.name);
        if (!dv || dv.payloads.length !== av.payloads.length) return false;
        return av.payloads.every((p, i) => relate(p, dv.payloads[i] ?? null, env, seen));
      });
    }

    default:
      return true;
  }
}

/**
 * Best-effort textual rendering of a type for diagnostic messages.
 *
 * The output is not only read by humans: `symbols.ts#variantTagsOf` parses the
 * type name back out of the E0209 message to offer variant suggestions, so
 * these shapes are a contract, not a formatting preference.
 */
export function typeToString(t: TypeExpr): string {
  switch (t.kind) {
    case "TypePrim":
      return t.name;
    case "TypeRef":
      return t.name;
    case "TypeApp":
      return t.args.length === 0 ? t.name : `${t.name}(${t.args.map(typeToString).join(", ")})`;
    case "TypeRecord":
      return `{${t.fields.map((f) => `${f.name}: ${typeToString(f.type)}`).join(", ")}}`;
    case "TypeUnion":
      return t.variants
        .map((v) =>
          v.payloads.length === 0
            ? v.name
            : `${v.name}(${v.payloads.map(typeToString).join(", ")})`,
        )
        .join(" | ");
    case "TypeNominal":
      return `nominal ${typeToString(t.inner)}`;
    case "TypeRefinement":
      return typeToString(t.inner);
  }
}

/** Does `name` name a type at all — a definition, or a built-in constructor? */
export function isKnownTypeName(name: string, env: TypeEnv): boolean {
  return env.types.has(name) || BUILTIN_TYPE_CONSTRUCTORS.has(name);
}

/**
 * How many type arguments `name` takes, or `null` when the question does not
 * apply — `Tuple` is variadic, and a name that is not a type has no arity.
 * Callers resolve the name with `isKnownTypeName` first, so by the time this
 * answers `null` the only reading left is "variadic".
 */
export function constructorArity(name: string, env: TypeEnv): number | null {
  const def = env.types.get(name);
  if (def) return def.params.length;
  return BUILTIN_TYPE_CONSTRUCTORS.get(name) ?? null;
}
