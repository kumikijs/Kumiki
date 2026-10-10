import type { Pos, TypeDef, TypeExpr } from "./ast.ts";

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

export { app as appType, prim as primType, record as recordType, ref as refType };

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

export const STDLIB_TYPES: readonly TypeDef[] = [
  def("HttpStatus", nominal(prim("Int"), "between", [0, 599])),
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
      pattern: prim("Text"),
      params: app("Map", prim("Text"), prim("Text")),
      query: app("Map", prim("Text"), prim("Text")),
      hash: app("Option", prim("Text")),
    }),
  ),
  def("FormData", app("Map", prim("Text"), ref("FormValue"))),
  def(
    "PanicInfo",
    record({
      message: prim("Text"),
      location: prim("Text"),
      "episode-id": app("Option", prim("Text")),
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

// The runtime or the standard library builds or reads values of these, so a
// program's own definition would be what the checker reasoned about while the
// runtime kept to the entry above. The other entries name types only a program
// builds values of, and a program may declare its own.
export const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  "PanicInfo",
  "Route",
  "HttpError",
  "HttpStatus",
  "Duration",
  "FormValue",
]);

export function isReservedTypeName(name: string): boolean {
  return RESERVED_TYPE_NAMES.has(name);
}

export const BUILTIN_TYPE_CONSTRUCTORS: ReadonlyMap<string, number | null> = new Map([
  ["List", 1],
  ["Set", 1],
  ["Map", 2],
  ["Option", 1],
  ["Result", 2],
  ["Tuple", null],
]);

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

export function isPrimTypeName(name: string): name is PrimName {
  return PRIM_TYPE_NAME_SET.has(name);
}

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
