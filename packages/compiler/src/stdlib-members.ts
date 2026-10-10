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

/** Every value has these, whatever its type — but an `EffectId`, which has no member at all. */
export const UNIVERSAL_MEMBERS: ReadonlySet<string> = new Set(["show"]);

export type Receiver = keyof typeof RECEIVER_MEMBERS;
export type MemberOf<R extends Receiver> = (typeof RECEIVER_MEMBERS)[R][number];

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
