import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `()` is a literal, so its type is known: `Unit`, refused where anything else
// is declared and accepted where `Unit` is.

type Diagnostic = { code: string; message: string; text: string };

const diagnose = (src: string): Diagnostic[] =>
  check(parse(lex(src)))
    .filter((e) => e.severity !== "warning")
    .map((e) => ({
      code: e.code,
      message: e.message,
      // The text at the diagnostic's own position, so the position is read
      // rather than counted.
      text: (src.split("\n")[e.pos.line - 1] ?? "").slice(e.pos.col - 1),
    }));

const app = (defs: string, caps = ""): string => `${defs}
tile B = button(text="x")
tile Home = column(B)
app R
    caps   = [${caps}]
    routes = {"/" -> Home, "/404" -> Home}
    init   = []`;

const CARD = `tile Card in={label: Text} = text($1.label)`;

describe("() is refused where a type other than Unit is declared", () => {
  // Each report is read at its own position, which must be the `()` itself.
  const reported = (d: Diagnostic[]) => d.map((x) => `${x.code} ${x.message} @ ${x.text}`);

  it("at a tile call", () => {
    expect(reported(diagnose(app(`${CARD}\ntile Host = column(Card(()))`)))).toEqual([
      "E0201 Expected {label: Text} but got Unit @ ()))",
    ]);
  });

  it("at a fn call", () => {
    expect(
      reported(diagnose(app(`fn twice(n: Int) -> Int = n * 2\nslot n : Int = twice(())`))),
    ).toEqual(["E0201 Expected Int but got Unit @ ())"]);
  });

  it("at an emit, under the emit's own code", () => {
    const src = app(
      `effect save cap=storage.write in=Text out=Unit map-request={key: "k", value: $1}
reducer r on=ui.click(B) do= emit save(())`,
      "storage.write",
    );
    expect(reported(diagnose(src))).toEqual(["E0202 Expected Text but got Unit @ ())"]);
  });

  it("at a slot assignment", () => {
    expect(
      reported(diagnose(app(`slot n : Int = 0\nreducer r on=ui.click(B) do= n := ()`))),
    ).toEqual(["E0201 Expected Int but got Unit @ ()"]);
  });

  it("at a slot's initial value", () => {
    expect(reported(diagnose(app(`slot t : Text = ()`)))).toEqual([
      "E0201 Expected Text but got Unit @ ()",
    ]);
  });

  it("inside a container the declared type reaches", () => {
    expect(reported(diagnose(app(`slot o : Option(Int) = Some(())`)))).toEqual([
      "E0201 Expected Int but got Unit @ ())",
    ]);
  });

  it("in an if branch the declared type reaches", () => {
    expect(reported(diagnose(app(`slot n : Int = if true then 1 else ()`)))).toEqual([
      "E0201 Expected Int but got Unit @ ()",
    ]);
  });

  it("in a record field", () => {
    expect(reported(diagnose(app(`slot r : {a: Int} = {a: ()}`)))).toEqual([
      "E0201 Expected Int but got Unit @ ()}",
    ]);
  });

  it("as a fn body against its declared return type", () => {
    expect(reported(diagnose(app(`fn f() -> Int = ()`)))).toEqual([
      "E0201 Expected Int but got Unit @ ()",
    ]);
  });

  it("as an operand of an ordering comparison", () => {
    expect(reported(diagnose(app(`slot b : Bool = () < 1`)))).toEqual([
      'E0201 Operator "<" cannot compare Unit with Int @ () < 1',
    ]);
  });
});

describe("() is accepted where Unit is declared", () => {
  it("as a Unit slot's value", () => {
    expect(diagnose(app(`slot u : Unit = ()\nreducer r on=ui.click(B) do= u := ()`))).toEqual([]);
  });

  it("as the payload of an Ok whose value type is Unit", () => {
    expect(diagnose(app(`slot saved : Result(Unit, Text) = Ok(())`))).toEqual([]);
  });

  it("as a Unit fn parameter", () => {
    expect(diagnose(app(`fn one(u: Unit) -> Int = 1\nslot n : Int = one(())`))).toEqual([]);
  });

  it("as the else of an if statement whose other branch assigns", () => {
    expect(
      diagnose(app(`slot n : Int = 0\nreducer r on=ui.click(B) do= if n > 0 then n := 1 else ()`)),
    ).toEqual([]);
  });

  it("as a match arm whose other arm assigns", () => {
    expect(
      diagnose(
        app(`slot n : Int = 0
slot o : Option(Int) = None
reducer r on=ui.click(B) do= match o with | Some(x) -> n := x | None -> ()`),
      ),
    ).toEqual([]);
  });
});
