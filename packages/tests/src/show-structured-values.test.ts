import { runScenario, type ScenarioStep } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

/** The page text after `steps`, every step clean and none of it the text `String` gives an object. */
async function pageText(src: string, steps: ScenarioStep[] = []): Promise<string> {
  const report = await withRoot(async (root) =>
    runScenario(await loadSource(withApp(src)), root, {
      steps: [...steps, { expect: { noErrors: true, domExcludes: ["[object Object]"] } }],
    }),
  );
  const text = report.steps.at(-1)?.domText ?? "";
  expect(text).not.toContain("[object Object]");
  expect(
    report.steps.flatMap((s) => s.failures),
    failureDetail(report),
  ).toEqual([]);
  return text;
}

describe("a structured value shows as its literal", () => {
  it("renders a record and a Map alike through `+`, `.show` and `fmt`", async () => {
    const text = await pageText(`slot p : {name: Text} = {name: "ada"}
slot m : Map(Text, Int) = {"a": 1}
tile App = column(text("p: " + p), text("show: " + p.show), text("fmt: " + fmt("{0}", p)), text("m: " + m))`);
    for (const line of [
      'p: {name: "ada"}',
      'show: {name: "ada"}',
      'fmt: {name: "ada"}',
      'm: {"a": 1}',
    ]) {
      expect(text).toContain(line);
    }
  });

  it("renders the PanicInfo an error-boundary fallback concatenates", async () => {
    const text = await pageText(
      `slot secret : Option(Text) = None
slot reveal : Bool = false
tile Fb in=PanicInfo = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = when(reveal, text(secret.get))
tile Reveal = button(text="reveal") {id: "reveal"}
reducer doReveal on=ui.click(Reveal) do= reveal := true
tile App = column(Risky, Reveal)`,
      [{ do: { click: "#reveal" } }],
    );
    expect(text).toContain(
      'recovered: {message: "get called on None", location: "Risky", episode-id: None, cause: None, category: "tile-render"}',
    );
  });

  it("writes each shape by its declared type, on every path that shows a value", async () => {
    const text = await pageText(`type Pt      = {x: Int, y: Int}
type Color   = Red | Green
type Tags    = Set(Text)
type Box(T)  = {v: T}
type Tree    = {label: Text, kids: List(Tree), marks: Set(Int)}
fn letters() -> Map(Text, Int) = {"z": 26}
slot s     : Set(Int)               = [2, 1]
slot t     : Tuple(Int, Text)       = (1, "a")
slot names : List(Text)             = ["a", "b"]
slot pm    : Map(Pt, Text)          = {{x: 0, y: 0}: "o"}
slot im    : Map(Int, Bool)         = {3: true}
slot cm    : Map(Color, Int)        = {}.insert(Red, 1)
slot es    : Set(Int)               = {}
slot em    : Map(Text, Int)         = {}
slot boxed : Box(Tags)              = {v: ["x"]}
slot tree  : Tree                   = {label: "root", kids: [{label: "leaf", kids: [], marks: [1]}], marks: []}
slot rows  : List({name: Text, tags: Tags}) = [{name: "a", tags: ["t"]}]
slot sets  : List(Set(Int))         = [[1], [2, 3]]
slot om    : Option(Map(Text, Int)) = Some({"a": 1})
tile App = column(
    text("s: " + s),
    text(im + " :im"),
    text("t: " + t.show),
    text("pm: " + pm.show()),
    text("tags: " + Tags.show(boxed.v)),
    text(fmt("cm: {0}", cm)),
    text(names),
    text("empty: " + es + " " + em),
    text("boxed: " + boxed),
    text("tree: " + tree),
    text("rows: " + rows),
    text("fn: " + letters()),
    text("om: " + om),
    button(text=t),
    column(for x in sets text("each: " + x)))`);
    for (const line of [
      "s: [1, 2]",
      "{3: true} :im",
      't: (1, "a")',
      'pm: {{x: 0, y: 0}: "o"}',
      'tags: ["x"]',
      "cm: {Red: 1}",
      '["a", "b"]',
      "empty: [] {}",
      'boxed: {v: ["x"]}',
      'tree: {label: "root", kids: [{label: "leaf", kids: [], marks: [1]}], marks: []}',
      'rows: [{name: "a", tags: ["t"]}]',
      'fn: {"z": 26}',
      "om: Some",
      '(1, "a")',
      "each: [1]",
      "each: [2, 3]",
    ]) {
      expect(text).toContain(line);
    }
  });

  it("writes the route slot's Maps as Maps", async () => {
    const text = await pageText(`tile App = column(text("route: " + route))`);
    expect(text).toContain('route: {path: "/", pattern: "/", params: {}, query: {}, hash: None}');
  });
});
