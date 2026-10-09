// `show` writes a record, a List, a Tuple, a Map and a Set the way a program
// writes them as literals (stdlib.md §2.2.7), and it is the one text form every
// way of putting a value into text renders: `+` with a `Text`, `.show` and
// `.show()`, `TypeName.show(v)`, `fmt`, and a tile's content. A Map, a Set and
// a Tuple are a plain object, an object of keys and an array at run time, so
// what tells them apart is the type the checker hands `show` along with the
// value — through an alias, a generic, a type that contains itself, a `fn`'s
// declared result and a loop variable alike.
//
// Each case compiles a program and reads what its page shows.

import { runScenario, type ScenarioStep } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const app = (body: string): string => `${body}
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

/**
 * The page text after `steps` (a first paint when there are none), every step
 * clean — and none of it the text `String` gives every object.
 */
async function pageText(src: string, steps: ScenarioStep[] = []): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const report = await runScenario(await loadSource(app(src)), root, {
    steps: [...steps, { expect: { noErrors: true, domExcludes: ["[object Object]"] } }],
  });
  root.remove();
  // The text first, so a failure prints what the page showed.
  const text = report.steps.at(-1)?.domText ?? "";
  expect(text).not.toContain("[object Object]");
  expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  return text;
}

describe("a structured value shows as its literal", () => {
  it("renders the record and the Map of the issue's program on every path", async () => {
    const text = await pageText(`slot p : {name: Text} = {name: "ada"}
slot m : Map(Text, Int) = {"a": 1}
tile App = column(text("p: " + p), text("show: " + p.show), text("fmt: " + fmt("{0}", p)), text("m: " + m))`);
    expect(text).toContain('p: {name: "ada"}');
    expect(text).toContain('show: {name: "ada"}');
    expect(text).toContain('fmt: {name: "ada"}');
    expect(text).toContain('m: {"a": 1}');
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
