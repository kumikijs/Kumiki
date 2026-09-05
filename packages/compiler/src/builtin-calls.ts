// Which callee names mean something, and to whom.
//
// `checkExpr` used to walk a `Call`'s arguments and return without looking at
// the callee at all, so any misspelling reached codegen, fell through to the
// user-fn fallback, and became an undefined global at runtime — `check` and
// `build` both green, `doubel is not defined` on the first click.
//
// Closing that means the checker has to know exactly what codegen can lower.
// Codegen does not read these tables — `codegen/expr.ts` dispatches through its
// own chain of bespoke cases, one per builtin, because each lowers to something
// different. What keeps the two in step is
// `packages/compiler/test/callee-resolution.test.ts`, which compiles a call to
// every name below and asserts the result is not the fallback. A name the
// checker accepts and codegen forgot fails there rather than in an app.
//
// Each name also carries the number of arguments a call to it must supply —
// which is not the same as the number its lowering reads, and `Decoder.Json` is
// the case that separates them: the lowering reads nothing and returns a
// sentinel, while a call has to name the payload type. Without a count at all,
// a builtin's argument list was whatever its lowering happened to find:
// `Duration.s()` lowered to `((0) * 1000)`, a timer written with an empty
// duration fired immediately and forever, and nothing said the argument was
// missing.

/**
 * How many arguments a call to a builtin must supply. `max` is infinite for the
 * one variadic builtin, `fmt`, whose signature is `fmt(template, ...args)`: the
 * template is all that can be required, and the lowering passes on whatever
 * follows it.
 */
export type BuiltinArity = { readonly min: number; readonly max: number };

const exactly = (n: number): BuiltinArity => ({ min: n, max: n });
const atLeast = (n: number): BuiltinArity => ({ min: n, max: Number.POSITIVE_INFINITY });

/**
 * Callees codegen lowers itself, with no qualifier. Every entry is lowercase
 * because the parser only produces an unqualified `Call` for a lowercase name
 * — a capitalised one is a `Variant`.
 */
// `run-reducer` is deliberately absent. It only lowers inside a generated
// property-test trial, where `_init` and `_event` are bound, and a
// property-test invariant never reaches `checkCallee` — `checkTest` walks it
// itself to resolve the reducer name. Listing it here would have whitelisted
// the one context where it is wrong: `t := run-reducer("inc")` in an ordinary
// reducer passes check and build and then throws `_init is not defined`, which
// is the exact failure this file exists to stop.
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
  // The decoder's payload type. It is not read by the lowering — every
  // `Decoder.*` becomes a sentinel string — but it is what makes the decode
  // type-safe in `docs/spec/http.md` §6.1.4, and a decoder written without it
  // was indistinguishable from one that had it, in the source and in the
  // output alike.
  ["Decoder.Json", exactly(1)],
  ["Decoder.Text", exactly(0)],
  ["Decoder.Bytes", exactly(0)],
  ["Decoder.None", exactly(0)],
]);

/**
 * Qualifiers the parser reads as the head of a call rather than as a value, so
 * `Qualifier.member` written without parentheses is a zero-argument call —
 * which is how `docs/spec/http.md` §6.1.4 writes `Decoder.Text` /
 * `Decoder.Bytes` / `Decoder.None` and how `stdlib.md` §2.1.1.1 writes
 * `EffectId.none`. Without that, the paren-less form was a field read on a
 * freshly built variant and emitted `undefined`, which `check` had no reason to
 * object to.
 *
 * Every qualifier `QUALIFIED_BUILTIN_CALLS` names is listed, which is not what
 * the name of this set suggests: `Duration` and `Bytes` have no constant
 * members at all. They are here because leaving a qualifier out never made its
 * bare spelling an error, it made it that same field read — `Duration.s` was
 * `{_tag: "Duration"}["s"]`, an `undefined` nothing reported, and a
 * `setTimeout(undefined)` is a `setTimeout(0)`. The reason they were excluded
 * was that reading them as calls turned that silence into another one, because
 * a missing argument was defaulted to `0`; that reason is gone, so the bare
 * spelling now answers by count (`Duration.s` is E0213) and by name
 * (`Duration.nope` is E0116). `Decoder.Json` is the same rule from the other
 * side: a member with an argument in an otherwise constant namespace, so it is
 * the one `Decoder` member with no paren-less spelling.
 *
 * The membership rule is enforced by `checkCallee`, not by this table alone:
 * `TYPE_MEMBER_CALLS` resolves `fresh` / `parse` / `show` on any capitalised
 * qualifier, and without that check `EffectId.fresh` passed and minted an id
 * where the author wrote the empty sentinel.
 */
export const CONSTANT_NAMESPACES: ReadonlySet<string> = new Set([
  "Decoder",
  "EffectId",
  "Duration",
  "Bytes",
]);

/**
 * Members codegen lowers on *any* capitalised qualifier — `TodoId.fresh()`,
 * `Int.parse(t)`, `Time.show(v)`. That the qualifier is matched by a regex
 * rather than resolved used to be the argument for the checker not resolving it
 * either, and the two members answer it differently:
 *
 * - `parse` branches on the qualifier (`Int` / `Float` / `Time` have numeric
 *   and millisecond readings), so a misspelt one silently produces a different
 *   value: `Itn.parse("12")` is `Some("12")` where `Int.parse` is `Some(12)`.
 * - `fresh` and `show` discard it. A misspelling there produces the same value,
 *   and the name is checked because a qualifier that resolves to no type is
 *   wrong on its own terms — which makes the checker deliberately stricter
 *   than the lowering for those two.
 */
export const TYPE_MEMBER_CALLS: ReadonlyMap<string, BuiltinArity> = new Map([
  ["fresh", exactly(0)],
  ["parse", exactly(1)],
  ["show", exactly(1)],
]);

/**
 * Documented by `docs/spec/stdlib.md` but not lowered by codegen. Listed so the
 * callee still resolves: the author gets "not implemented yet" at check time
 * instead of an undefined global at render time, which is the difference
 * between a diagnostic and a blank screen.
 */
export const UNIMPLEMENTED_CALLS: ReadonlySet<string> = new Set(["trace"]);

/** The parser's rule for a qualifier, mirrored: a capitalised identifier. */
const QUALIFIER_RE = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * Whether `name` can be the qualifier of a lowered call. Exported because the
 * checker resolves the qualifier of a type-member call against the type table,
 * and a rule stricter than this one would report an undefined *type* for a name
 * that has no lowering under any spelling — `Othe-Id.fresh()` is not a type
 * member at all, because a Kumiki name may contain a hyphen and a qualifier may
 * not.
 */
export function isQualifierName(name: string): boolean {
  return QUALIFIER_RE.test(name);
}

/**
 * The argument count a call to `callee` must supply, or `undefined` when codegen
 * has no lowering for the name — which makes this the one answer to both
 * questions, so a callee cannot resolve without an arity to hold it to.
 */
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

/**
 * Candidate names for a did-you-mean on an unresolved callee: the builtins plus
 * whatever `fn` names the caller supplies. Deliberately not the whole
 * definition table — suggesting a slot or a tile for a misspelled function call
 * would rewrite the source into a different kind of mistake.
 *
 * `missing` is the name that did not resolve. When it is qualified, the type
 * members are candidates *on its own qualifier*: `fresh` / `parse` / `show`
 * resolve on any capitalised name, so there is no list of qualified spellings
 * to draw from — `Int.pasre` has to be answered with `Int.parse`, built from
 * the qualifier the author already wrote.
 */
export function calleeCandidates(fnNames: Iterable<string>, missing?: string): string[] {
  const base = [...BUILTIN_CALLS.keys(), ...QUALIFIED_BUILTIN_CALLS.keys(), ...fnNames];
  const dot = missing === undefined ? -1 : missing.indexOf(".");
  if (missing === undefined || dot <= 0 || !QUALIFIER_RE.test(missing.slice(0, dot))) return base;
  const qualifier = missing.slice(0, dot);
  return [...base, ...[...TYPE_MEMBER_CALLS.keys()].map((m) => `${qualifier}.${m}`)];
}
