// What a type-member call's qualifier resolves to, and how `T.parse(text)`
// reads its text — the answers the checker and the lowering share.
//
// What decides the conversion is the base the qualifier unaliases to, not the
// name it is written with: a nominal is named for itself, so a branch on the
// name read `type Cents = nominal Int` as text. Only the type table knows the
// base, so the question is asked here, of the table, by both sides.

import { isKnownTypeName, type TypeEnv, unaliasType } from "./assignable.ts";
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
 * qualifier that unaliases to it (stdlib §2.4.3 is the table):
 *
 * - `Int` — an optional sign and decimal digits, nothing else.
 * - `Float` — an optional sign, decimal digits, an optional fraction and an
 *   optional exponent, spelling a finite number.
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
 * What `qualifier.parse(text)` reads its text as:
 *
 * - `reading` — the base it lowers by.
 * - `none` — the qualifier names a type, and no text spells a value of it: a
 *   record, a union, a container, `File`, `EffectId`, `Unit`, a nominal over
 *   any of them, or a type constructor written without its arguments. The call
 *   is the checker's to report (E0802).
 * - `unresolved` — the qualifier names nothing, or a definition whose body
 *   resolves to nothing (an alias of an undefined name, a cycle). That is
 *   E0117's / E0009's to report where it is written, and the parse has no base
 *   to judge, so it adds nothing.
 */
export type ParseQualifier =
  | { readonly kind: "reading"; readonly reading: ParseReading }
  | { readonly kind: "none" }
  | { readonly kind: "unresolved" };

export function parseQualifier(qualifier: string, env: TypeEnv): ParseQualifier {
  if (!isPrimTypeName(qualifier) && !isKnownTypeName(qualifier, env)) {
    return { kind: "unresolved" };
  }
  const named = qualifierType(qualifier, { line: 0, col: 0 }, env);
  // A known name that is not a complete type: a built-in constructor or a
  // program-defined generic, written without its arguments.
  if (named === null) return { kind: "none" };
  const base = unaliasType(named, env);
  if (base === null) return { kind: "unresolved" };
  if (base.kind === "TypeRef" && !env.types.has(base.name)) return { kind: "unresolved" };
  return base.kind === "TypePrim" && isParseReading(base.name)
    ? { kind: "reading", reading: base.name }
    : { kind: "none" };
}
