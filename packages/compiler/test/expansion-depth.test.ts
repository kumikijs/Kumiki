import { describe, expect, it } from "vitest";
import {
  builtSummariesOf,
  type CheckOptions,
  checkSource,
  codesOf,
  pointedErrorsOf,
} from "./helpers/diagnostics.ts";
import {
  tileChain as chain,
  NESTING_LIMIT as LIMIT,
  routedToT0 as program,
} from "./helpers/programs.ts";

const depthErrors = (source: string) => checkSource(source).filter((e) => e.code === "E0237");

/** The codes of what `check` refuses the program with, and the warnings it gives beside them. */
function diagnosed(source: string, opts?: CheckOptions) {
  const found = checkSource(source, opts);
  return {
    errors: found.filter((e) => e.severity !== "warning").map((e) => e.code),
    warnings: found.filter((e) => e.severity === "warning"),
  };
}

/** Each error as its code and the text it points at, up to the first `)`. */
const pointed = (source: string): string[] =>
  pointedErrorsOf(source).map((e) => `${e.code} ${e.text.slice(0, e.text.indexOf(")") + 1)}`);

describe("a chain of tiles nests no deeper than the limit once inlined", () => {
  it("compiles the longest chain the limit admits", () => {
    // Two levels a link and three for the text at the end: 127 tiles nest
    // 255 levels deep, and a 128th would make it 257.
    expect(builtSummariesOf(program(chain(127)))).toEqual([]);
  });

  it.each([
    128, 250, 300, 500, 5_000,
  ])("refuses a %i-tile chain at the call where it goes over, without throwing", (n) => {
    const src = program(chain(n));
    expect(builtSummariesOf(src).map((s) => s.slice(0, 5))).toEqual(["E0237"]);
    // `T127` is called 254 levels in, from `T126`, and its own body takes
    // the tree to 257.
    expect(pointed(src)).toEqual(["E0237 T127)"]);
  });

  it("names how deep the tree goes, the limit, and where it goes over", () => {
    const [err] = depthErrors(program(chain(300)));
    expect(err?.kind).toBe("tile-depth");
    expect(err?.message).toBe(
      `Tile "T0" nests 601 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "T126" expands into "T127"`,
    );
  });

  it("reports a chain once, not once for every tile in it that is over", () => {
    // `T0` … `T172` are each over the limit on their own; only `T0` is not
    // inside another one's tree.
    expect(depthErrors(program(chain(300)))).toHaveLength(1);
  });

  it("reports a tile nothing calls even when no route names it", () => {
    // The bound is on the definition, as the parser's is: an unrouted tile is
    // still compiled for a tile-test, and is one call away from a route.
    const src = program([...chain(200, { from: 1000 }), 'tile T0 = text("root")']);
    expect(depthErrors(src).map((e) => e.message)).toEqual([
      `Tile "T1000" nests 401 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "T1126" expands into "T1127"`,
    ]);
  });

  it("reports two chains that share no tile separately, in declaration order", () => {
    const src = program([
      "tile T0 = column(A0, B0)",
      ...chain(129, { name: "B" }),
      ...chain(129, { name: "A" }),
      'tile Other = text("other")',
    ]);
    // `T0` is over through both, and is the one tile nothing expands into.
    expect(depthErrors(src).map((e) => e.message.slice(0, 20))).toEqual(['Tile "T0" nests 261 ']);
    const apart = src.replace("tile T0 = column(A0, B0)", 'tile T0 = text("t")');
    expect(depthErrors(apart).map((e) => e.message.slice(0, 20))).toEqual([
      'Tile "B0" nests 259 ',
      'Tile "A0" nests 259 ',
    ]);
  });

  it("measures each tile once, however many paths reach it", () => {
    // Each tile calls the next twice, so a walk per path takes 2^130 steps.
    const lines = Array.from({ length: 130 }, (_, i) =>
      i === 129 ? 'tile T129 = text("leaf")' : `tile T${i} = column(T${i + 1}, T${i + 1})`,
    );
    expect(depthErrors(program(lines)).map((e) => e.message.slice(0, 20))).toEqual([
      'Tile "T0" nests 261 ',
    ]);
  });

  it("counts a tile written as a bare identifier like a call", () => {
    // A lowercase name inside a builtin parses as a `Ref`, which code
    // generation resolves to the tile and inlines. The slots of the same names
    // are what the checker resolves the value reading to (see cycles.test.ts).
    const slots = Array.from({ length: 129 }, (_, i) => `slot t${i} : Int = 0`);
    const src = program([...chain(129, { name: "t" }), "tile T0 = column(t0)", ...slots]);
    // `T0` nests 2 + 2 × 128 + 3 levels; `t126` is named 254 levels in, from `t125`.
    expect(pointed(src)).toEqual(["E0237 t126)"]);
  });

  it("leaves a loop to E0005, however long the chain that reaches it", () => {
    // Every tile reaches the loop at the end, so none has a depth to report.
    const lines = chain(300);
    lines[299] = "tile T299 = column(T298)";
    expect(codesOf(program(lines))).toEqual(["E0005"]);
  });

  it("leaves a cycle to E0005, and a deep chain beside it to this check", () => {
    const src = program([
      "tile T0 = column(Loop, D0)",
      "tile Loop = column(Back)",
      "tile Back = column(Loop)",
      ...chain(129, { name: "D" }),
    ]);
    // `T0` reaches the loop, so it has no depth and is not reported; the
    // chain `D0` heads is over on its own and no tile with a depth calls it.
    expect(codesOf(src)).toEqual(["E0005", "E0237"]);
  });
});

describe("a tile-test's expected tree nests no deeper than the limit once inlined", () => {
  // `T0` nests 255 levels on its own, within the limit.
  const tested = (expect: string) =>
    program([...chain(127), `test t = tile-test T0 given={slots: {}} expect = ${expect}`]);

  it("compiles an expected tree at the limit", () => {
    expect(codesOf(tested("T0"))).toEqual([]);
  });

  it("refuses one that inlines the tile it names past the limit", () => {
    expect(depthErrors(tested("column(T0)")).map((e) => e.message)).toEqual([
      `The expected tree of tile-test "t" nests 257 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "T125" expands into "T126"`,
    ]);
  });

  it("leaves a tile that is over on its own to the tile's report", () => {
    const src = program([
      ...chain(128),
      "test t = tile-test T0 given={slots: {}} expect = column(T0)",
    ]);
    expect(depthErrors(src).map((e) => e.message.slice(0, 20))).toEqual(['Tile "T0" nests 257 ']);
  });
});

describe("a check that follows tiles into the tiles they inline reaches the report", () => {
  const LONG = 20_000;
  const head = "slot c : Int = 0\n";
  const observed = (e: { code: string; message: string }) =>
    `${e.code} ${e.message.match(/observed in body: [^)]*/)?.[0]}`;

  it("answers a ui.click reducer on the head of the chain", () => {
    const { errors, warnings } = diagnosed(
      program([...chain(LONG), "reducer r on=ui.click(T0) do= c := c + 1"], head),
    );
    expect(errors).toEqual(["E0237"]);
    expect(warnings.map(observed)).toEqual(["W0212 observed in body: column, text"]);
  });

  it("answers a handler prop on a call to the head of the chain", () => {
    const { errors, warnings } = diagnosed(
      program(
        [
          "tile Top = column(T0 {onClick: r})",
          ...chain(LONG),
          "reducer r on=ui.click(_) do= c := c + 1",
        ],
        head,
      ),
    );
    expect(errors).toEqual(["E0237"]);
    expect(warnings.map(observed)).toEqual(["W0213 observed in body: column, text"]);
  });

  it("walks each tile once, however many calls ask about the tiles it inlines", () => {
    // Every link hands a handler to the next, so each asks about the rest of
    // the chain: a walk per question is quadratic in its length. The last
    // link's is on a call to the text the chain ends in.
    const links = chain(LONG).map((l) => l.replace(/column\((T\d+)\)/, "column($1 {onClick: r})"));
    const { errors, warnings } = diagnosed(
      program([...links, "reducer r on=ui.click(_) do= c := c + 1"], head),
    );
    expect(errors).toEqual(["E0237"]);
    expect([...new Set(warnings.map(observed))]).toEqual([
      "W0213 observed in body: column, text",
      "W0213 observed in body: text",
    ]);
    expect(warnings).toHaveLength(LONG - 1);
  });

  // Each link renders the next at its root, so the check at the end is every link's root.
  const rootChain = (call: (next: string) => string) =>
    Array.from({ length: LONG }, (_, i) =>
      i === LONG - 1 ? `tile T${i} = check(value=b)` : `tile T${i} = ${call(`T${i + 1}`)}`,
    );
  const atRoot = (e: { code: string; message: string }) =>
    `${e.code} ${e.message.match(/observed at its root: [^)]*/)?.[0]}`;

  it("answers an onFocus on a call to the head of a chain whose root is a check", () => {
    const { errors, warnings } = diagnosed(
      program(
        [
          "tile Top = column(T0 {onFocus: r})",
          ...rootChain((next) => `${next}()`),
          "reducer r on=ui.click(_) do= c := c + 1",
        ],
        `${head}slot b : Bool = false\n`,
      ),
    );
    expect(errors).toEqual(["E0237"]);
    expect(warnings.map(atRoot)).toEqual(["W0213 observed at its root: check"]);
  });

  it("walks each root once, however many links hand an onFocus to the next", () => {
    const { errors, warnings } = diagnosed(
      program(
        [...rootChain((next) => `${next} {onFocus: r}`), "reducer r on=ui.click(_) do= c := c + 1"],
        `${head}slot b : Bool = false\n`,
      ),
    );
    expect(errors).toEqual(["E0237"]);
    expect([...new Set(warnings.map(atRoot))]).toEqual(["W0213 observed at its root: check"]);
    expect(warnings).toHaveLength(LONG - 1);
  });

  it("answers a ui.click(T0#id) reducer, reading the ids down the chain", () => {
    const links = chain(LONG).map((l) => l.replace('text("leaf")', 'button(text="go", id="leaf")'));
    const src = program([...links, "reducer r on=ui.click(T0#other) do= c := c + 1"], head);
    const { errors } = diagnosed(src, { strictSelectorId: true });
    expect(errors).toEqual(["E0212", "E0237"]);
    expect(checkSource(src, { strictSelectorId: true })[0]?.message).toContain('has id "leaf"');
  });

  it("answers a ui.click(Tile#id) reducer on the last tile, reading its ids up to the route", () => {
    // Each link renders the next at its root, so every call up the chain could give the leaf an id.
    const links = Array.from({ length: LONG }, (_, i) =>
      i === LONG - 1 ? `tile T${i} = button(text="go", id="leaf")` : `tile T${i} = T${i + 1}()`,
    );
    const src = program(
      [...links, `reducer r on=ui.click(T${LONG - 1}#other) do= c := c + 1`],
      head,
    );
    const { errors } = diagnosed(src, { strictSelectorId: true });
    expect(errors).toEqual(["E0212", "E0237"]);
    expect(checkSource(src, { strictSelectorId: true })[0]?.message).toContain('has id "leaf"');
  });

  // Each fallback names the next as its own, and a fallback renders with its boundary like any
  // other tile, so the button at the end can render where `W` is.
  const fallbacks = [
    "tile T0 = column(W)",
    'tile W error-boundary=F0 = text("w")',
    ...Array.from({ length: LONG }, (_, i) =>
      i === LONG - 1
        ? `tile F${i} in=PanicInfo = button(text="go", id="leaf")`
        : `tile F${i} in=PanicInfo error-boundary=F${i + 1} = text("f")`,
    ),
  ];

  it("answers a ui.click reducer that reaches the end of a chain of fallbacks", () => {
    const { errors, warnings } = diagnosed(
      program([...fallbacks, "reducer r on=ui.click(T0) do= c := c + 1"], head),
    );
    expect(errors).toEqual(["E0237"]);
    expect(warnings.filter((w) => w.code === "W0212")).toEqual([]);
  });

  it("answers a ui.click(T0#id) reducer, reading the ids down a chain of fallbacks", () => {
    const src = program([...fallbacks, "reducer r on=ui.click(T0#other) do= c := c + 1"], head);
    const { errors } = diagnosed(src, { strictSelectorId: true });
    expect(errors).toEqual(["E0212", "E0237"]);
    expect(checkSource(src, { strictSelectorId: true })[0]?.message).toContain('has id "leaf"');
  });

  // A sub-routes tile may hold its outlet in any tile it renders, so E0113 follows the chain.
  const routed = (leaf: string) =>
    [
      ...chain(LONG).map((l) => l.replace('text("leaf")', leaf)),
      'tile Child = text("child")',
      'tile Shell sub-routes = { "/x/a" -> Child } = column(T0)',
      'app M caps=[] routes={"/x/*" -> Shell, "/404" -> Child} init=[]',
      "",
    ].join("\n");

  it("finds the route-outlet at the end of the chain a sub-routes tile renders", () => {
    expect(diagnosed(routed("route-outlet()")).errors).toEqual(["E0237"]);
  });

  it("answers E0113 for a sub-routes tile whose chain renders no route-outlet", () => {
    expect(diagnosed(routed('text("leaf")')).errors).toEqual(["E0113", "E0237"]);
  });
});

describe("what counts as a level", () => {
  const head = `slot xs : List(Int) = [1]
slot c : Bool = true
slot o : Option(Int) = None
`;

  // `k` levels of one construct around a column holding a call to a chain of
  // `m` links: k for the constructs, one for the column, one for the call, and
  // 2m + 1 for the chain.
  const nested = (wrap: (x: string, i: number) => string, k: number, m: number): string => {
    let body = "column(T1)";
    for (let i = 0; i < k; i++) body = wrap(body, i);
    return program([`tile T0 = ${body}`, ...chain(m, { from: 1 })], head);
  };

  it.each<[string, (x: string, i: number) => string]>([
    ["a builtin call", (x) => `column(${x})`],
    ["a for", (x, i) => `for x${i} in xs ${x}`],
    ["a when", (x) => `when(c, ${x})`],
    ["an if", (x) => `if c then ${x} else text("e")`],
    ["a match", (x, i) => `match o with | None -> text("n") | Some(v${i}) -> ${x}`],
  ])("counts %s inside one tile as one level of the inlined tree", (_, wrap) => {
    expect(builtSummariesOf(nested(wrap, 101, 76)), "101 + 2 + 153 levels").toEqual([]);
    expect(codesOf(nested(wrap, 102, 76)), "102 + 2 + 153 levels").toEqual(["E0237"]);
  });

  // 1 for the construct and 1 for the call, then 255 for the chain the call heads.
  it.each([
    ["the consequent of an if", 'if c then T1 else text("x")'],
    ["the alternate of an if", 'if c then text("x") else T1'],
    ["the first arm of a match", 'match o with | Some(v) -> T1 | None -> text("n")'],
    ["the last arm of a match", 'match o with | None -> text("n") | Some(v) -> T1'],
  ])("counts %s a level under it", (_, body) => {
    expect(pointed(program([`tile T0 = ${body}`, ...chain(127, { from: 1 })], head))).toEqual([
      "E0237 T127)",
    ]);
  });

  it("does not count siblings: a wide tree is as deep as its deepest child", () => {
    const leaves = Array.from({ length: 2_000 }, (_, i) => `tile L${i} = text("${i}")`);
    const calls = Array.from({ length: 2_000 }, (_, i) => `L${i}`).join(", ");
    expect(builtSummariesOf(program([`tile T0 = column(${calls})`, ...leaves]))).toEqual([]);
  });

  it("does not count a tile written where nothing renders it, which is E0129 alone", () => {
    // A spinner renders no positional argument, so the tile named there is not inlined
    // (see cycles.test.ts): `T1`'s chain is a tree of its own, within the limit.
    const src = (body: string) =>
      program([`tile T0 = column(${body})`, ...chain(127, { from: 1 })]);
    expect(codesOf(src("T1"))).toEqual(["E0237"]);
    expect(codesOf(src("spinner(T1)"))).toEqual(["E0129"]);
  });

  it("counts the expressions in a tile as the parser counts them", () => {
    // The last link's text holds `ifs` nested `if`s, each a level over the one in its `else`.
    const src = (ifs: number) => {
      const lines = chain(103);
      lines[102] = `tile T102 = text(${'if c then "a" else '.repeat(ifs)}"b")`;
      return program(lines, head);
    };
    expect(builtSummariesOf(src(49)), "2 × 102 + 3 + 49 levels").toEqual([]);
    expect(pointed(src(50)), "2 × 102 + 3 + 50 levels").toEqual(["E0237 T102)"]);
  });

  it("counts an error-boundary's fallback beneath the boundary, beside the tile's body", () => {
    // `F` nests exactly `LIMIT` deep on its own. Every call of `A` inlines it
    // into the `catch` of the boundary that wraps the call: under `T0`'s
    // column, `A`'s call, and the boundary.
    const deep = (boundary: string) =>
      program([
        "tile T0 = column(A)",
        `tile A${boundary} = text("a")`,
        "tile F in=PanicInfo = F0()",
        ...chain(127, { name: "F" }),
      ]);
    expect(builtSummariesOf(deep("")), "with no boundary, F is not under T0").toEqual([]);
    const over = deep(" error-boundary=F");
    expect(pointed(over)).toEqual(["E0237 F125)"]);
    expect(depthErrors(over)[0]?.message).toBe(
      `Tile "T0" nests 259 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "F124" expands into "F125"`,
    );
  });

  it("counts an error-boundary as a level of its own, around the tile's body", () => {
    // The `try` wraps every call of the tile that declares it, so a link here
    // is three levels: the boundary, the column, and the call. The last is
    // its boundary and its text's three.
    const boundaryChain = (lines: readonly string[]) =>
      program([
        ...lines.map((l) => l.replace(/^tile (T\d+)/, "tile $1 error-boundary=F")),
        'tile F in=PanicInfo = text("fallback")',
      ]);
    expect(builtSummariesOf(boundaryChain(chain(85))), "3 × 84 + 4 levels").toEqual([]);
    expect(codesOf(boundaryChain(chain(86))), "3 × 85 + 4 levels").toEqual(["E0237"]);
    // Here the tile's own body is deeper than its fallback, so its boundary
    // decides: 3 × 84 for the chain, 1 for the boundary, 4 for the column and its text.
    const deeper = chain(85);
    deeper[84] = 'tile T84 = column(text("leaf"))';
    expect(codesOf(boundaryChain(deeper)), "3 × 84 + 1 + 4 levels").toEqual(["E0237"]);
  });
});

describe("what a call to a user tile counts", () => {
  const head = "slot c : Bool = true\n";
  // `k` columns around the call, then the call's own levels, then 3 for the
  // text `T1` is.
  const around = (k: number, call: string, takes: string) =>
    program(
      [`tile T0 = ${"column(".repeat(k)}${call}${")".repeat(k)}`, `tile T1${takes} = text("leaf")`],
      head,
    );

  // Code generation wraps an inlined body once more for an argument, which it
  // binds in a function of its own, and once more for a key.
  it.each<[string, string, string, number]>([
    ["a call", "T1", "", 1],
    ["a call with a key", 'T1 {key: "k"}', "", 2],
    ["a call passing an argument", "T1(0)", " in=Int", 2],
    ["a call passing an argument with a key", 'T1(0) {key: "k"}', " in=Int", 3],
    ["a call a for renders, which keys it", "for x in [1] T1", "", 3],
    ["a call a for renders through a when", "for x in [1] when(c, T1)", "", 4],
    ["a call a for renders, passing an argument", "for x in [1] T1(x)", " in=Int", 4],
    ["a call in a builtin a for renders, which is not keyed", "for x in [1] column(T1)", "", 3],
  ])("counts %s as its levels", (_, call, takes, levels) => {
    const k = LIMIT - 3 - levels;
    expect(builtSummariesOf(around(k, call, takes)), `${k} + ${levels} + 3 levels`).toEqual([]);
    const over = pointed(around(k + 1, call, takes));
    expect(over, `${k + 1} + ${levels} + 3 levels`).toHaveLength(1);
    expect(over[0]).toMatch(/^E0237 T1\b/);
  });
});
