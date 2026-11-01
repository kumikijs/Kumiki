import { describe, expect, it } from "vitest";
import { errorsOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const program = (decls: string, body: string, caps = ""): string =>
  withApp(
    `${decls}

reducer go on=ui.click(Go)
    do= ${body.split("\n").join("\n        ")}

tile Go = button(text="go") {id: "go"}
tile App = column(Go)`,
    { caps },
  );

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

describe("the place a let-bound tag lands checks it", () => {
  it.each([
    [
      "a nullary Ok into an Int",
      "type Health = Ok | Down\nslot n : Int = 0",
      "let x = Ok\nn := x",
      ["E0201 Expected Int but got Result(?, ?)"],
    ],
    [
      "an Ok with a payload into a union whose Ok carries none",
      "type Health = Ok | Down\nslot health : Health = Down",
      "let r = Ok(1)\nhealth := r",
      ["E0201 Expected Health but got Result(Int, ?)"],
    ],
    [
      "a Some whose payload the applied union refuses",
      "type Box(T) = Some(T) | Empty\nslot b : Box(Int) = Empty",
      'let x = Some("x")\nb := x',
      ["E0201 Expected Box(Int) but got Option(Text)"],
    ],
    [
      "a list that also holds an Err the union does not declare",
      "type Outcome = Ok(Int) | Fail\nslot b : List(Outcome) = []",
      'let x = [Ok(1), Err("x")]\nb := x',
      ["E0201 Expected List(Outcome) but got List(Result(Int, ?))"],
    ],
    [
      "an if whose other branch is an Err the union does not declare",
      "type Outcome = Ok(Int) | Fail\nslot o : Outcome = Fail\nslot flag : Bool = true",
      'let r = if flag then Ok(1) else Err("bad")\no := r',
      ["E0201 Expected Outcome but got Result(Int, ?)"],
    ],
  ])("%s is E0201", (_label, decls, body, expected) => {
    expect(errors(program(decls, body))).toEqual(expected);
  });

  it.each([
    ["type Health = Ok | Degraded | Down", '| Degraded -> "slow"', '"Health" has no arm for Down'],
    [
      "type Health(T) = Ok | Down | Other(T)",
      '| Down -> "down"',
      '"Health(?)" has no arm for Other(_)',
    ],
  ])("a match the arms of `%s` decide has to cover it", (decls, arm, missing) => {
    const source = program(
      `${decls}\nslot label : Text = ""`,
      `let next = Ok\nlabel := match next with | Ok -> "fine" ${arm}`,
    );
    expect(errors(source)).toEqual([
      `E0227 This match on ${missing}, and a match used as a value has to evaluate to one of ` +
        "its arms. Add the missing arms, or end with `_ -> …`",
    ]);
  });

  it("a generic's parameter in a union it writes inline is undecided, beside a type of that name", () => {
    const source = program(
      'type T = Int\ntype Wrapped(T) = Outer(Ok(T) | Down) | Empty\nslot label : Text = ""',
      'let next = Ok("x")\nlabel := match next with | Ok(s) -> s | Down -> "down"',
    );
    expect(errors(source)).toEqual([]);
  });

  it.each([
    ["every arm's tag", "type Outcome = Ok | Fail"],
    ["a variant that holds the value", "type Sized = Ok(Int) | Down"],
  ])("a match reads the first union with %s", (_label, other) => {
    const source = program(
      `${other}\ntype Health = Ok | Down\nslot label : Text = ""`,
      'let next = Ok\nlabel := match next with | Ok -> "up" | Down -> "down"',
    );
    expect(errors(source)).toEqual([]);
  });

  it("a match reads each item of a tuple by the arms' patterns for it", () => {
    const source = program(
      'type Health = Ok | Down\nslot label : Text = ""',
      'let p = (Ok, 1)\nlabel := match p with | (Ok, _) -> "up" | (Down, _) -> "down"',
    );
    expect(errors(source)).toEqual([]);
  });
});

describe("a union is read wherever the program writes it", () => {
  // Each row writes `Ok | Down` in one place only. The match names `Down`, which a `Result`
  // lacks, so it checks only if the union written there is found.
  const matchOnOk =
    'let next = Ok\nlabel := match next with | Ok -> "up" | Down -> "down" | _ -> "?"';
  it.each([
    ["a type's body", "type Health = Ok | Down", []],
    ["a generic type's body", "type Health(T) = Ok | Down | Other(T)", []],
    ["a slot's type", "slot h : Ok | Down = Down", []],
    ["a tile's in=", 'tile Badge in=Ok | Down = text("x")', []],
    ["a fn's parameter", 'fn f(h: Ok | Down) -> Text = "x"', []],
    ["a fn's result", "fn f() -> Ok | Down = Down", []],
    ["an effect's in=", "effect send cap=http.post in=Ok | Down out=Unit", []],
    ["an effect's out=", "effect load cap=http.get in=Text out=Ok | Down", []],
    [
      "a property test's for-all",
      `test t =
    property-test
        for-all   = {h: Ok | Down}
        given     = {slots: {label: ""}, event: {type: ui.click, target: Go}}
        invariant = run-reducer(go).slots.label == "up"`,
      [],
    ],
    ["a type's argument", "slot xs : List(Ok | Down) = []", []],
    ["a record's field", "type Row = {s: Ok | Down}", []],
    ["a variant's payload", "type Wrapped = Outer(Ok | Down) | Empty", []],
    ["a nominal's inner type", "type Hs = nominal List(Ok | Down)", []],
    [
      "a refinement's inner type",
      "type Hs = List(Ok | Down) where nonempty",
      [
        'E0804 Refinement "nonempty" tests text but is written over List(Ok | Down), so no value satisfies it',
      ],
    ],
  ])("in %s", (_label, decls, expected) => {
    const source = program(`${decls}\nslot label : Text = ""`, matchOnOk, "http.get, http.post");
    expect(errors(source)).toEqual(expected);
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

  // A union has no `.map`, `.get-or` or `.length`, so a value read through one is the built-in.
  it.each([
    ["n := o", ["E0201 Expected Int but got Option(Int)"]],
    ['t := o.get-or("x")', ["E0201 Expected Int but got Text", "E0201 Expected Text but got Int"]],
    ["n := n + o", ['E0201 Operator "+" expects a number but got Option(Int)']],
    [
      "n := o.length",
      ['E0108 Type "Option" has no member ".length" — it is a member of List / Text'],
    ],
  ])("beside a generic union declaring Some, `%s` reads the Option", (use, expected) => {
    const source = program(
      'type Box(T) = Some(T) | Empty\nslot n : Int = 0\nslot t : Text = ""',
      `let o = Some(1)\n${use}`,
    );
    expect(errors(source)).toEqual(expected);
  });

  it.each([
    "let r = Ok(1)",
    'let r = if flag then Ok(1) else Err("bad")',
  ])("a match whose arms a Result has reads `%s` as a Result", (binding) => {
    const source = program(
      "type Outcome = Ok(Int) | Fail\nslot flag : Bool = true\nslot n : Int = 0",
      `${binding}\nn := match r with | Ok(v) -> v`,
    );
    expect(errors(source)).toEqual([
      'E0227 This match on "Result(Int, ?)" has no arm for Err(_), and a match used as a value ' +
        "has to evaluate to one of its arms. Add the missing arms, or end with `_ -> …`",
    ]);
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
