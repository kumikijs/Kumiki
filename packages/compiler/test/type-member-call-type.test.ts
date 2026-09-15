import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `stdlib.md` §2.4 gives the type-member calls a result type — `T.fresh()` is a
// `T` and `T.parse(t)` is an `Option(T)` — and `inferType` had neither. So
// `TodoId.fresh()` was undecidable, and an undecidable expression is accepted
// everywhere: `slot p : PostId` took a `UserId.fresh()` without a word, which
// is the one mistake `nominal` exists to catch and the position it matters most
// in, `.fresh` being how an id is normally minted (#348).
//
// `Duration` and `Bytes` are the carve-out: their members are constructors
// rather than these two, so the qualifier keeps answering for them.
//
// Expectations are the whole diagnostic list, not a filtered one — a stray
// extra report on a program called clean here is exactly what would ship.

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
slot p : PostId = "a"
slot u : UserId = "b"`;

const inReducer = (defs: string, body: string) =>
  diagnostics(`${defs}\nreducer r on=ui.click(B) do= ${body}`);

describe("<Type>.fresh() is a <Type>", () => {
  it("reports one nominal's fresh id assigned to another", () => {
    expect(inReducer(IDS, `p := UserId.fresh()`)).toEqual(["E0201 Expected PostId but got UserId"]);
  });

  it("accepts the fresh id of the slot's own type", () => {
    expect(inReducer(IDS, `p := PostId.fresh()`)).toEqual([]);
  });

  it("accepts a nominal's fresh id where its base type is required", () => {
    expect(diagnostics(`${IDS}\nslot base : Text = PostId.fresh()`)).toEqual([]);
  });

  it("answers for a standard-library nominal the same way", () => {
    expect(
      inReducer(
        `slot e : Email = "a@example.com"\nslot url : Url = "https://example.com"`,
        `e := Url.fresh()`,
      ),
    ).toEqual(["E0201 Expected Email but got Url"]);
  });

  it("answers for a primitive qualifier", () => {
    expect(diagnostics(`slot n : Int = Text.fresh()`)).toEqual(["E0201 Expected Int but got Text"]);
  });
});

describe("<Type>.parse(t) is an Option(<Type>)", () => {
  it("reports one nominal's parse assigned to an Option of another", () => {
    expect(diagnostics(`${IDS}\nslot o : Option(PostId) = UserId.parse("a")`)).toEqual([
      "E0201 Expected Option(PostId) but got Option(UserId)",
    ]);
  });

  it("accepts the parse of the slot's own type", () => {
    expect(diagnostics(`${IDS}\nslot o : Option(PostId) = PostId.parse("a")`)).toEqual([]);
  });

  it("reports the bare type where the Option was produced", () => {
    expect(diagnostics(`${IDS}\nslot bare : PostId = PostId.parse("a")`)).toEqual([
      "E0201 Expected PostId but got Option(PostId)",
    ]);
  });

  it("accepts a nominal's parse where an Option of its base is required", () => {
    expect(diagnostics(`${IDS}\nslot o : Option(Text) = PostId.parse("a")`)).toEqual([]);
  });

  it("answers Option(Int) for the numeric qualifier codegen branches on", () => {
    expect(diagnostics(`slot o : Option(Int) = Int.parse("1")`)).toEqual([]);
    expect(diagnostics(`slot n : Int = Int.parse("1")`)).toEqual([
      "E0201 Expected Int but got Option(Int)",
    ]);
    // The unwrapping the corpus writes stays clean — `.get-or` answers `Int`.
    expect(diagnostics(`slot n : Int = Int.parse("1").get-or(0)`)).toEqual([]);
  });
});

describe("the qualifiers that keep their own answers", () => {
  it("leaves Duration's constructors and its parse as they were", () => {
    expect(diagnostics(`slot d : Duration = Duration.ms(500)`)).toEqual([]);
    // `Duration.parse(t)` answering a bare `Duration` rather than an
    // `Option(Duration)` is #424, left exactly as it was rather than widened
    // into this fix.
    expect(diagnostics(`slot d : Duration = Duration.parse("1")`)).toEqual([]);
  });

  it("leaves Bytes as it was", () => {
    expect(diagnostics(`slot b : Bytes = Bytes.from-text("x")`)).toEqual([]);
  });

  it("keeps the qualified show a Text, whatever the qualifier", () => {
    expect(diagnostics(`${IDS}\nslot s : Text = PostId.show("a")`)).toEqual([]);
    expect(diagnostics(`slot s : Text = Duration.show(Duration.ms(1))`)).toEqual([]);
  });
});

describe("a qualifier that names no type infers nothing", () => {
  it("reports the undefined type once and nothing about the value", () => {
    // E0117 owns this report (#276). An inferred `TypeRef` to a name with no
    // definition would add a second diagnostic about a type that is not there.
    expect(inReducer(IDS, `p := Nope.fresh()`)).toEqual([
      'E0117 Reference to undefined type "Nope"',
    ]);
    expect(diagnostics(`${IDS}\nslot o : Option(PostId) = Nope.parse("a")`)).toEqual([
      'E0117 Reference to undefined type "Nope"',
    ]);
  });

  it("reads the qualifier by the one spelling rule the lowering does", () => {
    // A Kumiki name may carry a hyphen and a qualifier may not, so `Post-Id`
    // is not a type-member call under any spelling — E0116, the callee that
    // does not resolve, rather than a type answered for a name codegen would
    // never lower.
    expect(inReducer(IDS, `p := Post-Id.fresh()`)).toEqual([
      'E0116 Call to undefined function "Post-Id.fresh"',
    ]);
  });

  it("says nothing about a constructor that still wants its arguments", () => {
    // `Box` names a type but `Box` alone is not one, so there is no type to
    // answer with — and inventing an unapplied `TypeRef` would compare as one.
    expect(diagnostics(`type Box(T) = nominal List(T)\nslot n : Int = Box.fresh()`)).toEqual([]);
    expect(diagnostics(`slot l : List(Int) = List.fresh()`)).toEqual([]);
  });
});
