import { describe, expect, it } from "vitest";
import { checkSource, summariesOf } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const diagnostics = (src: string) => summariesOf(withButtonApp(src));

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

  it("reports at each arm that does not fit, not at the match", () => {
    const line = `reducer r on=ui.click(B) do= p := match ou with | Some(id) -> id | None -> u`;
    const errs = checkSource(withButtonApp(`${IDS}\n${line}`));
    // Columns are 1-based: each report sits on the arm's value, after its `-> `.
    const someArm = line.indexOf("-> id") + 4;
    const noneArm = line.indexOf("-> u") + 4;
    expect(errs.map((e) => [e.code, e.message, e.pos.col])).toEqual([
      ["E0201", "Expected PostId but got UserId", someArm],
      ["E0201", "Expected PostId but got UserId", noneArm],
    ]);
  });

  it.each([
    [
      "a fn argument",
      `t := take(match ou with | Some(id) -> id | None -> p)`,
      `fn take(q: PostId) -> Text = "x"\nslot t : Text = ""`,
    ],
    [
      "a record field",
      `rec := { id: match ou with | Some(id) -> id | None -> p }`,
      `type Rec = { id: PostId }\nslot rec : Rec = { id: "a" }`,
    ],
  ])("is checked in %s", (_, body, extra) => {
    expect(inReducer(body, `${IDS}\n${extra}`)).toEqual(["E0201 Expected PostId but got UserId"]);
  });

  it("accepts literals and constructors that fit each arm's destination", () => {
    const defs = `${IDS}
slot op : Option(PostId) = None
slot lp : List(PostId)   = []
slot f  : Float          = 0.0`;
    expect(
      inReducer(
        [
          `op := match ou with | Some(id) -> Some(p) | None -> None`,
          `lp := match ou with | Some(id) -> [p] | None -> []`,
          `f := match ou with | Some(id) -> 1 | None -> 2.5`,
          `p := match ou with | Some(id) -> "x" | None -> p`,
        ].join("; "),
        defs,
      ),
    ).toEqual([]);
  });

  it("reads a nested match in the scope of the arm it sits in", () => {
    expect(
      inReducer(
        `p := match oou with | Some(x) -> (match x with | Some(id) -> id | None -> p) | None -> p`,
        `${IDS}\nslot oou : Option(Option(UserId)) = None`,
      ),
    ).toEqual(["E0201 Expected PostId but got UserId"]);
  });

  it("reads an arm's bind over an outer name of the same spelling", () => {
    const line = `reducer r on=ui.click(B) do= let id = p; p := match ou with | Some(id) -> id | None -> id`;
    const errs = checkSource(withButtonApp(`${IDS}\n${line}`));
    expect(errs.map((e) => [e.code, e.message, e.pos.col])).toEqual([
      ["E0201", "Expected PostId but got UserId", line.indexOf("-> id") + 4],
    ]);
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

  it("drops the nominal when the arms disagree, keeping the base they share", () => {
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> p; n := v`)).toEqual([
      "E0201 Expected Int but got Text",
    ]);
    expect(inReducer(`let v = if true then u else p; n := v`)).toEqual([
      "E0201 Expected Int but got Text",
    ]);
    // `Text` goes into either nominal, so neither choice of arm is reported.
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> p; p := v`)).toEqual([]);
    expect(inReducer(`let v = match ou with | Some(id) -> id | None -> p; u := v`)).toEqual([]);
  });

  it("has no type when one arm's value is undecidable, rather than the other arm's", () => {
    // `.map` with a fragment answers no type, so the `None` arm is undecidable.
    const undecided = "Some(p).map($1).get-or(p)";
    expect(
      inReducer(`let v = match ou with | Some(id) -> id | None -> ${undecided}; p := v`),
    ).toEqual([]);
    expect(
      inReducer(`let v = match ou with | Some(id) -> id | None -> ${undecided}; n := v`),
    ).toEqual([]);
  });
});

describe("a name or tuple pattern binds the type as written", () => {
  const TUPLE = `${IDS}\nslot tt : Tuple(UserId, PostId) = ("b", "a")`;

  it.each([
    ["a name pattern as a value", `p := match u with | x -> x`],
    ["a tuple pattern as a value", `p := match tt with | (a, b) -> a`],
    ["a name pattern in statement form", `match u with | x -> p := x`],
    ["a tuple pattern in statement form", `match tt with | (a, b) -> p := a`],
    ["a name pattern nested in a tuple pattern", `p := match (u, p) with | (x, _) -> x`],
  ])("reports %s", (_, body) => {
    expect(inReducer(body, TUPLE)).toEqual(["E0201 Expected PostId but got UserId"]);
  });

  it.each([
    ["a name pattern", `n := match u with | x -> x`],
    ["a tuple pattern", `n := match tt with | (a, b) -> a`],
  ])("names the nominal the binder has for %s", (_, body) => {
    expect(inReducer(body, TUPLE)).toEqual(["E0201 Expected Int but got UserId"]);
  });

  const reportsAt = (body: string, message: string, at: string, offset = 0) => {
    const line = `reducer r on=ui.click(B) do= ${body}`;
    const src = withButtonApp(`${TUPLE}\nslot b : Bool = false\n${line}`);
    const lineNo = src.split("\n").indexOf(line) + 1;
    // Columns are 1-based.
    expect(checkSource(src).map((e) => [e.code, e.message, e.pos.line, e.pos.col])).toEqual([
      ["E0201", message, lineNo, line.indexOf(at) + offset + 1],
    ]);
  };

  it("carries the nominal through a let binder with no declared destination", () => {
    reportsAt(
      `let v = match u with | x -> x; p := v`,
      "Expected PostId but got UserId",
      "p := v",
      "p := ".length,
    );
  });

  it("compares the binder as its nominal in an == operand", () => {
    reportsAt(
      `b := match u with | x -> x == p`,
      'Operator "==" cannot compare UserId with PostId',
      "x == p",
    );
  });

  it.each([
    ["a name pattern", `u := match u with | x -> x`],
    ["a tuple pattern", `p := match tt with | (a, b) -> b`],
    ["a name pattern in statement form", `match u with | x -> u := x`],
    ["a name pattern read through the base's methods", `n := match u with | x -> x.length`],
  ])("accepts %s whose bind fits", (_, body) => {
    expect(inReducer(body, TUPLE)).toEqual([]);
  });
});
