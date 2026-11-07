import type { Pos } from "../ast.ts";
import type { KumikiError } from "./context.ts";

/** A number literal: the text it is written as, its sign included, and the number it was read as. */
export type NumberLiteral = { readonly value: number; readonly raw: string };

const SAFE_RANGE = `${Number.MIN_SAFE_INTEGER} through ${Number.MAX_SAFE_INTEGER}`;

/**
 * E0217 for an `Int` literal outside the safe range, or `null`. A literal with a fraction is no
 * `Int`, and its mistake is E0201's.
 */
export function intLiteralPrecision(literal: NumberLiteral, pos: Pos): KumikiError | null {
  if (!Number.isInteger(literal.value) || Number.isSafeInteger(literal.value)) return null;
  return { code: "E0217", kind: "int-literal-precision", message: precisionMessage(literal), pos };
}

// Outside the safe range most integers are rounded to a neighbour, but some are held exactly
// (2^53 is), and saying those were rounded would be false.
function precisionMessage({ value, raw }: NumberLiteral): string {
  const outside = `Int literal ${raw} is outside the safe range ${SAFE_RANGE}`;
  const read = BigInt(value);
  return writtenInteger(raw) === read
    ? `${outside}: it is held exactly, but an integer next to it is not`
    : `${outside} and was rounded to ${read}`;
}

/** The integer `raw` spells, or `null` when a digit after its point is not zero. */
function writtenInteger(raw: string): bigint | null {
  const [whole = "", fraction = ""] = raw.split(".");
  return /^0*$/.test(fraction) ? BigInt(whole) : null;
}
