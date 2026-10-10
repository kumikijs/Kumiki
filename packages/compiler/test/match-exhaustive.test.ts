import { codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, summariesOf } from "./helpers/diagnostics.ts";
import { withButtonApp, withReducer } from "./helpers/programs.ts";

const DEFS = `type Color = Red | Green | Blue
type Dim = { w: Int }
type Shape = Circle(Dim) | Square(Dim)
type Outer = Wrap(Color) | Bare
type Load(T) = Idle | Loaded(T)
type Ticket = { title: Text, status: Color }
slot c  : Color             = Blue
slot o  : Option(Int)       = None
slot r  : Result(Int, Text) = Err("e")
slot b  : Bool              = true
slot k  : Int               = 4
slot t  : Text              = "x"
slot s  : Shape             = Square({w: 3})
slot w  : Outer             = Bare
slot l  : Load(Int)         = Idle
slot tk : Ticket            = {title: "a", status: Blue}
slot cs : List(Color)       = [Red, Blue]
slot n  : Int               = 0
slot ns : List(Int)         = []
slot nm : Text              = ""`;

const diagnostics = (defs: string) => summariesOf(withButtonApp(`${DEFS}\n${defs}`));
const inReducer = (body: string) => summariesOf(withReducer(DEFS, body));

const missing = (type: string, witnesses: string) =>
  `E0227 This match on "${type}" has no arm for ${witnesses}, and a match used as a value has to evaluate to one of its arms. Add the missing arms, or end with \`_ -> …\``;

describe("a value match whose arms leave a value out", () => {
  it("names the variant of a union it has no arm for, in a reducer and in a tile", () => {
    const reducer = `reducer r on=ui.click(B) do= n := match c with | Red -> 1 | Green -> 2`;
    const tile = `tile Name = text("name: " + (match c with | Red -> "r" | Green -> "g"))`;
    const src = withButtonApp(`${DEFS}\n${reducer}\n${tile}`);
    const lines = src.split("\n");
    const message = missing("Color", "Blue").slice("E0227 ".length);
    expect(checkSource(src).map((e) => [e.code, e.message, e.pos.line, e.pos.col])).toEqual([
      ["E0227", message, lines.indexOf(reducer) + 1, reducer.indexOf("match") + 1],
      ["E0227", message, lines.indexOf(tile) + 1, tile.indexOf("match") + 1],
    ]);
  });

  it.each([
    [
      "an Option with no None arm",
      `n := match o with | Some(v) -> v`,
      missing("Option(Int)", "None"),
    ],
    [
      "an Option with no Some arm",
      `n := match o with | None -> 0`,
      missing("Option(Int)", "Some(_)"),
    ],
    [
      "a Result with no Err arm",
      `n := match r with | Ok(v) -> v`,
      missing("Result(Int, Text)", "Err(_)"),
    ],
    [
      "a union of record payloads",
      `n := match s with | Circle(d) -> d.w`,
      missing("Shape", "Square(_)"),
    ],
    [
      "a union whose payload is a union",
      `n := match w with | Wrap(x) -> 1`,
      missing("Outer", "Bare"),
    ],
    ["a generic union", `n := match l with | Loaded(v) -> v`, missing("Load(Int)", "Idle")],
    [
      "a record field of union type",
      `n := match tk.status with | Red -> 1`,
      missing("Color", "Green, Blue"),
    ],
    [
      "two variants at once, in declaration order",
      `n := match c with | Green -> 1`,
      missing("Color", "Red, Blue"),
    ],
  ])("names what it leaves out of %s", (_, body, message) => {
    expect(inReducer(body)).toEqual([message]);
  });

  it("names the combinations a tuple's arms leave out", () => {
    expect(
      inReducer(
        `n := match (o, c) with | (Some(v), Red) -> v | (None, Red) -> 1 | (_, Green) -> 2`,
      ),
    ).toEqual([missing("Tuple(Option(Int), Color)", "(Some(_), Blue), (None, Blue)")]);
    expect(inReducer(`n := match (o, c) with | (Some(v), _) -> v`)).toEqual([
      missing("Tuple(Option(Int), Color)", "(None, _)"),
    ]);
  });

  it("reaches into a tuple nested in a tuple", () => {
    expect(
      inReducer(`n := match ((o, c), b) with | ((None, Blue), _) -> 2 | ((Some(v), _), _) -> v`),
    ).toEqual([
      missing("Tuple(Tuple(Option(Int), Color), Bool)", "((None, Red), _), ((None, Green), _)"),
    ]);
  });

  it.each([
    ["a fn body", `fn code(x: Color) -> Int = match x with | Red -> 1 | Green -> 2`],
    ["a let", `reducer r on=ui.click(B) do= let m = match c with | Red -> 1 | Green -> 2; n := m`],
    [
      "an expression fragment",
      `reducer r on=ui.click(B) do= ns := cs.map(match $1 with | Red -> 1 | Green -> 2)`,
    ],
    [
      "a match nested in an arm",
      `reducer r on=ui.click(B) do= n := match o with | Some(v) -> (match c with | Red -> v | Green -> v) | None -> 0`,
    ],
  ])("is reported in %s", (_, def) => {
    expect(diagnostics(def)).toEqual([missing("Color", "Blue")]);
  });
});

describe("a value match that covers its scrutinee's type", () => {
  it.each([
    ["every variant", `n := match c with | Red -> 1 | Green -> 2 | Blue -> 3`],
    ["a `_` after some variants", `n := match c with | Red -> 1 | _ -> 9`],
    ["a name pattern", `n := match c with | other -> 8`],
    ["an Option with both arms", `n := match o with | Some(v) -> v | None -> 0`],
    ["a Result with both arms", `n := match r with | Ok(v) -> v | Err(e) -> 0`],
    ["record payloads, binds unread", `n := match s with | Circle(_) -> 1 | Square(d) -> d.w`],
    ["a union payload bound whole", `n := match w with | Wrap(x) -> 1 | Bare -> 2`],
    [
      "a tuple's every combination",
      `n := match (o, c) with | (Some(v), _) -> v | (None, Red) -> 1 | (None, _) -> 0`,
    ],
    ["a tuple by `_`", `n := match (o, c) with | (Some(v), Red) -> v | _ -> 4`],
    ["a tuple bound whole", `n := match (o, k) with | pair -> 1`],
    [
      "a nested tuple",
      `n := match ((o, c), b) with | ((None, Blue), _) -> 2 | ((Some(v), _), _) -> v | ((None, _), _) -> 0`,
    ],
    ["a Bool by `_`", `n := match b with | _ -> 1`],
    ["an Int by a name pattern", `n := match k with | x -> x + 1`],
    ["a Text by `_`", `nm := match t with | _ -> "y"`],
    [
      "an Int in a tuple by a name pattern",
      `n := match (k, c) with | (x, Blue) -> x | (x, _) -> 0`,
    ],
    ["an expression fragment", `ns := cs.map(match $1 with | Red -> 1 | Green -> 2 | Blue -> 3)`],
  ])("checks clean with %s", (_, body) => {
    expect(inReducer(body)).toEqual([]);
  });
});

describe("the forms the rule leaves to another diagnostic or another construct", () => {
  it("reports a variant arm on a type with no variants as E0208 alone", () => {
    expect(
      inReducer(`n := match b with | True -> 1 | False -> 0`).map((d) => d.slice(0, 5)),
    ).toEqual(["E0208", "E0208"]);
    expect(inReducer(`n := match k with | Zero -> 1`).map((d) => d.slice(0, 5))).toEqual(["E0208"]);
  });

  it("reports a misspelt variant as E0209 alone", () => {
    expect(
      inReducer(`n := match c with | Red -> 1 | Grene -> 2`).map((d) => d.slice(0, 5)),
    ).toEqual(["E0209"]);
  });

  it("does not reach a statement match, which runs no arm when none matches", () => {
    expect(inReducer(`match c with | Red -> n := 1 | Green -> n := 2`)).toEqual([]);
  });

  it("does not reach a tile match", () => {
    expect(
      diagnostics(`tile T = column(match c with | Red -> text("r") | Green -> text("g"))`),
    ).toEqual([]);
  });

  it.each([
    ["a scrutinee", `n := match cs.fold(c, $2) with | Red -> 1 | Green -> 2`],
    ["a tuple item", `n := match (cs.fold(c, $2), o) with | (Red, _) -> 1 | (Green, Some(v)) -> v`],
    ["the props of the tile that fired", `n := match $el.choice with | Red -> 1`],
  ])("leaves %s whose type is undecidable to the run", (_, body) => {
    expect(inReducer(body)).toEqual([]);
  });

  it("still reads the other columns of a tuple with an undecidable item", () => {
    expect(
      inReducer(
        `n := match (cs.fold(c, $2), o) with | (Red, _) -> 1 | (_, Some(v)) -> v | (_, None) -> 0`,
      ),
    ).toEqual([]);
    expect(
      inReducer(`n := match (cs.fold(c, $2), c) with | (_, Red) -> 1 | (_, Green) -> 2`),
    ).toEqual([missing("Tuple(?, Color)", "(_, Blue)")]);
  });
});

describe("a value match that no arm matches at run time", () => {
  it("lowers its fall-through to a panic naming where the match is, never to undefined", () => {
    const line = `reducer r on=ui.click(B) do= n := match c with | Red -> 1 | Green -> 2`;
    const src = withButtonApp(`${DEFS}\n${line}`);
    const { js } = codegen(parse(lex(src)), { runtimeSpecifier: "./runtime.js" });
    const at = `${src.split("\n").indexOf(line) + 1}:${line.indexOf("match") + 1}`;
    expect(js).not.toContain("return undefined");
    expect(js).toContain(`_s.panic("No arm of the match at ${at} matches its value")`);
  });
});
