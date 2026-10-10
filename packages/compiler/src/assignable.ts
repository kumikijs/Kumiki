import type { Pos, Refinement, TypeDef, TypeExpr } from "./ast.ts";
import { forwardedParams, type NominalReading } from "./def-graph.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/** The slice of the checker's symbol table the type relation needs. */
export type TypeEnv = { types: ReadonlyMap<string, TypeDef> };

export const unknownType = (pos: Pos): TypeExpr => ({ kind: "TypeRef", name: "?", pos });

/** True when nothing can be concluded about `t` — an unresolved name, or absent. */
export function isOpaque(t: TypeExpr | null, env: TypeEnv): boolean {
  const u = unaliasType(t, env);
  return u === null || u.kind === "TypeRef";
}

export function unaliasType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  return followChain(t, newWalk(env), null);
}

/** Every refinement a type carries, base outward: the order a failed predicate is named in. */
export function refinementsOf(t: TypeExpr, env: TypeEnv): Refinement[] {
  const outermostFirst: Refinement[] = [];
  followChain(t, newWalk(env), outermostFirst);
  return outermostFirst.reverse();
}

type ArgOrigins = WeakMap<TypeExpr, ReadonlySet<string>>;

type Walk = {
  readonly env: TypeEnv;
  readonly origins: ArgOrigins;
  readonly facts: TableFacts;
};

type Forwarded = Readonly<Record<NominalReading, (def: TypeDef) => number | null>>;

// An answer read from a table holds as long as the table: a check and a build each make one.
type TableFacts = {
  readonly forwarded: Forwarded;
  // Each name's normal form: a chain is followed once, not once per `where` judged over it.
  readonly normal: Map<string, TypeExpr | null>;
};

const factsByTable = new WeakMap<TypeEnv["types"], TableFacts>();

function factsOf(env: TypeEnv): TableFacts {
  let facts = factsByTable.get(env.types);
  if (!facts) {
    const lookup = (name: string) => env.types.get(name);
    facts = {
      forwarded: {
        through: forwardedParams(lookup, "through"),
        stop: forwardedParams(lookup, "stop"),
      },
      normal: new Map(),
    };
    factsByTable.set(env.types, facts);
  }
  return facts;
}

function newWalk(env: TypeEnv): Walk {
  return { env, origins: new WeakMap(), facts: factsOf(env) };
}

// Copied only once shared, so a walk down a chain of aliases stays linear in its length.
class Guard {
  private names: ReadonlySet<string>;
  private own: Set<string> | null = null;

  constructor(names: ReadonlySet<string>) {
    this.names = names;
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  /** The names in force, handed to the caller to keep: the next entry copies them first. */
  share(): ReadonlySet<string> {
    this.own = null;
    return this.names;
  }

  readAs(t: TypeExpr, origins: ArgOrigins): void {
    const recorded = origins.get(t);
    if (recorded === undefined) return;
    this.names = recorded;
    this.own = null;
  }

  enter(name: string): void {
    if (this.own === null) {
      this.own = new Set(this.names);
      this.names = this.own;
    }
    this.own.add(name);
  }
}

export function forwardedHead(t: TypeExpr, env: TypeEnv): TypeExpr {
  // Asked of every argument a walk substitutes: one that is no application
  // is answered before the table is looked up.
  if (t.kind !== "TypeApp") return t;
  const { forwarded } = factsOf(env);
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
  guard: Guard,
  origins: ArgOrigins,
): TypeExpr {
  if (t.kind === "TypeRef") return def.body;
  const seen = guard.share();
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

// A loop rather than a recursion: nothing bounds how many definitions a chain passes through, so
// recursing once per step would overflow the stack on a chain the parser accepts.
function followChain(
  t: TypeExpr | null,
  walk: Walk,
  predicates: Refinement[] | null,
): TypeExpr | null {
  const { normal } = walk.facts;
  const named: string[] = [];
  const settle = (form: TypeExpr | null): TypeExpr | null => {
    for (const name of named) normal.set(name, form);
    return form;
  };
  const guard = new Guard(new Set());
  let cur = t;
  for (;;) {
    if (!cur) return settle(null);
    guard.readAs(cur, walk.origins);
    if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
      if (predicates && cur.refinement) predicates.push(cur.refinement);
      cur = cur.inner;
      continue;
    }
    if (cur.kind !== "TypeRef" && cur.kind !== "TypeApp") return settle(cur);
    const def = walk.env.types.get(cur.name);
    if (!def) return settle(cur);
    if (guard.has(cur.name)) return settle(null);
    if (!predicates) {
      if (cur.kind === "TypeRef") {
        if (normal.has(cur.name)) return settle(normal.get(cur.name) ?? null);
        named.push(cur.name);
      }
      const arg = forwardedArg(cur, def, walk.facts.forwarded.through);
      if (arg) {
        cur = arg;
        continue;
      }
    }
    const name = cur.name;
    cur = applyDef(cur, def, guard, walk.origins);
    guard.enter(name);
  }
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
  // A loop for the reason `followChain` is one.
  const guard = new Guard(outer);
  let cur = t;
  for (;;) {
    if (!cur) return null;
    guard.readAs(cur, walk.origins);
    if (cur.kind === "TypeRefinement") {
      cur = cur.inner;
      continue;
    }
    if (cur.kind !== "TypeRef" && cur.kind !== "TypeApp") return null;
    if (guard.has(cur.name)) return null;
    const def = walk.env.types.get(cur.name);
    if (!def) return null;
    const arg = forwardedArg(cur, def, walk.facts.forwarded.stop);
    if (arg) {
      cur = arg;
      continue;
    }
    const body = applyDef(cur, def, guard, walk.origins);
    const bare = bareType(body);
    if (bare.kind === "TypeNominal") return { name: cur.name, over: bare.inner };
    guard.enter(cur.name);
    cur = body;
  }
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
