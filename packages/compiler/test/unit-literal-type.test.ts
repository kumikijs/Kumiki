import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `()` had no type (#427). `inferType` answered `null` for it, and `null` is
// "cannot tell", which every check accepts — so the one value of `Unit` was
// taken against any declared type. `Card(42)` was E0201 and `Card(())` was
// not; the latter mounted with `$1 = null` and threw reading `$1.label`.
//
// It is a literal, so its type is known: `Unit`, refused where anything else
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
  it("at a tile call", () => {
    const d = diagnose(app(`${CARD}\ntile Host = column(Card(()))`));
    expect(d.map((x) => `${x.code} ${x.message}`)).toEqual([
      "E0201 Expected {label: Text} but got Unit",
    ]);
    expect(d[0]?.text).toMatch(/^\(\)\)\)/);
  });

  it("at a fn call", () => {
    expect(
      diagnose(app(`fn twice(n: Int) -> Int = n * 2\nslot n : Int = twice(())`)).map(
        (x) => `${x.code} ${x.message}`,
      ),
    ).toEqual(["E0201 Expected Int but got Unit"]);
  });

  it("at an emit, under the emit's own code", () => {
    const src = app(
      `effect save cap=storage.write in=Text out=Unit map-request={key: "k", value: $1}
reducer r on=ui.click(B) do= emit save(())`,
      "storage.write",
    );
    expect(diagnose(src).map((x) => x.code)).toEqual(["E0202"]);
  });

  it("at a slot assignment and a slot's initial value", () => {
    expect(
      diagnose(app(`slot n : Int = 0\nreducer r on=ui.click(B) do= n := ()`)).map(
        (x) => `${x.code} ${x.message}`,
      ),
    ).toEqual(["E0201 Expected Int but got Unit"]);
    expect(diagnose(app(`slot t : Text = ()`)).map((x) => `${x.code} ${x.message}`)).toEqual([
      "E0201 Expected Text but got Unit",
    ]);
  });

  it("inside a container the declared type reaches", () => {
    expect(
      diagnose(app(`slot o : Option(Int) = Some(())`)).map((x) => `${x.code} ${x.message}`),
    ).toEqual(["E0201 Expected Int but got Unit"]);
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
});
