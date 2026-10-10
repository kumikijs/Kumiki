import { iterStringLiterals, planTestPatch, planTestPatchExplained } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { storeOf } from "./helpers/files.ts";

type Leaf = { expected: unknown; actual: unknown };

const failing = (diffAt: string, leaf: Leaf) => ({ name: "t", pass: false, diffAt, leaf });

/** A `test t` over `target` spanning the lines after `defs`, with `given` / `expect` as written. */
function withTest(defs: string[], kind: string, target: string, given: string, expected: string) {
  const source = [
    ...defs,
    "test t =",
    `    ${kind} ${target}`,
    `        given  = ${given}`,
    `        expect = ${expected}`,
    "",
  ].join("\n");
  const first = defs.length + 1;
  return { source, testRange: [first, first + 3] as [number, number] };
}

describe("planTestPatch: deterministic literal repair from a failing test", () => {
  it("proposes replacing a unique source literal with the expected text", () => {
    const source = `tile Title = heading("Helo")\n`;
    const patch = planTestPatch(
      source,
      failing("heading.text", { expected: "Hello", actual: "Helo" }),
    );
    expect(patch?.description).toContain('replace "Helo" with "Hello"');
    expect(patch?.apply(source)).toBe(`tile Title = heading("Hello")\n`);
  });

  it("does not mis-handle a `$` in the expected replacement text", () => {
    const source = `tile Price = label("USD 9")\n`;
    const patch = planTestPatch(source, failing("label.text", { expected: "$9", actual: "USD 9" }));
    expect(patch?.apply(source)).toBe(`tile Price = label("$9")\n`);
  });

  it.each([
    [
      "the actual text is not a verbatim source literal",
      `tile App = heading("Count: " + count.show)\n`,
      failing("heading.text", { expected: "Count: 5", actual: "Count: 0" }),
    ],
    [
      "the literal occurs more than once",
      `tile A = heading("Helo")\ntile B = label("Helo")\n`,
      failing("heading.text", { expected: "Hello", actual: "Helo" }),
    ],
    [
      "the leaf is numeric and no store scopes the reducer",
      `reducer dec on=ui.click(B) do= count := count - 1\n`,
      failing("slots.count", { expected: 1, actual: -1 }),
    ],
    [
      "the expected text needs an escape Kumiki cannot represent",
      `tile T = heading("a")\n`,
      failing("heading.text", { expected: "a\bc", actual: "a" }),
    ],
  ])("returns null when %s", (_, source, result) => {
    expect(planTestPatch(source, result)).toBeNull();
  });

  it("skips a literal that lives only in a test body", () => {
    const { source, testRange } = withTest(
      ["tile Msg = heading(msg.show)"],
      "tile-test",
      "Msg",
      '{slots: {msg: "Helo"}}',
      'heading("Hello")',
    );
    const leaf = { expected: "Hello", actual: "Helo" };
    expect(planTestPatch(source, failing("heading.text", leaf), [testRange])).toBeNull();
  });

  it("still patches a production literal when a test body also exists", () => {
    const { source, testRange } = withTest(
      ['tile Title = heading("Helo")'],
      "tile-test",
      "Title",
      "{slots: {}}",
      'heading("Hello")',
    );
    const leaf = { expected: "Hello", actual: "Helo" };
    const patch = planTestPatch(source, failing("heading.text", leaf), [testRange]);
    expect(patch?.apply(source)).toContain('tile Title = heading("Hello")');
  });
});

describe("iterStringLiterals: string-literal walker", () => {
  it("returns spans and raw bodies for a lone literal", () => {
    expect(iterStringLiterals('x = "hello"')).toMatchObject([{ start: 4, end: 11, body: "hello" }]);
  });

  it("iterates consecutive literals as two separate entries", () => {
    const lits = iterStringLiterals('"a""b"');
    expect(lits.map((l) => l.body)).toEqual(["a", "b"]);
    expect(lits[0]?.end).toBe(lits[1]?.start);
  });

  it('treats an escaped `\\"` inside a literal as part of its body', () => {
    expect(iterStringLiterals('x = "a\\"b" y').map((l) => l.body)).toEqual(['a\\"b']);
  });

  it('yields an entry with an empty body for a bare `""`', () => {
    expect(iterStringLiterals('x = ""')).toMatchObject([{ start: 4, end: 6, body: "" }]);
  });
});

/** Plan a patch for `source` whose test spans `testRange`, with the store of a file holding it. */
function planScoped(source: string, testRange: [number, number], diffAt: string, leaf: Leaf) {
  return planTestPatch(source, failing(diffAt, leaf), [testRange], storeOf(source));
}

const reducerTest = (reducer: string, defs: string[], given: string, expected: string) =>
  withTest(defs, "reducer-test", reducer, given, expected);

describe("planTestPatch: relaxed repair tiers", () => {
  it("scope-aware: picks the literal inside the target tile when two tiles share it", () => {
    const { source, testRange } = withTest(
      ['tile A = heading("Helo")', 'tile B = label("Helo")'],
      "tile-test",
      "A",
      "{slots: {}}",
      'heading("Hello")',
    );
    const patched = defined(
      planScoped(source, testRange, "heading.text", { expected: "Hello", actual: "Helo" }),
      "a patch",
    ).apply(source);
    expect(patched).toContain('tile A = heading("Hello")');
    expect(patched).toContain('tile B = label("Helo")');
  });

  it("scope-aware: null when both hits sit inside the target's own range", () => {
    const { source, testRange } = withTest(
      ['tile A = column(heading("Helo"), label("Helo"))'],
      "tile-test",
      "A",
      "{slots: {}}",
      'column(heading("Hello"), label("Helo"))',
    );
    expect(
      planScoped(source, testRange, "heading.text", { expected: "Hello", actual: "Helo" }),
    ).toBeNull();
  });

  it.each([
    {
      tier: "number leaf: swaps a unique numeric literal in the target reducer",
      reducer: "inc",
      defs: ["slot count : Int = 0", "reducer inc on=ui.click(B) do= count := count + 1"],
      tile: 'tile B = button(text="+")',
      given: "{slots: {count: 0}, event: {type: ui.click, target: B}}",
      expected: "{slots: {count: 2}}",
      diffAt: "slots.count",
      leaf: { expected: 2, actual: 1 },
      fixed: "count := count + 2",
    },
    {
      tier: "boolean leaf: swaps false → true",
      reducer: "flip",
      defs: ["slot flag : Bool = false", "reducer flip on=ui.click(B) do= flag := true"],
      tile: 'tile B = button(text="toggle")',
      given: "{slots: {flag: false}, event: {type: ui.click, target: B}}",
      expected: "{slots: {flag: false}}",
      diffAt: "slots.flag",
      leaf: { expected: false, actual: true },
      fixed: "flag := false",
    },
    {
      tier: "boolean leaf: swaps true → false",
      reducer: "flip",
      defs: ["slot flag : Bool = true", "reducer flip on=ui.click(B) do= flag := false"],
      tile: 'tile B = button(text="toggle")',
      given: "{slots: {flag: true}, event: {type: ui.click, target: B}}",
      expected: "{slots: {flag: true}}",
      diffAt: "slots.flag",
      leaf: { expected: true, actual: false },
      fixed: "flag := true",
    },
    {
      tier: "arithmetic: flips + to - when the sign of the delta is wrong",
      reducer: "dec",
      defs: ["slot count : Int = 0", "reducer dec on=ui.click(B) do= count := count + 1"],
      tile: 'tile B = button(text="-")',
      given: "{slots: {count: 5}, event: {type: ui.click, target: B}}",
      expected: "{slots: {count: 4}}",
      diffAt: "slots.count",
      leaf: { expected: 4, actual: 6 },
      fixed: "count := count - 1",
    },
  ])("$tier", ({ reducer, defs, tile, given, expected, diffAt, leaf, fixed }) => {
    const { source, testRange } = reducerTest(reducer, [...defs, tile], given, expected);
    expect(planScoped(source, testRange, diffAt, leaf)?.apply(source)).toContain(fixed);
  });

  it.each([
    {
      shape: "a numeric leaf that also appears inside a string literal",
      reducer: "dec on=ui.click(DecBtn) do= count := count - 1",
      tile: 'tile DecBtn = button(text="-1")',
      target: "DecBtn",
      given: "{count: 0}",
      expected: "{count: 1}",
      leaf: { expected: 1, actual: -1 },
      fixed: /count := count \+ 1/,
    },
    {
      shape: "a single-digit leaf inside a three-character string span",
      reducer: "inc on=ui.click(B) do= count := count + 1",
      tile: 'tile B = button(text="7")',
      target: "B",
      given: "{count: 6}",
      expected: "{count: 8}",
      leaf: { expected: 8, actual: 7 },
      fixed: /count := count \+ 2/,
    },
  ])("rewrites the reducer, not the string, for $shape", ({
    reducer,
    tile,
    target,
    given,
    expected,
    leaf,
    fixed,
  }) => {
    const name = reducer.split(" ")[0] as string;
    const { source, testRange } = reducerTest(
      name,
      [
        "slot count : Int = 0",
        `reducer ${reducer}`,
        tile,
        `tile App = column(heading("x"), ${target})`,
      ],
      `{slots: ${given}, event: {type: ui.click, target: ${target}}}`,
      `{slots: ${expected}}`,
    );
    const patched = defined(planScoped(source, testRange, "slots.count", leaf), "a patch").apply(
      source,
    );
    expect(patched).toContain(tile);
    expect(patched).toMatch(fixed);
  });

  it("prefix/suffix: swaps the divergent middle inside a shared string literal", () => {
    const { source, testRange } = withTest(
      ['tile Greet = heading("Hello, world")'],
      "tile-test",
      "Greet",
      "{slots: {}}",
      'heading("Hi, world")',
    );
    const leaf = { expected: "Hi, world", actual: "Hello, world" };
    expect(planScoped(source, testRange, "heading.text", leaf)?.apply(source)).toContain(
      'tile Greet = heading("Hi, world")',
    );
  });

  it("arithmetic: rewrites the multiplier when count := count * n needs a different n", () => {
    const { source, testRange } = reducerTest(
      "mul",
      [
        "slot count : Int = 0",
        "reducer mul on=ui.click(B) do= count := count * 5",
        'tile B = button(text="mul")',
      ],
      "{slots: {count: 2}, event: {type: ui.click, target: B}}",
      "{slots: {count: 6}}",
    );
    const patch = defined(
      planScoped(source, testRange, "slots.count", { expected: 6, actual: 10 }),
      "a patch",
    );
    const patched = patch.apply(source);
    expect(patched).toContain("count := count * 3");
    expect(patched).not.toContain("count := count * 5");
    expect(patch.description).toContain("count := count * 5");
    expect(patch.description).toContain("count := count * 3");
  });

  describe("partial-string: escape-normalized matching", () => {
    const greet = (body: string, expectedBody: string) =>
      withTest(
        [`tile Greet = heading("outer ${body} outer")`],
        "tile-test",
        "Greet",
        "{slots: {}}",
        `heading("outer ${expectedBody} outer")`,
      );

    it.each([
      ["a newline", "foo\\nbar", "foo bar", { expected: "foo bar", actual: "foo\nbar" }],
      ["a tab", "foo\\tbar", "foo bar", { expected: "foo bar", actual: "foo\tbar" }],
      ["a CR", "foo\\rbar", "foo bar", { expected: "foo bar", actual: "foo\rbar" }],
      ["a quote", 'say \\" now', "say ! now", { expected: "say ! now", actual: 'say " now' }],
      ["a backslash", "a\\\\b", "a/b", { expected: "a/b", actual: "a\\b" }],
    ])("rewrites when the divergent middle is %s the source spells as an escape", (_, body, fixed, leaf) => {
      const { source, testRange } = greet(body, fixed);
      expect(planScoped(source, testRange, "heading.text", leaf)?.apply(source)).toContain(
        `tile Greet = heading("outer ${fixed} outer")`,
      );
    });

    it("re-encodes the untouched escapes of the literal canonically", () => {
      const { source, testRange } = greet("head\\nfoo tail", "head\\nbar tail");
      const leaf = { expected: "head\nbar tail", actual: "head\nfoo tail" };
      const patched = defined(planScoped(source, testRange, "heading.text", leaf), "a patch").apply(
        source,
      );
      expect(patched).toContain('tile Greet = heading("outer head\\nbar tail outer")');
      expect(patched).not.toContain("head\\\\n");
    });

    it("spells a newline the expected text injects as `\\n`, never a bare line break", () => {
      const { source, testRange } = greet("XYZ", "AB\\nCD");
      const leaf = { expected: "AB\nCD", actual: "XYZ" };
      const patched = defined(planScoped(source, testRange, "heading.text", leaf), "a patch").apply(
        source,
      );
      expect(patched).toContain('tile Greet = heading("outer AB\\nCD outer")');
      expect(patched).not.toMatch(/"outer AB\nCD/);
    });
  });
});

describe("planTestPatchExplained: skip-reason classification", () => {
  const reasonOf = (...args: Parameters<typeof planTestPatchExplained>): string | undefined => {
    const result = planTestPatchExplained(...args);
    expect(result.patch).toBeNull();
    return result.patch === null ? result.reason : undefined;
  };

  it("test-passes-or-no-leaf: pass=true short-circuits before any tier", () => {
    expect(reasonOf("", { name: "t", pass: true })).toBe("test-passes-or-no-leaf");
  });

  it("leaf-equal-no-diff: leaf.actual === leaf.expected", () => {
    expect(
      reasonOf("", { name: "t", pass: false, leaf: { actual: "same", expected: "same" } }),
    ).toBe("leaf-equal-no-diff");
  });

  it.each([
    [
      "leaf-not-a-kumiki-literal",
      'tile T = heading("a")\n',
      "heading.text",
      { actual: Number.NaN, expected: 5 },
    ],
    [
      "no-scoped-literal-hit",
      'tile T = heading("hi")\n',
      "heading.visible",
      { actual: false, expected: true },
    ],
    [
      "affix-empty-middle",
      'tile T = heading("other")\n',
      "heading.text",
      { actual: "abc", expected: "abcd" },
    ],
    [
      "no-string-literal-contains-mida",
      'tile T = heading("hi")\n',
      "heading.text",
      { actual: "abc", expected: "axc" },
    ],
    [
      "patched-body-unspellable",
      'tile T = heading("prefix elx suffix")\n',
      "heading.text",
      { actual: "Helxo", expected: "H\byo" },
    ],
    [
      "patched-body-unspellable",
      'tile T = heading("pre \\nX suffix")\n',
      "heading.text",
      { actual: "pre \nX suffix", expected: "pre \nX\bsuffix" },
    ],
  ])("%s, without a store", (reason, source, diffAt, leaf) => {
    expect(reasonOf(source, failing(diffAt, leaf))).toBe(reason);
  });

  const COUNTER_REDUCER = (slot: string, reducer: string) => [
    `slot count : Int = ${slot}`,
    `reducer ${reducer}`,
    'tile B = button(text="b")',
    "",
  ];

  it.each([
    [
      "ambiguous-string-literal-match",
      "two equal literals and no test to scope by",
      ['tile A = heading("Helo, world")', 'tile B = label("Helo, world")', ""],
      "heading.text",
      { actual: "Helo, chum", expected: "Hi, chum" },
    ],
    [
      "ambiguous-string-literal-match",
      "two literals that decode to the same body",
      ['tile A = heading("a\\nb suffix")', 'tile B = label("a\\nb suffix")', ""],
      "heading.text",
      { actual: "a\nb suffix", expected: "a\nb replaced" },
    ],
    [
      "ambiguous-reducer-set",
      "two reducers writing the same slot",
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        "reducer dec on=ui.click(C) do= count := count - 1",
        'tile B = button(text="+")',
        'tile C = button(text="-")',
        "",
      ],
      "slots.count",
      { actual: 99, expected: 100 },
    ],
    [
      "no-additive-multiplicative-shape",
      "a reducer that is not `slot := slot ± N`",
      COUNTER_REDUCER("0", "set on=ui.click(B) do= count := count"),
      "slots.count",
      { actual: 99, expected: 7 },
    ],
    [
      "additive-zero-delta",
      "an expected value equal to the base",
      COUNTER_REDUCER("0", "inc on=ui.click(B) do= count := count + 1"),
      "slots.count",
      { actual: 6, expected: 5 },
    ],
    [
      "multiplicative-zero-guard",
      "an actual value of zero",
      COUNTER_REDUCER("5", "mul on=ui.click(B) do= count := count * 3"),
      "slots.count",
      { actual: 0, expected: 7 },
    ],
    [
      "multiplicative-zero-guard",
      "a zero operand",
      COUNTER_REDUCER("9", "noop on=ui.click(B) do= count := count * 0"),
      "slots.count",
      { actual: 17, expected: 4 },
    ],
    [
      "multiplicative-nonintegral-base",
      "an actual value the operand does not divide",
      COUNTER_REDUCER("1", "dbl on=ui.click(B) do= count := count * 2"),
      "slots.count",
      { actual: 5, expected: 6 },
    ],
    [
      "multiplicative-nonintegral-solution",
      "an expected value the base does not divide (×2)",
      COUNTER_REDUCER("1", "dbl on=ui.click(B) do= count := count * 2"),
      "slots.count",
      { actual: 4, expected: 5 },
    ],
    [
      "multiplicative-nonintegral-solution",
      "an expected value the base does not divide (×3)",
      COUNTER_REDUCER("1", "tpl on=ui.click(B) do= count := count * 3"),
      "slots.count",
      { actual: 6, expected: 7 },
    ],
    [
      "non-safe-integer-operand",
      "an operand past Number.MAX_SAFE_INTEGER",
      COUNTER_REDUCER("0", "inc on=ui.click(B) do= count := count + 99999999999999999999"),
      "slots.count",
      { actual: 42, expected: 1 },
    ],
  ])("%s: %s", (reason, _, lines, diffAt, leaf) => {
    const source = lines.join("\n");
    expect(reasonOf(source, failing(diffAt, leaf), [], storeOf(source))).toBe(reason);
  });

  it.each([
    [
      "the target tile's own scope (rank 0 tie)",
      withTest(
        ['tile A = column(heading("Helo, world"), label("Helo, chum"))'],
        "tile-test",
        "A",
        "{slots: {}}",
        'column(heading("Hi, cats"), label("Helo, chum"))',
      ),
    ],
    [
      "the target's dependencies (rank 1 tie)",
      withTest(
        [
          'tile TileL = heading("Helo, world")',
          'tile TileR = label("Helo, chum")',
          "tile Root = column(TileL, TileR)",
        ],
        "tile-test",
        "Root",
        "{slots: {}}",
        'column(heading("Hi, cats"), label("Helo, chum"))',
      ),
    ],
  ])("ambiguous-string-literal-match: two literals inside %s", (_, { source, testRange }) => {
    const leaf = { actual: "Helo, cats", expected: "Hi, cats" };
    expect(reasonOf(source, failing("heading.text", leaf), [testRange], storeOf(source))).toBe(
      "ambiguous-string-literal-match",
    );
  });
});
