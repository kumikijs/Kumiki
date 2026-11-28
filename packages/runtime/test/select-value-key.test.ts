import type { TileNode } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";
import { valueKey } from "../src/tiles/input/_shared.ts";
import { clientElement, serverElement } from "./helpers/ssr-elements.ts";

const { eq } = _stdlibCore;

const some = (v: unknown) => ({ _tag: "Some", _0: v });
const tag = (name: string) => ({ _tag: name });

// A `select` matches its slot's option by key, so the key has to ask `==`'s question:
// the same key for two values `==` calls equal, and different keys for two it tells apart.
describe("a select's option key agrees with ==", () => {
  it.each<[string, unknown, unknown, boolean]>([
    ["a record written in another field order", { h: 3, w: 2 }, { w: 2, h: 3 }, true],
    ["a record inside a variant's payload", some({ h: 3, w: 2 }), some({ w: 2, h: 3 }), true],
    [
      "a record inside a record",
      { size: { h: 3, w: 2 }, at: { y: 1, x: 0 } },
      { at: { x: 0, y: 1 }, size: { w: 2, h: 3 } },
      true,
    ],
    ["a record inside a List", [{ h: 3, w: 2 }], [{ w: 2, h: 3 }], true],
    [
      "a variant inside a record, holding a record",
      { id: 1, shape: { _tag: "Box", _0: { h: 3, w: 2 } } },
      { shape: { _tag: "Box", _0: { w: 2, h: 3 } }, id: 1 },
      true,
    ],
    ["a Map whose entries were added in another order", { b: 2, a: 1 }, { a: 1, b: 2 }, true],
    ["the same record, in the same order", { w: 2, h: 3 }, { w: 2, h: 3 }, true],
    ["a record whose values are swapped", { w: 2, h: 3 }, { w: 3, h: 2 }, false],
    ["a record with other field names", { w: 2 }, { h: 2 }, false],
    ["a record with one more field", { w: 2, h: 3 }, { w: 2, h: 3, d: 1 }, false],
    [
      "a record that differs a level down",
      { size: { w: 2, h: 3 } },
      { size: { w: 2, h: 4 } },
      false,
    ],
    ["a payload", some(tag("Backlog")), some(tag("InProgress")), false],
    ["None and Some(None)", tag("None"), some(tag("None")), false],
    ["a List in another order", [1, 2], [2, 1], false],
    ["a List and a record keyed by position", [1], { 0: 1 }, false],
    ["a Text and a number", "1", 1, false],
    ["a Text and a nullary variant", "M", tag("M"), false],
  ])("%s", (_, a, b, equal) => {
    expect(eq(a, b)).toBe(equal);
    expect(valueKey(a) === valueKey(b)).toBe(equal);
  });

  it("keys a record by its JSON text with the fields in sorted order", () => {
    expect(valueKey({ w: 2, h: 3 })).toBe('{"h":3,"w":2}');
    expect(valueKey(some({ w: 2, h: 3 }))).toBe('Some|{"h":3,"w":2}');
  });

  it.each<[string, unknown, string]>([
    ["a Text", "m", '"m"'],
    ["a number", 3, "3"],
    ["a nullary variant", tag("M"), "M"],
    ["a variant with a payload", some(tag("B")), "Some|B"],
    ["a variant with two payloads", { _tag: "Pair", _0: 1, _1: 2 }, "Pair|1|2"],
    ["no value", undefined, "undefined"],
  ])("keys %s as before", (_, v, key) => {
    expect(valueKey(v)).toBe(key);
  });
});

describe("a select holds a record option whatever order its fields are written in", () => {
  const node: TileNode = {
    kind: "select",
    value: { h: 3, w: 2 },
    options: [
      { label: "1 x 1", value: { w: 1, h: 1 } },
      { label: "2 x 3", value: { w: 2, h: 3 } },
      { label: "4 x 4", value: { w: 4, h: 4 } },
    ],
  };

  it("on the mounted select", () => {
    const sel = clientElement(node) as HTMLSelectElement;
    const held = Array.from(sel.options).filter((o) => o.selected);
    expect(held.map((o) => o.textContent)).toEqual(["2 x 3"]);
  });

  it("on the served select, under the value the mounted one gives it", () => {
    const served = serverElement(node) as HTMLSelectElement;
    const marked = Array.from(served.options).filter((o) => o.hasAttribute("selected"));
    expect(marked.map((o) => o.textContent)).toEqual(["2 x 3"]);
    const values = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.value);
    expect(values(served)).toEqual(values(clientElement(node) as HTMLSelectElement));
  });
});

// A Set is held as an object keyed by its members and a Map as one keyed by its keys, so a Set
// or a Map that holds the text "_tag" has a `_tag` field without being a variant.
describe("a Set or a Map holding the text _tag is told apart as == tells it apart", () => {
  const set = (...members: string[]) => Object.fromEntries(members.map((m) => [m, true]));

  it.each<[string, unknown, unknown, boolean]>([
    ["two Sets holding _tag", set("_tag"), set("_tag", "a"), false],
    ["a Set holding _tag, built in another order", set("a", "_tag"), set("_tag", "a"), true],
    [
      "two Maps from _tag to one text, one with another entry",
      { _tag: "S" },
      { _tag: "S", a: "x" },
      false,
    ],
    ["two Maps from _tag to a number", { _tag: 1, a: 2 }, { _tag: 1, a: 3 }, false],
    ["a Map from _tag to a text that is no identifier", { _tag: '{"a":"b"}' }, { a: "b" }, false],
    [
      "two Maps from _tag and _1, with no _0",
      { _tag: "S", _1: "x" },
      { _tag: "S", _1: "y" },
      false,
    ],
    ["a Set holding _tag in a payload", some(set("_tag")), some(set("_tag", "a")), false],
    [
      "two Maps from _tag and _0, to two texts",
      { _tag: "S", _0: "x" },
      { _tag: "S", _0: "y" },
      false,
    ],
    [
      "two Maps from _tag and _0, one with another entry",
      { _tag: "S", _0: "x" },
      { _tag: "S", _0: "x", a: "y" },
      false,
    ],
  ])("%s", (_, a, b, equal) => {
    expect(eq(a, b)).toBe(equal);
    expect(valueKey(a) === valueKey(b)).toBe(equal);
  });

  it.each<[string[], string]>([
    [["_tag"], '{"_tag":true}'],
    [["a", "_tag"], '{"_tag":true,"a":true}'],
  ])("keys the Set %j by its JSON text, as any other Set", (members, key) => {
    expect(valueKey(set(...members))).toBe(key);
  });

  it("gives a radio holding such a Set its JSON text as its value on both render paths", () => {
    const node: TileNode = { kind: "radio", group: "tags", value: set("_tag") };
    const value = (el: Element): string | undefined =>
      (el instanceof HTMLInputElement ? el : el.querySelector("input"))?.value;
    expect(value(clientElement(node))).toBe('{"_tag":true}');
    expect(value(serverElement(node))).toBe('{"_tag":true}');
  });

  const sets = [set("_tag"), set("_tag", "a")];
  const maps = [{ _tag: "S" }, { _tag: "S", a: "x" }];

  // Each pair is held at either option: where two options share a key, the mounted select marks
  // the later one, so only the first option tells a shared key apart from a key of its own.
  it.each<[string, unknown[], number, boolean[]]>([
    ["the first of two Sets", sets, 0, [true, false]],
    ["the second of two Sets", sets, 1, [false, true]],
    ["the first of two Maps", maps, 0, [true, false]],
    ["the second of two Maps", maps, 1, [false, true]],
  ])("holds %s among options that each hold _tag", (_, values, held, selected) => {
    const node: TileNode = {
      kind: "select",
      value: values[held],
      options: values.map((value, i) => ({ label: `option ${i}`, value })),
    };
    const sel = clientElement(node) as HTMLSelectElement;
    expect(Array.from(sel.options, (o) => o.selected)).toEqual(selected);
    const served = serverElement(node) as HTMLSelectElement;
    expect(Array.from(served.options, (o) => o.hasAttribute("selected"))).toEqual(selected);
  });
});
