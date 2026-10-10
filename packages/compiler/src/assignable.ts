import type { Pos, TypeDef, TypeExpr } from "./ast.ts";
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
    if (!def) return t;
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
  return relate(actual, declared, env, {
    pairs: new Set(),
    unfolded: new Map(),
    budget: { reentries: REENTRY_LIMIT },
  });
}

// `pairs` is keyed on the types as written, which is finite for a regular recursive type; a generic
// whose recursive occurrence grows its argument (`type G(T) = Leaf(T) | Node(G(List(T)))`) writes a
// new pair at every level, so `unfolded` remembers each pair of heads unfolded on the way down with
// its size, and a re-entry that grew is charged to one budget shared by the whole comparison.
type Path = {
  readonly pairs: ReadonlySet<string>;
  readonly unfolded: ReadonlyMap<string, number>;
  readonly budget: { reentries: number };
};

const REENTRY_LIMIT = 64;

function relate(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
  path: Path,
): boolean {
  if (actual !== null && declared !== null) {
    const key = `${typeToString(actual)} ⇒ ${typeToString(declared)}`;
    if (path.pairs.has(key)) return true;
    path = { ...path, pairs: new Set([...path.pairs, key]) };
  }
  const required = nominalDecl(declared, new Set(), newWalk(env))?.name;
  if (required !== undefined) {
    const declaredAs = nominalChain(actual, env);
    if (declaredAs.length > 0 && !declaredAs.includes(required)) return false;
  }
  if (actual?.kind === "TypeApp" && declared?.kind === "TypeApp") {
    const uses = sharedGeneric(actual, declared, env);
    if (uses) {
      const [as, ds] = [actual.args, declared.args];
      return uses.every((use, i) => relateArgument(use, as[i] ?? null, ds[i] ?? null, env, path));
    }
  }
  if (isGenericApplication(actual, env) || isGenericApplication(declared, env)) {
    const heads = `${headName(actual)} ⇒ ${headName(declared)}`;
    const size = typeSize(actual) + typeSize(declared);
    const last = path.unfolded.get(heads);
    if (last !== undefined && size > last && --path.budget.reentries < 0) return true;
    path = { ...path, unfolded: new Map(path.unfolded).set(heads, size) };
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
        return aarg === undefined || relate(aarg, darg, env, path);
      });
    }

    case "TypeRecord": {
      if (a.kind !== "TypeRecord") return false;
      for (const f of d.fields) {
        const got = recordFieldType(a, f.name);
        if (got === null) return false;
        if (!relate(got, f.type, env, path)) return false;
      }
      return a.fields.every((f) => recordFieldType(d, f.name) !== null);
    }

    case "TypeUnion": {
      if (a.kind !== "TypeUnion") return false;
      return a.variants.every((av) => {
        const dv = d.variants.find((v) => v.name === av.name);
        if (!dv || dv.payloads.length !== av.payloads.length) return false;
        return av.payloads.every((p, i) => relate(p, dv.payloads[i] ?? null, env, path));
      });
    }

    default:
      return true;
  }
}

/**
 * What comparing two applications of one generic reads of an argument, as unfolding both bodies
 * would: `unread` when the parameter is only handed back to its own position in the recursion or
 * to a generic that ignores it; `normal` under a `nominal`, which normalising strips; `written`,
 * nominal identity included, everywhere else.
 */
type ArgumentUse = "unread" | "normal" | "written";

const STRICTNESS: Readonly<Record<ArgumentUse, number>> = { unread: 0, normal: 1, written: 2 };

const stricter = (a: ArgumentUse, b: ArgumentUse): ArgumentUse =>
  STRICTNESS[a] >= STRICTNESS[b] ? a : b;

function relateArgument(
  use: ArgumentUse,
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
  path: Path,
): boolean {
  switch (use) {
    case "unread":
      return true;
    case "normal":
      return relate(unaliasType(actual, env), unaliasType(declared, env), env, path);
    case "written":
      return relate(actual, declared, env, path);
  }
}

const argumentUsesByTable = new WeakMap<
  TypeEnv["types"],
  ReadonlyMap<string, readonly ArgumentUse[]>
>();

// A generic applied to the wrong number of arguments is E0210's, and is unfolded like any other.
function sharedGeneric(
  actual: TypeExpr & { kind: "TypeApp" },
  declared: TypeExpr & { kind: "TypeApp" },
  env: TypeEnv,
): readonly ArgumentUse[] | null {
  if (actual.name !== declared.name || !isGenericApplication(actual, env)) return null;
  let table = argumentUsesByTable.get(env.types);
  if (!table) {
    table = argumentUses(env);
    argumentUsesByTable.set(env.types, table);
  }
  const uses = table.get(actual.name);
  if (!uses || actual.args.length !== uses.length || declared.args.length !== uses.length) {
    return null;
  }
  return uses;
}

function isGenericApplication(t: TypeExpr | null, env: TypeEnv): boolean {
  return t?.kind === "TypeApp" && (env.types.get(t.name)?.params.length ?? 0) > 0;
}

function headName(t: TypeExpr | null): string {
  if (t === null) return "";
  return t.kind === "TypeRef" || t.kind === "TypeApp" ? t.name : t.kind;
}

function typeSize(t: TypeExpr | null): number {
  if (t === null) return 0;
  switch (t.kind) {
    case "TypePrim":
    case "TypeRef":
      return 1;
    case "TypeApp":
      return t.args.reduce((n, a) => n + typeSize(a), 1);
    case "TypeRecord":
      return t.fields.reduce((n, f) => n + typeSize(f.type), 1);
    case "TypeUnion":
      return t.variants.reduce((n, v) => v.payloads.reduce((m, p) => m + typeSize(p), n), 1);
    case "TypeNominal":
    case "TypeRefinement":
      return 1 + typeSize(t.inner);
  }
}

// The least fixed point: every answer starts `unread` and only rises, which keeps a parameter that is
// only handed back into the recursion `unread`, as the co-inductive guard answers when bodies unfold.
function argumentUses(env: TypeEnv): ReadonlyMap<string, readonly ArgumentUse[]> {
  const { stop, through } = forwardedIn(env);
  const generics = [...env.types.values()].filter((d) => d.params.length > 0);
  const uses = new Map<string, readonly ArgumentUse[]>(
    generics.map((d) => [d.name, d.params.map((): ArgumentUse => "unread")]),
  );
  const strictest = (reads: ArgumentUse[]): ArgumentUse => reads.reduce(stricter, "unread");

  const readOf = (t: TypeExpr, p: string, as: ArgumentUse): ArgumentUse => {
    switch (t.kind) {
      case "TypeRef":
        return t.name === p ? as : "unread";
      case "TypePrim":
        return "unread";
      case "TypeRecord":
        return strictest(t.fields.map((f) => readOf(f.type, p, "written")));
      case "TypeUnion":
        return strictest(t.variants.flatMap((v) => v.payloads.map((x) => readOf(x, p, "written"))));
      // An inline `nominal` declares no name, so no nominal check reads it.
      case "TypeNominal":
        return readOf(t.inner, p, "normal");
      case "TypeRefinement":
        return readOf(t.inner, p, as);
      case "TypeApp": {
        const def = env.types.get(t.name);
        if (!def) return strictest(t.args.map((a) => readOf(a, p, "written")));
        const own = uses.get(def.name);
        if (!own) return "unread";
        const handed = as === "normal" ? through(def) : null;
        if (handed !== null) {
          const arg = t.args[handed];
          return arg ? readOf(arg, p, "normal") : "unread";
        }
        return strictest(
          t.args.map((a, i) => {
            const use = own[i] ?? "unread";
            return use === "unread" ? "unread" : readOf(a, p, use);
          }),
        );
      }
    }
  };

  // The nominal check reads an argument a generic hands straight back with no `nominal` on the way.
  const classify = (d: TypeDef): readonly ArgumentUse[] => {
    const handed = stop(d);
    if (handed !== null) return d.params.map((_, i) => (i === handed ? "written" : "unread"));
    return d.params.map((p) => readOf(d.body, p, "normal"));
  };

  const readers = new Map<string, TypeDef[]>();
  for (const d of generics) {
    for (const name of appliedNames(d.body)) {
      if (!uses.has(name)) continue;
      const list = readers.get(name);
      if (list) list.push(d);
      else readers.set(name, [d]);
    }
  }
  const pending = [...generics];
  const queued = new Set(generics.map((d) => d.name));
  for (let d = pending.pop(); d !== undefined; d = pending.pop()) {
    queued.delete(d.name);
    const next = classify(d);
    const prev = uses.get(d.name);
    if (prev && next.every((u, i) => u === prev[i])) continue;
    uses.set(d.name, next);
    for (const r of readers.get(d.name) ?? []) {
      if (queued.has(r.name)) continue;
      queued.add(r.name);
      pending.push(r);
    }
  }
  return uses;
}

function appliedNames(t: TypeExpr, out: Set<string> = new Set()): Set<string> {
  switch (t.kind) {
    case "TypeApp":
      out.add(t.name);
      for (const a of t.args) appliedNames(a, out);
      break;
    case "TypeRecord":
      for (const f of t.fields) appliedNames(f.type, out);
      break;
    case "TypeUnion":
      for (const v of t.variants) for (const x of v.payloads) appliedNames(x, out);
      break;
    case "TypeNominal":
    case "TypeRefinement":
      appliedNames(t.inner, out);
      break;
    default:
      break;
  }
  return out;
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
