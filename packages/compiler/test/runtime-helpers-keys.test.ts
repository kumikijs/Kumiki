// `_wk` and `_children` on their own, with no mount (runtime.md §10.3.10).
//
// Both ship as source text in `RUNTIME_HELPERS`, inlined at the top of every
// compiled app, so they are evaluated here the same way. A mounted example
// says whether a reorder kept the DOM; these say which key each node got, and
// name the branch that went wrong when it did not.

import { describe, expect, it } from "vitest";
import { RUNTIME_HELPERS } from "../src/codegen/runtime-helpers.ts";

type Node = { kind: string; key?: string; text?: string };
type Tree = Node | null | undefined | Tree[];

const { _wk, _children } = new Function(`${RUNTIME_HELPERS}\nreturn { _wk, _children };`)() as {
  _wk: (node: Tree, key: unknown) => Tree;
  _children: (...xs: Tree[]) => Node[];
};

const t = (text: string): Node => ({ kind: "text", text });
const keys = (tree: Tree): unknown[] => (tree as Node[]).map((n) => n.key);

describe("_children", () => {
  it("flattens nested lists to their nodes, in order, however deep", () => {
    expect(_children(t("a"), [t("b"), [t("c"), [t("d")]]], t("e")).map((n) => n.text)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("drops null and undefined entries at any depth", () => {
    expect(_children(null, [undefined, t("a"), [null]], undefined).map((n) => n.text)).toEqual([
      "a",
    ]);
  });
});

describe("_wk", () => {
  it("stamps the key on a single node", () => {
    expect(_wk(t("a"), "k")).toEqual({ kind: "text", text: "a", key: "k" });
  });

  it("refuses a null, undefined or empty key", () => {
    for (const bad of [null, undefined, ""]) {
      expect(() => _wk(t("a"), bad)).toThrow(/TileNode.key must be a non-empty string/);
    }
  });

  it("pairs the key with each node's own key", () => {
    expect(
      keys(
        _wk(
          [
            { ...t("a"), key: "a" },
            { ...t("b"), key: "b" },
          ],
          "k",
        ),
      ),
    ).toEqual(['["k","a"]', '["k","b"]']);
  });

  it("gives a node in a nested list its own key, not the nested list's position", () => {
    const tree = [
      [
        { ...t("x1"), key: "x1" },
        { ...t("x2"), key: "x2" },
      ],
      [{ ...t("y1"), key: "y1" }],
    ];
    expect(keys(_wk(tree, "k"))).toEqual(['["k","x1"]', '["k","x2"]', '["k","y1"]']);
  });

  it("falls back to the position in the flattened list only for a node with no key", () => {
    const tree = [[t("a"), { ...t("b"), key: "b" }], [t("c")]];
    expect(keys(_wk(tree, "k"))).toEqual(['["k",0]', '["k","b"]', '["k",2]']);
  });

  it('keeps a key of the string "0" apart from position 0', () => {
    const [first, second] = keys(_wk([t("a"), { ...t("b"), key: "0" }], "k"));
    expect(first).toBe('["k",0]');
    expect(second).toBe('["k","0"]');
    expect(first).not.toBe(second);
  });

  it("composes the keys of a for nested in a for, as the codegen wraps each outer iteration", () => {
    const inner = (outer: string) =>
      _wk(
        ["1", "2"].map((i) => _wk(t(`${outer}-${i}`), i)),
        outer,
      );
    const all = _children(["a", "b"].map(inner));
    const ks = all.map((n) => n.key);
    expect(ks).toEqual(['["a","1"]', '["a","2"]', '["b","1"]', '["b","2"]']);
    expect(new Set(ks).size).toBe(ks.length);
  });

  it("drops a null entry of a list rather than keying it", () => {
    expect(keys(_wk([null, { ...t("a"), key: "a" }], "k"))).toEqual(['["k","a"]']);
  });
});
