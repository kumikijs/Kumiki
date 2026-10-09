import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
const SLOTS = `
type Qty = Int where positive
type Cents = nominal Int
type Order = {qty: Int, note: Text}
slot n : Int = 0
slot f : Float = 0.0
slot t : Time = now
slot s : Text = ""
slot b : Bool = false
slot oi : Option(Int) = None
slot ot : Option(Time) = None
slot r : Result(Int, Text) = Ok(1)
slot q : Qty = 1
slot c : Cents = 0
slot o : Order = {qty: 1, note: ""}
slot k : Text = "number"
`;
const diagsOf = (input: string) => check(parse(lex(`${SLOTS}\ntile App = ${input}\n${TAIL}`)));
const e0226 = (input: string) => diagsOf(input).filter((d) => d.code === "E0226");

describe("an input's field kind has to go with the bound type (E0226)", () => {
  const bad: [string, string][] = [
    ["a Time in a time field", `input(bind=t, type="time")`],
    ["a Time in a month field", `input(bind=t, type="month")`],
    ["a Time in a week field", `input(bind=t, type="week")`],
    ["a Time with no type", `input(bind=t)`],
    ["a Time in the obsolete datetime field", `input(bind=t, type="datetime")`],
    ["an Int in a date field", `input(bind=n, type="date")`],
    ["a Float in a date field", `input(bind=f, type="date")`],
    ["an Int in a text field", `input(bind=n, type="text")`],
    ["an Int with no type", `input(bind=n)`],
    ["a Text in a checkbox field", `input(bind=s, type="checkbox")`],
    ["an aliased Int in a date field", `input(bind=q, type="date")`],
    ["a nominal Int in a text field", `input(bind=c, type="text")`],
    ["a record field's Int in a date field", `input(bind=o.qty, type="date")`],
    ["an Option payload's Time in a time field", `input(bind=ot.get, type="time")`],
    ["a Bool", `input(bind=b, type="text")`],
    ["an Option(Int) bound without .get", `input(bind=oi, type="number")`],
    ["an Option(Time) bound without .get", `input(bind=ot, type="date")`],
    ["a Result bound without .get", `input(bind=r, type="number")`],
    ["a record", `input(bind=o)`],
  ];
  for (const [name, input] of bad) {
    it(`reports ${name}`, () => {
      const found = e0226(input);
      expect(found.map((d) => [d.code, d.kind, d.severity ?? "error"])).toEqual([
        ["E0226", "input-bind-type", "error"],
      ]);
    });
  }

  it("names the field kinds the bound base goes with, at the type= it disagrees with", () => {
    const [d] = e0226(`input(bind=t, type="time")`);
    expect(d?.message).toBe(
      `input(bind=…) with type="time" cannot bind a value of type Time: a Time binds with type="date" / type="datetime-local" (see docs/spec/forms.md §5.1.1)`,
    );
    expect(d?.pos.col).toBe(`tile App = input(bind=t, type=`.length + 1);
    const [none] = e0226(`input(bind=n)`);
    expect(none?.message).toBe(
      `input(bind=…) with no type= (a "text" field) cannot bind a value of type Int: an Int binds with type="number" (see docs/spec/forms.md §5.1.1)`,
    );
  });

  it("points an Option or Result bound whole at its payload", () => {
    expect(e0226(`input(bind=oi, type="number")`)[0]?.message).toBe(
      `input(bind=…) cannot bind a value of type Option(Int): an input binds a Text, Int, Float or Time — bind its payload with ".get" (see docs/spec/forms.md §5.1.1)`,
    );
    expect(e0226(`input(bind=b)`)[0]?.message).toBe(
      `input(bind=…) cannot bind a value of type Bool: an input binds a Text, Int, Float or Time (see docs/spec/forms.md §5.1.1)`,
    );
  });

  const good: [string, string][] = [
    ["an Int in a number field", `input(bind=n, type="number")`],
    ["a Float in a number field", `input(bind=f, type="number")`],
    ["a Time in a date field", `input(bind=t, type="date")`],
    ["a Time in a datetime-local field", `input(bind=t, type="datetime-local")`],
    ["a Text with no type", `input(bind=s)`],
    ["a Text in an email field", `input(bind=s, type="email")`],
    ["a Text in a date field", `input(bind=s, type="date")`],
    ["a Text in a number field", `input(bind=s, type="number")`],
    ["an aliased Int in a number field", `input(bind=q, type="number")`],
    ["a nominal Int in a number field", `input(bind=c, type="number")`],
    ["an Option payload's Int in a number field", `input(bind=oi.get, type="number")`],
    ["a Result payload's Int in a number field", `input(bind=r.get, type="number")`],
    ["a record field's Int in a number field", `input(bind=o.qty, type="number")`],
    // An expression's value is not known here; the bound type still is.
    ["an Int beside a type= expression", `input(bind=n, type=k)`],
    // A file field with a bind is E0205's, and only E0205's.
    ["a bind on a file field", `input(bind=s, type="file")`],
  ];
  for (const [name, input] of good) {
    it(`accepts ${name}`, () => {
      expect(e0226(input)).toEqual([]);
    });
  }

  it("leaves a bind whose type cannot be read to the code that names it", () => {
    const codes = diagsOf(`input(bind=nope, type="time")`).map((d) => d.code);
    expect(codes).toContain("E0103");
    expect(codes).not.toContain("E0226");
  });

  it("still judges a bound type that no field kind goes with beside a type= expression", () => {
    expect(e0226(`input(bind=b, type=k)`)).toHaveLength(1);
  });
});
