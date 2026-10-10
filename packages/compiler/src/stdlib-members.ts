export const RECEIVER_MEMBERS = {
  Map: [
    "keys",
    "values",
    "entries",
    "size",
    "is-empty",
    "has",
    "get",
    "get-or",
    "insert",
    "remove",
    "update",
    "merge",
    "filter",
    "map",
  ],
  Set: [
    "size",
    "has",
    "add",
    "remove",
    "toggle",
    "union",
    "intersect",
    "diff",
    "filter",
    "to-list",
  ],
  List: [
    "length",
    "is-empty",
    "get",
    "head",
    "tail",
    "last",
    "push",
    "prepend",
    "concat",
    "slice",
    "reverse",
    "sort",
    "sort-by",
    "unique",
    "map",
    "filter",
    "contains",
    "find",
    "fold",
    "join",
    "chunk",
    "zip",
  ],
  Option: ["is-some", "is-none", "get", "get-or", "map", "flat-map", "filter", "or", "to-list"],
  Result: [
    "is-ok",
    "is-err",
    "get",
    "get-err",
    "get-or",
    "map",
    "map-err",
    "flat-map",
    "or",
    "to-option",
  ],
  Text: [
    "length",
    "is-empty",
    "upper",
    "lower",
    "trim",
    "starts-with",
    "ends-with",
    "contains",
    "split",
    "replace",
    "slice",
    "parse-int",
    "parse-float",
  ],
  Int: [
    "abs",
    "neg",
    "min",
    "max",
    "clamp",
    "floor",
    "ceil",
    "round",
    "sqrt",
    "log",
    "exp",
    "pow",
    "to-float",
  ],
  Float: [
    "abs",
    "neg",
    "min",
    "max",
    "clamp",
    "floor",
    "ceil",
    "round",
    "sqrt",
    "log",
    "exp",
    "pow",
    "to-int",
  ],
  Bool: [],
  Time: ["plus", "minus", "diff", "format", "to-ms"],
  Duration: ["to-ms"],
  Bytes: [],
  File: [],
} as const satisfies Record<string, readonly string[]>;

/** Every value has these, whatever its type. */
export const UNIVERSAL_MEMBERS: ReadonlySet<string> = new Set(["show"]);

export type Receiver = keyof typeof RECEIVER_MEMBERS;
export type MemberOf<R extends Receiver> = (typeof RECEIVER_MEMBERS)[R][number];

type MapParam = "K" | "V" | "Map(K, V)";
type SetParam = "T" | "Set(T)";
type ListParam = "T" | "List(T)";

export type ReceiverParam = MapParam | SetParam | ListParam;

type ParamRow<R extends Receiver, P extends string> = Readonly<
  Record<MemberOf<R>, readonly (P | null)[]>
>;

// `null` is a parameter the receiver does not type. `get-or`'s default is one: it is checked
// against what the call answers. Every member of the three rows is listed, so a member a row
// gains without a line here is a `tsc` error.
export const RECEIVER_PARAMS = {
  Map: {
    keys: [],
    values: [],
    entries: [],
    size: [],
    "is-empty": [],
    has: ["K"],
    get: ["K"],
    "get-or": ["K", null],
    insert: ["K", "V"],
    remove: ["K"],
    // The fragment answers the entry's new value.
    update: ["K", "V"],
    merge: ["Map(K, V)"],
    filter: [null],
    map: [null],
  },
  Set: {
    size: [],
    has: ["T"],
    add: ["T"],
    remove: ["T"],
    toggle: ["T"],
    union: ["Set(T)"],
    intersect: ["Set(T)"],
    diff: ["Set(T)"],
    filter: [null],
    "to-list": [],
  },
  List: {
    length: [],
    "is-empty": [],
    get: [null],
    head: [],
    tail: [],
    last: [],
    push: ["T"],
    prepend: ["T"],
    concat: ["List(T)"],
    slice: [null, null],
    reverse: [],
    sort: [],
    "sort-by": [null],
    unique: [],
    map: [null],
    filter: [null],
    contains: ["T"],
    find: [null],
    fold: [null, null],
    join: [null],
    chunk: [null],
    zip: [null],
  },
} as const satisfies {
  Map: ParamRow<"Map", MapParam>;
  Set: ParamRow<"Set", SetParam>;
  List: ParamRow<"List", ListParam>;
};

export function receiverParams(
  receiver: string,
  member: string,
): readonly (ReceiverParam | null)[] | undefined {
  if (!Object.hasOwn(RECEIVER_PARAMS, receiver)) return undefined;
  const row: Readonly<Record<string, readonly (ReceiverParam | null)[]>> =
    RECEIVER_PARAMS[receiver as keyof typeof RECEIVER_PARAMS];
  return Object.hasOwn(row, member) ? row[member] : undefined;
}

const MEMBER_SETS = new Map<string, ReadonlySet<string>>(
  Object.entries(RECEIVER_MEMBERS).map(([r, ms]) => [r, new Set<string>(ms)]),
);

/** True when `r` is a receiver this table speaks for. */
export function isReceiver(r: string): r is Receiver {
  return MEMBER_SETS.has(r);
}

export function isOwnMember<R extends Receiver>(
  receiver: R,
  member: string,
): member is MemberOf<R> {
  return MEMBER_SETS.get(receiver)?.has(member) ?? false;
}

/** True when `member` is a member of `receiver` — its own, or one every value has. */
export function hasMember(receiver: Receiver, member: string): boolean {
  return UNIVERSAL_MEMBERS.has(member) || (MEMBER_SETS.get(receiver)?.has(member) ?? false);
}

/** The receivers that do have `member`, for a diagnostic that names them. */
export function receiversOf(member: string): Receiver[] {
  return (Object.keys(RECEIVER_MEMBERS) as Receiver[]).filter((r) =>
    MEMBER_SETS.get(r)?.has(member),
  );
}
