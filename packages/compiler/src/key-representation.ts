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
