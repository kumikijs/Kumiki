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
