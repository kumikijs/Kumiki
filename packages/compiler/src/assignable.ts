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

/** The place an index into the unaliased `base` names — a List's element, a Map's value — or `null` (a Set has members, not places). */
export function indexPlaceType(base: TypeExpr | null): TypeExpr | null {
  if (base?.kind !== "TypeApp") return null;
  if (base.name === "List") return base.args[0] ?? null;
  if (base.name === "Map") return base.args[1] ?? null;
  return null;
}

export function elementType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  const u = unaliasType(t, env);
  if (u?.kind !== "TypeApp") return null;
  if (u.name === "List" || u.name === "Set") return u.args[0] ?? null;
  return null;
}

/**
 * A tag a value was written as, with the types of its payloads: `Ok`, `Some([1, 2])`. Kept on the
 * `Option` / `Result` the checker reads such a value as when a union of the program's own
 * declares the same tag, since then the value is that union's too (language.md, Built-in Generic
 * Types).
 */
export type WrittenVariant = { readonly tag: string; readonly payloads: readonly TypeExpr[] };

const writtenAs = new WeakMap<TypeExpr, readonly WrittenVariant[]>();

/** `t`, read also as the variants it may have been written as. */
export function asWritten(t: TypeExpr, variants: readonly WrittenVariant[]): TypeExpr {
  writtenAs.set(t, variants);
  return t;
}

/** The variants a value of type `t` may have been written as, when it lands in a union. */
export function writtenVariants(t: TypeExpr | null): readonly WrittenVariant[] | undefined {
  return t === null ? undefined : writtenAs.get(t);
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
    reentries: new Map(),
  });
}

// `pairs` is keyed on the types as written, which is finite for a regular recursive type. A generic
// that nests its argument deeper at each level (`G` against an identically shaped `H`, with
// `type G(T) = Leaf(T) | Node(G(List(T)))`) writes a new pair at every level, so for a pair of heads
// that applies such a generic, `unfolded` keeps the size it was last entered at on the way down. A
// re-entry that grew counts against its pair of heads in `reentries`, which the whole comparison
// shares, and past `REENTRY_LIMIT` such a re-entry answers yes, as a repeated pair does.
type Path = {
  readonly pairs: ReadonlySet<string>;
  readonly unfolded: ReadonlyMap<string, number>;
  readonly reentries: Map<string, number>;
};

/**
 * How many re-entries that grew one pair of heads may make in one comparison; every re-entry past
 * that answers yes.
 */
export const REENTRY_LIMIT = 64;

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
  const heads = nestingHeads(actual, declared, env);
  if (heads !== null) {
    const size = typeSize(actual) + typeSize(declared);
    const last = path.unfolded.get(heads);
    if (last !== undefined && size > last) {
      const spent = (path.reentries.get(heads) ?? 0) + 1;
      path.reentries.set(heads, spent);
      if (spent > REENTRY_LIMIT) return true;
    }
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
      // A short `List` / `Map` / generic is already E0210, so a missing argument agrees below;
      // `Tuple` takes any number of arguments, and a different number is a different type.
      if (d.name === "Tuple" && a.args.length !== d.args.length) return false;
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
      const written = writtenAs.get(a);
      if (written) return written.every((w) => unionHolds(d, w, env, path));
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

// A variant holds a value written as its tag when it has as many payloads and each one written fits.
// A payload left to a generic's parameter fits anything while the parameter is undecided (`?`); an
// applied type such as `Box(Int)` has substituted it before the value is checked.
function unionHolds(
  union: TypeExpr & { kind: "TypeUnion" },
  written: WrittenVariant,
  env: TypeEnv,
  path: Path,
): boolean {
  const v = union.variants.find((x) => x.name === written.tag);
  if (!v || v.payloads.length !== written.payloads.length) return false;
  return written.payloads.every((p, i) => relate(p, v.payloads[i] ?? null, env, path));
}

/**
 * How comparing two applications of one generic reads an argument, as unfolding both bodies would:
 * `unread` when no comparison reaches the parameter (it is not named, or only as an argument the
 * applied generic, its own recursion included, leaves `unread`); `normal` where the parameter is
 * itself a `nominal`'s inner type, compared past every nominal the argument has; `written`, nominal
 * identity included, everywhere else. The strictest reading wins.
 */
type ArgumentUse = "unread" | "normal" | "written";

const STRICTNESS: Readonly<Record<ArgumentUse, number>> = { unread: 0, normal: 1, written: 2 };

/** The strictest of `reads`, or `unread` when there are none. */
const strictest = (reads: readonly ArgumentUse[]): ArgumentUse =>
  reads.reduce<ArgumentUse>((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a), "unread");

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

// A generic applied to the wrong number of arguments is E0210's, and is unfolded like any other.
function sharedGeneric(
  actual: TypeExpr & { kind: "TypeApp" },
  declared: TypeExpr & { kind: "TypeApp" },
  env: TypeEnv,
): readonly ArgumentUse[] | null {
  if (actual.name !== declared.name || !isGenericApplication(actual, env)) return null;
  const uses = argumentUsesIn(env).get(actual.name);
  if (!uses || actual.args.length !== uses.length || declared.args.length !== uses.length) {
    return null;
  }
  return uses;
}

function isGenericApplication(t: TypeExpr | null, env: TypeEnv): boolean {
  return t?.kind === "TypeApp" && (env.types.get(t.name)?.params.length ?? 0) > 0;
}

/** The key of the two heads, when either side applies a generic that nests its argument deeper. */
function nestingHeads(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
): string | null {
  const nesting = nestingGenericsIn(env);
  const nests = (t: TypeExpr | null) => t?.kind === "TypeApp" && nesting.has(t.name);
  return nests(actual) || nests(declared) ? `${headName(actual)} ⇒ ${headName(declared)}` : null;
}

// A structural type is keyed on its kind, after a `#` that no type name can start with.
function headName(t: TypeExpr | null): string {
  if (t === null) return "";
  return t.kind === "TypeRef" || t.kind === "TypeApp" ? t.name : `#${t.kind}`;
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

/** `build`, run once for each symbol table and kept for as long as the table lives. */
function perTable<T>(build: (env: TypeEnv) => T): (env: TypeEnv) => T {
  const built = new WeakMap<TypeEnv["types"], T>();
  return (env) => {
    const kept = built.get(env.types);
    if (kept !== undefined) return kept;
    const value = build(env);
    built.set(env.types, value);
    return value;
  };
}

// The least fixed point, passing over every generic until nothing changes: every answer starts
// `unread` and is only ever joined with a stricter one, which keeps a parameter that is only handed
// back into the recursion `unread`, as the co-inductive guard answers when bodies unfold.
const argumentUsesIn = perTable((env): ReadonlyMap<string, readonly ArgumentUse[]> => {
  const { stop, through } = forwardedIn(env);
  const generics = [...env.types.values()].filter((d) => d.params.length > 0);
  const uses = new Map<string, readonly ArgumentUse[]>(
    generics.map((d) => [d.name, d.params.map((): ArgumentUse => "unread")]),
  );

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

  let changed = true;
  while (changed) {
    changed = false;
    for (const d of generics) {
      const prev = uses.get(d.name) ?? [];
      const next = classify(d).map((u, i) => strictest([u, prev[i] ?? "unread"]));
      if (next.every((u, i) => u === prev[i])) continue;
      uses.set(d.name, next);
      changed = true;
    }
  }
  return uses;
});

/**
 * The generics that nest an argument deeper at each level: following where each parameter is
 * handed, through the generics its body applies, leads back to a parameter it started from, at
 * least once inside a larger argument (`Node(G(List(T)))`). Comparing any other generics reaches
 * finitely many pairs as written, which `pairs` ends.
 */
export const nestingGenericsIn = perTable((env): ReadonlySet<string> => {
  const generics = [...env.types.values()].filter((d) => d.params.length > 0);
  // One node for each parameter of each generic, numbered on from the generic's first.
  const first = new Map<string, number>();
  const owner: string[] = [];
  for (const d of generics) {
    first.set(d.name, owner.length);
    owner.push(...d.params.map(() => d.name));
  }
  const ahead: number[][] = owner.map(() => []);
  const behind: number[][] = owner.map(() => []);
  const deeper: [from: number, to: number][] = [];
  for (const d of generics) {
    const base = first.get(d.name) ?? 0;
    eachPart(d.body, (t) => {
      if (t.kind !== "TypeApp" || d.params.includes(t.name)) return;
      const callee = env.types.get(t.name);
      const to = first.get(t.name);
      if (!callee || to === undefined) return;
      t.args.slice(0, callee.params.length).forEach((arg, j) => {
        const named = new Set<string>();
        eachPart(arg, (x) => {
          if (x.kind === "TypeRef") named.add(x.name);
        });
        d.params.forEach((p, i) => {
          if (!named.has(p)) return;
          ahead[base + i]?.push(to + j);
          behind[to + j]?.push(base + i);
          if (arg.kind !== "TypeRef") deeper.push([base + i, to + j]);
        });
      });
    });
  }

  // Kosaraju: the order the nodes finish in along `ahead`, then one component per tree along
  // `behind`, latest finished first. An edge that nests deeper inside one component is on a cycle.
  const finished: number[] = [];
  const seen = new Set<number>();
  for (let root = 0; root < owner.length; root++) {
    if (seen.has(root)) continue;
    seen.add(root);
    const stack = [{ node: root, edge: 0 }];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const next = ahead[top.node]?.[top.edge++];
      if (next === undefined) {
        finished.push(top.node);
        stack.pop();
      } else if (!seen.has(next)) {
        seen.add(next);
        stack.push({ node: next, edge: 0 });
      }
    }
  }
  const component = new Map<number, number>();
  for (const root of finished.reverse()) {
    if (component.has(root)) continue;
    component.set(root, root);
    const todo = [root];
    for (let n = todo.pop(); n !== undefined; n = todo.pop()) {
      for (const m of behind[n] ?? []) {
        if (component.has(m)) continue;
        component.set(m, root);
        todo.push(m);
      }
    }
  }
  const cyclic = new Set(
    deeper.filter(([u, v]) => component.get(u) === component.get(v)).map(([u]) => component.get(u)),
  );
  return new Set(owner.filter((_, n) => cyclic.has(component.get(n))));
});

/** Calls `visit` on `t` and on every type written inside it. */
function eachPart(t: TypeExpr, visit: (part: TypeExpr) => void): void {
  visit(t);
  switch (t.kind) {
    case "TypeApp":
      for (const a of t.args) eachPart(a, visit);
      break;
    case "TypeRecord":
      for (const f of t.fields) eachPart(f.type, visit);
      break;
    case "TypeUnion":
      for (const v of t.variants) for (const x of v.payloads) eachPart(x, visit);
      break;
    case "TypeNominal":
    case "TypeRefinement":
      eachPart(t.inner, visit);
      break;
    default:
      break;
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
