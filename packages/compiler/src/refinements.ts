import { typeToString } from "./assignable.ts";
import type { Refinement, TypeExpr } from "./ast.ts";

/** A literal a refinement can be written with. */
export type RefinementArg = number | string;

type ArgKind = "number" | "count" | "text" | "literal";

type Tests = Shape | "choice";

/** The two shapes a predicate can test, one per `typeof` a guard reads. */
type Shape = "text" | "number";

/** The primitive bases each shape is a value of. */
const BASES: Record<Shape, readonly string[]> = {
  text: ["Text"],
  number: ["Int", "Float", "Time"],
};

const TESTS_DESCRIPTION: Record<Tests, string> = {
  text: "text",
  number: "a number",
  choice: "text or a number",
};

/** The shape a literal argument is a value of. */
const shapeOfArg = (arg: RefinementArg): Shape => (typeof arg === "string" ? "text" : "number");

/** The shape every value of `base` has, or `undefined` when it is neither. */
function shapeOfBase(base: TypeExpr): Shape | undefined {
  if (base.kind !== "TypePrim") return undefined;
  return (Object.keys(BASES) as Shape[]).find((s) => BASES[s].includes(base.name));
}

export function refinementBases(pred: string): readonly string[] | undefined {
  const tests = REFINEMENTS.get(pred)?.tests;
  if (tests === undefined) return undefined;
  return tests === "choice" ? [...BASES.text, ...BASES.number] : BASES[tests];
}

/** A fixed parameter list, or a variadic tail with a floor under its length. */
type Params =
  | { readonly fixed: readonly ArgKind[] }
  | { readonly rest: ArgKind; readonly min: number };

type RefinementEntry = {
  readonly tests: Tests;
  readonly params: Params;
  readonly combined?: (args: readonly RefinementArg[]) => string | undefined;
  readonly body?: (args: readonly RefinementArg[]) => string;
};

const NUM = `typeof v === "number"`;
const STR = `typeof v === "string"`;

const EMAIL_RE = String.raw`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`;
/** Absolute, with a scheme and an authority: a `Url` is somewhere to go. */
const URL_RE = String.raw`/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#]+\S*$/`;
/** The 8-4-4-4-12 shape, any version, either case. No escape to keep raw. */
const UUID_RE = "/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/";

/** `args[i]` as a number, for an entry the checker has already validated. */
const num = (args: readonly RefinementArg[], i: number): number => Number(args[i]);

const anchored = (pattern: string): string => `^(?:${pattern})$`;

export const REFINEMENTS: ReadonlyMap<string, RefinementEntry> = new Map<string, RefinementEntry>([
  [
    "between",
    {
      tests: "number",
      params: { fixed: ["number", "number"] },
      combined: (a) =>
        num(a, 0) > num(a, 1)
          ? `between(${a[0]}, ${a[1]}) has a lower bound above its upper bound, so no value satisfies it`
          : undefined,
      body: (a) => `${NUM} && v >= ${num(a, 0)} && v <= ${num(a, 1)}`,
    },
  ],
  ["nonempty", { tests: "text", params: { fixed: [] }, body: () => `${STR} && v.length > 0` }],
  [
    "len-eq",
    {
      tests: "text",
      params: { fixed: ["count"] },
      body: (a) => `${STR} && v.length === ${num(a, 0)}`,
    },
  ],
  [
    "len-lt",
    {
      tests: "text",
      params: { fixed: ["count"] },
      // A count, so well formed, and still below every length there is.
      combined: (a) =>
        num(a, 0) === 0
          ? "len-lt(0) is shorter than every text, so no value satisfies it"
          : undefined,
      body: (a) => `${STR} && v.length < ${num(a, 0)}`,
    },
  ],
  [
    "len-gt",
    {
      tests: "text",
      params: { fixed: ["count"] },
      body: (a) => `${STR} && v.length > ${num(a, 0)}`,
    },
  ],
  ["positive", { tests: "number", params: { fixed: [] }, body: () => `${NUM} && v > 0` }],
  ["negative", { tests: "number", params: { fixed: [] }, body: () => `${NUM} && v < 0` }],
  ["email", { tests: "text", params: { fixed: [] }, body: () => `${STR} && ${EMAIL_RE}.test(v)` }],
  ["url", { tests: "text", params: { fixed: [] }, body: () => `${STR} && ${URL_RE}.test(v)` }],
  ["uuid", { tests: "text", params: { fixed: [] }, body: () => `${STR} && ${UUID_RE}.test(v)` }],
  [
    "regex",
    {
      tests: "text",
      params: { fixed: ["text"] },
      combined: (a) => {
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
      tests: "choice",
      params: { rest: "literal", min: 1 },
      body: (a) => `${JSON.stringify(a)}.includes(v)`,
    },
  ],
]);

/** The predicate names the parser accepts — the table's own keys. */
export const REFINEMENT_PREDS: ReadonlySet<string> = new Set(REFINEMENTS.keys());

export function refinementBodyJs(r: Refinement): string | undefined {
  return REFINEMENTS.get(r.pred)?.body?.(r.args);
}

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

export function refinementBaseProblem(
  r: Refinement,
  base: TypeExpr,
  over = `is written over ${typeToString(base)}`,
): string | undefined {
  const tests = REFINEMENTS.get(r.pred)?.tests;
  if (tests === undefined || base.kind === "TypeRef") return undefined;
  const shape = shapeOfBase(base);
  if (tests === "choice" && shape !== undefined) {
    const wrong = r.args.findIndex((a) => shapeOfArg(a) !== shape);
    if (wrong === -1) return undefined;
    return `Refinement "${r.pred}" lists ${showArg(r.args[wrong])} (argument ${wrong + 1}) but ${over}, so no value equals it`;
  }
  if (shape !== undefined && shape === tests) return undefined;
  return `Refinement "${r.pred}" tests ${TESTS_DESCRIPTION[tests]} but ${over}, so no value satisfies it`;
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
