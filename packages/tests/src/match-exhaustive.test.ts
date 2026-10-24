import { type AppShape, runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { click, freshRoot, tick, withMounted } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { placeOf, withApp } from "./helpers/source.ts";

// E0227 itself is pinned in packages/compiler/test/match-exhaustive.test.ts; this file runs the
// programs it lets through.

async function scenarioOf(src: string, steps: Scenario["steps"]): Promise<void> {
  const report = await runScenario(await loadSource(src), freshRoot(), { steps });
  expect(report.ok, failureDetail(report)).toBe(true);
}

const covered = (arms: string, tileArms: string) =>
  withApp(`type Color = Red | Green | Blue
slot c : Color = Blue
slot n : Int   = 0
reducer go on=ui.click(Go) do= n := match c with ${arms}
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text("n: " + n.show), text("name: " + (match c with ${tileArms})))`);

describe("a value match that covers its scrutinee", () => {
  it.each([
    [
      "the missing arm",
      `| Red -> 1 | Green -> 2 | Blue -> 3`,
      `| Red -> "r" | Green -> "g" | Blue -> "b"`,
      3,
      "name: b",
    ],
    ["a `_` arm", `| Red -> 1 | _ -> 9`, `| Red -> "r" | _ -> "other"`, 9, "name: other"],
  ])("evaluates the arm its value matches with %s", (_, arms, tileArms, n, shown) =>
    scenarioOf(covered(arms, tileArms), [
      { do: { click: "#go" }, expect: { noErrors: true, state: { n }, domIncludes: [shown] } },
    ]));
});

describe("a statement match and a tile match, which are not values", () => {
  it("run no arm and render an empty text when no arm matches", () =>
    scenarioOf(
      withApp(`type Color = Red | Green | Blue
slot c : Color = Blue
slot n : Int = 0
reducer q on=ui.click(B) do= match c with | Red -> n := 1 | Green -> n := 2
tile B = button(text="go") {id: "go"}
tile Body = match c with | Red -> text("r") | Green -> text("g")
tile App = column(B, text("n: " + n.show), Body)`),
      [
        {
          do: { click: "#go" },
          expect: { noErrors: true, state: { n: 0 }, domIncludes: ["n: 0"] },
        },
      ],
    ));
});

// `$el` has no type the checker reads, so coverage of `$el.choice` is decided at run time.
const UNDECIDED = withApp(`type Color = Red | Green | Blue
slot n      : Int  = 0
slot tries  : Int  = 0
slot failed : Text = "-"
reducer pick on=ui.click(Pick)
    do= tries := tries + 1
        n := match $el.choice with | Red -> 1 | Green -> 2
reducer on-panic on=app.error
    do= failed := $event.message
tile Pick in=Color = button(text="pick") {id: $1.show, choice: $1}
tile App = column(Pick(Red), Pick(Blue), text("n: " + n.show), text("failed: " + failed))`);

describe("a value match in a reducer whose coverage is undecidable", () => {
  it("evaluates the arm a value matches", () =>
    scenarioOf(UNDECIDED, [
      { do: { click: "#Red" }, expect: { noErrors: true, state: { n: 1, tries: 1 } } },
    ]));

  it("panics on a value no arm matches: the reducer's writes roll back and app.error runs", () =>
    scenarioOf(UNDECIDED, [
      {
        do: { click: "#Blue" },
        expect: {
          state: {
            n: 0,
            tries: 0,
            failed: `No arm of the match at ${placeOf(UNDECIDED, "match $el")} matches its value`,
          },
          errorIncludes: ['panic in reducer "pick"'],
        },
      },
    ]));
});

/** A page whose `last` is a value match over the result of a `fold`, which the checker cannot type. */
const rendering = (shown: string, boundary: boolean) =>
  withApp(`type Color = Red | Green | Blue
slot cs     : List(Color) = [Red]
slot failed : Text        = "-"
reducer add on=ui.click(Add) do= cs := cs.push(Blue)
reducer on-panic on=app.error do= failed := $event.message
fn name(xs: List(Color)) -> Text = match xs.fold(Red, $2) with | Red -> "r" | Green -> "g"
tile Add = button(text="add")
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Last${boundary ? " error-boundary=Fallback" : ""} = column(text("last: " + ${shown}))
tile App = column(Add, text("failed: " + failed), Last)`);

const SHOWN = [
  ["a tile expression", `(match cs.fold(Red, $2) with | Red -> "r" | Green -> "g")`, "match cs"],
  ["a fn called from a tile", "name(cs)", "match xs"],
] as const;

type Live = AppShape & { live?: Record<string, unknown> };

describe("a value match in a render whose coverage is undecidable", () => {
  it.each(
    SHOWN,
  )("in %s, shows the panic in place of the page, and app.error does not run", async (_, shown, at) => {
    const src = rendering(shown, false);
    const app = (await loadSource(src)) as Live;
    await withMounted(app, async (root) => {
      expect(root.textContent).toContain("last: r");
      click(root, "add");
      await tick(0);
      expect(root.textContent).toBe(
        `Something went wrong: No arm of the match at ${placeOf(src, at)} matches its value`,
      );
      expect(app.live?.failed).toBe("-");
      expect(app.live?.cs).toHaveLength(2);
    });
  });

  it.each(
    SHOWN,
  )("in %s, is caught by the nearest error-boundary, and the rest of the page stays", async (_, shown, at) => {
    const src = rendering(shown, true);
    const app = (await loadSource(src)) as Live;
    await withMounted(app, async (root) => {
      click(root, "add");
      await tick(0);
      expect(root.textContent).toContain(
        `caught: No arm of the match at ${placeOf(src, at)} matches its value`,
      );
      expect(root.querySelector("button")?.textContent).toBe("add");
      expect(app.live?.failed).toBe("-");
    });
  });
});
