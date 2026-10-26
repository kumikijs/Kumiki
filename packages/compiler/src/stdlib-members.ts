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
  EffectId: [],
} as const satisfies Record<string, readonly string[]>;

/** Every value has these, whatever its type. `show` on an `EffectId` is E0204, refused where the value is shown rather than by this set. */
export const UNIVERSAL_MEMBERS: ReadonlySet<string> = new Set(["show"]);

export type Receiver = keyof typeof RECEIVER_MEMBERS;
export type MemberOf<R extends Receiver> = (typeof RECEIVER_MEMBERS)[R][number];

// `self` is the receiver's own type: the `other` of `Map.merge`, `Set.union` or `List.concat`.
type MapParam = "K" | "V" | "self";
type SetParam = "T" | "self";
type ListParam = "T" | "self";

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
    merge: ["self"],
    filter: [null],
    map: [null],
  },
  Set: {
    size: [],
    has: ["T"],
    add: ["T"],
    remove: ["T"],
    toggle: ["T"],
    union: ["self"],
    intersect: ["self"],
    diff: ["self"],
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
    concat: ["self"],
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

// The type parameters of each receiver a fragment's positional can be, named as stdlib.md names
// them in its signatures.
type FragmentParams = { List: "T"; Option: "T"; Result: "T" | "E"; Map: "K" | "V" };

export type FragmentReceiver = keyof FragmentParams;

/** `Acc` is `fold`'s accumulator, whose type is its init's. */
export type FragmentPositional = FragmentParams[FragmentReceiver] | "Acc";

/** Which type argument of its receiver each type parameter is. */
export const TYPE_ARGUMENT_OF = { T: 0, K: 0, V: 1, E: 1 } as const satisfies Record<
  FragmentParams[FragmentReceiver] | Exclude<ReceiverParam, "self">,
  number
>;

type HavingMethod<M extends string> = {
  [R in FragmentReceiver]: R extends Receiver ? (M extends MemberOf<R> ? R : never) : never;
}[FragmentReceiver];

// A row is keyed only by a receiver that has the method, and names only that receiver's type
// parameters. `second` is absent where the fragment binds `$1` alone.
type FragmentRow<M extends string> =
  | {
      readonly index: number;
      readonly second?: undefined;
      readonly on: { readonly [R in HavingMethod<M>]?: readonly [FragmentParams[R]] };
    }
  | {
      readonly index: number;
      readonly second: "pair-value";
      readonly on: {
        readonly [R in HavingMethod<M>]?: R extends "Map"
          ? readonly ["K", "V"]
          : readonly [FragmentParams[R]];
      };
    }
  | {
      readonly index: number;
      readonly second: "element";
      readonly on: { readonly List: readonly ["Acc", "T"] };
    };

type FragmentMethod =
  | "filter"
  | "map"
  | "find"
  | "sort-by"
  | "fold"
  | "flat-map"
  | "update"
  | "map-err";

/**
 * Where each method's fragment argument is (`index`), and what the checker types its
 * positionals as, `$1` first. On a `pair-value` row the length also decides the shape the lowering
 * takes apart: two positionals are a Map's key and value; one is the element, split if a pair.
 * A receiver that has the method but no row binds them with no type: a `Set`'s `filter` is handed
 * each member as an `[element, true]` entry, which a one-positional row would bind to `$1` whole.
 * A receiver without the method is E0108.
 */
export const FRAGMENT_ARGUMENTS = {
  filter: { index: 0, second: "pair-value", on: { List: ["T"], Option: ["T"], Map: ["K", "V"] } },
  map: {
    index: 0,
    second: "pair-value",
    on: { List: ["T"], Option: ["T"], Result: ["T"], Map: ["K", "V"] },
  },
  find: { index: 0, second: "pair-value", on: { List: ["T"] } },
  "sort-by": { index: 0, second: "pair-value", on: { List: ["T"] } },
  fold: { index: 1, second: "element", on: { List: ["Acc", "T"] } },
  "flat-map": { index: 0, on: { Option: ["T"], Result: ["T"] } },
  update: { index: 1, on: { Map: ["V"] } },
  "map-err": { index: 0, on: { Result: ["E"] } },
} as const satisfies { readonly [M in FragmentMethod]: FragmentRow<M> };

export type FragmentPositionals =
  | readonly [FragmentPositional]
  | readonly [FragmentPositional, FragmentPositional];

export type FragmentArgument = {
  readonly index: number;
  readonly second?: "pair-value" | "element";
  readonly on: Readonly<Partial<Record<FragmentReceiver, FragmentPositionals>>>;
};

const FRAGMENT_ROWS: ReadonlyMap<string, FragmentArgument> = new Map(
  Object.entries(FRAGMENT_ARGUMENTS),
);

/** The fragment argument of `method`, or `undefined` when it takes none. */
export function fragmentArgument(method: string): FragmentArgument | undefined {
  return FRAGMENT_ROWS.get(method);
}

/** How many positionals the fragment binds: a `second` binds `$2` as well. */
export function fragmentBinds(fragment: FragmentArgument): 1 | 2 {
  return fragment.second === undefined ? 1 : 2;
}

const PARAM_ROWS = new Map<string, ReadonlyMap<string, readonly (ReceiverParam | null)[]>>(
  Object.entries(RECEIVER_PARAMS).map(([r, row]) => [r, new Map(Object.entries(row))]),
);

/** The parameters of `receiver.member`, or `undefined` when the table has no row for it. */
export function receiverParams(
  receiver: string,
  member: string,
): readonly (ReceiverParam | null)[] | undefined {
  return PARAM_ROWS.get(receiver)?.get(member);
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
