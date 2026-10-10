import { describe, expect, it } from "vitest";
import { type Pointed, pointedErrorsOf } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const app = (defs: string, caps = ""): string => withButtonApp(defs, { caps });

const CARD = `tile Card in={label: Text} = text($1.label)`;

describe("() is refused where a type other than Unit is declared", () => {
  // Each report is read at its own position, which must be the `()` itself.
  const reported = (d: Pointed[]) => d.map((x) => `${x.code} ${x.message} @ ${x.text}`);

  it("at a tile call", () => {
    expect(reported(pointedErrorsOf(app(`${CARD}\ntile Host = column(Card(()))`)))).toEqual([
      "E0201 Expected {label: Text} but got Unit @ ()))",
    ]);
  });

  it("at a fn call", () => {
    expect(
      reported(pointedErrorsOf(app(`fn twice(n: Int) -> Int = n * 2\nslot n : Int = twice(())`))),
    ).toEqual(["E0201 Expected Int but got Unit @ ())"]);
  });

  it("at an emit, under the emit's own code", () => {
    const src = app(
      `effect save cap=storage.write in=Text out=Unit map-request={key: "k", value: $1}
reducer r on=ui.click(B) do= emit save(())`,
      "storage.write",
    );
    expect(reported(pointedErrorsOf(src))).toEqual(["E0202 Expected Text but got Unit @ ())"]);
  });

  it("at a slot assignment", () => {
    expect(
      reported(pointedErrorsOf(app(`slot n : Int = 0\nreducer r on=ui.click(B) do= n := ()`))),
    ).toEqual(["E0201 Expected Int but got Unit @ ()"]);
  });

  it("at a slot's initial value", () => {
    expect(reported(pointedErrorsOf(app(`slot t : Text = ()`)))).toEqual([
      "E0201 Expected Text but got Unit @ ()",
    ]);
  });

  it("inside a container the declared type reaches", () => {
    expect(reported(pointedErrorsOf(app(`slot o : Option(Int) = Some(())`)))).toEqual([
      "E0201 Expected Int but got Unit @ ())",
    ]);
  });

  it("in an if branch the declared type reaches", () => {
    expect(reported(pointedErrorsOf(app(`slot n : Int = if true then 1 else ()`)))).toEqual([
      "E0201 Expected Int but got Unit @ ()",
    ]);
  });

  it("in a record field", () => {
    expect(reported(pointedErrorsOf(app(`slot r : {a: Int} = {a: ()}`)))).toEqual([
      "E0201 Expected Int but got Unit @ ()}",
    ]);
  });

  it("as a fn body against its declared return type", () => {
    expect(reported(pointedErrorsOf(app(`fn f() -> Int = ()`)))).toEqual([
      "E0201 Expected Int but got Unit @ ()",
    ]);
  });

  it("as an operand of an ordering comparison", () => {
    expect(reported(pointedErrorsOf(app(`slot b : Bool = () < 1`)))).toEqual([
      'E0201 Operator "<" cannot compare Unit with Int @ () < 1',
    ]);
  });
});

describe("() is accepted where Unit is declared", () => {
  it("as a Unit slot's value", () => {
    expect(
      pointedErrorsOf(app(`slot u : Unit = ()\nreducer r on=ui.click(B) do= u := ()`)),
    ).toEqual([]);
  });

  it("as the payload of an Ok whose value type is Unit", () => {
    expect(pointedErrorsOf(app(`slot saved : Result(Unit, Text) = Ok(())`))).toEqual([]);
  });

  it("as a Unit fn parameter", () => {
    expect(pointedErrorsOf(app(`fn one(u: Unit) -> Int = 1\nslot n : Int = one(())`))).toEqual([]);
  });

  it("as the else of an if statement whose other branch assigns", () => {
    expect(
      pointedErrorsOf(
        app(`slot n : Int = 0\nreducer r on=ui.click(B) do= if n > 0 then n := 1 else ()`),
      ),
    ).toEqual([]);
  });

  it("as a match arm whose other arm assigns", () => {
    expect(
      pointedErrorsOf(
        app(`slot n : Int = 0
slot o : Option(Int) = None
reducer r on=ui.click(B) do= match o with | Some(x) -> n := x | None -> ()`),
      ),
    ).toEqual([]);
  });
});
