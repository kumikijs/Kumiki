import { readFileSync } from "node:fs";
import { applyFixPlan, gateComposed } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";
import { errorDiagnosticsOf } from "./helpers/diagnostics.ts";
import { seedLines } from "./helpers/files.ts";

const at = (e: { code: string; pos: { line: number; col: number } }): string =>
  `${e.code}@${e.pos.line}:${e.pos.col}`;

/** A reducer that reads `v` a line before the `if` branch that declares it (E0103 names where). */
const READ_BEFORE_IF = [
  'slot seen  : Text = ""',
  'slot other : Text = ""',
  "slot flag  : Bool = true",
  'tile B = button(text="x")',
  "tile App = column(B)",
  "reducer r on=ui.click(B)",
  "    do= seen := v",
  '        if flag then { let v = "a"  other := v }',
  "app A",
  "    caps   = []",
] as const;

describe("a diagnostic a repair merely moved is not an introduced one", () => {
  it("along its line — the repair is shorter than what it replaced", () => {
    const file = seedLines([
      'slot seen : Text = ""',
      "reducer clicked on=ui.click(B) do= seen := $route.path + qqqqqqqqqq",
      'tile B = button(text="go")',
      "tile App = column(B)",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(result.regressionBlocked).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain("seen := route.path + qqqqqqqqqq");
    // Still there, at the position it moved to — reported, not repaired.
    expect(result.remaining.map(at)).toEqual(["E0103@2:57"]);
  });

  it("down the file — the repair inserts lines above it", () => {
    const file = seedLines([
      'slot seen : Text = ""',
      'reducer clicked on=ui.click(B) do= seen := "x"',
      'tile B = button(text="go")',
      "tile App = column(B, text(nowhere))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(result.regressionBlocked).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain('"/404" -> NotFound');
    expect(result.remaining.map(at)).toEqual(["E0103@6:27"]);
  });

  it("down the file — an E0227 that says a nested match takes the arms after it", () => {
    const file = seedLines([
      "type Color = Red | Green | Blue",
      "type Size = Small | Large",
      "fn f(x: Color, y: Size) -> Int = match x with | Red -> match y with | Small -> 1 | other -> 3",
      'tile B = button(text="go")',
      "tile App = column(B)",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(result.regressionBlocked).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain('"/404" -> NotFound');
    expect(result.remaining.map(at)).toEqual(["E0227@5:34"]);
  });

  it("when two diagnostics share a code and only one is repairable", () => {
    const file = seedLines([
      "slot counter : Int = 0",
      "slot n : Int = 0",
      "reducer r on=ui.click(B) do= n := countr + qqqqqqqqqq",
      'tile B = button(text="go")',
      "tile App = column(B, text(n))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(readFileSync(file, "utf8")).toContain("n := counter + qqqqqqqqqq");
    expect(result.remaining.map((e) => e.code)).toEqual(["E0103"]);
    expect(result.remaining[0]?.message).toContain("qqqqqqqqqq");
  });

  it.each([
    {
      move: "down the file",
      lines: [...READ_BEFORE_IF, '    routes = {"/" -> App}', "    init   = []"],
      repaired: '"/404" -> NotFound',
      remaining: ["E0103@9:17"],
      declared: "declared later, at 10:28,",
    },
    {
      move: "along its line",
      lines: [
        'slot seen  : Text = ""',
        'slot other : Text = ""',
        "slot flag  : Bool = true",
        'tile B = button(text="x")',
        "tile App = column(B)",
        'reducer r on=ui.click(B) do= seen := $route.path + v  if flag then { let v = "a"  other := v }',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
      ],
      repaired: "seen := route.path + v",
      remaining: ["E0103@6:51"],
      declared: "declared later, at 6:73,",
    },
  ])("$move — an E0103 whose message names where the name is declared", (row) => {
    const file = seedLines(row.lines);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(result.regressionBlocked).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain(row.repaired);
    expect(result.remaining.map(at)).toEqual(row.remaining);
    // The message names the declaration where the repair moved it.
    expect(result.remaining[0]?.message).toContain(row.declared);
  });
});

describe("a position a message names does not hide a diagnostic the repair introduced", () => {
  const before = [...READ_BEFORE_IF, '    routes = {"/" -> App}', "    init   = []"];
  const repaired = [
    ...READ_BEFORE_IF,
    '    routes = {"/" -> App, "/404" -> App}',
    "    init   = []",
  ];

  it.each([
    {
      name: "a second one, the same but for the position it names",
      after: [
        ...repaired,
        "reducer r2 on=ui.click(B)",
        "    do= seen := v",
        '        if flag then { let v = "b"  other := v }',
      ],
      introduced: ["E0103@14:17"],
    },
    {
      name: "one whose words changed along with its position",
      after: repaired.map((line) => line.replace("if flag then {", "for item in [1] {")),
      introduced: ["E0103@7:17"],
    },
  ])("$name", ({ after, introduced }) => {
    const errors = errorDiagnosticsOf(`${before.join("\n")}\n`);
    expect(errors.map(at)).toEqual(["E0103@7:17", "E0001@9:1"]);

    const verdict = gateComposed(errors, `${after.join("\n")}\n`);

    expect(verdict.blocked?.reason).toBe("introduced");
    if (verdict.blocked?.reason === "introduced") {
      expect(verdict.blocked.introduced.map(at)).toEqual(introduced);
    }
  });
});

describe("a repair that leaves the file no cleaner still rolls back", () => {
  it("when it rewords a diagnostic while another repair resolves one", () => {
    const file = seedLines([
      'slot seen : Text = ""',
      'tile Button = button(text="go")',
      "reducer Bttn on=ui.click(Bttn) do= seen := $route.path",
      "tile App = column(Button, text(seen))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);
    const before = readFileSync(file, "utf8");

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(0);
    expect(result.blocked?.reason).toBe("introduced");
    if (result.blocked?.reason === "introduced") {
      expect(result.blocked.introduced.map((e) => e.code)).toEqual(["E0211"]);
      expect(result.blocked.introduced[0]?.message).toContain('Reducer "Button"');
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("when it swaps one diagnostic for another", () => {
    const file = seedLines([
      "effect logHello cap=lgo",
      "                in=Text",
      "                out=Unit",
      "",
      'reducer greet on=app.start do= emit logHello("hi")',
      'tile App = heading("hi")',
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);
    const before = readFileSync(file, "utf8");

    const result = applyFixPlan(file, "E0301");

    expect(result.applied).toBe(0);
    expect(result.regressionBlocked).toBe(true);
    expect(result.blocked?.reason).toBe("introduced");
    if (result.blocked?.reason === "introduced") {
      expect(result.blocked.introduced.map((e) => e.code)).toEqual(["E0302"]);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("when the repair creates a type error where a name error was", () => {
    const file = seedLines([
      "slot n  : Int  = 0",
      'slot cn : Text = ""',
      "reducer bump on=ui.click(Btn) do= n := cnt + 1",
      'tile Btn  = button(text="go")',
      "tile Page = column(Btn, text(n))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> Page, "/404" -> Page}',
      "    init   = []",
    ]);
    const before = readFileSync(file, "utf8");

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(0);
    expect(result.blocked?.reason).toBe("introduced");
    if (result.blocked?.reason === "introduced") {
      expect(result.blocked.introduced.map((e) => e.code)).toEqual(["E0201"]);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
