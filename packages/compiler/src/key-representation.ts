import { type TypeEnv, unaliasType } from "./assignable.ts";
import type { KeyKind, TypeExpr } from "./ast.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

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

export type UnkeyedPart = {
  readonly part: "Float" | "File" | "Set";
  /** The type is that part itself, rather than holding it somewhere inside. */
  readonly whole: boolean;
};

// The runtime keys a value by `entryKey`: a primitive's `String`, or a structured value's JSON
// with sorted fields. That is `==` but for three types. `NaN` is one key yet not `==` to itself,
// and JSON writes `NaN` and both infinities as `null`. A `File` keeps its state outside its own
// fields, so every `File` is `{}`. A `Set`'s key depends on how it was built.
// A part the checker cannot decide is not judged, and a name met again inside itself is not
// entered again on that path, which is what ends the walk.
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
