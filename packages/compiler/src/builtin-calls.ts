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

// Kept out of BUILTIN_CALLS: it lowers only inside a property-test trial, where `_init` and
// `_event` are bound, so a call anywhere else must stay undefined.
export const RUN_REDUCER = "run-reducer";

// The names a program's `fn` can share with a builtin, since a `fn` name takes no qualifier.
export const UNQUALIFIED_BUILTIN_CALLS: ReadonlySet<string> = new Set([
  ...BUILTIN_CALLS.keys(),
  RUN_REDUCER,
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

/** The parser's rule for a qualifier, mirrored: a capitalised identifier. */
const QUALIFIER_RE = /^[A-Z][A-Za-z0-9_]*$/;

export function isQualifierName(name: string): boolean {
  return QUALIFIER_RE.test(name);
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

// A `fn` the program declares under a builtin's name wins. Codegen and the checker both ask this,
// so they cannot read one name two ways.
export function callsBuiltin(callee: string, declaresFn: (name: string) => boolean): boolean {
  if (UNQUALIFIED_BUILTIN_CALLS.has(callee)) return !declaresFn(callee);
  return isBuiltinCallee(callee);
}

export function calleeCandidates(fnNames: Iterable<string>, missing?: string): string[] {
  const base = [...BUILTIN_CALLS.keys(), ...QUALIFIED_BUILTIN_CALLS.keys(), ...fnNames];
  const dot = missing === undefined ? -1 : missing.indexOf(".");
  if (missing === undefined || dot <= 0 || !QUALIFIER_RE.test(missing.slice(0, dot))) return base;
  const qualifier = missing.slice(0, dot);
  return [...base, ...[...TYPE_MEMBER_CALLS.keys()].map((m) => `${qualifier}.${m}`)];
}
