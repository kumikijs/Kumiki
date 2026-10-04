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
// the case that separates them: a call has to name the payload type, while the
// lowering reads it only for the predicates it carries and is the `"json"`
// sentinel when it carries none. Without a count at all,
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
  // The decoder's payload type, which is what makes the decode type-safe in
  // `docs/spec/http.md` §6.1.4: the lowering is the check of the predicates it
  // carries, or the `"json"` sentinel when it carries none. A decoder written
  // without it was indistinguishable from one that had it, in the source and
  // in the output alike.
  ["Decoder.Json", exactly(1)],
  ["Decoder.Text", exactly(0)],
  ["Decoder.Bytes", exactly(0)],
  ["Decoder.None", exactly(0)],
]);

/**
 * The qualifiers of `QUALIFIED_BUILTIN_CALLS`, which is what the parser reads
 * `Qualifier.member` by as the head of a call rather than as a value — so the
 * member is a zero-argument call even written without parentheses. That is how
 * `docs/spec/http.md` §6.1.4 writes `Decoder.Text` / `Decoder.Bytes` /
 * `Decoder.None` and how `stdlib.md` §2.1.1.1 writes `EffectId.none`.
 *
 * Left out, a qualifier's bare spelling is not an error but a field read on a
 * freshly built variant: `Duration.s` was `{_tag: "Duration"}["s"]`, an
 * `undefined` nothing reported, and a `setTimeout(undefined)` is a
 * `setTimeout(0)`. So the list holds every qualifier the map names, and a
 * member of one is answered by name (E0116) and by count (E0213) in either
 * spelling. It is written out rather than derived from the map because listing
 * a qualifier claims `Q.<member>` in every expression position — a decision
 * about the language surface, not a consequence of adding a lowering.
 *
 * Not every qualifier codegen lowers: `TYPE_MEMBER_CALLS` resolves `fresh` /
 * `parse` / `show` on any capitalised name, and those are deliberately absent,
 * which is why a bare `Int.parse` is still that field read. `Time` is absent
 * too, though its bare members are read as calls: it is a type with one
 * builtin among its members (`BUILTIN_MEMBERS`), not a namespace of them, so
 * its membership stays open (`readsBareMemberAsCall`).
 *
 * Membership is closed, and `checkCallee` is what closes it: without that,
 * `TYPE_MEMBER_CALLS` reached inside these namespaces and `EffectId.fresh`
 * minted an id where the author wrote the empty sentinel — so within a listed
 * namespace those three members resolve to nothing, in either spelling.
 */
export const QUALIFIED_CALL_NAMESPACES: ReadonlySet<string> = new Set([
  "Decoder",
  "EffectId",
  "Duration",
  "Bytes",
]);

/**
 * Builtins a type lists among its own members, keyed by the qualified spelling
 * the type gives them: `docs/spec/stdlib.md` §2.2.8 lists `Time.now` beside
 * `Time.parse`, and it is the `now` of §2.4.2. The parser reads that spelling,
 * with or without its parentheses, as a call to the builtin it names
 * (`qualifiedCallee`), so the type, the argument count, the lowering and the
 * environment read the runtime journals are the builtin's own — nothing past
 * the parser sees which spelling was written, and no second entry for any of
 * them exists to disagree with the first.
 */
export const BUILTIN_MEMBERS: ReadonlyMap<string, string> = new Map([["Time.now", "now"]]);

const BUILTIN_MEMBER_QUALIFIERS: ReadonlySet<string> = new Set(
  [...BUILTIN_MEMBERS.keys()].map((name) => name.slice(0, name.indexOf("."))),
);

/**
 * Whether the parser reads `qualifier.member`, written without parentheses, as
 * a call given no arguments rather than as a field read on a variant of the
 * qualifier's name — which evaluates to `undefined`, and which nothing reports.
 *
 * That is a `QUALIFIED_CALL_NAMESPACES` qualifier, and the qualifier of a
 * `BUILTIN_MEMBERS` spelling: `Time.now` has to be read as a call to be the
 * builtin at all, and read that way, a member `Time` does not have
 * (`Time.nope`) is a callee that resolves to nothing, and a type member short
 * of its argument (`Time.parse`) gets the diagnostic its parenthesised
 * spelling gets. Unlike those namespaces, `Time` keeps the type members of
 * §2.4: `checkCallee` closes the membership of `QUALIFIED_CALL_NAMESPACES`
 * only.
 */
export function readsBareMemberAsCall(qualifier: string): boolean {
  return QUALIFIED_CALL_NAMESPACES.has(qualifier) || BUILTIN_MEMBER_QUALIFIERS.has(qualifier);
}

/**
 * The callee of a call written `qualifier.member`: the builtin a
 * `BUILTIN_MEMBERS` spelling names, and otherwise the spelling as written.
 */
export function qualifiedCallee(qualifier: string, member: string): string {
  const written = `${qualifier}.${member}`;
  return BUILTIN_MEMBERS.get(written) ?? written;
}

/**
 * Members codegen lowers on *any* capitalised qualifier — `TodoId.fresh()`,
 * `Int.parse(t)`, `Time.show(v)`. That the qualifier is matched by a regex
 * rather than resolved used to be the argument for the checker not resolving it
 * either, and the two members answer it differently:
 *
 * - `parse` reads its text by the base the qualifier resolves to
 *   (`parse-reading.ts`), so a misspelt one names no reading at all — where it
 *   used to branch on the name and silently produce a different value:
 *   `Itn.parse("12")` was `Some("12")` where `Int.parse` is `Some(12)`.
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
 * Candidate names for a did-you-mean on an unresolved callee: the builtins,
 * under each spelling that resolves to one (`Time.now` as well as `now`), plus
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
  const base = [
    ...BUILTIN_CALLS.keys(),
    ...QUALIFIED_BUILTIN_CALLS.keys(),
    ...BUILTIN_MEMBERS.keys(),
    ...fnNames,
  ];
  const dot = missing === undefined ? -1 : missing.indexOf(".");
  if (missing === undefined || dot <= 0 || !QUALIFIER_RE.test(missing.slice(0, dot))) return base;
  const qualifier = missing.slice(0, dot);
  return [...base, ...[...TYPE_MEMBER_CALLS.keys()].map((m) => `${qualifier}.${m}`)];
}
