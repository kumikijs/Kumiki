import { assignable, isOpaque, recordFieldType, unaliasType, unknownType } from "../assignable.ts";
import type { Expr, Pos, TypeExpr } from "../ast.ts";
import { isQualifierName } from "../builtin-calls.ts";
import { qualifierType } from "../parse-reading.ts";
import { hasMember, isOwnMember } from "../stdlib-members.ts";
import { getOrResultType, unwrappedType } from "./against.ts";
import type { Ctx, SymbolTable } from "./context.ts";
import { binOpResult, letInScope } from "./expr.ts";
import { memberReceivers } from "./members.ts";
import { armScope } from "./patterns.ts";
import { RESERVED_SLOT_NAMES } from "./slot.ts";

export const KNOWN_TOKEN_GROUPS: ReadonlySet<string> = new Set([
  "colors",
  "spacing",
  "radius",
  "shadow",
  "typography",
  "breakpoints",
]);

export const PRIM_FIELDS: Record<string, Record<string, "Text" | "Int">> = {
  File: { name: "Text", size: "Int", type: "Text" },
};

function primFieldType(primName: string, field: string, pos: Pos): TypeExpr | null {
  const name = PRIM_FIELDS[primName]?.[field];
  if (!name) return null;
  return { kind: "TypePrim", name, pos };
}

export const prim = (name: PrimName, pos: Pos): TypeExpr => ({ kind: "TypePrim", name, pos });

export const container = (name: string, args: TypeExpr[], pos: Pos): TypeExpr => ({
  kind: "TypeApp",
  name,
  args,
  pos,
});

type PrimName = Extract<TypeExpr, { kind: "TypePrim" }>["name"];

/** True when `t` is a number — the operand family arithmetic is defined on. */
export function isNumeric(t: TypeExpr | null, sym: SymbolTable): boolean {
  const u = unaliasType(t, sym);
  return u?.kind === "TypePrim" && (u.name === "Int" || u.name === "Float");
}

/** True when `t` resolved to a concrete shape, so a mismatch against it is real. */
export function isKnown(t: TypeExpr | null, sym: SymbolTable): boolean {
  return t !== null && !isOpaque(t, sym);
}

/** How a resolved type is named in a diagnostic. */
export function typeName(t: TypeExpr | null, sym: SymbolTable): string {
  const u = unaliasType(t, sym);
  if (!u) return "unknown";
  if (u.kind === "TypePrim") return u.name;
  if (u.kind === "TypeApp") return u.name;
  if (u.kind === "TypeRecord") return "record";
  return "unknown";
}

export function isPrimNamed(t: TypeExpr | null, sym: SymbolTable, name: PrimName): boolean {
  const u = unaliasType(t, sym);
  return u?.kind === "TypePrim" && u.name === name;
}

const METHOD_RESULT: ReadonlyMap<string, PrimName> = new Map<string, PrimName>([
  ["show", "Text"],
  ["to-int", "Int"],
  ["to-float", "Float"],
  ["floor", "Int"],
  ["ceil", "Int"],
  ["round", "Int"],
  ["sqrt", "Float"],
  ["log", "Float"],
  ["exp", "Float"],
]);

const CALL_RESULT: ReadonlyMap<string, PrimName> = new Map<string, PrimName>([
  ["now", "Time"],
  ["random", "Float"],
  ["fmt", "Text"],
  ["file-url", "Text"],
  ["prefers-dark", "Bool"],
  ["EffectId.none", "EffectId"],
]);

export function arithmeticResult(
  op: string,
  lt: TypeExpr | null,
  rt: TypeExpr | null,
  sym: SymbolTable,
  pos: Pos,
): TypeExpr {
  if (op === "/") return prim("Float", pos);
  const float = isPrimNamed(lt, sym, "Float") || isPrimNamed(rt, sym, "Float");
  return prim(float ? "Float" : "Int", pos);
}

export function freshResultType(qualifier: string, pos: Pos, sym: SymbolTable): TypeExpr | null {
  const named = qualifierType(qualifier, pos, sym);
  if (named === null) return null;
  return assignable(prim("Text", pos), named, sym) ? named : null;
}

function receiverMemberResult(
  recv: TypeExpr | null,
  member: string,
  argCount: number,
  sym: SymbolTable,
  pos: Pos,
): TypeExpr | null {
  const t = unaliasType(recv, sym);
  if (!t) return null;
  const receivers = memberReceivers(recv, t, sym);
  if (receivers === null || !receivers.some((r) => hasMember(r, member))) return null;

  const int = () => prim("Int", pos);
  const bool = () => prim("Bool", pos);
  const text = () => prim("Text", pos);
  const list = (of: TypeExpr) => container("List", [of], pos);
  const option = (of: TypeExpr) => container("Option", [of], pos);

  if (t.kind === "TypePrim" && t.name === "Text") {
    if (!isOwnMember("Text", member)) return null;
    switch (member) {
      case "length":
        return int();
      case "is-empty":
      case "starts-with":
      case "ends-with":
      case "contains":
        return bool();
      case "upper":
      case "lower":
      case "trim":
      case "replace":
      case "slice":
        return text();
      case "split":
        return list(text());
      case "parse-int":
        return option(int());
      case "parse-float":
        return option(prim("Float", pos));
      default:
        return unlisted(member);
    }
  }

  if (t.kind !== "TypeApp") return null;

  const a0 = t.args[0] ?? null;
  const a1 = t.args[1] ?? null;

  switch (t.name) {
    case "Map":
      if (!isOwnMember("Map", member)) return null;
      switch (member) {
        case "size":
          return int();
        case "is-empty":
        case "has":
          return bool();
        case "keys":
          return a0 && list(a0);
        case "values":
          return a1 && list(a1);
        case "entries":
          return a0 && a1 ? list(container("Tuple", [a0, a1], pos)) : null;
        case "get":
          return argCount === 1 && a1 ? option(a1) : null;
        case "get-or":
          return getOrResultType(t, argCount);
        case "insert":
        case "remove":
        case "update":
        case "merge":
        case "filter":
          return t;
        case "map":
          return null;
        default:
          return unlisted(member);
      }
    case "Set":
      if (!isOwnMember("Set", member)) return null;
      switch (member) {
        case "size":
          return int();
        case "has":
          return bool();
        case "add":
        case "remove":
        case "toggle":
        case "union":
        case "intersect":
        case "diff":
        case "filter":
          return t;
        case "to-list":
          return a0 && list(a0);
        default:
          return unlisted(member);
      }
    case "List":
      if (!isOwnMember("List", member)) return null;
      switch (member) {
        case "length":
          return int();
        case "is-empty":
        case "contains":
          return bool();
        case "get":
          return argCount === 1 && a0 ? option(a0) : null;
        case "head":
        case "last":
        case "find":
          return a0 && option(a0);
        case "tail":
        case "push":
        case "prepend":
        case "concat":
        case "slice":
        case "reverse":
        case "sort":
        case "sort-by":
        case "unique":
        case "filter":
          return t;
        case "join":
          return text();
        case "chunk":
          return list(t);
        case "map":
        case "fold":
        case "zip":
          return null;
        default:
          return unlisted(member);
      }
    case "Option":
      if (!isOwnMember("Option", member)) return null;
      switch (member) {
        case "is-some":
        case "is-none":
          return bool();
        case "get":
          return argCount === 0 ? unwrappedType(t) : null;
        case "get-or":
          return getOrResultType(t, argCount);
        case "filter":
        case "or":
          return t;
        case "to-list":
          return a0 && list(a0);
        case "map":
        case "flat-map":
          return null;
        default:
          return unlisted(member);
      }
    case "Result":
      if (!isOwnMember("Result", member)) return null;
      switch (member) {
        case "is-ok":
        case "is-err":
          return bool();
        case "get":
          return argCount === 0 ? unwrappedType(t) : null;
        case "get-err":
          return argCount === 0 ? a1 : null;
        case "get-or":
          return getOrResultType(t, argCount);
        case "or":
          return t;
        case "to-option":
          return a0 && option(a0);
        case "map":
        case "map-err":
        case "flat-map":
          return null;
        default:
          return unlisted(member);
      }
    default:
      return null;
  }
}

function unlisted(_member: never): null {
  return null;
}

/** Best-effort static type of an expression; `null` = undecidable / dynamic. */
export function inferType(e: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  switch (e.kind) {
    case "Num":
      return prim(Number.isInteger(e.value) ? "Int" : "Float", e.pos);
    case "Str":
      return { kind: "TypePrim", name: "Text", pos: e.pos };
    case "Bool":
      return { kind: "TypePrim", name: "Bool", pos: e.pos };
    case "Unit":
      return prim("Unit", e.pos);
    case "Ref": {
      // A bind with no type still shadows a slot of its name.
      if (ctx.localBinds.has(e.name) && !ctx.localTypes.has(e.name)) return null;
      const bound = ctx.localTypes.get(e.name);
      if (bound) return bound;
      return sym.slots.get(e.name)?.type ?? null;
    }
    case "FieldAccess": {
      const base = unaliasType(inferType(e.base, sym, ctx), sym);
      if (!base) return null;
      if (base.kind === "TypeRecord") return recordFieldType(base, e.field);
      if (base.kind === "TypePrim") {
        const t = primFieldType(base.name, e.field, e.pos);
        if (t) return t;
      }
      const decided = receiverMemberResult(base, e.field, 0, sym, e.pos);
      if (decided) return decided;
      // A member whose result is the same whatever the receiver (`n.show`,
      // `f.to-int`).
      const fixed = METHOD_RESULT.get(e.field);
      return fixed ? prim(fixed, e.pos) : null;
    }
    case "Index": {
      const base = unaliasType(inferType(e.base, sym, ctx), sym);
      if (base?.kind === "TypeApp") {
        if (base.name === "List" || base.name === "Set") return base.args[0] ?? null;
        if (base.name === "Map") return base.args[1] ?? null;
      }
      return null;
    }
    case "MethodCall": {
      if (e.method === "copy") return inferType(e.receiver, sym, ctx);
      if (e.method === "run-reducer" && ctx.runReducerScope) return runReducerState(sym, e.pos);
      const decided = receiverMemberResult(
        inferType(e.receiver, sym, ctx),
        e.method,
        e.args.length,
        sym,
        e.pos,
      );
      if (decided) return decided;
      const fixed = METHOD_RESULT.get(e.method);
      return fixed ? prim(fixed, e.pos) : null;
    }
    case "RecordLit":
      return {
        kind: "TypeRecord",
        fields: e.fields.map((f) => ({
          name: f.name,
          type: inferType(f.value, sym, ctx) ?? unknownType(f.value.pos),
          pos: f.pos ?? f.value.pos,
        })),
        pos: e.pos,
      };
    case "ListLit": {
      const elem = commonType(
        e.items.map((it) => inferType(it, sym, ctx)),
        sym,
      );
      return container("List", [elem ?? unknownType(e.pos)], e.pos);
    }
    case "TupleLit":
      return container(
        "Tuple",
        e.items.map((it) => inferType(it, sym, ctx) ?? unknownType(it.pos)),
        e.pos,
      );
    case "MapLit": {
      if (e.entries.length === 0) return null;
      const k = commonType(
        e.entries.map((ent) => inferType(ent.key, sym, ctx)),
        sym,
      );
      const v = commonType(
        e.entries.map((ent) => inferType(ent.value, sym, ctx)),
        sym,
      );
      return container("Map", [k ?? unknownType(e.pos), v ?? unknownType(e.pos)], e.pos);
    }
    case "Variant": {
      const inner = e.payload[0]
        ? (inferType(e.payload[0], sym, ctx) ?? unknownType(e.pos))
        : unknownType(e.pos);
      if (e.name === "Some") return container("Option", [inner], e.pos);
      if (e.name === "None") return container("Option", [unknownType(e.pos)], e.pos);
      if (e.name === "Ok") return container("Result", [inner, unknownType(e.pos)], e.pos);
      if (e.name === "Err") return container("Result", [unknownType(e.pos), inner], e.pos);
      return null;
    }
    case "BinOp":
      return binOpResult(e, sym, ctx);
    case "UnaryOp": {
      if (e.op === "!") return prim("Bool", e.pos);
      const rt = inferType(e.rhs, sym, ctx);
      return isNumeric(rt, sym) ? rt : null;
    }
    case "IfExpr": {
      return commonType([inferType(e.consequent, sym, ctx), inferType(e.alternate, sym, ctx)], sym);
    }
    case "MatchExpr": {
      const scrutType = inferType(e.scrutinee, sym, ctx);
      return commonType(
        e.arms.map((arm) => inferType(arm.body, sym, armScope(arm, scrutType, sym, ctx))),
        sym,
      );
    }
    case "LetIn":
      return inferType(e.body, sym, letInScope(e, sym, ctx));
    case "EmitExpr":
      return prim("EffectId", e.pos);
    case "Call": {
      if (e.callee === "run-reducer" && ctx.runReducerScope) return runReducerState(sym, e.pos);
      const fixed = CALL_RESULT.get(e.callee);
      if (fixed) return prim(fixed, e.pos);
      const dot = e.callee.indexOf(".");
      const qualifier = dot > 0 ? e.callee.slice(0, dot) : null;
      const member =
        qualifier !== null && isQualifierName(qualifier) ? e.callee.slice(dot + 1) : null;
      if (member === "show") return prim("Text", e.pos);
      if (qualifier !== null && member === "parse") {
        const named = qualifierType(qualifier, e.pos, sym);
        return named === null ? null : container("Option", [named], e.pos);
      }
      if (qualifier === "Duration") return { kind: "TypeRef", name: "Duration", pos: e.pos };
      if (qualifier === "Bytes") return prim("Bytes", e.pos);
      if (qualifier !== null && member === "fresh") return freshResultType(qualifier, e.pos, sym);
      return sym.fns.get(e.callee)?.ret ?? null;
    }
    default:
      return null;
  }
}

function runReducerState(sym: SymbolTable, pos: Pos): TypeExpr {
  const declared = [...sym.slots.values()].map((s) => ({ name: s.name, type: s.type, pos: s.pos }));
  // The runtime's own slots (`route`) are in the state too, with a type the
  // program does not declare — present, and undecided.
  const reserved = [...RESERVED_SLOT_NAMES.keys()]
    .filter((name) => !sym.slots.has(name))
    .map((name) => ({ name, type: unknownType(pos), pos }));
  const slots: TypeExpr = { kind: "TypeRecord", fields: [...declared, ...reserved], pos };
  return { kind: "TypeRecord", fields: [{ name: "slots", type: slots, pos }], pos };
}

function commonType(types: (TypeExpr | null)[], sym: SymbolTable): TypeExpr | null {
  const first = types[0];
  if (types.length === 0 || !first) return null;
  for (const t of types.slice(1)) {
    if (!t) return null;
    if (!assignable(t, first, sym) || !assignable(first, t, sym))
      return sharedBase(types, first, sym);
  }
  return first;
}

function sharedBase(
  types: (TypeExpr | null)[],
  first: TypeExpr,
  sym: SymbolTable,
): TypeExpr | null {
  const base = unaliasType(first, sym);
  if (base === null) return null;
  const meets = (t: TypeExpr | null): boolean =>
    t !== null && assignable(t, base, sym) && assignable(base, t, sym);
  return types.every(meets) ? base : null;
}
