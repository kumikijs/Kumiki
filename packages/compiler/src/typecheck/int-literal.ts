import { isIntLiteral, type NumberLiteral, numberLiteral, type Pos } from "../ast.ts";
import type { KumikiError, SymbolTable } from "./context.ts";

const SAFE_RANGE = `${Number.MIN_SAFE_INTEGER} through ${Number.MAX_SAFE_INTEGER}`;

/**
 * E0217 for an `Int` literal outside the safe range, or `null`. A literal written with a point is
 * no `Int`, and its mistake is E0201's.
 */
export function intLiteralPrecision(literal: NumberLiteral, pos: Pos): KumikiError | null {
  if (!isIntLiteral(literal) || Number.isSafeInteger(literal.value)) return null;
  return { code: "E0217", kind: "int-literal-precision", message: precisionMessage(literal), pos };
}

// Outside the safe range most integers are rounded to a neighbour, but some are held exactly
// (2^53 is), and saying those were rounded would be false. Past the largest double the literal is
// read as Infinity, which no integer equals.
function precisionMessage({ value, raw }: NumberLiteral): string {
  const outside = `Int literal ${raw} is outside the safe range ${SAFE_RANGE}`;
  const read = Number.isFinite(value) ? BigInt(value) : value;
  return writtenInteger(raw) === read
    ? `${outside}: it is held exactly, but an integer next to it is not`
    : `${outside} and was rounded to ${read}`;
}

/** The integer `raw` spells, or `null` for text that is not a sign and digits. */
function writtenInteger(raw: string): bigint | null {
  return /^[+-]?\d+$/.test(raw) ? BigInt(raw) : null;
}

/**
 * E0217 for each `Int` literal outside the safe range that no declared type read: a `let` value,
 * an operand, the body of a `fn` with no `->`. Where nothing declares a type the literal has the
 * type it is written as: `Int` with no point, `Float` with one, whatever value it holds. One a
 * declared type read was judged there, once.
 */
export function checkUndeclaredIntLiterals(sym: SymbolTable, errors: KumikiError[]): void {
  for (const e of sym.numberLiterals.met) {
    const literal = sym.numberLiterals.judged.has(e) ? null : numberLiteral(e);
    const imprecise = literal && isIntLiteral(literal) ? intLiteralPrecision(literal, e.pos) : null;
    if (imprecise) errors.push(imprecise);
  }
}
