/**
 * The members each standard-library receiver has (docs/spec/stdlib.md §2.2).
 *
 * `recv.m` is a member only when `m` is listed for `recv`'s own type. A name
 * that the runtime understands on *some* receiver is not thereby a member of
 * every one: `Result.filter` was accepted because `Map.filter` exists, and the
 * runtime read the `Result` as a `Map`. A receiver whose type the checker
 * cannot decide is not looked up here at all: codegen lowers it by the
 * member's name alone (the `FieldAccess` / `MethodCall` lowering in
 * `codegen/expr.ts`), which is §2.2.3's name-based dispatch.
 *
 * `show` is not listed here: every value has it (§2.2.7), including a record,
 * so it is `UNIVERSAL_MEMBERS` rather than a line in every row.
 */
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

/** A parameter {@link RECEIVER_PARAMS} types by the receiver, as it writes it. */
export type ReceiverParam = MapParam | SetParam | ListParam;

/**
 * One row of {@link RECEIVER_PARAMS}: every member of `R`, each with its
 * parameters in order, each written as one of `P` or as `null`.
 */
type ParamRow<R extends Receiver, P extends string> = Readonly<
  Record<MemberOf<R>, readonly (P | null)[]>
>;

/**
 * The parameters of each `Map` / `Set` / `List` member, position by position,
 * as the signatures of stdlib.md §2.2.1–§2.2.3 type them — where that type is
 * the receiver's own: a key `K` or value `V` of a `Map(K, V)`, an element `T`
 * of a `Set(T)` or `List(T)`, or another container of the receiver's type,
 * written as the receiver is (`Map(K, V)`, `Set(T)`, `List(T)`).
 *
 * `null` is a parameter the receiver does not type: a fragment the lambda
 * binds (`map`, `filter`, `find`, `sort-by`, `fold`'s second), a `List`'s
 * index or count (`get`, `slice`, `chunk`), `join`'s separator, `fold`'s
 * initial accumulator, and `zip`'s other list, whose element type `U` is its
 * own. `get-or`'s default is `null` too: it is checked against what the call
 * answers, on each receiver that has the member.
 *
 * Every member of the three rows is listed, so a member a row gains without a
 * line here is a `tsc` error.
 */
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

/**
 * The parameters of `member` on a `receiver` {@link RECEIVER_PARAMS} has a row
 * for, or `undefined` when it has none or the row does not list the member.
 */
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

/**
 * True when `member` is listed in `receiver`'s own row — not `show`, which
 * every value has and no row lists. The narrowing is what lets a `switch` over
 * one row's members be checked for having a case for each of them.
 */
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
