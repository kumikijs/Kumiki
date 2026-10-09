// `_wk` and `_children` on their own, with no mount (runtime.md §10.3.10).
// `_named` joins them where a chain of calls copies a node between two `_wk`s.
//
// All three ship as source text in `RUNTIME_HELPERS`, inlined at the top of
// every compiled app, so they are evaluated here the same way. A mounted
// example says whether a reorder kept the DOM; these say which key each node
// got, and name the branch that went wrong when it did not.

import { describe, expect, it } from "vitest";
import { RUNTIME_HELPERS } from "../src/codegen/runtime-helpers.ts";

type Node = { kind: string; key?: string; text?: string };
type Tree = Node | null | undefined | Tree[];

const { _wk, _children, _named } = new Function(
  `${RUNTIME_HELPERS}\nreturn { _wk, _children, _named };`,
)() as {
  _wk: (node: Tree, key: unknown) => Tree;
  _children: (...xs: Tree[]) => Node[];
  _named: (node: Tree, name: string) => Tree;
};

const t = (text: string): Node => ({ kind: "text", text });
const keys = (tree: Tree): unknown[] => (tree as Node[]).map((n) => n.key);

/**
 * The child list of `column(for x1 in xs … for xn in xs text(…))` with one
 * element per list, built the way the codegen wraps it: each `for` below the
 * first is the body of the one above, so its list is keyed under that one's
 * iteration key, and the innermost `for` keys the `text`. `loopKeys[d]` is the
 * implicit key of depth `d`'s one iteration.
 */
function nestedFors(loopKeys: string[]): Node[] {
  const list = (d: number): Tree => {
    const key = loopKeys[d] as string;
    return [d === loopKeys.length - 1 ? _wk(t("leaf"), key) : _wk(list(d + 1), key)];
  };
  return _children(list(0));
}

/**
 * The child list of `column(L1)` for `tile Li = for x in xs L(i+1)` and
 * `tile Ln = for x in xs text(…)`: each call sits in a `for`, so the node the
 * callee's list renders is keyed under the call's iteration key, after
 * `_named` has copied it.
 */
function forChain(loopKeys: string[]): Node[] {
  const body = (d: number): Tree => {
    const key = loopKeys[d] as string;
    return [
      d === loopKeys.length - 1 ? _wk(t("leaf"), key) : _wk(_named(body(d + 1), `L${d + 2}`), key),
    ];
  };
  return _children(_named(body(0), "L1"));
}

/**
 * `count` distinct implicit keys, shaped as `_s.loopKeys` writes them, each
 * with a shown value holding quotes for JSON to escape.
 */
const loopKeysOf = (count: number): string[] =>
  Array.from({ length: count }, (_, d) => `Page_${d}|1|"${d}"`);

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

describe("_wk at depth", () => {
  it("keys a node of twenty nested fors by the array of their twenty keys", () => {
    const loopKeys = loopKeysOf(20);
    const nodes = nestedFors(loopKeys);
    expect(nodes).toHaveLength(1);
    const [leaf] = nodes;
    // The length first: a key that doubles per level is megabytes long, and
    // comparing it as a string would print all of it.
    expect(leaf?.key?.length).toBe(JSON.stringify(loopKeys).length);
    expect(leaf?.key).toBe(JSON.stringify(loopKeys));
  });

  it("keys a node of a chain of twenty for-bodied tiles the same way", () => {
    const loopKeys = loopKeysOf(20);
    const nodes = forChain(loopKeys);
    expect(nodes).toHaveLength(1);
    const [leaf] = nodes;
    expect(leaf?.key?.length).toBe(JSON.stringify(loopKeys).length);
    expect(leaf?.key).toBe(JSON.stringify(loopKeys));
    expect(leaf?.text).toBe("leaf");
  });

  it("keys a node 256 fors deep in one element per for", () => {
    // As deep as the parser lets one definition nest (256 levels).
    const loopKeys = loopKeysOf(256);
    for (const tree of [nestedFors(loopKeys), forChain(loopKeys)]) {
      expect(tree.map((n) => n.key)).toEqual([JSON.stringify(loopKeys)]);
    }
  });

  it("keys every node of a nest with two elements at each level apart, by its own path", () => {
    // `for a in ["0", "1"] for b in ["0", "1"] for c in … for d in … text(…)`.
    const level = (path: string[], depth: number): Tree =>
      ["0", "1"].map((i) => {
        const key = `L${depth}|1|${i}`;
        return depth === 3
          ? _wk({ ...t([...path, key].join(" ")), path: [...path, key] } as Node, key)
          : _wk(level([...path, key], depth + 1), key);
      });
    const nodes = _children(level([], 0));
    expect(nodes).toHaveLength(16);
    for (const n of nodes) {
      expect(n.key).toBe(JSON.stringify((n as Node & { path: string[] }).path));
    }
    expect(new Set(nodes.map((n) => n.key)).size).toBe(16);
  });

  it("extends a node's key only when it is an array of two or more, as JSON.stringify writes it", () => {
    // Each sibling's own key next to the one it would collide with if it were
    // read back as an array: a spelling JSON.stringify does not write next to
    // the one it does, a one-element array next to its element, and `[0]`
    // next to position 0.
    const own = (key: string): Node => ({ ...t(key), key });
    const tree = [
      t("no key"),
      own("[0]"),
      own('["a","b"]'),
      own('[ "a", "b" ]'),
      own('["a"]'),
      own("a"),
      own("[not json"),
    ];
    const ks = keys(_wk(tree, "k"));
    expect(ks).toEqual([
      '["k",0]',
      '["k","[0]"]',
      '["k","a","b"]',
      '["k","[ \\"a\\", \\"b\\" ]"]',
      '["k","[\\"a\\"]"]',
      '["k","a"]',
      '["k","[not json"]',
    ]);
    expect(new Set(ks).size).toBe(ks.length);
  });
});
