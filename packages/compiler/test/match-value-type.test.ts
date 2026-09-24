import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// A `match` used as a value had no type (#435). Its arms bound their payloads
// with the right types — `| Some(id) -> p := id` reported — but the value the
// arms produce was never compared with where it lands, so
// `p := match ou with | Some(id) -> id | None -> p` put a `UserId` into a
// `PostId` slot without a word, while `p := ou.get-or(p)` reported the same
// mistake.
//
// Two readers had to learn it: a destination with a declared type checks each
// arm the way it checks each branch of an `if`, and `inferType` answers the
// arms' common type for the positions that have no declared type (a `let`, an
// operand, a receiver).

const errsOf = (src: string) => check(parse(lex(src)));
const app = (defs: string): string =>
  `${defs}
tile B = button(text="x")
tile App = column(B)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const diagnostics = (src: string) => errsOf(app(src)).map((e) => `${e.code} ${e.message}`);

const IDS = `type PostId = nominal Text where uuid
type UserId = nominal Text where uuid
slot p  : PostId         = "a"
slot u  : UserId         = "b"
slot ou : Option(UserId) = None
slot n  : Int            = 0`;

const inReducer = (body: string, defs = IDS) =>
  diagnostics(`${defs}\nreducer r on=ui.click(B) do= ${body}`);

describe("a match assigned to a declared destination", () => {
  it("reports the arm whose value is the wrong type", () => {
    expect(inReducer(`p := match ou with | Some(id) -> id | None -> p`)).toEqual([
      "E0201 Expected PostId but got UserId",
    ]);
  });

  it("reports at the arm, not at the match", () => {
    const errs = errsOf(
      app(`${IDS}\nreducer r on=ui.click(B) do= p := match ou with
    | Some(id) -> id
    | None     -> p`),
    );
    // IDS is six lines, so the `match` is on line 7 and the `Some` arm on 8.
    expect(errs.map((e) => [e.code, e.pos.line])).toEqual([["E0201", 8]]);
  });

  it("accepts arms that all fit", () => {
    expect(inReducer(`p := match ou with | Some(id) -> p | None -> p`)).toEqual([]);
    expect(inReducer(`u := match ou with | Some(id) -> id | None -> u`)).toEqual([]);
  });

  it("is checked against a fn's declared return type", () => {
    expect(
      diagnostics(
        `${IDS}\nfn pick(o: Option(UserId), d: PostId) -> PostId = match o with | Some(id) -> id | None -> d`,
      ),
    ).toEqual(["E0201 Expected PostId but got UserId"]);
  });

  it("reads a Result and a user union the same way as an Option", () => {
    expect(
      inReducer(
        `n := match r with | Ok(t) -> t | Err(e) -> 0`,
        `${IDS}\nslot r : Result(Text, Int) = Err(0)`,
      ),
    ).toEqual(["E0201 Expected Int but got Text"]);
    expect(
      inReducer(
        `n := match s with | Circle(t) -> t | Square(k) -> k`,
        `${IDS}\ntype Shape = Circle(Text) | Square(Int)\nslot s : Shape = Square(1)`,
      ),
    ).toEqual(["E0201 Expected Int but got Text"]);
  });

  it("reports a pattern's own mistake once, not once per reader", () => {
    // `Ok` is not a tag of an `Option`. `checkExpr` owns that report; the arm
    // scope the destination check builds must not repeat it.
    const codes = inReducer(`n := match ou with | Ok(x) -> 1 | None -> 0`).map((d) =>
      d.slice(0, 5),
    );
    expect(codes).toEqual(["E0209"]);
  });
});

describe("a match with no declared destination has its arms' common type", () => {
  it("carries through a let binder", () => {
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> u; p := v`)).toEqual([
      "E0201 Expected PostId but got UserId",
    ]);
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> u; u := v`)).toEqual([]);
  });

  it("reaches a comparison operand", () => {
    expect(
      inReducer(`n := if (match ou with | Some(id) -> id | None -> u) == p then 1 else 0`),
    ).toEqual(['E0201 Operator "==" cannot compare UserId with PostId']);
  });

  it("has no type when the arms disagree, rather than the first arm's", () => {
    // `UserId` and `PostId` meet nothing both ways, so the `match` says
    // nothing — naming either arm's type would report the other arm's value.
    // The `p := v` below is still wrong at run time for one arm; what this
    // pins is that the undecidable answer does not pick a side.
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> p; p := v`)).not.toContain(
      "E0201 Expected PostId but got UserId",
    );
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> p; u := v`)).not.toContain(
      "E0201 Expected UserId but got PostId",
    );
  });

  it("has no type when one arm's value is undecidable", () => {
    // `inferType` gives a `let` expression no type, so the second arm is
    // undecidable; a report here would reject a running program if that arm
    // were a `PostId`.
    expect(
      inReducer(`let v = match ou with | Some(id) -> id | None -> (let w = u in w); p := v`),
    ).not.toContain("E0201 Expected PostId but got UserId");
  });
});
