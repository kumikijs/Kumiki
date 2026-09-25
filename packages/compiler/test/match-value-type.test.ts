import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// A `match` used as a value had no type. Its arms bound their payloads
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

  it("reports at each arm that does not fit, not at the match", () => {
    const line = `reducer r on=ui.click(B) do= p := match ou with | Some(id) -> id | None -> u`;
    const errs = errsOf(app(`${IDS}\n${line}`));
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
    // The `Some` arm's `id` is the `UserId` payload; the `None` arm's `id` is
    // the outer `PostId`. Exactly one arm is wrong, and it is the `Some` arm.
    const line = `reducer r on=ui.click(B) do= let id = p; p := match ou with | Some(id) -> id | None -> id`;
    const errs = errsOf(app(`${IDS}\n${line}`));
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

  it("drops the nominal when the arms disagree, keeping the base they share", () => {
    // `UserId` and `PostId` refuse each other but are both `nominal Text`, so
    // the `match` has type `Text` (`sharedBase`), exactly as an `if` does —
    // not the first arm's type, which would report the other arm's value.
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
    // `inferType` gives a `let` expression no type, so the `None` arm is
    // undecidable and so is the whole `match`. Its value is a `PostId`, so
    // were it decidable the `match` would be `Text` (above) and `p := v` would
    // pass; answering the `Some` arm's `UserId` instead would report it.
    expect(
      inReducer(`let v = match ou with | Some(id) -> id | None -> (let w = p in w); p := v`),
    ).toEqual([]);
  });
});

describe("known gap: a bare or tuple pattern binds the scrutinee's base type", () => {
  // Only a variant pattern's payload keeps its nominal today. A name pattern
  // (`x`) or a tuple pattern binds the scrutinee's type with the nominal
  // dropped, so these put a `UserId` into a `PostId` slot and report nothing.
  // When the gap closes, each of these should be `E0201 Expected PostId but
  // got UserId`.
  it.each([
    ["a name pattern as a value", `p := match u with | x -> x`],
    ["a tuple pattern as a value", `p := match t with | (a, b) -> a`],
    ["a name pattern in statement form", `match u with | x -> p := x`],
  ])("%s", (_, body) => {
    expect(inReducer(body, `${IDS}\nslot t : Tuple(UserId, PostId) = ("b", "a")`)).not.toContain(
      "E0201 Expected PostId but got UserId",
    );
  });
});
