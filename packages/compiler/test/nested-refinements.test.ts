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
import type { AppShape, SlotMeta } from "@kumikijs/runtime";
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

tile App = text("x")

app Nested
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

let slots: Record<string, SlotMeta>;

beforeAll(async () => {
  const result = compile(SRC, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const dir = mkdtempSync(join(TMP_ROOT, "nested-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  slots = mod.default.slots;
}, 30_000);

const meta = (name: string): SlotMeta => defined(slots[name], `slot "${name}"`);
const refineOf = (name: string): ((v: unknown) => boolean) =>
  defined(meta(name).refine, `slot "${name}"'s refinement`);
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
      path: ".email",
    });
    expect(failureOf("form", { email: "ada@example.com", age: 999 })).toEqual({
      kind: "between",
      args: [0, 120],
      path: ".age",
    });
    expect(failureOf("form", { email: "ada@example.com", age: 36 })).toBeUndefined();
  });

  it("reads a field's type through a name", () => {
    expect(failureOf("named", { h: "a" })).toEqual({ kind: "len-gt", args: [1], path: ".h" });
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
      path: ".Found",
    });
  });

  it("names the payload by position when the variant carries several", () => {
    expect(refineOf("look")({ _tag: "Pair", _0: -5, _1: 1 })).toBe(true);
    expect(failureOf("look", { _tag: "Pair", _0: 1, _1: 0 })).toEqual({
      kind: "positive",
      args: [],
      path: ".Pair[1]",
    });
  });
});

describe("a refinement on a container element", () => {
  it("checks every element of a List, and names the index", () => {
    expect(refineOf("tags")(["abc", "de"])).toBe(true);
    expect(failureOf("tags", ["abc", "abcd"])).toEqual({ kind: "len-lt", args: [4], path: "[1]" });
  });

  it("checks a Set's members, which are an object's keys at runtime", () => {
    expect(refineOf("uniq")({ a: true })).toBe(true);
    expect(failureOf("uniq", { a: true, "": true })).toEqual({
      kind: "nonempty",
      args: [],
      path: '{""}',
    });
  });

  it("checks Option's Some, and not None", () => {
    expect(refineOf("opt")({ _tag: "None" })).toBe(true);
    expect(refineOf("opt")({ _tag: "Some", _0: 3 })).toBe(true);
    expect(failureOf("opt", { _tag: "Some", _0: 0 })).toEqual({
      kind: "positive",
      args: [],
      path: ".Some",
    });
  });

  it("checks Result's Ok and Err against their own types", () => {
    expect(refineOf("res")({ _tag: "Ok", _0: "abc" })).toBe(true);
    expect(failureOf("res", { _tag: "Ok", _0: "abcd" })?.path).toBe(".Ok");
    expect(failureOf("res", { _tag: "Err", _0: "nope" })).toEqual({
      kind: "email",
      args: [],
      path: ".Err",
    });
  });

  it("checks a Tuple's members by position", () => {
    expect(refineOf("pair")(["", -1])).toBe(true);
    expect(failureOf("pair", ["a", 1])).toEqual({ kind: "negative", args: [], path: "[1]" });
  });

  it("checks a Map's values, and its keys as the type they were declared", () => {
    // A map is an object at runtime, so its keys arrive as strings; an `Int`
    // key's predicate still has to see a number.
    expect(refineOf("byId")({ 1: "abc", 2: "de" })).toBe(true);
    expect(failureOf("byId", { 1: "abcd" })).toEqual({ kind: "len-lt", args: [4], path: '["1"]' });
    expect(failureOf("byId", { 0: "a" })).toEqual({
      kind: "positive",
      args: [],
      path: '.keys["0"]',
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
      path: ".rows[2].email",
    });
  });

  it("checks a recursive type at every depth the value has", () => {
    const leaf = (label: string) => ({ label, kids: [] });
    expect(refineOf("tree")({ label: "a", kids: [leaf("b"), leaf("c")] })).toBe(true);
    expect(
      failureOf("tree", { label: "a", kids: [leaf("b"), { label: "c", kids: [leaf("")] }] }),
    ).toEqual({ kind: "nonempty", args: [], path: ".kids[1].kids[0].label" });
  });

  it("follows a generic applied to a refined argument", () => {
    expect(refineOf("box")({ v: "x" })).toBe(true);
    expect(failureOf("box", { v: "" })).toEqual({ kind: "nonempty", args: [], path: ".v" });
  });
});
