// Which callee names mean something, and to whom.
//
// `checkExpr` used to walk a `Call`'s arguments and return without looking at
// the callee at all, so any misspelling reached codegen, fell through to the
// user-fn fallback, and became an undefined global at runtime — `check` and
// `build` both green, `doubel is not defined` on the first click.
//
// Closing that means the checker has to know exactly what codegen can lower,
// which is what these tables are for. They are the single source of truth for
// both sides: `packages/compiler/test/callee-resolution.test.ts` asserts every
// name here lowers to something other than the fallback, so a name accepted by
// one side and unknown to the other cannot ship.

/**
 * Callees codegen lowers itself, with no qualifier. Every entry is lowercase
 * because the parser only produces an unqualified `Call` for a lowercase name
 * — a capitalised one is a `Variant`.
 */
export const BUILTIN_CALLS: ReadonlySet<string> = new Set([
  "now",
  "fmt",
  "panic",
  "file-url",
  "prefers-dark",
  // Testing DSL: legal inside a property-test invariant, where `checkTest`
  // resolves its argument against the reducer namespace (E0102).
  "run-reducer",
]);

/** Callees codegen lowers by their full `Qualifier.member` name. */
export const QUALIFIED_BUILTIN_CALLS: ReadonlySet<string> = new Set([
  "EffectId.none",
  "Duration.ms",
  "Duration.s",
  "Duration.m",
  "Duration.min",
  "Duration.h",
  "Duration.d",
  "Duration.days",
  "Bytes.from-text",
  "Bytes.from-base64",
  "Bytes.from-bytes",
  "Decoder.Json",
  "Decoder.Text",
  "Decoder.Bytes",
  "Decoder.None",
]);

/**
 * Members codegen lowers on *any* capitalised qualifier — `TodoId.fresh()`,
 * `Int.parse(t)`, `Time.show(v)`. The qualifier is not resolved against the
 * type table: codegen does not resolve it either, and a checker stricter than
 * the lowering it guards would reject programs that build and run.
 */
export const TYPE_MEMBER_CALLS: ReadonlySet<string> = new Set(["fresh", "parse", "show"]);

/**
 * Documented by `docs/spec/stdlib.md` but not lowered by codegen. Listed so the
 * callee still resolves: the author gets "not implemented yet" at check time
 * instead of an undefined global at render time, which is the difference
 * between a diagnostic and a blank screen.
 */
export const UNIMPLEMENTED_CALLS: ReadonlySet<string> = new Set(["trace"]);

/** The parser's rule for a qualifier, mirrored: a capitalised identifier. */
const QUALIFIER_RE = /^[A-Z][A-Za-z0-9_]*$/;

/** Whether codegen has a lowering for `callee`. */
export function isBuiltinCallee(callee: string): boolean {
  if (BUILTIN_CALLS.has(callee) || QUALIFIED_BUILTIN_CALLS.has(callee)) return true;
  const dot = callee.indexOf(".");
  if (dot <= 0) return false;
  return QUALIFIER_RE.test(callee.slice(0, dot)) && TYPE_MEMBER_CALLS.has(callee.slice(dot + 1));
}

/**
 * Candidate names for a did-you-mean on an unresolved callee: the builtins plus
 * whatever `fn` names the caller supplies. Deliberately not the whole
 * definition table — suggesting a slot or a tile for a misspelled function call
 * would rewrite the source into a different kind of mistake.
 */
export function calleeCandidates(fnNames: Iterable<string>): string[] {
  return [...BUILTIN_CALLS, ...QUALIFIED_BUILTIN_CALLS, ...fnNames];
}
