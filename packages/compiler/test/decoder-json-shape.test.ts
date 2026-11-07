import { describe, expect, it } from "vitest";
import { decodeHandedBy } from "./helpers/module.ts";

const TYPES = `
type User    = {id: Int, name: Text}
type Cents   = nominal Int
type Tag     = nominal Text
type Owner   = {id: Tag}
type Shape   = Circle(Float) | Square(Float, Float) | Dot
type Tree    = {v: Int, kids: List(Tree)}
type Page(T) = {items: List(T), next: Option(Int)}
type Due     = nominal Time
type Stamp   = {at: Time}
type When    = At(Time) | Never
`;

/** A program whose one storage read decodes with `decoder`. */
const program = (decoder: string): string => `
${TYPES}

effect load cap=storage.read
            in=Unit
            out=Result(Option(Text), Text)
            map-request={key: "k", decode: ${decoder}}

tile App = text("x")

app D
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

type Failure = { kind: string; args: unknown[]; path: unknown[] };
type Check = (v: unknown) => Failure | undefined;

async function checkOf(t: string): Promise<Check> {
  const decode = await decodeHandedBy(program(`Decoder.Json(${t})`));
  if (typeof decode !== "function") expect.fail(`Decoder.Json(${t}) lowered to ${String(decode)}`);
  return decode as Check;
}

const failure = (kind: string, path: unknown[] = []): Failure => ({ kind, args: [], path });

// 2026-03-07T10:00:00Z
const AT = 1772877600000;

describe("Decoder.Json(T) refuses a value that is not a T", () => {
  it.each([
    {
      t: "User",
      value: { id: "7", title: "not a user" },
      refused: failure("expected Int", ["id"]),
    },
    { t: "User", value: { id: 7 }, refused: failure("missing", ["name"]) },
    { t: "User", value: [7, "Ann"], refused: failure("expected User") },
    { t: "User", value: null, refused: failure("expected User") },
    { t: "User", value: { id: 7.5, name: "Ann" }, refused: failure("expected Int", ["id"]) },
    { t: "{id: Int, name: Text}", value: "x", refused: failure("expected {id: Int, name: Text}") },
    { t: "List(Int)", value: [1, "2"], refused: failure("expected Int", [1]) },
    { t: "List(Int)", value: { 0: 1 }, refused: failure("expected List(Int)") },
    {
      t: "Option(Text)",
      value: { _tag: "Some", _0: 1 },
      refused: failure("expected Text", [{ variant: "Some" }]),
    },
    { t: "Option(Text)", value: null, refused: failure("expected Option(Text)") },
    { t: "Option(Text)", value: "x", refused: failure("expected Option(Text)") },
    {
      t: "Map(Text, Int)",
      value: { a: 1, b: "2" },
      refused: failure("expected Int", [{ entry: "b" }]),
    },
    { t: "Map(Text, Int)", value: [1], refused: failure("expected Map(Text, Int)") },
    { t: "Map(Int, Text)", value: { x: "y" }, refused: failure("expected Int", [{ key: "x" }]) },
    {
      t: "Map(Int, Text)",
      value: { "07": "y" },
      refused: failure("expected Int", [{ key: "07" }]),
    },
    {
      t: "Map(Shape, Int)",
      value: { Dot: 1 },
      refused: failure("expected Shape", [{ key: "Dot" }]),
    },
    { t: "Shape", value: { _tag: "Hexagon" }, refused: failure("expected Shape") },
    { t: "Shape", value: "Dot", refused: failure("expected Shape") },
    {
      t: "Shape",
      value: { _tag: "Circle", _0: "1" },
      refused: failure("expected Float", [{ variant: "Circle" }]),
    },
    {
      t: "Shape",
      value: { _tag: "Square", _0: 1, _1: null },
      refused: failure("expected Float", [{ variant: "Square", payload: 1 }]),
    },
    { t: "Cents", value: "5", refused: failure("expected Cents") },
    { t: "Owner", value: { id: 7 }, refused: failure("expected Tag", ["id"]) },
    { t: "Set(Text)", value: ["a"], refused: failure("expected Set(Text)") },
    { t: "Set(Text)", value: { a: 1 }, refused: failure("expected Set(Text)") },
    { t: "Map(Bool, Int)", value: { yes: 1 }, refused: failure("expected Bool", [{ key: "yes" }]) },
    {
      t: "Map(Tuple(Int, Int), Text)",
      value: { "[1, 2]": "x" },
      refused: failure("expected Tuple(Int, Int)", [{ key: "[1, 2]" }]),
    },
    {
      t: "Map(Tuple(Int, Int), Text)",
      value: { '[1,"2"]': "x" },
      refused: failure("expected Int", [{ key: '[1,"2"]' }, 1]),
    },
    { t: "Set(Int)", value: { a: true }, refused: failure("expected Int", [{ member: "a" }]) },
    { t: "Tuple(Int, Text)", value: [1], refused: failure("expected Tuple(Int, Text)") },
    { t: "Tuple(Int, Text)", value: [1, 2], refused: failure("expected Text", [1]) },
    {
      t: "Result(Int, Text)",
      value: { _tag: "Ok", _0: "1" },
      refused: failure("expected Int", [{ variant: "Ok" }]),
    },
    { t: "Bool", value: "true", refused: failure("expected Bool") },
    { t: "Unit", value: 0, refused: failure("expected Unit") },
    { t: "Bytes", value: "aGk=", refused: failure("expected Bytes") },
    {
      t: "Tree",
      value: { v: 1, kids: [{ v: 2, kids: [{ v: "3", kids: [] }] }] },
      refused: failure("expected Int", ["kids", 0, "kids", 0, "v"]),
    },
    {
      t: "Page(User)",
      value: { items: [{ id: 1 }], next: { _tag: "None" } },
      refused: failure("missing", ["items", 0, "name"]),
    },
  ])("refuses $value as $t", async ({ t, value, refused }) => {
    expect((await checkOf(t))(value)).toEqual(refused);
  });

  it.each([
    { t: "User", value: { id: 7, name: "Ann" } },
    { t: "User", value: { id: 7, name: "Ann", title: "kept as it came" } },
    { t: "Float", value: 1 },
    { t: "Float", value: Number.POSITIVE_INFINITY },
    { t: "Option(Text)", value: { _tag: "None" } },
    { t: "Map(Int, Text)", value: { 7: "x", "-1": "y" } },
    { t: "Map(Bool, Int)", value: { true: 1 } },
    { t: "Map(Shape, Int)", value: { '{"_tag":"Dot"}': 1 } },
    { t: "Map(Tuple(Int, Int), Text)", value: { "[1,2]": "x" } },
    { t: "Shape", value: { _tag: "Dot" } },
    { t: "Set(Int)", value: { 1: true } },
    { t: "Unit", value: null },
    { t: "Bytes", value: new Uint8Array([104, 105]) },
    { t: "Tree", value: { v: 1, kids: [{ v: 2, kids: [] }] } },
    { t: "Page(User)", value: { items: [{ id: 1, name: "a" }], next: { _tag: "Some", _0: 2 } } },
    { t: "Time", value: AT },
  ])("takes $value as $t, unchanged", async ({ t, value }) => {
    const copy = structuredClone(value);
    expect((await checkOf(t))(value)).toBeUndefined();
    expect(value).toEqual(copy);
  });
});

describe("Decoder.Json(T) reads a Time position by Time.parse's grammar", () => {
  it.each([
    { t: "Stamp", value: { at: "2026-03-07T10:00:00Z" }, read: { at: AT } },
    { t: "Stamp", value: { at: "2026-03-07T19:00:00+09:00" }, read: { at: AT } },
    { t: "Stamp", value: { at: AT }, read: { at: AT } },
    { t: "{at: Due}", value: { at: "2026-03-07T10:00:00.250Z" }, read: { at: AT + 250 } },
    {
      t: "List(Time)",
      value: ["2026-03-07T10:00:00Z", AT + 1],
      read: [AT, AT + 1],
    },
    {
      t: "Option(Due)",
      value: { _tag: "Some", _0: "2026-03-07T10:00:00Z" },
      read: { _tag: "Some", _0: AT },
    },
    { t: "When", value: { _tag: "At", _0: "2026-03-07T10:00:00Z" }, read: { _tag: "At", _0: AT } },
    { t: "Map(Text, Time)", value: { a: "2026-03-07T10:00:00Z" }, read: { a: AT } },
    { t: "Tuple(Time, Int)", value: ["2026-03-07T10:00:00Z", 1], read: [AT, 1] },
  ])("reads $value as $t into $read", async ({ t, value, read }) => {
    expect((await checkOf(t))(value)).toBeUndefined();
    expect(value).toEqual(read);
  });

  it.each([
    { what: "digits in a string", at: "1772877600000" },
    { what: "an offset without its colon", at: "2026-03-07T10:00:00+0000" },
    { what: "text with blanks around it", at: " 2026-03-07T10:00:00Z" },
    { what: "a fraction of a millisecond", at: 1.5 },
    { what: "a Bool", at: true },
  ])("refuses $what, naming the field", async ({ at }) => {
    const value = { at };
    expect((await checkOf("Stamp"))(value)).toEqual(failure("expected Time", ["at"]));
    expect(value).toEqual({ at });
  });

  it("names a nominal Time by its own name", async () => {
    expect((await checkOf("{at: Due}"))({ at: "soon" })).toEqual(failure("expected Due", ["at"]));
  });

  it("reads a Time that is the whole value from a number only", async () => {
    const check = await checkOf("Time");
    expect(check(AT)).toBeUndefined();
    expect(check("2026-03-07T10:00:00Z")).toEqual(failure("expected Time"));
  });
});
