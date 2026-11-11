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
const union = (variants: Record<string, TypeExpr[]>): TypeExpr => ({
  kind: "TypeUnion",
  variants: Object.entries(variants).map(([name, payloads]) => ({ name, payloads, pos: NO_POS })),
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
 * carries an optional `childPattern`, which picks the tile `route-outlet` renders and the sub-route
 * a route event fires for; that is runtime bookkeeping, not part of the type.
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
// `pattern` the reducer names. It is not a `PanicInfo`, because a record type matches only its own field set.
export const ROUTE_ERROR_INFO_TYPE: RecordType = record({
  ...PANIC_INFO_FIELDS,
  pattern: prim("Text"),
});

// `route`, `$route` and a panic reducer's `$event` are typed from the exports above.
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
  // A decoder runs as a sentinel or a check, which no literal spells, so its body is a primitive
  // only `Decoder.*` produces. The parser leaves the name to this entry, so a type parameter of
  // that name is still the parameter.
  def("Decoder", prim("Decoder")),
  def("Route", ROUTE_TYPE),
  def("FormData", app("Map", prim("Text"), ref("FormValue"))),
  def("PanicInfo", PANIC_INFO_TYPE),
  def("RouteErrorInfo", ROUTE_ERROR_INFO_TYPE),
  def(
    "FormValue",
    union({
      TextV: [prim("Text")],
      NumberV: [prim("Float")],
      BoolV: [prim("Bool")],
      FileV: [prim("File")],
    }),
  ),
  // The HTTP handler sends a body by its tag, and a body that has none of these tags as JSON.
  def(
    "HttpBody",
    union({
      Json: [ref("T")],
      Form: [app("Map", prim("Text"), prim("Text"))],
      Multipart: [app("Map", prim("Text"), ref("FormValue"))],
      Text: [prim("Text")],
      Bytes: [prim("Bytes")],
      Empty: [],
    }),
    ["T"],
  ),
  // The fields are `IDBKeyRange`'s, which the IndexedDB handler builds from them.
  def(
    "IndexRange",
    record({
      lower: app("Option", ref("K")),
      upper: app("Option", ref("K")),
      lowerOpen: prim("Bool"),
      upperOpen: prim("Bool"),
    }),
    ["K"],
  ),
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
  "Decoder",
  "HttpBody",
  "IndexRange",
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

// `Option` and `Result` have no body to read tags from. The tags of `FormValue` and `HttpBody`
// come from their definitions above.
export const BUILTIN_UNION_TAGS: ReadonlyMap<string, readonly string[]> = new Map([
  ["Option", ["Some", "None"]],
  ["Result", ["Ok", "Err"]],
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

// The primitives and the constructors are read from the tables the parser and
// the checker resolve those names by, so a name added to either is reserved with
// no second list to update; the runtime-supplied names are a list of their own.
// A program's definition under any of them could only be half-applied.
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
  return [
    ...userTypeNames,
    ...STDLIB_TYPES.map((t) => t.name),
    ...BUILTIN_TYPE_CONSTRUCTORS.keys(),
    ...PRIM_TYPE_NAMES,
  ];
}
