import { perTable, type TypeEnv, typeToString } from "./assignable.ts";
import { assertNever, type Pos, type TypeExpr } from "./ast.ts";
import { expandNamed, GENERIC_SELF_NESTING_LIMIT, typeKey } from "./refinement-positions.ts";
import { BUILTIN_TYPE_CONSTRUCTORS, type PrimName } from "./stdlib-types.ts";
import type { KumikiError } from "./typecheck/context.ts";

/** A type that is a Decoder, or holds one somewhere inside. */
export type HeldDecoder = {
  /** The type is a Decoder itself, rather than holding one. */
  readonly whole: boolean;
};

/** A Map key or a Set element type that holds a Decoder, and the container it keys. */
export type DecoderKey = HeldDecoder & {
  readonly container: "Map" | "Set";
  readonly key: TypeExpr;
};

// A named type is walked through what it stands for, and a name in `opaque` (a type parameter of
// the definition being read) or one that resolves to nothing is not judged. Each instantiation is
// entered once in the whole walk, since what it holds does not depend on where it is met, and a
// generic is entered at most the nesting limit's number of times, so a type applying itself to a
// growing argument, along one branch or several, ends: what lies past that is not judged. The walk
// keeps its own stack, as a chain of definitions thousands of `where`s deep is a type too.
function search<R>(
  t: TypeExpr,
  env: TypeEnv,
  opaque: ReadonlySet<string>,
  found: (t: TypeExpr, whole: boolean) => R | undefined,
  parts: (t: TypeApp) => readonly TypeExpr[] = (x) => x.args,
): R | undefined {
  const entered = new Set<string>();
  const entries = new Map<string, number>();
  const todo: { t: TypeExpr; whole: boolean }[] = [{ t, whole: true }];
  // Pushed last to first, so the parts are met in the order they are written.
  const push = (ts: readonly TypeExpr[]): void => {
    for (let i = ts.length - 1; i >= 0; i--) {
      const part = ts[i];
      if (part) todo.push({ t: part, whole: false });
    }
  };
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    const { t, whole } = next;
    if ((t.kind === "TypeRef" || t.kind === "TypeApp") && !opaque.has(t.name)) {
      const body = expandNamed(t, env);
      if (body) {
        const at = typeKey(t);
        const times = entries.get(t.name) ?? 0;
        if (entered.has(at) || times >= GENERIC_SELF_NESTING_LIMIT) continue;
        entered.add(at);
        entries.set(t.name, times + 1);
        todo.push({ t: body, whole });
        continue;
      }
    }
    const hit = found(t, whole);
    if (hit !== undefined) return hit;
    switch (t.kind) {
      case "TypePrim":
      case "TypeRef":
        break;
      case "TypeApp":
        if (BUILTIN_TYPE_CONSTRUCTORS.has(t.name)) push(parts(t));
        break;
      case "TypeRecord":
        push(t.fields.map((f) => f.type));
        break;
      case "TypeUnion":
        push(t.variants.flatMap((v) => v.payloads));
        break;
      case "TypeNominal":
      case "TypeRefinement":
        todo.push({ t: t.inner, whole });
        break;
      default:
        assertNever(t);
    }
  }
  return undefined;
}

type TypeApp = TypeExpr & { kind: "TypeApp" };

/** The names each node of `t` writes, a name in `skip` aside, and whether it writes the primitive. */
function namesIn(
  t: TypeExpr,
  skip: ReadonlySet<string>,
): { names: Set<string>; primitive: boolean } {
  const names = new Set<string>();
  let primitive = false;
  const todo = [t];
  for (let x = todo.pop(); x !== undefined; x = todo.pop()) {
    switch (x.kind) {
      case "TypePrim":
        if (x.name === "Decoder") primitive = true;
        break;
      case "TypeRef":
        if (!skip.has(x.name)) names.add(x.name);
        break;
      case "TypeApp":
        if (!skip.has(x.name)) names.add(x.name);
        todo.push(...x.args);
        break;
      case "TypeRecord":
        for (const f of x.fields) todo.push(f.type);
        break;
      case "TypeUnion":
        for (const v of x.variants) todo.push(...v.payloads);
        break;
      case "TypeNominal":
      case "TypeRefinement":
        todo.push(x.inner);
        break;
      default:
        assertNever(x);
    }
  }
  return { names, primitive };
}

// The definitions whose body writes the primitive, or names one that does at any depth, its own
// type parameters aside: the standard library's `Decoder` first. A type that writes none of them
// holds no Decoder, whatever its arguments, so most types are answered without being walked.
const decoderWriters = perTable((env): ReadonlySet<string> => {
  const writers = new Set<string>();
  const namedBy = new Map<string, string[]>();
  for (const def of env.types.values()) {
    const { names, primitive } = namesIn(def.body, new Set(def.params));
    if (primitive) writers.add(def.name);
    for (const n of names) {
      const by = namedBy.get(n);
      if (by) by.push(def.name);
      else namedBy.set(n, [def.name]);
    }
  }
  const todo = [...writers];
  for (let w = todo.pop(); w !== undefined; w = todo.pop()) {
    for (const by of namedBy.get(w) ?? []) {
      if (writers.has(by)) continue;
      writers.add(by);
      todo.push(by);
    }
  }
  return writers;
});

function mayHoldDecoder(t: TypeExpr, env: TypeEnv, opaque: ReadonlySet<string>): boolean {
  const { names, primitive } = namesIn(t, opaque);
  const writers = decoderWriters(env);
  return primitive || [...names].some((n) => writers.has(n));
}

/** Whether a value of type `t` is or holds a Decoder, in a Map key and a Set element too. */
export function heldDecoder(
  t: TypeExpr | null,
  env: TypeEnv,
  opaque: ReadonlySet<string> = new Set(),
): HeldDecoder | undefined {
  if (t === null || !mayHoldDecoder(t, env, opaque)) return undefined;
  return search(t, env, opaque, (x, whole) =>
    x.kind === "TypePrim" && x.name === "Decoder" ? { whole } : undefined,
  );
}

/** Why `t`, which is or holds a Decoder, has no `==`: the end of the message each refusal gives. */
export function noEquality(t: TypeExpr, held: HeldDecoder): string {
  return held.whole
    ? "a Decoder has no equality"
    : `${typeToString(t)} holds a Decoder, which has no equality`;
}

/** The first Map key or Set element type inside `t`, `t` included, that holds a Decoder. */
export function decoderKey(
  t: TypeExpr,
  env: TypeEnv,
  opaque: ReadonlySet<string> = new Set(),
): DecoderKey | undefined {
  if (!mayHoldDecoder(t, env, opaque)) return undefined;
  return search(t, env, opaque, (x) => {
    if (x.kind !== "TypeApp" || (x.name !== "Map" && x.name !== "Set")) return undefined;
    const key = x.args[0];
    const held = key && heldDecoder(key, env, opaque);
    return key && held ? { container: x.name, key, whole: held.whole } : undefined;
  });
}

function decoderKeyMessage({ container, key, whole }: DecoderKey): string {
  const role = container === "Map" ? "Map key" : "Set element";
  return whole
    ? `a Decoder cannot be a ${role}`
    : `a ${role} of type ${typeToString(key)} cannot hold a Decoder`;
}

/** E0204 at `pos` for `found`, a key that is or holds a Decoder, under the generic `applied` if one keys by it. */
export function decoderKeyError(found: DecoderKey, pos: Pos, applied?: TypeExpr): KumikiError {
  const message = decoderKeyMessage(found);
  return {
    code: "E0204",
    kind: "effect-id-misuse",
    message: `${applied ? `${typeToString(applied)}: ${message}` : `${message.charAt(0).toUpperCase()}${message.slice(1)}`} — it is an opaque handle`,
    pos,
  };
}

// A JSON body holds data, and a Decoder is a check the compiler builds, so no body decodes into one.
const UNDECODABLE: ReadonlySet<PrimName> = new Set<PrimName>(["Decoder"]);

/** A handle no JSON body decodes into, which a type is or holds. */
type Undecodable = HeldDecoder & { readonly handle: PrimName };

// A Map key or a Set element holding a Decoder is refused wherever it is written, so the walks
// for an undecodable handle pass over it.
function unkeyed(x: TypeApp, env: TypeEnv): readonly TypeExpr[] {
  const key = x.args[0];
  return (x.name === "Map" || x.name === "Set") && key && heldDecoder(key, env)
    ? x.args.slice(1)
    : x.args;
}

/** The first handle no JSON body decodes into that `t` is or holds. */
function undecodable(t: TypeExpr, env: TypeEnv): Undecodable | undefined {
  return search(
    t,
    env,
    new Set(),
    (x, whole) =>
      x.kind === "TypePrim" && UNDECODABLE.has(x.name) ? { whole, handle: x.name } : undefined,
    (x) => unkeyed(x, env),
  );
}

const article = (name: string): string => (/^[AEIOU]/.test(name) ? "an" : "a");

/** E0204 at `t`, which is or holds a handle no JSON body decodes into. */
function undecodableError(t: TypeExpr, { whole, handle }: Undecodable): KumikiError {
  const a = article(handle);
  const what = whole
    ? `${a.charAt(0).toUpperCase()}${a.slice(1)} ${handle} cannot`
    : `${typeToString(t)} holds ${a} ${handle}, which cannot`;
  return {
    code: "E0204",
    kind: "effect-id-misuse",
    message: `${what} be decoded from JSON — it is an opaque handle`,
    pos: t.pos,
  };
}

/**
 * E0204 at each part of `t`, the type a `Decoder.Json` decodes, that is or holds a handle no JSON
 * body decodes into: the builtin constructors and records it writes are looked through, so each
 * mistake is reported once, where it is written.
 */
export function undecodableErrors(t: TypeExpr, env: TypeEnv): KumikiError[] {
  const errors: KumikiError[] = [];
  const todo = [t];
  // Pushed last to first, so the parts are reported in the order they are written.
  const push = (ts: readonly TypeExpr[]): void => {
    for (let i = ts.length - 1; i >= 0; i--) {
      const part = ts[i];
      if (part) todo.push(part);
    }
  };
  for (let x = todo.pop(); x !== undefined; x = todo.pop()) {
    if (x.kind === "TypeRecord") push(x.fields.map((f) => f.type));
    else if (x.kind === "TypeApp" && BUILTIN_TYPE_CONSTRUCTORS.has(x.name)) push(unkeyed(x, env));
    else {
      const found = undecodable(x, env);
      if (found) errors.push(undecodableError(x, found));
    }
  }
  return errors;
}
