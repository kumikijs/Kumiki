// The type names the standard library provides, in one table.
//
// Two consumers used to carry their own list and had already drifted: the
// typechecker had none at all (so `HttpError` was an unresolvable name that
// silently accepted every value), and `dts.ts` had a private `KNOWN_SCALAR`
// covering five of the nine. Both read this now, and `stdlib-types.test.ts`
// drives every entry through both.

import type { Pos, TypeDef, TypeExpr } from "./ast.ts";

/**
 * Synthesised definitions have no source position. Nothing reports at one —
 * `resolveType` only walks types written in the program, and a mismatch is
 * always reported at the offending *expression* — but `TypeExpr` requires the
 * field, so this is the value it gets.
 */
const NO_POS: Pos = { line: 0, col: 0 };

type PrimName = Extract<TypeExpr, { kind: "TypePrim" }>["name"];

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
  fields: Object.entries(fields).map(([name, type]) => ({ name, type })),
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
  def(
    "Route",
    record({
      path: prim("Text"),
      params: app("Map", prim("Text"), prim("Text")),
      query: app("Map", prim("Text"), prim("Text")),
    }),
  ),
  def("FormData", app("Map", prim("Text"), ref("FormValue"))),
  def("FormValue", {
    kind: "TypeUnion",
    variants: [
      { name: "TextV", payloads: [prim("Text")] },
      { name: "NumberV", payloads: [prim("Float")] },
      { name: "BoolV", payloads: [prim("Bool")] },
      { name: "FileV", payloads: [prim("File")] },
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
