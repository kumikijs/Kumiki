// The refinement predicates of docs/spec/language.md §1.3.3, in one table:
// what the parser accepts, what the checker validates, and what each lowers to.
//
// There used to be two lists. The parser held the twelve accepted names, and
// `codegen/emit-type.ts` held a `switch` that lowered five of them and ended in
//
//   default: return `(_v) => true`;
//
// so `positive`, `negative`, `email`, `url`, `uuid`, `regex` and `one-of`
// reached the runtime as a check that cannot fail — `slot n : Int where
// positive` accepted -7, and `error(field=…)` on one of them rendered nothing
// (#352). The documents present a refinement as a runtime guarantee
// (docs/spec/forms.md §5.6, docs/spec/runtime.md §10.3.3), so the
// silent arm was the spec being half-implemented rather than a design.
//
// One table closes that: `REFINEMENT_PREDS` is what the parser accepts and is
// derived from the same entries that carry the lowering, so a name cannot be
// accepted by one side and unknown to the other. An entry with no `body` is
// E0803 at build time — the honest answer, and the same reasoning as E0802 for
// a documented function the toolchain does not lower.

import type { Refinement } from "./ast.ts";

/** A literal a refinement can be written with (language.md §1.3.1). */
export type RefinementArg = number | string;

/**
 * What one argument position accepts.
 *
 * `count` is a number that counts characters, so it is also a whole
 * non-negative one. An argument that is neither lands on one side or the other
 * of the same defect: `len-eq(2.5)` is a check no `Text` can satisfy, and
 * `len-gt(-1)` one that every `Text` satisfies, the empty one included.
 */
type ArgKind = "number" | "count" | "text" | "literal";

/** A fixed parameter list, or a variadic tail with a floor under its length. */
type Params =
  | { readonly fixed: readonly ArgKind[] }
  | { readonly rest: ArgKind; readonly min: number };

type RefinementEntry = {
  readonly params: Params;
  /**
   * A problem the arguments only have together — a range with nothing in it, a
   * pattern that does not compile. Runs after every argument has passed its
   * own `ArgKind`, so it can read them by position.
   */
  readonly combined?: (args: readonly RefinementArg[]) => string | undefined;
  /**
   * The predicate's condition over `v`, without the arrow around it: a type may
   * carry several `where` clauses and they conjoin (#353), so the bodies are
   * what `refinementJs` joins with `&&`. Absent means the predicate is
   * registered and not lowered, which is {@link refinementProblem}'s
   * `unimplemented-refinement` — never a check that passes.
   */
  readonly body?: (args: readonly RefinementArg[]) => string;
};

const NUM = `typeof v === "number"`;
const STR = `typeof v === "string"`;

// The three constants below are emitted as regex literals, so those checks
// cost no `RegExp` construction per write. A `regex(…)` predicate cannot be:
// its pattern comes from the program, so it lowers to `new RegExp(…)` inside
// the check and is built on each call.
//
// Each is deliberately shape-only and permissive about what lives inside the
// shape: a refinement decides whether a value can be a slot's, not whether the
// mailbox exists or the host resolves. The bar is that a value which is
// plainly not one of these is refused — which is what `error(field=…)` renders
// a message for.
/** Local part, `@`, and a host with at least one dot in it. */
const EMAIL_RE = String.raw`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`;
/** Absolute, with a scheme and an authority: a `Url` is somewhere to go. */
const URL_RE = String.raw`/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#]+\S*$/`;
/** The 8-4-4-4-12 shape, any version, either case. No escape to keep raw. */
const UUID_RE = "/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/";

/** `args[i]` as a number, for an entry the checker has already validated. */
const num = (args: readonly RefinementArg[], i: number): number => Number(args[i]);

/**
 * A user pattern as an anchored JS one. Anchored because a refinement
 * describes the whole value: `regex("[0-9]{4}")` on a postcode field must not
 * accept `"AB1234 "`. A pattern already anchored at **both** ends is unharmed
 * — `^(?:^x$)$` matches exactly what `^x$` does — while one anchored at a
 * single end is not, and is not meant to be: `^a|b` matches `"ax"` and
 * `^(?:^a|b)$` does not, which is the promise §1.3.3 makes. The non-capturing
 * group is what keeps a top-level alternation from binding looser than the
 * anchors, and {@link REFINEMENTS} compiles the pattern as written before
 * wrapping it, so one that closes this group cannot escape them.
 */
const anchored = (pattern: string): string => `^(?:${pattern})$`;

export const REFINEMENTS: ReadonlyMap<string, RefinementEntry> = new Map<string, RefinementEntry>([
  [
    "between",
    {
      params: { fixed: ["number", "number"] },
      combined: (a) =>
        num(a, 0) > num(a, 1)
          ? `between(${a[0]}, ${a[1]}) has a lower bound above its upper bound, so no value satisfies it`
          : undefined,
      body: (a) => `${NUM} && v >= ${num(a, 0)} && v <= ${num(a, 1)}`,
    },
  ],
  ["nonempty", { params: { fixed: [] }, body: () => `${STR} && v.length > 0` }],
  ["len-eq", { params: { fixed: ["count"] }, body: (a) => `${STR} && v.length === ${num(a, 0)}` }],
  ["len-lt", { params: { fixed: ["count"] }, body: (a) => `${STR} && v.length < ${num(a, 0)}` }],
  ["len-gt", { params: { fixed: ["count"] }, body: (a) => `${STR} && v.length > ${num(a, 0)}` }],
  ["positive", { params: { fixed: [] }, body: () => `${NUM} && v > 0` }],
  ["negative", { params: { fixed: [] }, body: () => `${NUM} && v < 0` }],
  ["email", { params: { fixed: [] }, body: () => `${STR} && ${EMAIL_RE}.test(v)` }],
  ["url", { params: { fixed: [] }, body: () => `${STR} && ${URL_RE}.test(v)` }],
  ["uuid", { params: { fixed: [] }, body: () => `${STR} && ${UUID_RE}.test(v)` }],
  [
    "regex",
    {
      params: { fixed: ["text"] },
      combined: (a) => {
        // The pattern as written, and only then the anchored form. Compiling
        // the wrapped one alone let a pattern escape its own anchors: `a)|(b`
        // does not compile, but `^(?:a)|(b)$` does — as `^(?:a)` OR `(b)$`,
        // which matches `"axxx"`. The author's parentheses would have closed
        // the group this adds, so the value would be tested against a pattern
        // nobody wrote, unanchored, and §1.3.3 promises the opposite.
        try {
          new RegExp(String(a[0]));
        } catch (e) {
          return `regex(${JSON.stringify(a[0])}) is not a pattern: ${(e as Error).message}`;
        }
        try {
          new RegExp(anchored(String(a[0])));
          return undefined;
        } catch (e) {
          return `regex(${JSON.stringify(a[0])}) is not a pattern: ${(e as Error).message}`;
        }
      },
      body: (a) => `${STR} && new RegExp(${JSON.stringify(anchored(String(a[0])))}).test(v)`,
    },
  ],
  [
    "one-of",
    {
      params: { rest: "literal", min: 1 },
      body: (a) => `${JSON.stringify(a)}.includes(v)`,
    },
  ],
]);

/** The predicate names the parser accepts — the table's own keys. */
export const REFINEMENT_PREDS: ReadonlySet<string> = new Set(REFINEMENTS.keys());

/**
 * `r`'s condition over `v`, or `undefined` when nothing lowers it. Several of
 * these conjoin into one slot's check, which is why the arrow is not part of
 * them.
 */
export function refinementBodyJs(r: Refinement): string | undefined {
  return REFINEMENTS.get(r.pred)?.body?.(r.args);
}

/**
 * The JS predicate for `r` on its own, or `undefined` when nothing lowers it.
 * The caller emits nothing in that case rather than a check in its place: a
 * slot with no `refine` is one the runtime does not gate, which is visibly
 * different from a slot whose gate lets everything through.
 */
export function refinementToJs(r: Refinement): string | undefined {
  const body = refinementBodyJs(r);
  return body === undefined ? undefined : `(v) => ${body}`;
}

/** Why a refinement cannot become a runtime check, for the checker to code. */
export type RefinementProblem = {
  kind: "unimplemented-refinement" | "refinement-args-invalid";
  message: string;
};

const ARG_DESCRIPTION: Record<ArgKind, string> = {
  number: "a number",
  count: "a whole number of characters, zero or more",
  text: "a text literal",
  literal: "a number or text literal",
};

function argFits(kind: ArgKind, arg: RefinementArg | undefined): boolean {
  switch (kind) {
    case "number":
      return typeof arg === "number";
    case "count":
      return typeof arg === "number" && Number.isInteger(arg) && arg >= 0;
    case "text":
      return typeof arg === "string";
    case "literal":
      return typeof arg === "number" || typeof arg === "string";
  }
}

/** How an argument reads in a message — quoted when it is text, as written. */
const showArg = (arg: RefinementArg | undefined): string =>
  arg === undefined ? "nothing" : JSON.stringify(arg);

/**
 * The problem with `r`, or `undefined` when it becomes a check. Two kinds, both
 * of them a build-time answer to what used to be a runtime surprise: a
 * predicate nothing lowers, and one whose arguments cannot produce a check that
 * both accepts and refuses something.
 */
export function refinementProblem(r: Refinement): RefinementProblem | undefined {
  const entry = REFINEMENTS.get(r.pred);
  if (!entry) {
    return {
      kind: "unimplemented-refinement",
      message: `Refinement "${r.pred}" is not a registered predicate`,
    };
  }
  const arity = arityProblem(r.pred, entry.params, r.args);
  if (arity) return { kind: "refinement-args-invalid", message: arity };
  const combined = entry.combined?.(r.args);
  if (combined) return { kind: "refinement-args-invalid", message: `Refinement ${combined}` };
  if (!entry.body) {
    return {
      kind: "unimplemented-refinement",
      message: `Refinement "${r.pred}" is documented but not enforced by the runtime`,
    };
  }
  return undefined;
}

function arityProblem(
  pred: string,
  params: Params,
  args: readonly RefinementArg[],
): string | undefined {
  const wrongArg = (i: number, kind: ArgKind): string =>
    `Refinement "${pred}" takes ${ARG_DESCRIPTION[kind]} but argument ${i + 1} is ${showArg(args[i])}`;
  if ("rest" in params) {
    if (args.length < params.min) {
      return `Refinement "${pred}" needs at least ${params.min} value(s) but got ${args.length}`;
    }
    const wrong = args.findIndex((a) => !argFits(params.rest, a));
    return wrong === -1 ? undefined : wrongArg(wrong, params.rest);
  }
  if (args.length !== params.fixed.length) {
    return `Refinement "${pred}" takes ${params.fixed.length} argument(s) but got ${args.length}`;
  }
  for (const [i, kind] of params.fixed.entries()) {
    if (!argFits(kind, args[i])) return wrongArg(i, kind);
  }
  return undefined;
}
