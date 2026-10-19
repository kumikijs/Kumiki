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
    ["no value", undefined, "undefined"],
  ])("keeps the key it gave %s", (_, v, key) => {
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
