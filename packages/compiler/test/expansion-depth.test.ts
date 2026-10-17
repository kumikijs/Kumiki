import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

/** The nesting bound in language.md. */
const LIMIT = 256;

const TAIL = `app M caps=[] routes={"/" -> T0, "/404" -> T0} init=[]
`;

/** `n` tiles, each a column around a call to the next; the last holds the leaf. */
function chain(n: number, from = 0): string[] {
  return Array.from(
    { length: n },
    (_, i) => `tile T${from + i} = column(${i === n - 1 ? 'text("leaf")' : `T${from + i + 1}`})`,
  );
}

const program = (lines: readonly string[], head = ""): string =>
  `${head}${lines.join("\n")}\n${TAIL}`;

const build = (source: string) =>
  compile(source, { runtimeSpecifier: "@kumikijs/runtime", capabilities: [] });

const depthErrors = (source: string) => checkSource(source).filter((e) => e.code === "E0237");

describe("a chain of tiles nests no deeper than the limit once inlined", () => {
  it("compiles the longest chain the limit admits", () => {
    // Two levels a link, so 128 links nest exactly `LIMIT` deep.
    expect(build(program(chain(LIMIT / 2))).kind).toBe("ok");
  });

  for (const n of [LIMIT / 2 + 1, 250, 300, 500, 5_000]) {
    it(`refuses a ${n}-tile chain with a positioned diagnostic, without throwing`, () => {
      const result = build(program(chain(n)));
      expect(result.kind, `a ${n}-tile chain compiled`).toBe("fail");
      if (result.kind !== "fail") return;
      const found = result.errors.filter((e) => e.code === "E0237");
      expect(found).toHaveLength(1);
      // At the call where the tree goes past the limit: `T128` is called 256
      // levels in, and its column is the 257th. That call is written in
      // `T127`, on line 128.
      expect(`${found[0]?.pos.line}:${found[0]?.pos.col}`).toBe("128:20");
    });
  }

  it("names how deep the tree goes, the limit, and where it goes over", () => {
    const [err] = depthErrors(program(chain(300)));
    expect(err?.kind).toBe("tile-depth");
    expect(err?.message).toBe(
      `Tile "T0" nests 600 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "T127" expands into "T128"`,
    );
  });

  it("reports a chain once, not once for every tile in it that is over", () => {
    // `T0` … `T171` are each over the limit on their own; only `T0` is not
    // inside another one's tree.
    expect(depthErrors(program(chain(300)))).toHaveLength(1);
  });

  it("reports a tile nothing calls even when no route names it", () => {
    // The bound is on the definition, as the parser's is: an unrouted tile is
    // still compiled for a tile-test, and is one call away from a route.
    const src = `${chain(200, 1000).join("\n")}\ntile T0 = text("root")\n${TAIL}`;
    const errs = depthErrors(src);
    expect(errs.map((e) => e.message)).toEqual([
      `Tile "T1000" nests 400 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "T1127" expands into "T1128"`,
    ]);
  });

  it("reports two chains that share no tile separately, in declaration order", () => {
    const src = program([
      "tile T0 = column(A0, B0)",
      ...chain(129, 0).map((l) => l.replace(/\bT(\d+)/g, "B$1")),
      ...chain(129, 0).map((l) => l.replace(/\bT(\d+)/g, "A$1")),
      'tile Other = text("other")',
    ]);
    // `T0` is over through both, and is the one tile nothing expands into.
    expect(depthErrors(src).map((e) => e.message.slice(0, 20))).toEqual(['Tile "T0" nests 260 ']);
    const apart = src.replace("tile T0 = column(A0, B0)", 'tile T0 = text("t")');
    expect(depthErrors(apart).map((e) => e.message.slice(0, 20))).toEqual([
      'Tile "B0" nests 258 ',
      'Tile "A0" nests 258 ',
    ]);
  });

  it("measures each tile once, however many paths reach it", () => {
    // Each tile calls the next twice, so a walk per path takes 2^130 steps.
    const lines = Array.from(
      { length: 130 },
      (_, i) => `tile T${i} = column(${i === 129 ? 'text("leaf")' : `T${i + 1}, T${i + 1}`})`,
    );
    expect(depthErrors(program(lines)).map((e) => e.message.slice(0, 20))).toEqual([
      'Tile "T0" nests 260 ',
    ]);
  });

  it("counts a tile written as a bare identifier like a call", () => {
    // A lowercase name inside a builtin parses as a `Ref`, which code
    // generation resolves to the tile and inlines. The slots of the same names
    // are what the checker resolves the value reading to (see cycles.test.ts).
    const tiles = Array.from(
      { length: 129 },
      (_, i) => `tile t${i} = column(${i === 128 ? 'text("leaf")' : `t${i + 1}`})`,
    );
    const slots = Array.from({ length: 129 }, (_, i) => `slot t${i} : Int = 0`);
    const src = program([...tiles, "tile T0 = column(t0)", ...slots]);
    // `T0` nests 2 + 2 × 129 levels; `t127` is called 256 levels in, from `t126`.
    expect(depthErrors(src).map((e) => `${e.pos.line}:${e.pos.col}`)).toEqual(["127:20"]);
  });
});

describe("a check that follows tiles into the tiles they inline reaches the report", () => {
  const LONG = 20_000;
  const head = "slot c : Int = 0\n";
  const observed = (e: { code: string; message: string }) =>
    `${e.code} ${e.message.match(/observed in body: [^)]*/)?.[0]}`;

  it("answers a ui.click reducer on the head of the chain", () => {
    const result = build(
      program([...chain(LONG), "reducer r on=ui.click(T0) do= c := c + 1"], head),
    );
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0237"]);
    expect(result.warnings.map(observed)).toEqual(["W0212 observed in body: column, text"]);
  });

  it("answers a handler prop on a call to the head of the chain", () => {
    const result = build(
      program(
        [
          "tile Top = column(T0 {onClick: r})",
          ...chain(LONG),
          "reducer r on=ui.click(_) do= c := c + 1",
        ],
        head,
      ),
    );
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0237"]);
    expect(result.warnings.map(observed)).toEqual(["W0213 observed in body: column, text"]);
  });

  it("walks each tile once, however many calls ask about the tiles it inlines", () => {
    // Every link hands a handler to the next, so each asks about the rest of
    // the chain: a walk per question is quadratic in its length.
    const links = chain(LONG).map((l) => l.replace(/column\((T\d+)\)/, "column($1 {onClick: r})"));
    const result = build(program([...links, "reducer r on=ui.click(_) do= c := c + 1"], head));
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0237"]);
    const answers = new Set(result.warnings.map(observed));
    expect([...answers]).toEqual(["W0213 observed in body: column, text"]);
    expect(result.warnings).toHaveLength(LONG - 1);
  });
});

describe("what counts as a level", () => {
  const head = `slot xs : List(Int) = [1]
slot c : Bool = true
slot o : Option(Int) = None
`;
  // One level of each construct a tile body nests, around `x`.
  const wrappers: readonly [string, (x: string, i: number) => string][] = [
    ["a builtin call", (x) => `column(${x})`],
    ["a for", (x, i) => `for x${i} in xs ${x}`],
    ["a when", (x) => `when(c, ${x})`],
    ["an if", (x) => `if c then ${x} else text("e")`],
    ["a match", (x, i) => `match o with | None -> text("n") | Some(v${i}) -> ${x}`],
  ];
  // `k` levels of one construct around a call to a chain of `m` links: k for
  // the constructs, one for the call, two for each link.
  const nested = (wrap: (x: string, i: number) => string, k: number, m: number): string => {
    let body = "T1";
    for (let i = 0; i < k; i++) body = wrap(body, i);
    return program([`tile T0 = ${body}`, ...chain(m, 1)], head);
  };

  for (const [what, wrap] of wrappers) {
    it(`counts ${what} inside one tile as one level of the inlined tree`, () => {
      expect(build(nested(wrap, 101, 77)).kind, "101 + 1 + 154 levels").toBe("ok");
      const over = build(nested(wrap, 102, 77));
      expect(over.kind, "102 + 1 + 154 levels").toBe("fail");
      if (over.kind === "fail") expect(over.errors.map((e) => e.code)).toEqual(["E0237"]);
    });
  }

  it("does not count siblings: a wide tree is as deep as its deepest child", () => {
    const leaves = Array.from({ length: 2_000 }, (_, i) => `tile L${i} = text("${i}")`);
    const calls = Array.from({ length: 2_000 }, (_, i) => `L${i}`).join(", ");
    expect(build(program([`tile T0 = column(${calls})`, ...leaves])).kind).toBe("ok");
  });

  it("counts an error-boundary's fallback beneath the boundary, beside the tile's body", () => {
    // `F` nests exactly `LIMIT` deep on its own. Every call of `A` inlines it
    // into the `catch` of the boundary that wraps the call: under `T0`'s
    // column, `A`'s call, and the boundary.
    const deep = (boundary: string) =>
      program([
        `tile T0 = column(A)`,
        `tile A${boundary} = text("a")`,
        "tile F = column(F1)",
        ...chain(127, 1).map((l) => l.replace(/\bT(\d+)/g, "F$1")),
      ]);
    expect(build(deep("")).kind, "with no boundary, F is not under T0").toBe("ok");
    const over = build(deep(" error-boundary=F"));
    expect(over.kind).toBe("fail");
    if (over.kind === "fail") {
      expect(over.errors.map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
        "E0237 128:20",
      ]);
      expect(over.errors[0]?.message).toBe(
        `Tile "T0" nests 259 levels deep once the tiles in it are inlined, past the limit of ${LIMIT}; it goes over where "F125" expands into "F126"`,
      );
    }
  });

  it("counts an error-boundary as a level of its own, around the tile's body", () => {
    // The `try` wraps every call of the tile that declares it, so a link here
    // is three levels: the boundary, the column, and the call.
    const boundaryChain = (n: number) =>
      program([
        ...chain(n).map((l) => l.replace(/^tile (T\d+)/, "tile $1 error-boundary=F")),
        'tile F = text("fallback")',
      ]);
    expect(build(boundaryChain(85)).kind, "3 × 85 levels").toBe("ok");
    const over = build(boundaryChain(86));
    expect(over.kind, "3 × 86 levels").toBe("fail");
    if (over.kind === "fail") expect(over.errors.map((e) => e.code)).toEqual(["E0237"]);
  });

  it("leaves a cycle to E0005, and a deep chain beside it to this check", () => {
    const src = program([
      "tile T0 = column(Loop, D0)",
      "tile Loop = column(Back)",
      "tile Back = column(Loop)",
      ...chain(129, 0).map((l) => l.replace(/\bT(\d+)/g, "D$1")),
    ]);
    // `T0` reaches the loop, so it has no depth and is not reported; the
    // chain `D0` heads is over on its own and nothing measurable calls it.
    expect(codesOf(src)).toEqual(["E0005", "E0237"]);
  });
});
