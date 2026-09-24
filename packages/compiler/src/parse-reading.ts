// What a type-member call's qualifier resolves to, and how `T.parse(text)`
// reads its text — the answers the checker and the lowering share.
//
// `parse` used to branch on the qualifier's *name*: `Int`, `Float` and `Time`
// converted, and every other qualifier fell into a branch that wrapped the raw
// string. A nominal is named for itself, not for its base, so
// `type Cents = nominal Int` parsed to a `Text` and the sum after it
// concatenated (#431); `Duration`, the standard library's `nominal Int`, did
// the same (#424). What decides the conversion is the base the qualifier
// unaliases to, and only the type table knows that — so the question is asked
// here, of the table, by both sides.

import { type TypeEnv, unaliasType } from "./assignable.ts";
import type { Pos, TypeExpr } from "./ast.ts";
import { isPrimTypeName } from "./stdlib-types.ts";

/**
 * The type a call's qualifier names, or `null` when it names none.
 *
 * A primitive is answered first because the grammar resolves those itself — a
 * `TypePrim`, never a symbol-table entry — so the type table has no `Int`.
 *
 * A definition answers only when it is complete on its own, and that half is
 * the load-bearing one: an unapplied `TypeRef` to a `type Box(T) = …` unaliases
 * into an unsubstituted body and mismatches against real types, so `Box.fresh()`
 * would report a type the author never wrote. An *unresolvable* name costs
 * nothing by comparison — `relate` short-circuits on a `TypeRef` it cannot
 * unalias, which is how `unknownType` (literally `TypeRef "?"`) works — so
 * answering `null` for one only keeps this function honest; E0117 is the report
 * either way. That is why `isKnownTypeName`, the resolution rule E0117 applies,
 * is not the rule here: naming a type is what makes a qualifier legal, and
 * *being* one is what lets it answer.
 */
export function qualifierType(name: string, pos: Pos, env: TypeEnv): TypeExpr | null {
  if (isPrimTypeName(name)) return { kind: "TypePrim", name, pos };
  const def = env.types.get(name);
  return def !== undefined && def.params.length === 0 ? { kind: "TypeRef", name, pos } : null;
}

/**
 * The bases a text has a reading as. Each is how `T.parse` lowers for a
 * qualifier that unaliases to it:
 *
 * - `Int` / `Float` — the number the text spells (`Int` truncated), `None` for
 *   blank text or text that spells no finite number.
 * - `Time` — the instant as a millisecond number (stdlib §2.2.9).
 * - `Bool` — `"true"` / `"false"`, the two spellings `.show` produces.
 * - `Text` — the text itself, `None` when it is empty.
 * - `Bytes` — the UTF-8 bytes of the text, `None` when it is empty.
 */
export type ParseReading = "Int" | "Float" | "Time" | "Bool" | "Text" | "Bytes";

const READINGS: ReadonlySet<string> = new Set<ParseReading>([
  "Int",
  "Float",
  "Time",
  "Bool",
  "Text",
  "Bytes",
]);

function isParseReading(name: string): name is ParseReading {
  return READINGS.has(name);
}

/**
 * The reading `qualifier.parse(text)` lowers to, or `null` when there is none:
 * the qualifier names no complete type (misspelt, or a constructor still
 * wanting its arguments), or it names one whose base no text spells — a
 * record, a union, `File`, `EffectId`, `Unit`, or a nominal over any of them.
 */
export function parseReading(qualifier: string, env: TypeEnv): ParseReading | null {
  const base = unaliasType(qualifierType(qualifier, { line: 0, col: 0 }, env), env);
  return base?.kind === "TypePrim" && isParseReading(base.name) ? base.name : null;
}
