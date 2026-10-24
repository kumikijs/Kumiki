import type { Pos, TypeDef, TypeExpr } from "./ast.ts";
import { forwardedParams, type NominalReading } from "./def-graph.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/** The slice of the checker's symbol table the type relation needs. */
export type TypeEnv = { types: ReadonlyMap<string, TypeDef> };

export const unknownType = (pos: Pos): TypeExpr => ({ kind: "TypeRef", name: "?", pos });

/** True when nothing can be concluded about `t` — an unresolved name, bare or applied, or absent. */
export function isOpaque(t: TypeExpr | null, env: TypeEnv): boolean {
  const u = unaliasType(t, env);
  return u === null || u.kind === "TypeRef";
}

export function unaliasType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  return unaliasFrom(t, new Set(), newWalk(env));
}

type ArgOrigins = WeakMap<TypeExpr, ReadonlySet<string>>;

type Walk = {
  readonly env: TypeEnv;
  readonly origins: ArgOrigins;
  readonly forwarded: Forwarded;
};

type Forwarded = Readonly<Record<NominalReading, (def: TypeDef) => number | null>>;

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
    // Arguments to a name that is no type describe nothing to compare against.
    if (!def) {
      return t.kind === "TypeApp" && !isKnownTypeName(t.name, walk.env)
        ? { kind: "TypeRef", name: t.name, pos: t.pos }
        : t;
    }
    if (seen.has(t.name)) return null;
    const arg = forwardedArg(t, def, walk.forwarded.through);
    if (arg) return unaliasFrom(arg, seen, walk);
    return unaliasFrom(applyDef(t, def, seen, walk.origins), new Set([...seen, t.name]), walk);
  }
  if (t.kind === "TypeNominal" || t.kind === "TypeRefinement")
    return unaliasFrom(t.inner, seen, walk);
  return t;
}

function bareType(t: TypeExpr): TypeExpr {
  let cur = t;
  while (cur.kind === "TypeRefinement") cur = cur.inner;
  return cur;
}

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
  const arg = forwardedArg(t, def, walk.forwarded.stop);
  if (arg) return nominalDecl(arg, seen, walk);
  const body = applyDef(t, def, seen, walk.origins);
  const bare = bareType(body);
  if (bare.kind === "TypeNominal") return { name: t.name, over: bare.inner };
  return nominalDecl(body, new Set([...seen, t.name]), walk);
}

function nominalChain(t: TypeExpr | null, env: TypeEnv): string[] {
  const chain: string[] = [];
  const walk = newWalk(env);
  let cur = t;
  for (;;) {
    const decl = nominalDecl(cur, new Set(chain), walk);
    if (decl === null) return chain;
    chain.push(decl.name);
    if (chain.length > NOMINAL_CHAIN_LIMIT) return [];
    cur = decl.over;
  }
}

/** How many nominal names `nominalChain` lists before it stops and answers "cannot tell". */
const NOMINAL_CHAIN_LIMIT = 4096;

export function nominallyComparable(a: TypeExpr | null, b: TypeExpr | null, env: TypeEnv): boolean {
  const [an, bn] = [nominalChain(a, env), nominalChain(b, env)];
  const [aName, bName] = [an[0], bn[0]];
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

export function elementType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  const u = unaliasType(t, env);
  if (u?.kind !== "TypeApp") return null;
  if (u.name === "List" || u.name === "Set") return u.args[0] ?? null;
  return null;
}

const widensTo: ReadonlyMap<string, ReadonlySet<string>> = new Map([["Int", new Set(["Float"])]]);

export function assignable(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
): boolean {
  return relate(actual, declared, env, new Set());
}

function relate(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
  seen: ReadonlySet<string>,
): boolean {
  if (actual !== null && declared !== null) {
    const key = `${typeToString(actual)} ⇒ ${typeToString(declared)}`;
    if (seen.has(key)) return true;
    seen = new Set([...seen, key]);
  }
  const required = nominalDecl(declared, new Set(), newWalk(env))?.name;
  if (required !== undefined) {
    const declaredAs = nominalChain(actual, env);
    if (declaredAs.length > 0 && !declaredAs.includes(required)) return false;
  }
  const a = unaliasType(actual, env);
  const d = unaliasType(declared, env);
  if (a === null || d === null) return true;
  if (a.kind === "TypeRef" || d.kind === "TypeRef") return true;

  switch (d.kind) {
    case "TypePrim":
      if (a.kind !== "TypePrim") return false;
      if (a.name === d.name) return true;
      return widensTo.get(a.name)?.has(d.name) ?? false;

    case "TypeApp": {
      if (a.kind !== "TypeApp" || a.name !== d.name) return false;
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

export function constructorArity(name: string, env: TypeEnv): number | null {
  const def = env.types.get(name);
  if (def) return def.params.length;
  return BUILTIN_TYPE_CONSTRUCTORS.get(name) ?? null;
}
