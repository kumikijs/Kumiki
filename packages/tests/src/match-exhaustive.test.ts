import { check, lex, parse } from "@kumikijs/compiler";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => [e.code, e.pos.line, e.message.split(",")[0]]);

const nonExhaustive = (arms: string, tileArms: string) => `type Color = Red | Green | Blue
slot c : Color = Blue
slot n : Int   = 0
reducer go on=ui.click(Go) do= n := match c with ${arms}
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text("n: " + n.show), text("name: " + (match c with ${tileArms})))
app NonEx caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

describe("a value match whose arms leave a variant out", () => {
  it("is reported at check time in a reducer and in a tile, naming the variant", () => {
    expect(
      diagnostics(nonExhaustive(`| Red -> 1 | Green -> 2`, `| Red -> "r" | Green -> "g"`)),
    ).toEqual([
      ["E0227", 4, 'This match on "Color" has no arm for Blue'],
      ["E0227", 6, 'This match on "Color" has no arm for Blue'],
    ]);
  });

  it("is reported over an Option, naming None", () => {
    const src = `slot o : Option(Int) = None
slot n : Int = 0
reducer go on=ui.click(Go) do= n := match o with | Some(v) -> v
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text("n: " + n.show))
app NonExOpt caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([
      ["E0227", 3, 'This match on "Option(Int)" has no arm for None'],
    ]);
  });

  it.each([
    [
      "the missing arm",
      `| Red -> 1 | Green -> 2 | Blue -> 3`,
      `| Red -> "r" | Green -> "g" | Blue -> "b"`,
      3,
      "name: b",
    ],
    ["a `_` arm", `| Red -> 1 | _ -> 9`, `| Red -> "r" | _ -> "other"`, 9, "name: other"],
  ])("checks clean and runs with %s", async (_, arms, tileArms, n, shown) => {
    const src = nonExhaustive(arms, tileArms);
    expect(diagnostics(src)).toEqual([]);
    const report = await runScenario(await loadSource(src), freshRoot(), {
      steps: [
        { do: { click: "#go" }, expect: { noErrors: true, state: { n }, domIncludes: [shown] } },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });
});

// `$el` has no type the checker reads, so coverage of `$el.choice` is decided at run time.
const UNDECIDED = `type Color = Red | Green | Blue
slot n      : Int  = 0
slot tries  : Int  = 0
slot failed : Text = "-"
reducer pick on=ui.click(Pick)
    do= tries := tries + 1
        n := match $el.choice with | Red -> 1 | Green -> 2
reducer on-panic on=app.error
    do= failed := $event.message
tile Pick in=Color = button(text="pick") {id: $1.show, choice: $1}
tile App = column(Pick(Red), Pick(Blue), text("n: " + n.show), text("failed: " + failed))
app Undecided caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

describe("a value match whose coverage is undecidable", () => {
  it("evaluates the arm a value matches", async () => {
    const report = await runScenario(await loadSource(UNDECIDED), freshRoot(), {
      steps: [{ do: { click: "#Red" }, expect: { noErrors: true, state: { n: 1, tries: 1 } } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });

  it("panics on a value no arm matches: the reducer's writes roll back and app.error runs", async () => {
    const lines = UNDECIDED.split("\n");
    const line = lines.findIndex((l) => l.includes("match $el"));
    const at = `${line + 1}:${(lines[line] ?? "").indexOf("match") + 1}`;
    const report = await runScenario(await loadSource(UNDECIDED), freshRoot(), {
      steps: [
        {
          do: { click: "#Blue" },
          expect: {
            state: { n: 0, tries: 0, failed: `No arm of the match at ${at} matches its value` },
            errorIncludes: ['panic in reducer "pick"'],
          },
        },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });
});
