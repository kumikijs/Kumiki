import { type TypeEnv, typeSize, typeToString, unaliasType } from "./assignable.ts";
import type { KeyKind, ShowShape, TypeExpr } from "./ast.ts";
import { keyRepresentation } from "./key-representation.ts";

/** `0` when `t` has no Map, Set or Tuple outside a variant: the value alone then says how to show it. */
export function showShapeOf(t: TypeExpr | null, env: TypeEnv): ShowShape {
  return shapeOf(t, env, new Map(), new Map());
}

/** The generics a walk is inside, each by its head, with the instance it was entered at. */
type Path = ReadonlyMap<string, { readonly name: string; readonly size: number }>;

function definedName(t: TypeExpr, env: TypeEnv): string | null {
  return (t.kind === "TypeRef" || t.kind === "TypeApp") && env.types.has(t.name)
    ? typeToString(t)
    : null;
}

// A generic whose recursion grows its argument (`type N(T) = {kids: List(N(List(T)))}`) is a new
// type at every level, where one nested in itself (`Box(Box(Int))`) shrinks: the walk stops at a
// repeat of a head it is inside that is no smaller than where it entered that head.
function grows(t: TypeExpr, name: string, path: Path): boolean {
  const outer = t.kind === "TypeApp" ? path.get(t.name) : undefined;
  return outer !== undefined && outer.name !== name && typeSize(t) >= outer.size;
}

function inside(t: TypeExpr, name: string | null, path: Path): Path {
  if (t.kind !== "TypeApp" || name === null) return path;
  return new Map(path).set(t.name, { name, size: typeSize(t) });
}

function hasShape(t: TypeExpr | null, env: TypeEnv, seen: Set<string>, path: Path): boolean {
  if (!t) return false;
  const name = definedName(t, env);
  if (name !== null) {
    if (seen.has(name) || grows(t, name, path)) return false;
    seen.add(name);
  }
  const inner = inside(t, name, path);
  const u = unaliasType(t, env);
  if (u?.kind === "TypeRecord") return u.fields.some((f) => hasShape(f.type, env, seen, inner));
  if (u?.kind !== "TypeApp") return false;
  if (u.name === "List") return hasShape(u.args[0] ?? null, env, seen, inner);
  return u.name === "Map" || u.name === "Set" || u.name === "Tuple";
}

// A definition's shape is registered under its name before its parts are walked, so a type
// that contains itself gets a shape that refers back to itself.
function shapeOf(
  t: TypeExpr | null,
  env: TypeEnv,
  building: Map<string, ShowShape>,
  path: Path,
): ShowShape {
  if (!t || !hasShape(t, env, new Set(), path)) return 0;
  const name = definedName(t, env);
  const known = name === null ? undefined : building.get(name);
  if (known !== undefined) return known;
  const register = (shape: ShowShape): void => {
    if (name !== null) building.set(name, shape);
  };
  const inner = inside(t, name, path);
  const u = unaliasType(t, env);
  if (u?.kind === "TypeRecord") {
    // No prototype, so a field named `__proto__` is a field like any other.
    const fields: Record<string, ShowShape> = Object.create(null);
    register(fields);
    for (const f of u.fields) {
      const s = shapeOf(f.type, env, building, inner);
      if (s !== 0) fields[f.name] = s;
    }
    return fields;
  }
  if (u?.kind !== "TypeApp") return 0;
  const arg = (i: number): ShowShape => shapeOf(u.args[i] ?? null, env, building, inner);
  // A `Text` key, and one the walk cannot place, stays the string it is stored as.
  const key = (): KeyKind | 0 => {
    const kind = keyRepresentation(u.args[0] ?? null, env);
    return kind === "text" || kind === null ? 0 : kind;
  };
  // Each is registered before its slots are filled, so a slot that names this definition
  // again holds the finished shape.
  switch (u.name) {
    case "List": {
      const shape: ["l", ShowShape] = ["l", 0];
      register(shape);
      shape[1] = arg(0);
      return shape;
    }
    case "Tuple": {
      const shape: ["t", ...ShowShape[]] = ["t"];
      register(shape);
      shape.push(...u.args.map((_, i) => arg(i)));
      return shape;
    }
    case "Map": {
      const shape: ["m", KeyKind | 0, ShowShape, ShowShape] = ["m", key(), 0, 0];
      register(shape);
      shape[2] = arg(0);
      shape[3] = arg(1);
      return shape;
    }
    case "Set": {
      const shape: ["s", KeyKind | 0, ShowShape] = ["s", key(), 0];
      register(shape);
      shape[2] = arg(0);
      return shape;
    }
    default:
      return 0;
  }
}
