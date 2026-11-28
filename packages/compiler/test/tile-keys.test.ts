import { _stdlibCore } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { compileOrFail, keyedLoopsIn, loadApp } from "./helpers/module.ts";
import { withApp } from "./helpers/programs.ts";

type Node = {
  key?: string;
  props?: { _tile?: string | string[]; el?: { key?: unknown } };
  children?: Node[];
};

/** The tree `/` of the program `defs` completes renders. */
async function rendered(defs: string): Promise<Node> {
  const app = await loadApp<{ routes: { tile: () => Node }[] }>(withApp(defs), "keys");
  const tree = app.routes[0]?.tile();
  if (!tree) expect.fail("the app routes nothing to `/`");
  return tree;
}

/** The key of each node the tile `tile` renders in `tree`, in document order. */
function keysOf(tree: Node, tile: string): (string | undefined)[] {
  const keys: (string | undefined)[] = [];
  const walk = (n: Node): void => {
    if ([n.props?._tile ?? []].flat().includes(tile)) keys.push(n.key);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return keys;
}

/** The keys the runtime gives the elements of `xs` in the loop named `loop`. */
const loopKeys = (xs: readonly unknown[], loop: string): string[] => _stdlibCore.loopKeys(xs, loop);

describe("stable tile identity (key)", () => {
  it("lifts an explicit {key: expr} on a builtin tile call to a top-level `key` field", async () => {
    const tree = await rendered(`slot xs : List(Int) = [1, 2, 3]
tile Row = text("row")
tile App = column(for x in xs Row {key: x.show})`);
    expect(keysOf(tree, "Row")).toEqual(["1", "2", "3"]);
    for (const row of tree.children ?? []) expect(row.props?.el?.key).toBeUndefined();
  });

  it("synthesizes an implicit key from the loop variable when the tile-for body omits {key: ...}", async () => {
    const tree = await rendered(`slot xs : List(Int) = [1, 2, 3]
tile Row = text("row")
tile App = column(for x in xs Row)`);
    expect(keysOf(tree, "Row")).toEqual(loopKeys([1, 2, 3], "App_0"));
  });

  it("does not synthesize an implicit key outside of a for iteration", async () => {
    const tree = await rendered(`tile Row = text("row")
tile App = column(Row)`);
    expect(keysOf(tree, "Row")).toEqual([undefined]);
  });

  const [outerKey] = loopKeys([1], "App_0");
  it.each([
    ["under a row", "row(for i in inner Cell)", loopKeys([2, 3], "App_1")],
    // The outer loop keys the list the inner one renders, so each key holds both of them.
    [
      "directly",
      "for i in inner Cell",
      loopKeys([2, 3], "App_1").map((inner) => JSON.stringify([outerKey, inner])),
    ],
  ])("keys a for nested %s in a for by the inner loop's elements", async (_, nest, keys) => {
    const tree = await rendered(`slot outer : List(Int) = [1]
slot inner : List(Int) = [2, 3]
tile Cell = text("c")
tile App = column(for o in outer ${nest})`);
    expect(keysOf(tree, "Cell")).toEqual(keys);
  });

  it("propagates the implicit key through TileWhen (for x in xs when(cond, Row))", async () => {
    const tree = await rendered(`slot xs : List(Int) = [1, 2, 3]
tile Row = text("row")
tile App = column(for x in xs when(x > 0, Row))`);
    expect(keysOf(tree, "Row")).toEqual(loopKeys([1, 2, 3], "App_0"));
  });

  it("propagates the implicit key through TileMatch (for id in ids match kind with |A -> Row)", async () => {
    const tree = await rendered(`type Kind = A | B
slot kind : Kind = A
slot ids : List(Int) = [1, 2, 3]
tile Row = text("row")
tile App = column(for id in ids match kind with |A -> Row |B -> Row)`);
    expect(keysOf(tree, "Row")).toEqual(loopKeys([1, 2, 3], "App_0"));
  });

  it("resets the implicit key at user-tile boundaries (inner for uses its own loop var)", async () => {
    const tree = await rendered(`slot outer : List(Int) = [1]
slot inner : List(Int) = [2, 3]
tile Cell = text("c")
tile Inner = column(for i in inner Cell)
tile Outer = column(Inner)
tile App = column(for o in outer Outer)`);
    expect(keysOf(tree, "Outer")).toEqual(loopKeys([1], "App_0"));
    expect(keysOf(tree, "Cell")).toEqual(loopKeys([2, 3], "Inner_0"));
  });

  it("names a loop by its tile and its ordinal there, so an edit above it keeps every key", async () => {
    const tiles = `tile Row = text("row")
tile App = column(for x in xs Row, for y in xs when(y > 1, Row))`;
    const keys = async (above: string) =>
      keysOf(await rendered(`slot xs : List(Int) = [1, 2, 3]\n${above}${tiles}`), "Row");
    const before = await keys("");
    expect(before).toEqual([
      ...loopKeys([1, 2, 3], "App_0"),
      ...loopKeys([1, 2, 3], "App_1").slice(1),
    ]);
    expect(await keys('\n\n\ntile Other = text("other")\n')).toEqual(before);
  });

  // Whether a loop computes keys nobody reads shows only in the module.
  it.each([
    ["its own key", "text(x.show) {key: x.show}"],
    // `__fk0` is what the module calls the first loop's key.
    ["its own key and a text that spells its key's name", 'text("__fk0") {key: x.show}'],
  ])("computes no implicit keys for a loop whose every tile call has %s", (_, body) => {
    const js = compileOrFail(
      withApp(`slot xs : List(Int) = [1, 2, 3]
tile App = column(for x in xs ${body}, for y in xs text(y.show))`),
    );
    // Only the second loop, whose `text` has no key, reads an implicit one.
    expect(keyedLoopsIn(js)).toEqual(["App_1"]);
  });
});
