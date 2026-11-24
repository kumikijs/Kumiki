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
type Memo    = {text: Text where nonempty}
type Nest(A) = {v: A, next: Option(Nest(List(A)))}
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
    { t: "Tuple(Int, Text)", value: [1, "a", 3], refused: failure("expected Tuple(Int, Text)") },
    { t: "Memo", value: { text: 5 }, refused: failure("expected Text", ["text"]) },
    {
      t: "Map(Float, Int)",
      value: { "1.50": 1 },
      refused: failure("expected Float", [{ key: "1.50" }]),
    },
    {
      t: "Map(Time, Int)",
      value: { "1.5": 1 },
      refused: failure("expected Time", [{ key: "1.5" }]),
    },
    { t: "Map(Int, Int)", value: { "-0": 1 }, refused: failure("expected Int", [{ key: "-0" }]) },
    {
      t: "File",
      value: { name: "a.txt", size: "3", type: "text/plain" },
      refused: failure("expected Int", ["size"]),
    },
    { t: "File", value: "a.txt", refused: failure("expected File") },
    {
      t: "Nest(Int)",
      value: { v: "1", next: { _tag: "None" } },
      refused: failure("expected Int", ["v"]),
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
    { t: "Shape", value: { _tag: "Square", _0: 1, _1: 2 } },
    { t: "Map(Float, Int)", value: { "1.5": 1, NaN: 2, "-Infinity": 3 } },
    { t: "Map(Time, Int)", value: { [AT]: 1 } },
    {
      t: "File",
      value: { name: "a.txt", size: 3, type: "text/plain", _file: {} },
    },
    {
      t: "Nest(Int)",
      value: { v: 1, next: { _tag: "Some", _0: { v: [2], next: { _tag: "None" } } } },
    },
  ])("takes $value as $t, unchanged", async ({ t, value }) => {
    const copy = structuredClone(value);
    expect((await checkOf(t))(value)).toBeUndefined();
    expect(value).toEqual(copy);
  });
});

// A storage tag or an IndexedDB clone can hand back an object JSON never makes.
describe("Decoder.Json(T) takes only a plain object as a record, a Map or a Set", () => {
  it.each([
    {
      t: "Map(Int, Int)",
      value: new Uint8Array([0, 1, 2]),
      refused: failure("expected Map(Int, Int)"),
    },
    {
      t: "{m: Map(Int, Int)}",
      value: { m: new Uint8Array([0, 1, 2]) },
      refused: failure("expected Map(Int, Int)", ["m"]),
    },
    { t: "Set(Int)", value: new Uint8Array(0), refused: failure("expected Set(Int)") },
    { t: "Set(Int)", value: new Date(0), refused: failure("expected Set(Int)") },
    {
      t: "Map(Text, Int)",
      value: new Map([["a", 1]]),
      refused: failure("expected Map(Text, Int)"),
    },
    { t: "User", value: new Date(0), refused: failure("expected User") },
  ])("refuses $value as $t", async ({ t, value, refused }) => {
    expect((await checkOf(t))(value)).toEqual(refused);
  });

  it("takes an object with no prototype", async () => {
    const value = Object.assign(Object.create(null), { id: 7, name: "Ann" });
    expect((await checkOf("User"))(value)).toBeUndefined();
  });
});

// `(-1.0).sqrt.floor` is an `Int` that is `NaN`, and storage keeps it.
describe("Decoder.Json(T) takes a number that is not finite where the program can hold one", () => {
  it.each([
    { t: "Int", value: Number.NaN },
    { t: "{n: Int}", value: { n: Number.NEGATIVE_INFINITY } },
    { t: "Cents", value: Number.POSITIVE_INFINITY },
    { t: "Stamp", value: { at: Number.NaN } },
    { t: "Map(Int, Text)", value: { NaN: "x", Infinity: "y", "-Infinity": "z" } },
    { t: "Set(Time)", value: { NaN: true } },
    // A structured key holds a number that is not finite as `null`.
    { t: "Map(Tuple(Float, Int), Text)", value: { "[null,null]": "x" } },
    { t: "Set({at: Time})", value: { '{"at":null}': true, [`{"at":${AT}}`]: true } },
  ])("takes $value as $t, unchanged", async ({ t, value }) => {
    const copy = structuredClone(value);
    expect((await checkOf(t))(value)).toBeUndefined();
    expect(value).toEqual(copy);
  });

  it.each([
    { t: "Int", value: null, refused: failure("expected Int") },
    {
      t: "Map(Int, Text)",
      value: { nan: "x" },
      refused: failure("expected Int", [{ key: "nan" }]),
    },
    {
      t: "Set({at: Time})",
      value: { '{"at":"2026-03-07T10:00:00Z"}': true },
      refused: failure("expected Time", [{ member: '{"at":"2026-03-07T10:00:00Z"}' }, "at"]),
    },
  ])("still refuses $value as $t", async ({ t, value, refused }) => {
    expect((await checkOf(t))(value)).toEqual(refused);
  });
});

// `Unit`, `Bytes` and `File` have no text of their own, so a key of one is stored as a structured
// key is: `Unit` as `"null"`, the others as their JSON.
describe("Decoder.Json(T) reads a key with no text of its own as it is stored", () => {
  it.each([
    { t: "Set(Unit)", value: { null: true } },
    { t: "Map(Bytes, Int)", value: { '{"0":0,"1":1,"2":2}': 1 } },
    {
      t: "Map(File, Int)",
      value: { '{"_file":{},"name":"a.txt","size":3,"type":"text/plain"}': 1 },
    },
  ])("takes $value as $t", async ({ t, value }) => {
    expect((await checkOf(t))(value)).toBeUndefined();
  });

  it.each([
    { t: "Set(Unit)", value: { x: true }, refused: failure("expected Unit", [{ member: "x" }]) },
    {
      t: "Map(Bytes, Int)",
      value: { hello: 1 },
      refused: failure("expected Bytes", [{ key: "hello" }]),
    },
    {
      t: "Map(File, Int)",
      value: { hello: 1 },
      refused: failure("expected File", [{ key: "hello" }]),
    },
    {
      t: "Map(File, Int)",
      value: { '{"name":"a.txt"}': 1 },
      refused: failure("missing", [{ key: '{"name":"a.txt"}' }, "size"]),
    },
  ])("refuses $value as $t", async ({ t, value, refused }) => {
    expect((await checkOf(t))(value)).toEqual(refused);
  });
});

// `Nest` applies itself to a growing argument, so every level is a type of its own to check.
describe("Decoder.Json(T) checks a growing generic 32 levels down", () => {
  /** A `Nest(Int)` holding `bottom` after `depth` steps of `next._0`, its `v`s empty lists. */
  const nested = (depth: number, bottom: unknown, top = true): unknown =>
    depth === 0
      ? bottom
      : { v: top ? 0 : [], next: { _tag: "Some", _0: nested(depth - 1, bottom, false) } };

  it("refuses a value 31 levels down", async () => {
    const refused = (await checkOf("Nest(Int)"))(nested(31, "garbage"));
    expect(refused?.kind).toMatch(/^expected Nest\(/);
  });

  it("takes any value past 32 levels, unchecked", async () => {
    expect((await checkOf("Nest(Int)"))(nested(32, "garbage"))).toBeUndefined();
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

  // A host provider calls the check on the value it delivers, so it sees what the check did.
  it("leaves the instants it read before the position it refuses", async () => {
    const value = { a: "2026-03-07T10:00:00Z", b: "2026-03-07T10:00:01Z", m: { "-0": 5 } };
    const check = await checkOf("{a: Time, b: Time, m: Map(Int, Int)}");
    expect(check(value)).toEqual(failure("expected Int", ["m", { key: "-0" }]));
    expect(value).toEqual({ a: AT, b: AT + 1000, m: { "-0": 5 } });
  });

  it("throws on a frozen value that holds a Time as text", async () => {
    const check = await checkOf("Stamp");
    expect(() => check(Object.freeze({ at: "2026-03-07T10:00:00Z" }))).toThrow(TypeError);
    expect(check(Object.freeze({ at: AT }))).toBeUndefined();
  });

  it("reads a Time that is the whole value from a number only", async () => {
    const check = await checkOf("Time");
    expect(check(AT)).toBeUndefined();
    expect(check("2026-03-07T10:00:00Z")).toEqual(failure("expected Time"));
  });
});
