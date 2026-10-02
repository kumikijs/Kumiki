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
  Set: ["size", "has", "add", "remove", "toggle", "union", "intersect", "diff", "to-list"],
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
