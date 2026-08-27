// The type names the standard library provides, in one table.
//
// Two consumers used to carry their own list and had already drifted: the
// typechecker had none at all (so `HttpError` was an unresolvable name that
// silently accepted every value), and `dts.ts` had a private `KNOWN_SCALAR`
// holding only the scalar nominals — no records, no unions, so `HttpError` and
// `Route` generated `unknown`. Both read this now, and `stdlib-types.test.ts`
// drives every entry through both.

import type { Pos, TypeDef, TypeExpr } from "./ast.ts";

/**
 * Synthesised definitions have no source position. Nothing reports at one —
 * `resolveType` only walks types written in the program, and a mismatch is
 * always reported at the offending *expression* — but `TypeExpr` requires the
 * field, so this is the value it gets.
 */
const NO_POS: Pos = { line: 0, col: 0 };

export type PrimName = Extract<TypeExpr, { kind: "TypePrim" }>["name"];

const prim = (name: PrimName): TypeExpr => ({ kind: "TypePrim", name, pos: NO_POS });
const ref = (name: string): TypeExpr => ({ kind: "TypeRef", name, pos: NO_POS });
const app = (name: string, ...args: TypeExpr[]): TypeExpr => ({
  kind: "TypeApp",
  name,
  args,
  pos: NO_POS,
});
const record = (fields: Record<string, TypeExpr>): TypeExpr => ({
  kind: "TypeRecord",
  fields: Object.entries(fields).map(([name, type]) => ({ name, type, pos: NO_POS })),
  pos: NO_POS,
});
const nominal = (inner: TypeExpr, pred?: string, args: (number | string)[] = []): TypeExpr => ({
  kind: "TypeNominal",
  inner,
  ...(pred ? { refinement: { kind: "Refinement" as const, pred, args, pos: NO_POS } } : {}),
  pos: NO_POS,
});
const def = (name: string, body: TypeExpr, params: string[] = []): TypeDef => ({
  kind: "TypeDef",
  name,
  params,
  body,
  pos: NO_POS,
});

/**
 * Domain types provided by the standard library (docs/spec/stdlib.md §2.1.3).
 *
 * `File` is absent on purpose: the grammar makes it a primitive type name, so a
 * program can never reach a definition under that name. Its fields live in the
 * checker's `PRIM_FIELDS` instead.
 *
 * A program that declares its own `type Route = …` shadows the entry here —
 * these are seeded before the program's definitions, not after.
 */
export const STDLIB_TYPES: readonly TypeDef[] = [
  def("HttpStatus", nominal(prim("Int"), "between", [100, 599])),
  def(
    "HttpError",
    record({
      status: ref("HttpStatus"),
      message: prim("Text"),
      body: app("Option", prim("Text")),
    }),
  ),
  def("Url", nominal(prim("Text"), "url")),
  def("Email", nominal(prim("Text"), "email")),
  def("Uuid", nominal(prim("Text"), "uuid")),
  def("Duration", nominal(prim("Int"))),
  // The five fields routing.md §3.2 documents, which is what a program reads.
  // (`parseLocation` also carries `childPattern` for `route-outlet`; that one
  // is runtime bookkeeping and is deliberately not part of the type.)
  // `pattern` and `hash` were missing here, so a provider signature generated
  // for a `Route` typed them as `unknown`.
  def(
    "Route",
    record({
      path: prim("Text"),
      pattern: prim("Text"),
      params: app("Map", prim("Text"), prim("Text")),
      query: app("Map", prim("Text"), prim("Text")),
      hash: app("Option", prim("Text")),
    }),
  ),
  def("FormData", app("Map", prim("Text"), ref("FormValue"))),
  // The payload of `app.error` and of an `error-boundary` tile's `in=`
  // (docs/spec/lifecycle.md §7.2.3). Filed with the domain types rather than
  // with lifecycle because a program names it exactly the way it names `Route`.
  def(
    "PanicInfo",
    record({
      message: prim("Text"),
      location: prim("Text"),
      "episode-id": prim("Text"),
      cause: app("Option", prim("Text")),
      category: prim("Text"),
    }),
  ),
  def("FormValue", {
    kind: "TypeUnion",
    variants: [
      { name: "TextV", payloads: [prim("Text")], pos: NO_POS },
      { name: "NumberV", payloads: [prim("Float")], pos: NO_POS },
      { name: "BoolV", payloads: [prim("Bool")], pos: NO_POS },
      { name: "FileV", payloads: [prim("File")], pos: NO_POS },
    ],
    pos: NO_POS,
  }),
];

/**
 * Generic type constructors with no definition to look up (stdlib §2.1.2), and
 * the number of arguments each takes. `Tuple` is variadic — `null` means the
 * arity check does not apply.
 */
export const BUILTIN_TYPE_CONSTRUCTORS: ReadonlyMap<string, number | null> = new Map([
  ["List", 1],
  ["Set", 1],
  ["Map", 2],
  ["Option", 1],
  ["Result", 2],
  ["Tuple", null],
]);

/**
 * The primitive type names (stdlib §2.1.1). The grammar turns these into
 * `TypePrim` rather than a name lookup, so they never reach the symbol table —
 * but a *misspelling* of one does, as an unresolvable `TypeRef`, which is
 * exactly when a repair needs them as candidates.
 */
const PRIM_TYPE_NAMES: readonly PrimName[] = [
  "Text",
  "Int",
  "Float",
  "Bool",
  "Unit",
  "Bytes",
  "Time",
  "File",
  "EffectId",
];

const PRIM_TYPE_NAME_SET: ReadonlySet<string> = new Set(PRIM_TYPE_NAMES);

/**
 * Whether `name` is a primitive type name. Separate from the symbol table
 * because the grammar resolves these itself: a primitive is a `TypePrim`, so
 * asking `sym.types` about `Int` answers no.
 */
export function isPrimTypeName(name: string): boolean {
  return PRIM_TYPE_NAME_SET.has(name);
}

/**
 * Every type name a program may write, given its own `type` definitions. The
 * candidate set `kumiki fix` suggests from for E0117 — a name from another
 * namespace would be E0117 again at the same position, so only type names
 * belong here.
 */
export function typeCandidates(userTypeNames: Iterable<string>): string[] {
  // The program's own names come first so an equidistant tie resolves to one
  // of them: `Filtre` is two edits from both the declared `Filter` and the
  // built-in `File`, and the declared type is the one the author meant.
  return [
    ...userTypeNames,
    ...STDLIB_TYPES.map((t) => t.name),
    ...BUILTIN_TYPE_CONSTRUCTORS.keys(),
    ...PRIM_TYPE_NAMES,
  ];
}
