import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "122-value-equality.kumiki");

const DEFS = `type Pt   = {x: Int, y: Int}
type Role = Admin | Editor | Viewer
slot empty : List(Int)  = []
slot p     : Pt         = {x: 1, y: 2}
slot m     : Map(Text, Int) = {"a": 1, "b": 2}
slot roles : List(Role) = [Admin, Editor]
slot picks : List(Role) = [Admin, Admin, Viewer]
slot pts   : List(Pt)   = [{x: 1, y: 2}, {x: 1, y: 2}, {x: 3, y: 4}]
slot opts  : List(Option(Int)) = [Some(1), Some(1), None]`;

/** Render each `label: expr` as `label: <shown>` and return the page text. */
async function render(rows: Record<string, string>): Promise<string> {
  const texts = Object.entries(rows).map(([label, expr]) => `text("${label}: " + (${expr}).show)`);
  const src = `${DEFS}
tile App = column(${texts.join(", ")})
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  const root = document.createElement("div");
  document.body.appendChild(root);
  const report = await runScenario(await loadSource(src), root, { steps: [{ expect: {} }] });
  return report.steps[0]?.domText ?? "";
}

describe("== compares by value", () => {
  it.each([
    ["a List", { eq: "empty == []", same: "[1, 2] == [1, 2]", other: "[1, 2] == [2, 1]" }],
    [
      "a record",
      { eq: "p == {x: 1, y: 2}", same: "{y: 2, x: 1} == p", other: "p == {x: 1, y: 3}" },
    ],
    [
      "a tuple",
      { eq: "(0, 0) == (0, 0)", same: "(1, (2, 3)) == (1, (2, 3))", other: "(0, 0) == (0, 1)" },
    ],
    [
      "a Map",
      { eq: 'm == {"a": 1, "b": 2}', same: 'm == {"b": 2, "a": 1}', other: 'm == {"a": 1}' },
    ],
    [
      "a variant with a compound payload",
      {
        eq: "Some(Some(1)) == Some(Some(1))",
        same: "Some(p) == Some({x: 1, y: 2})",
        other: "Some(Some(1)) == Some(None)",
      },
    ],
  ])("%s equals another holding equal values, and no other", async (_what, rows) => {
    const text = await render({
      ...rows,
      ne: rows.other.replace("==", "!="),
      not: rows.eq.replace("==", "!="),
    });
    expect(text).toContain("eq: true");
    expect(text).toContain("same: true");
    expect(text).toContain("other: false");
    expect(text).toContain("ne: true");
    expect(text).toContain("not: false");
  });
});

describe("List.contains and unique ask the question == asks", () => {
  it("contains finds a variant, a record and a Option built elsewhere, and nothing absent", async () => {
    const text = await render({
      admin: "roles.contains(Admin)",
      viewer: "roles.contains(Viewer)",
      point: "pts.contains({x: 3, y: 4})",
      option: "opts.contains(Some(1))",
      sub: '"kumiki".contains("mik")',
    });
    expect(text).toContain("admin: true");
    expect(text).toContain("viewer: false");
    expect(text).toContain("point: true");
    expect(text).toContain("option: true");
    expect(text).toContain("sub: true");
  });

  it("unique keeps the first of each value, in order, in both spellings", async () => {
    const text = await render({
      bare: "picks.unique == [Admin, Viewer]",
      call: "picks.unique() == [Admin, Viewer]",
      points: "pts.unique.length",
      options: "opts.unique == [Some(1), None]",
      nums: "[3, 1, 3, 2, 1].unique == [3, 1, 2]",
    });
    expect(text).toContain("bare: true");
    expect(text).toContain("call: true");
    expect(text).toContain("points: 2");
    expect(text).toContain("options: true");
    expect(text).toContain("nums: true");
  });
});

describe("a property test comparing a List slot with ==", () => {
  it("holds for a reducer that writes an equal List", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["add-appends-one:true"]);
  });
});
