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
type RecordType = Extract<TypeExpr, { kind: "TypeRecord" }>;

const record = (fields: Record<string, TypeExpr>): RecordType => ({
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

/**
 * The record the runtime keeps in the `route` slot; its field names must be `emptyRoute()`'s keys,
 * or a test's `route` seed is refused or left partly undefined. The runtime's `ParsedRoute` also
 * carries an optional `childPattern` for `route-outlet`; that is runtime bookkeeping, not part of
 * the type.
 */
export const ROUTE_TYPE: RecordType = record({
  path: prim("Text"),
  pattern: prim("Text"),
  params: app("Map", prim("Text"), prim("Text")),
  query: app("Map", prim("Text"), prim("Text")),
  hash: app("Option", prim("Text")),
});

const PANIC_INFO_FIELDS = {
  message: prim("Text"),
  location: prim("Text"),
  "episode-id": app("Option", prim("Text")),
  cause: app("Option", prim("Text")),
  category: prim("Text"),
};

export const PANIC_INFO_TYPE: RecordType = record(PANIC_INFO_FIELDS);

// What a `route.error(<pattern>)` reducer is handed as `$event`: a `PanicInfo`'s fields and the
// matched `pattern`. It is not a `PanicInfo`, because a record type matches only its own field set.
export const ROUTE_ERROR_INFO_TYPE: RecordType = record({
  ...PANIC_INFO_FIELDS,
  pattern: prim("Text"),
});

// A program cannot declare its own `type Route`, `type PanicInfo` or `type RouteErrorInfo` (E0231,
// `RUNTIME_SUPPLIED_TYPE_NAMES`). The values the runtime builds (`route`, `$route`, a panic reducer's
// `$event`) are typed from the exports above, because the runtime builds them whatever the program
// declares.
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
  def("Route", ROUTE_TYPE),
  def("FormData", app("Map", prim("Text"), ref("FormValue"))),
  def("PanicInfo", PANIC_INFO_TYPE),
  def("RouteErrorInfo", ROUTE_ERROR_INFO_TYPE),
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
export const RUNTIME_SUPPLIED_TYPE_NAMES: ReadonlySet<string> = new Set([
  "PanicInfo",
  "RouteErrorInfo",
  "Route",
  "HttpError",
  "HttpStatus",
  "Duration",
  "FormValue",
]);

// A browser reads a file's bytes only asynchronously, so the record a `change` event
// delivers cannot hold them; they are not a field. `File` stays a `TypePrim` with this
// side table, not a record in `STDLIB_TYPES` like `Route`: a record type would accept any
// `{name, size, type}` literal as a `File`, and that value has no `_file` for a `FileV`
// part or `file-url()` to read. As a prim, a `File` is only ever one the runtime made.
export const FILE_FIELDS: RecordType = record({
  name: prim("Text"),
  size: prim("Int"),
  type: prim("Text"),
});

export const BUILTIN_TYPE_CONSTRUCTORS: ReadonlyMap<string, number | null> = new Map([
  ["List", 1],
  ["Set", 1],
  ["Map", 2],
  ["Option", 1],
  ["Result", 2],
  ["Tuple", null],
]);

export const PRIM_TYPE_NAMES: readonly PrimName[] = [
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

export type ReservedTypeReason = "primitive" | "constructor" | "runtime-supplied";

// Read from the tables the parser and the checker resolve these names by, so a
// name added to one is reserved with no second list to update. A program's
// definition under one could only be half-applied.
export function reservedTypeReason(name: string): ReservedTypeReason | undefined {
  if (isPrimTypeName(name)) return "primitive";
  if (BUILTIN_TYPE_CONSTRUCTORS.has(name)) return "constructor";
  if (RUNTIME_SUPPLIED_TYPE_NAMES.has(name)) return "runtime-supplied";
  return undefined;
}

export function isReservedTypeName(name: string): boolean {
  return reservedTypeReason(name) !== undefined;
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
