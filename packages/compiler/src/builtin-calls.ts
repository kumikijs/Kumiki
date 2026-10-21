import type { Expr, Pos, TypeExpr } from "./ast.ts";
import { isPrimTypeName } from "./stdlib-types.ts";

export type BuiltinArity = { readonly min: number; readonly max: number };

const exactly = (n: number): BuiltinArity => ({ min: n, max: n });
const atLeast = (n: number): BuiltinArity => ({ min: n, max: Number.POSITIVE_INFINITY });

export const BUILTIN_CALLS: ReadonlyMap<string, BuiltinArity> = new Map([
  ["now", exactly(0)],
  ["random", exactly(0)],
  ["fmt", atLeast(1)],
  ["panic", exactly(1)],
  ["file-url", exactly(1)],
  ["prefers-dark", exactly(0)],
]);

/** Callees codegen lowers by their full `Qualifier.member` name. */
export const QUALIFIED_BUILTIN_CALLS: ReadonlyMap<string, BuiltinArity> = new Map([
  ["EffectId.none", exactly(0)],
  ["Duration.ms", exactly(1)],
  ["Duration.s", exactly(1)],
  ["Duration.m", exactly(1)],
  ["Duration.min", exactly(1)],
  ["Duration.h", exactly(1)],
  ["Duration.d", exactly(1)],
  ["Duration.days", exactly(1)],
  ["Bytes.from-text", exactly(1)],
  ["Bytes.from-base64", exactly(1)],
  ["Bytes.from-bytes", exactly(1)],
  ["Decoder.Json", exactly(1)],
  ["Decoder.Text", exactly(0)],
  ["Decoder.Bytes", exactly(0)],
  ["Decoder.None", exactly(0)],
]);

export const QUALIFIED_CALL_NAMESPACES: ReadonlySet<string> = new Set([
  "Decoder",
  "EffectId",
  "Duration",
  "Bytes",
]);

export const TYPE_MEMBER_CALLS: ReadonlyMap<string, BuiltinArity> = new Map([
  ["fresh", exactly(0)],
  ["parse", exactly(1)],
  ["show", exactly(1)],
]);

export const UNIMPLEMENTED_CALLS: ReadonlySet<string> = new Set(["trace"]);

/**
 * The spelling builtinArity and codegen lower a qualifier under: a capitalised identifier with no
 * hyphen. The parser only checks the leading capital, so `My-Type.fresh()` still parses as a
 * qualified call.
 */
const QUALIFIER_RE = /^[A-Z][A-Za-z0-9_]*$/;

export function isQualifierName(name: string): boolean {
  return QUALIFIER_RE.test(name);
}

// Written with no argument, a member of these namespaces is exactly one of their built-in calls, so
// any other (`Duration.fresh()`, `Duration.show()`, a bare `Duration.nope`) is E0116 and names no
// type. Given its argument, `parse` / `show` is the type member.
export function isMissingNamespaceMember(callee: string, argCount: number): boolean {
  const dot = callee.indexOf(".");
  return (
    dot > 0 &&
    argCount === 0 &&
    QUALIFIED_CALL_NAMESPACES.has(callee.slice(0, dot)) &&
    !QUALIFIED_BUILTIN_CALLS.has(callee)
  );
}

// One rule for checkCallee, which resolves the name against the type table, and the reference
// walker, which reads it as an edge to that type, so refs and rename see exactly the qualifiers
// checkCallee resolves. The spelling is builtinArity's and codegen's: a looser one would make
// `My-Type.fresh()`, which nothing lowers, an undefined type instead of E0116, and a stricter one
// would let a call codegen lowers skip this check.
export function typeMemberQualifier(callee: string, argCount: number): string | undefined {
  const dot = callee.indexOf(".");
  if (dot <= 0 || !TYPE_MEMBER_CALLS.has(callee.slice(dot + 1))) return undefined;
  const qualifier = callee.slice(0, dot);
  if (!QUALIFIER_RE.test(qualifier) || isMissingNamespaceMember(callee, argCount)) {
    return undefined;
  }
  return qualifier;
}

/**
 * The type a `Decoder.Json(T)` argument spells, which parses as a value (`Map(ItemId, Item)` is a
 * `Variant`). Codegen decodes by it and the reference walker reads its names as types, so both
 * take it from here. Each node keeps its source position.
 */
export function decodedType(e: Expr | undefined): TypeExpr | undefined {
  if (e?.kind === "Variant") {
    if (e.payload.length === 0) {
      return isPrimTypeName(e.name)
        ? { kind: "TypePrim", name: e.name, pos: e.pos }
        : { kind: "TypeRef", name: e.name, pos: e.pos };
    }
    const args = e.payload.map(decodedType);
    if (!args.every((a): a is TypeExpr => a !== undefined)) return undefined;
    return { kind: "TypeApp", name: e.name, args, pos: e.pos };
  }
  if (e?.kind === "RecordLit") {
    const fields = e.fields.map((f) => ({ name: f.name, type: decodedType(f.value), pos: f.pos }));
    if (!fields.every((f): f is { name: string; type: TypeExpr; pos: Pos } => !!f.type)) {
      return undefined;
    }
    return { kind: "TypeRecord", fields, pos: e.pos };
  }
  return undefined;
}

export function builtinArity(callee: string): BuiltinArity | undefined {
  const named = BUILTIN_CALLS.get(callee) ?? QUALIFIED_BUILTIN_CALLS.get(callee);
  if (named) return named;
  const dot = callee.indexOf(".");
  if (dot <= 0 || !QUALIFIER_RE.test(callee.slice(0, dot))) return undefined;
  return TYPE_MEMBER_CALLS.get(callee.slice(dot + 1));
}

/** Whether codegen has a lowering for `callee`. */
export function isBuiltinCallee(callee: string): boolean {
  return builtinArity(callee) !== undefined;
}

export function calleeCandidates(fnNames: Iterable<string>, missing?: string): string[] {
  const base = [...BUILTIN_CALLS.keys(), ...QUALIFIED_BUILTIN_CALLS.keys(), ...fnNames];
  const dot = missing === undefined ? -1 : missing.indexOf(".");
  if (missing === undefined || dot <= 0 || !QUALIFIER_RE.test(missing.slice(0, dot))) return base;
  const qualifier = missing.slice(0, dot);
  return [...base, ...[...TYPE_MEMBER_CALLS.keys()].map((m) => `${qualifier}.${m}`)];
}
