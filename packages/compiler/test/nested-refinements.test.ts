// A refinement written inside a type — a record field, a union payload, a
// container element — is a check on the value on its way into the slot, the
// same as one written on the type itself (spec/language.md §1.3.3).
// Codegen used to gate a slot on its own chain only, so on
//
//     slot form : {email: Text where email} = {email: "ada@example.com"}
//
// the slot was emitted with no `refine`, and `form.email := "nope"` committed
// with `check`, `build` and `smoke` all silent (#444).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import {
  type AppShape,
  type BindSegment,
  type PathSegment,
  type SlotMeta,
  slotAccepts,
} from "@kumikijs/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const SRC = `
type Contact = {email: Text where email, age: Int where between(0, 120)}
type Lookup  = Pending | Found(Text where nonempty) | Pair(Int, Int where positive)
type Short   = Text where len-lt(4)
type Sheet   = {rows: List(Contact)}
type Tree    = {label: Text where nonempty, kids: List(Tree)}
type Box(T)  = {v: T}
type Handle  = nominal Text where len-gt(1)

slot form   : Contact                         = {email: "ada@example.com", age: 36}
slot look   : Lookup                          = Pending
slot tags   : List(Short)                     = []
slot uniq   : Set(Text where nonempty)        = {}
slot opt    : Option(Int where positive)      = None
slot res    : Result(Short, Text where email) = Ok("a")
slot pair   : Tuple(Text, Int where negative) = ("a", -1)
slot byId   : Map(Int where positive, Short)  = {}
slot sheet  : Sheet                           = {rows: []}
slot tree   : Tree                            = {label: "root", kids: []}
slot box    : Box(Text where nonempty)        = {v: "x"}
slot named  : {h: Handle}                     = {h: "ab"}
slot nums   : Set(Int where positive)         = {}
slot people : Set({n: Text where nonempty})   = {}
slot byName : Map({n: Text where nonempty}, Int) = {}
slot cellAt : Map({x: Int, y: Int}, Short)       = {}
slot plain  : {n: Int, kids: List(Text)}      = {n: 1, kids: []}
slot handle : Handle                          = "ab"

tile App = text("x")

app Nested
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** Compile `src`, import the module, and hand back its slot table. */
async function load(src: string): Promise<Record<string, SlotMeta>> {
  const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const dir = mkdtempSync(join(TMP_ROOT, "nested-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  return mod.default.slots;
}

/** A program around `defs`, with nothing else in it. */
const program = (defs: string): string => `
${defs}

tile App = text("x")

app Nested
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

let slots: Record<string, SlotMeta>;

beforeAll(async () => {
  slots = await load(SRC);
}, 30_000);

const meta = (name: string): SlotMeta => defined(slots[name], `slot "${name}"`);
/** The gate every check reads (`slotAccepts`), on a slot that has to have one. */
const refineOf = (name: string): ((v: unknown) => boolean) => {
  defined(meta(name).refineFailure, `slot "${name}"'s failure reader`);
  return (v) => slotAccepts(meta(name), v);
};
const failureOf = (name: string, v: unknown) =>
  defined(meta(name).refineFailure, `slot "${name}"'s failure reader`)(v);

describe("a refinement on a record field", () => {
  it("gates the slot on every field", () => {
    const refine = refineOf("form");
    expect(refine({ email: "ada@example.com", age: 36 })).toBe(true);
    expect(refine({ email: "nope", age: 36 })).toBe(false);
    expect(refine({ email: "ada@example.com", age: 999 })).toBe(false);
  });

  it("names the predicate and the field it failed at, in field order", () => {
    expect(failureOf("form", { email: "nope", age: 999 })).toEqual({
      kind: "email",
      args: [],
      path: ["email"],
    });
    expect(failureOf("form", { email: "ada@example.com", age: 999 })).toEqual({
      kind: "between",
      args: [0, 120],
      path: ["age"],
    });
    expect(failureOf("form", { email: "ada@example.com", age: 36 })).toBeUndefined();
  });

  it("reads a field's type through a name", () => {
    expect(failureOf("named", { h: "a" })).toEqual({ kind: "len-gt", args: [1], path: ["h"] });
  });
});

describe("a refinement on a union payload", () => {
  it("is checked for the variant that carries it, and only that one", () => {
    const refine = refineOf("look");
    expect(refine({ _tag: "Pending" })).toBe(true);
    expect(refine({ _tag: "Found", _0: "ada" })).toBe(true);
    expect(refine({ _tag: "Found", _0: "" })).toBe(false);
    expect(failureOf("look", { _tag: "Found", _0: "" })).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ variant: "Found" }],
    });
  });

  it("names the payload by position when the variant carries several", () => {
    expect(refineOf("look")({ _tag: "Pair", _0: -5, _1: 1 })).toBe(true);
    expect(failureOf("look", { _tag: "Pair", _0: 1, _1: 0 })).toEqual({
      kind: "positive",
      args: [],
      path: [{ variant: "Pair", payload: 1 }],
    });
  });
});

describe("a refinement on a container element", () => {
  it("checks every element of a List, and names the index", () => {
    expect(refineOf("tags")(["abc", "de"])).toBe(true);
    expect(failureOf("tags", ["abc", "abcd"])).toEqual({ kind: "len-lt", args: [4], path: [1] });
  });

  it("checks a Set's text members, which are an object's keys at runtime", () => {
    expect(refineOf("uniq")({ a: true })).toBe(true);
    expect(failureOf("uniq", { a: true, "": true })).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ member: "" }],
    });
  });

  it("checks Option's Some, and not None", () => {
    expect(refineOf("opt")({ _tag: "None" })).toBe(true);
    expect(refineOf("opt")({ _tag: "Some", _0: 3 })).toBe(true);
    expect(failureOf("opt", { _tag: "Some", _0: 0 })).toEqual({
      kind: "positive",
      args: [],
      path: [{ variant: "Some" }],
    });
  });

  it("checks Result's Ok and Err against their own types", () => {
    expect(refineOf("res")({ _tag: "Ok", _0: "abc" })).toBe(true);
    expect(failureOf("res", { _tag: "Ok", _0: "abcd" })).toEqual({
      kind: "len-lt",
      args: [4],
      path: [{ variant: "Ok" }],
    });
    expect(failureOf("res", { _tag: "Err", _0: "nope" })).toEqual({
      kind: "email",
      args: [],
      path: [{ variant: "Err" }],
    });
  });

  it("checks a Tuple's members by position", () => {
    expect(refineOf("pair")(["", -1])).toBe(true);
    expect(failureOf("pair", ["a", 1])).toEqual({ kind: "negative", args: [], path: [1] });
  });

  it("checks a Map's values, and its keys as the type they were declared", () => {
    // A map is an object at runtime, so its keys arrive as strings; an `Int`
    // key's predicate still has to see a number.
    expect(refineOf("byId")({ 1: "abc", 2: "de" })).toBe(true);
    expect(failureOf("byId", { 1: "abcd" })).toEqual({
      kind: "len-lt",
      args: [4],
      path: [{ entry: 1 }],
    });
    expect(failureOf("byId", { 0: "a" })).toEqual({
      kind: "positive",
      args: [],
      path: [{ key: 0 }],
    });
  });
});

describe("a Map's structured keys, read back from the JSON they are keyed by", () => {
  it("checks a refined record key as the record it encodes", () => {
    expect(refineOf("byName")({ '{"n":"ada"}': 1 })).toBe(true);
    expect(failureOf("byName", { '{"n":"ada"}': 1, '{"n":""}': 2 })).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ key: { n: "" } }, "n"],
    });
  });

  it("names the record key an entry that fails its value's refinement is under", () => {
    expect(refineOf("cellAt")({ '{"x":0,"y":1}': "abc" })).toBe(true);
    expect(failureOf("cellAt", { '{"x":0,"y":1}': "abcd" })).toEqual({
      kind: "len-lt",
      args: [4],
      path: [{ entry: { x: 0, y: 1 } }],
    });
  });
});

describe("positions nest, and a type may be recursive", () => {
  it("joins the path outward-in", () => {
    const ok = { email: "ada@example.com", age: 36 };
    expect(refineOf("sheet")({ rows: [ok, ok] })).toBe(true);
    expect(failureOf("sheet", { rows: [ok, ok, { ...ok, email: "nope" }] })).toEqual({
      kind: "email",
      args: [],
      path: ["rows", 2, "email"],
    });
  });

  it("checks a recursive type at every depth the value has", () => {
    const leaf = (label: string) => ({ label, kids: [] });
    expect(refineOf("tree")({ label: "a", kids: [leaf("b"), leaf("c")] })).toBe(true);
    expect(
      failureOf("tree", { label: "a", kids: [leaf("b"), { label: "c", kids: [leaf("")] }] }),
    ).toEqual({ kind: "nonempty", args: [], path: ["kids", 1, "kids", 0, "label"] });
  });

  it("follows a generic applied to a refined argument", () => {
    expect(refineOf("box")({ v: "x" })).toBe(true);
    expect(failureOf("box", { v: "" })).toEqual({ kind: "nonempty", args: [], path: ["v"] });
  });
});

describe("a Set's members, in either runtime form", () => {
  // A Set is an object keyed by `entryKey(member)` once `add` / `toggle`
  // built it, and still an array when it came from a literal; a literal a member was
  // added to is both at once (the array's entries plus a key).
  it("reads a numeric member back as a number from a key", () => {
    expect(refineOf("nums")({ 1: true, 2: true })).toBe(true);
    expect(failureOf("nums", { 1: true, 0: true })).toEqual({
      kind: "positive",
      args: [],
      path: [{ member: 0 }],
    });
  });

  it("reads an array's members as themselves", () => {
    expect(refineOf("nums")([1, 2])).toBe(true);
    expect(failureOf("nums", [1, -2])?.path).toEqual([{ member: -2 }]);
  });

  it("does not mistake an array entry's index for a member", () => {
    // `s.add(2)` on the literal `[1]` spreads it: `{"0": 1, "2": true}`.
    expect(refineOf("nums")({ 0: 1, 2: true })).toBe(true);
  });

  it("reads a record member back from the JSON it is keyed by", () => {
    expect(refineOf("people")({ '{"n":"ada"}': true })).toBe(true);
    expect(refineOf("people")([{ n: "ada" }])).toBe(true);
    expect(failureOf("people", { '{"n":"ada"}': true, '{"n":""}': true })).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ member: { n: "" } }, "n"],
    });
  });
});

describe("a slot the walk does not gate", () => {
  it("carries no gate at all when no predicate is written anywhere in its type", () => {
    expect(meta("plain").refine).toBeUndefined();
    expect(meta("plain").refineFailure).toBeUndefined();
  });

  it("keeps the chain's own gate when every predicate sits on the type itself", () => {
    expect(meta("handle").refineFailure).toBeUndefined();
    expect(defined(meta("handle").refine, "handle's refinement")("a")).toBe(false);
  });

  it("is gated by the walk alone when it does carry one inside", () => {
    // Nothing else for a reader to consult and disagree with.
    expect(meta("form").refine).toBeUndefined();
    expect(meta("form").refineAll).toBeUndefined();
  });
});

describe("a value of the wrong shape", () => {
  // §1.3.3: a predicate answers a value of the wrong shape with `false`
  // rather than raising — the position's first predicate refuses it.
  it("is refused at the position whose shape it lacks, not passed or thrown", () => {
    expect(failureOf("tags", {})).toEqual({ kind: "len-lt", args: [4], path: [] });
    expect(failureOf("tags", "abcdefg")).toEqual({ kind: "len-lt", args: [4], path: [] });
    expect(failureOf("byId", 5)).toEqual({ kind: "positive", args: [], path: [] });
    expect(failureOf("opt", 3)).toEqual({ kind: "positive", args: [], path: [] });
    expect(failureOf("look", { tag: "Found" })).toEqual({ kind: "nonempty", args: [], path: [] });
    expect(failureOf("form", null)).toEqual({ kind: "email", args: [], path: [] });
    expect(failureOf("sheet", { rows: [null] })).toEqual({
      kind: "email",
      args: [],
      path: ["rows", 0],
    });
  });
});

describe("the helpers a walk is made of", () => {
  it("stop at a directly recursive record's missing field instead of recursing", async () => {
    // No finite value has the type, so none is well typed — but a decoded
    // payload can still arrive holding one, and the walk has to end on it.
    const loop = await load(
      program(`type Loop = {next: Loop, name: Text where nonempty}
slot l : Option(Loop) = None`),
    );
    const failure = defined(loop.l?.refineFailure, "l's failure reader");
    const some = (v: unknown) => ({ _tag: "Some", _0: v });
    expect(failure(some({ next: { name: "a" }, name: "root" }))).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ variant: "Some" }, "next", "next"],
    });
  });

  it("are declared so that a name aliasing one still being lowered loads", async () => {
    // Lowering B reaches A, whose body is B again: A's helper stands for B's,
    // which is not declared yet when A's is.
    const aliased = await load(
      program(`type B = {x: Option(A), n: Text where nonempty}
type A = B
slot b : B = {x: None, n: "a"}`),
    );
    const failure = defined(aliased.b?.refineFailure, "b's failure reader");
    expect(failure({ x: { _tag: "Some", _0: { x: { _tag: "None" }, n: "" } }, n: "a" })).toEqual({
      kind: "nonempty",
      args: [],
      path: ["x", { variant: "Some" }, "n"],
    });
  });

  it("follow distinct named types however deep they nest", async () => {
    const depth = 33;
    const defs = Array.from({ length: depth }, (_, i) =>
      i + 1 < depth ? `type A${i + 1} = {x: A${i + 2}}` : `type A${i + 1} = {x: Text where email}`,
    );
    const deep = await load(
      program(
        `${defs.join("\n")}\nslot a : A1 = ${"{x: ".repeat(depth)}"ada@example.com"${"}".repeat(depth)}`,
      ),
    );
    const failure = defined(deep.a?.refineFailure, "a's failure reader");
    let value: unknown = "nope";
    for (let i = 0; i < depth; i++) value = { x: value };
    expect(failure(value)).toEqual({ kind: "email", args: [], path: Array(depth).fill("x") });
  });
});

describe("a generic that applies itself to a growing argument", () => {
  const growing = (arg: string) =>
    program(`type T(A) = {v: A, next: Option(T(List(A)))}
slot t : T(${arg}) = {v: ${arg === "Int" ? "1" : '"a"'}, next: None}`);

  it("is E0803 at build time when a refinement lies along it", () => {
    const result = compile(growing("Text where nonempty"), {
      runtimeSpecifier: "@kumikijs/runtime",
    });
    expect(result.kind).toBe("fail");
    const codes = result.kind === "fail" ? result.errors.map((e) => e.code) : [];
    expect(codes).toContain("E0803");
  });

  it("is not reported when nothing along it carries a refinement", () => {
    const result = compile(growing("Int"), { runtimeSpecifier: "@kumikijs/runtime" });
    const codes = result.kind === "fail" ? result.errors.map((e) => e.code) : [];
    expect(codes).not.toContain("E0803");
  });
});

// A `bind` into part of a slot is judged at the path it writes (forms.md
// §5.6): the gate takes that path as a focus, enters only the position each
// step names, and checks everything below where it ends. The focus has to
// survive every helper between the slot and the field — an alias of a named
// type is a wrapper around that type's helper, and a nominal or refined type
// calls its inner type's — or a sibling's failure refuses the write again.
describe("a gate asked about one bind path", () => {
  const FOCUS = program(`type Short   = Text where len-lt(12)
type City    = nominal Short where nonempty
type Place   = nominal {city: City, zip: Text where len-gt(3)}
type Addr    = Place
type Person  = {email: Text where email, addr: Addr}
type Account = {owner: Person, note: Text where nonempty}
type Post    = {title: Text where nonempty, body: Text where len-lt(10)}
type Entry   = Post

slot person : Person        = {email: "", addr: {city: "", zip: ""}}
slot acct   : Account       = {owner: {email: "", addr: {city: "", zip: ""}}, note: ""}
slot draft  : Option(Entry) = None`);

  let focused: Record<string, SlotMeta>;
  beforeAll(async () => {
    focused = await load(FOCUS);
  }, 30_000);

  const at = (slot: string, v: unknown, focus?: BindSegment[]) =>
    defined(focused[slot]?.refineFailure, `slot "${slot}"'s failure reader`)(v, focus);
  const GET = { get: true } as const;

  const person = (city: string) => ({ email: "nope", addr: { city, zip: "1" } });

  it("reaches a field through an alias and a nominal record, passing over its siblings", () => {
    // Whole value: the email is the first failure.
    expect(at("person", person("Paris"))?.path).toEqual(["email"]);
    // At the city: the failing email and the failing zip beside it are not on the path.
    expect(at("person", person("Paris"), ["addr", "city"])).toBeUndefined();
    // The zip is judged at its own path.
    expect(at("person", person("Paris"), ["addr", "zip"])).toEqual({
      kind: "len-gt",
      args: [3],
      path: ["addr", "zip"],
    });
  });

  it("still refuses the field's own failure, from every predicate its type chain carries", () => {
    // `City`'s own predicate, written on the nominal.
    expect(at("person", person(""), ["addr", "city"])).toEqual({
      kind: "nonempty",
      args: [],
      path: ["addr", "city"],
    });
    // `Short`'s, the named type the nominal wraps.
    expect(at("person", person("Ciudad de Mexico"), ["addr", "city"])).toEqual({
      kind: "len-lt",
      args: [12],
      path: ["addr", "city"],
    });
  });

  it("checks the shape of every type along the path", () => {
    const f = at("person", { email: "nope", addr: "not a record" }, ["addr", "city"]);
    expect(f?.path).toEqual(["addr"]);
  });

  it("follows a focus three fields deep", () => {
    const acct = (city: string) => ({ owner: person(city), note: "" });
    expect(at("acct", acct("Paris"))?.path).toEqual(["owner", "email"]);
    expect(at("acct", acct("Paris"), ["owner", "addr", "city"])).toBeUndefined();
    expect(at("acct", acct(""), ["owner", "addr", "city"])).toEqual({
      kind: "nonempty",
      args: [],
      path: ["owner", "addr", "city"],
    });
  });

  it("reaches a record field inside an Option's payload through .get", () => {
    const draft = (title: string) => ({ _tag: "Some", _0: { title, body: "far too long a body" } });
    expect(at("draft", draft("Hi"))?.path).toEqual([{ variant: "Some" }, "body"]);
    expect(at("draft", draft("Hi"), [GET, "title"])).toBeUndefined();
    expect(at("draft", draft(""), [GET, "title"])).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ variant: "Some" }, "title"],
    });
  });

  it("answers an empty focus as it answers none", () => {
    for (const v of [
      person("Paris"),
      person(""),
      { email: "a@b.co", addr: { city: "P", zip: "1234" } },
    ]) {
      expect(at("person", v, [])).toEqual(at("person", v));
    }
  });

  it("enters Result's Ok through .get and passes over Err, which is beside that path", () => {
    // `res : Result(Short, Text where email)` in the fixture above.
    const res = (v: unknown, focus?: BindSegment[]) =>
      defined(meta("res").refineFailure, "res's failure reader")(v, focus);
    expect(res({ _tag: "Ok", _0: "abcdef" }, [GET])).toEqual({
      kind: "len-lt",
      args: [4],
      path: [{ variant: "Ok" }],
    });
    expect(res({ _tag: "Err", _0: "nope" }, [GET])).toBeUndefined();
    expect(res({ _tag: "Err", _0: "nope" })?.path).toEqual([{ variant: "Err" }]);
  });

  // No bind step names a List element, a Set member, a Map key or entry, a
  // Tuple member or a user union's payload, so a focus that reaches one with
  // steps left has nothing there to follow: everything below is checked, and
  // a step the gate cannot read is never a reason to pass over a failure.
  const unnamed: [string, string, unknown, BindSegment[], unknown[]][] = [
    [
      "a List element",
      "sheet",
      { rows: [{ email: "nope", age: 36 }] },
      ["rows", "size"],
      ["rows", 0, "email"],
    ],
    ["a Set member", "nums", [-1], ["x"], [{ member: -1 }]],
    ["a Map key", "byId", { "-1": "a" }, ["x"], [{ key: -1 }]],
    ["a Tuple member", "pair", ["a", 1], ["x"], [1]],
    ["a union payload", "look", { _tag: "Found", _0: "" }, [GET], [{ variant: "Found" }]],
  ];
  for (const [position, slot, v, focus, path] of unnamed) {
    it(`checks ${position} whole, whatever steps the focus has left`, () => {
      const f = defined(meta(slot).refineFailure, `slot "${slot}"'s failure reader`)(v, focus);
      expect(f?.path).toEqual(path);
    });
  }
});

// An `error(field=…)` path also takes an index with a literal key (forms.md
// §5.7.1), and the gate follows it as it follows a field: into the List
// element or the Map entry it names, passing over the others — so a message
// for `xs[1]` is not hidden by `xs[0]` failing first. A Map's keys are beside
// every entry, as a sibling field is beside a field.
describe("a gate asked about a path with an index step", () => {
  const at = (slot: string, v: unknown, focus?: PathSegment[]) =>
    defined(meta(slot).refineFailure, `slot "${slot}"'s failure reader`)(v, focus);
  const contact = (email: string, age: number) => ({ email, age });

  it("enters the List element the index names, and that one only", () => {
    const sheet = { rows: [contact("nope", 36), contact("ada@example.com", 999)] };
    expect(at("sheet", sheet)?.path).toEqual(["rows", 0, "email"]);
    expect(at("sheet", sheet, ["rows", { at: 1 }])).toEqual({
      kind: "between",
      args: [0, 120],
      path: ["rows", 1, "age"],
    });
    expect(at("sheet", sheet, ["rows", { at: 1 }, "email"])).toBeUndefined();
    expect(at("sheet", sheet, ["rows", { at: 5 }])).toBeUndefined();
  });

  it("enters the Map entry the key names, passing over the keys", () => {
    // `byId : Map(Int where positive, Short)` in the fixture above.
    const byId = { "-1": "abcdef", "2": "ghijkl", "3": "ok" };
    expect(at("byId", byId)?.path).toEqual([{ key: -1 }]);
    expect(at("byId", byId, [{ at: 2 }])).toEqual({
      kind: "len-lt",
      args: [4],
      path: [{ entry: 2 }],
    });
    expect(at("byId", byId, [{ at: 3 }])).toBeUndefined();
    expect(at("byId", byId, [{ at: 7 }])).toBeUndefined();
  });

  it("checks a Set member whole whatever the index, as no index names one", () => {
    expect(at("nums", [-1], [{ at: 0 }])?.path).toEqual([{ member: -1 }]);
  });
});
