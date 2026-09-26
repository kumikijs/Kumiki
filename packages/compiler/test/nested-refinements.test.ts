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
import { type AppShape, type SlotMeta, slotAccepts } from "@kumikijs/runtime";
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
  // A Set is an object keyed by `String(member)` once `add` / `toggle` built
  // it, and still an array when it came from a literal; a literal a member was
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

  it("leaves a member it cannot read back from a key ungated", () => {
    // A record member is keyed "[object Object]"; no check can see the record
    // through that, so the position is not walked rather than refusing every write.
    expect(meta("people").refineFailure).toBeUndefined();
    expect(meta("people").refine).toBeUndefined();
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
