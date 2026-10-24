import { describe, expect, it } from "vitest";
import { errorsOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const program = (decls: string, body: string): string =>
  withApp(`${decls}

reducer go on=ui.click(Go)
    do= ${body.split("\n").join("\n        ")}

tile Go = button(text="go") {id: "go"}
tile App = column(Go)`);

const errors = (source: string): string[] => errorsOf(source).map((e) => `${e.code} ${e.message}`);

describe("a tag a variant of the program's own could hold is decided where it lands", () => {
  it.each([
    [
      "a nullary Ok through a let",
      "type Health = Ok | Degraded | Down\nslot health : Health = Down",
      "let next = Ok\nhealth := next",
    ],
    [
      "None through a let",
      'type Filter = None | Tag(Text)\nslot f : Filter = Tag("x")',
      "let next = None\nf := next",
    ],
    [
      "Err with a payload through a let",
      "type Step = Ok | Err(Text)\nslot s : Step = Ok",
      'let e = Err("bad")\ns := e',
    ],
    [
      "Ok inside a list literal",
      "type Outcome = Ok(Int) | Fail\nslot b : List(Outcome) = []",
      "let x = [Ok(1)]\nb := x",
    ],
    [
      "Some with a payload of a generic union",
      "type Box(T) = Some(T) | Empty\nslot b : Box(Int) = Empty",
      "let x = Some(1)\nb := x",
    ],
    [
      "Some of a generic union whose parameter shadows a type",
      "type T = Int\ntype Box(T) = Some(T) | Empty\nslot b : Box(Text) = Empty",
      'let x = Some("x")\nb := x',
    ],
    [
      "Ok inside a record literal",
      "type Health = Ok | Down\nslot r : {h: Health} = {h = Down}",
      "let x = {h = Ok}\nr := x",
    ],
    [
      "two unions that both declare None",
      'type Filter = None | Tag(Text)\ntype Pick = None | One(Int)\nslot f : Filter = Tag("x")\nslot p : Pick = One(1)',
      "let a = None\nf := a\nlet b = None\np := b",
    ],
    [
      "a union written in the slot's own type",
      "slot health : Ok | Degraded | Down = Down",
      "let next = Ok\nhealth := next",
    ],
    [
      "a union written in a fn's parameter type",
      'fn label(h: Ok | Down) -> Text = match h with | Ok -> "up" | Down -> "down"\nslot t : Text = ""',
      "let next = Ok\nt := label(next)",
    ],
  ])("%s checks", (_label, decls, body) => {
    expect(errors(program(decls, body))).toEqual([]);
  });

  it("matches a let-bound Ok against the union's own arms", () => {
    const source = program(
      'type Health = Ok | Degraded | Down\nslot label : Text = ""',
      'let next = Ok\nlabel := match next with | Ok -> "fine" | Degraded -> "slow" | Down -> "down"',
    );
    expect(errors(source)).toEqual([]);
  });
});

describe("the built-in tag beside a variant of the same name", () => {
  it("still writes a Result and an Option through a let", () => {
    const source = program(
      `type Outcome = Ok(Int) | Fail
type Filter = None | Tag(Text)
slot o : Outcome = Fail
slot f : Filter = Tag("x")
slot res : Result(Int, Text) = Err("e")
slot opt : Option(Int) = Some(1)`,
      "let a = Ok(1)\nres := a\nlet b = Ok(2)\no := b\nlet c = None\nopt := c\nlet d = None\nf := d",
    );
    expect(errors(source)).toEqual([]);
  });
});

describe("a value no variant of the program's own could hold is an Option or a Result", () => {
  it.each([
    ["type Health = Good | Down", "let o = Some(1)", "Option(Int)"],
    ["type Health = Good | Down", "let o = None", "Option(?)"],
    ["type Health = Good | Down", "let o = Ok(1)", "Result(Int, ?)"],
    ["type Health = Good | Down", 'let o = Err("x")', "Result(?, Text)"],
    ["type Health = Ok | Down", "let o = Ok(1)", "Result(Int, ?)"],
    ["type Pick = Some(Int) | Nothing", 'let o = Some("x")', "Option(Text)"],
  ])("%s: %s is %s, and an Int slot refuses it", (decls, binding, inferred) => {
    const source = program(`${decls}\nslot n : Int = 0`, `${binding}\nn := o`);
    expect(errors(source)).toEqual([`E0201 Expected Int but got ${inferred}`]);
  });
});
