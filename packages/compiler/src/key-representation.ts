import { type TypeEnv, unaliasType } from "./assignable.ts";
import type { KeyKind, TypeExpr } from "./ast.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/**
 * How a `Set` member or `Map` key of type `key` reads back from the object key
 * the runtime stores it under (`entryKey` in the runtime's core.ts): a string
 * for a `Text`, a `KeyKind` for a type the runtime restores, `null` for
 * anything else — a type parameter, or a primitive such as `Bytes` whose
 * stored string is not a value of the type at all.
 *
 * Followed through aliases, `nominal` and `where`, since what matters is how
 * the key is represented: a `TaskId = nominal Int` key is written from a
 * number and reads back as one. `Time` is a number at runtime. A record, a
 * union and a builtin container (a tuple, an `Option`, …) are objects at
 * runtime, stored under their JSON and read back as `"value"`.
 *
 * The one answer for every reader: the checker's key-reader annotation, the
 * `$1` a `Map.filter` predicate is bound to, and the slot gate's walk over a
 * Set's members and a Map's keys.
 */
export function keyRepresentation(key: TypeExpr | null, env: TypeEnv): KeyKind | "text" | null {
  const t = unaliasType(key, env);
  if (t?.kind === "TypeRecord" || t?.kind === "TypeUnion") return "value";
  if (t?.kind === "TypeApp") return BUILTIN_TYPE_CONSTRUCTORS.has(t.name) ? "value" : null;
  if (t?.kind !== "TypePrim") return null;
  switch (t.name) {
    case "Text":
      return "text";
    case "Int":
    case "Float":
    case "Time":
      return "number";
    case "Bool":
      return "bool";
    default:
      return null;
  }
}

/** A part of a type whose values the runtime's key does not tell apart by `==`. */
export type UnkeyedPart = {
  readonly part: "Float" | "File" | "Set";
  /** The type is that part itself, rather than holding it somewhere inside. */
  readonly whole: boolean;
};

/**
 * What keeps the runtime's key (`entryKey` in the runtime's core.ts) from
 * telling the values of `key` apart by `==` (language.md §1.9.4), or `null`
 * when nothing does. The key is a primitive's `String`, or a structured
 * value's JSON with each object's fields in sorted order, so two values are one
 * key exactly when they are `==` — but for three types:
 *
 * - `Float`: `NaN` is one key and is not `==` to itself, and JSON writes
 *   `NaN`, `Infinity` and `-Infinity` all as `null`, so inside a record, a
 *   tuple, a List or a variant they are one key.
 * - `File`: a platform object holding its state outside its own fields, so
 *   every `File` is the JSON `{}`, while `==` holds only of a File and itself.
 * - `Set`: stored as its members' keys or, where the checker could not decide
 *   its type, as the list it was built from, so its `==` — and its key —
 *   depend on how it was built (stdlib.md §2.2.2).
 *
 * A type holds one when a record field, a variant payload or a builtin
 * container's argument does, followed through aliases, generics, `nominal`
 * and `where`. A part the checker cannot decide — a type parameter, a name
 * that names nothing — is not judged: that silence is a missing answer rather
 * than a wrong one. A name met again inside itself is not entered again on
 * that path, which is what ends the walk: a recursive type adds nothing new
 * there, and a generic that applies itself to another argument is left
 * unjudged there, as an undecided part is.
 *
 * The rule `latest-per-key` keys are held to (language.md §1.5.2): a request
 * runs under its key, so two requests whose keys are not `==` must not abort
 * each other.
 */
export function unkeyedPart(key: TypeExpr | null, env: TypeEnv): UnkeyedPart | null {
  const walk = (t: TypeExpr, whole: boolean, path: ReadonlySet<string>): UnkeyedPart | null => {
    let inside = path;
    if ((t.kind === "TypeRef" || t.kind === "TypeApp") && env.types.has(t.name)) {
      if (path.has(t.name)) return null;
      inside = new Set(path).add(t.name);
    }
    const parts = (ts: readonly TypeExpr[]): UnkeyedPart | null => {
      for (const x of ts) {
        const found = walk(x, false, inside);
        if (found) return found;
      }
      return null;
    };
    const u = unaliasType(t, env);
    switch (u?.kind) {
      case undefined:
      case "TypeRef":
        return null;
      case "TypePrim":
        return u.name === "Float" || u.name === "File" ? { part: u.name, whole } : null;
      case "TypeApp":
        if (u.name === "Set") return { part: "Set", whole };
        return BUILTIN_TYPE_CONSTRUCTORS.has(u.name) ? parts(u.args) : null;
      case "TypeRecord":
        return parts(u.fields.map((f) => f.type));
      case "TypeUnion":
        return parts(u.variants.flatMap((v) => v.payloads));
      case "TypeNominal":
      case "TypeRefinement":
        return walk(u.inner, whole, inside);
    }
  };
  return key ? walk(key, true, new Set()) : null;
}
