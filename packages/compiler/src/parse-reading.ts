import { isKnownTypeName, type TypeEnv, unaliasType } from "./assignable.ts";
import type { Pos, TypeExpr } from "./ast.ts";
import { isPrimTypeName } from "./stdlib-types.ts";

export function qualifierType(name: string, pos: Pos, env: TypeEnv): TypeExpr | null {
  if (isPrimTypeName(name)) return { kind: "TypePrim", name, pos };
  const def = env.types.get(name);
  return def !== undefined && def.params.length === 0 ? { kind: "TypeRef", name, pos } : null;
}

export type ParseReading = "Int" | "Float" | "Time" | "Bool" | "Text" | "Bytes";

const READINGS: ReadonlySet<string> = new Set<ParseReading>([
  "Int",
  "Float",
  "Time",
  "Bool",
  "Text",
  "Bytes",
]);

export const PARSE_READINGS_PHRASE = ((names: readonly string[]) =>
  `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`)([...READINGS]);

function isParseReading(name: string): name is ParseReading {
  return READINGS.has(name);
}

export type ParseQualifier =
  | { readonly kind: "reading"; readonly reading: ParseReading }
  | { readonly kind: "none" }
  | { readonly kind: "unresolved" };

export function parseQualifier(qualifier: string, env: TypeEnv): ParseQualifier {
  if (!isPrimTypeName(qualifier) && !isKnownTypeName(qualifier, env)) {
    return { kind: "unresolved" };
  }
  const named = qualifierType(qualifier, { line: 0, col: 0 }, env);
  if (named === null) return { kind: "none" };
  const base = unaliasType(named, env);
  if (base === null) return { kind: "unresolved" };
  if (base.kind === "TypeRef" && !env.types.has(base.name)) return { kind: "unresolved" };
  return base.kind === "TypePrim" && isParseReading(base.name)
    ? { kind: "reading", reading: base.name }
    : { kind: "none" };
}
