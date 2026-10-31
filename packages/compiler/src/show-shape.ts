import { type TypeEnv, typeToString, unaliasType } from "./assignable.ts";
import type { KeyKind, ShowShape, TypeExpr } from "./ast.ts";
import { keyRepresentation } from "./key-representation.ts";

/** `0` when `t` has no Map, Set or Tuple outside a variant: the value alone then says how to show it. */
export function showShapeOf(t: TypeExpr | null, env: TypeEnv): ShowShape {
  return shapeOf(t, env, new Map());
}

function definedName(t: TypeExpr, env: TypeEnv): string | null {
  return (t.kind === "TypeRef" || t.kind === "TypeApp") && env.types.has(t.name)
    ? typeToString(t)
    : null;
}

function hasShape(t: TypeExpr | null, env: TypeEnv, seen: Set<string>): boolean {
  if (!t) return false;
  const name = definedName(t, env);
  if (name !== null) {
    if (seen.has(name)) return false;
    seen.add(name);
  }
  const u = unaliasType(t, env);
  if (u?.kind === "TypeRecord") return u.fields.some((f) => hasShape(f.type, env, seen));
  if (u?.kind !== "TypeApp") return false;
  if (u.name === "List") return hasShape(u.args[0] ?? null, env, seen);
  return u.name === "Map" || u.name === "Set" || u.name === "Tuple";
}

// A definition's shape is registered under its name before its parts are walked, so a type
// that contains itself gets a shape that refers back to itself.
function shapeOf(t: TypeExpr | null, env: TypeEnv, building: Map<string, ShowShape>): ShowShape {
  if (!t || !hasShape(t, env, new Set())) return 0;
  const name = definedName(t, env);
  const known = name === null ? undefined : building.get(name);
  if (known !== undefined) return known;
  const u = unaliasType(t, env);
  if (u?.kind === "TypeRecord") {
    const fields: Record<string, ShowShape> = {};
    if (name !== null) building.set(name, fields);
    for (const f of u.fields) {
      const s = shapeOf(f.type, env, building);
      if (s !== 0) fields[f.name] = s;
    }
    return fields;
  }
  if (u?.kind !== "TypeApp") return 0;
  // Filled in place below, so a part that names this definition again holds the finished shape.
  const parts: (ShowShape | KeyKind | string)[] = [];
  const shape = parts as unknown as ShowShape;
  if (name !== null) building.set(name, shape);
  const arg = (i: number): ShowShape => shapeOf(u.args[i] ?? null, env, building);
  // A `Text` key, and one the walk cannot place, stays the string it is stored as.
  const key = (): KeyKind | 0 => {
    const kind = keyRepresentation(u.args[0] ?? null, env);
    return kind === "text" || kind === null ? 0 : kind;
  };
  if (u.name === "List") parts.push("l", arg(0));
  else if (u.name === "Tuple") parts.push("t", ...u.args.map((_, i) => arg(i)));
  else if (u.name === "Map") parts.push("m", key(), arg(0), arg(1));
  else if (u.name === "Set") parts.push("s", key(), arg(0));
  return shape;
}
