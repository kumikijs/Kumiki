import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `stdlib.md` §2.4 gives the type-member calls a result type — `T.fresh()` is a
// `T` and `T.parse(t)` is an `Option(T)` — and `inferType` had neither. So
// `TodoId.fresh()` was undecidable, and an undecidable expression is accepted
// everywhere: `slot p : PostId` took a `UserId.fresh()` without a word, which
// is the one mistake `nominal` exists to catch and the position it matters most
// in, `.fresh` being how an id is normally minted (#348).
//
// `Duration` and `Bytes` are the carve-out: their other members are
// constructors, so the qualifier keeps answering for those — but not for
// `parse`, which is the type member for them as for every other type.
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

  it("sees through an alias to a nominal, and down a narrowing", () => {
    const src = `type Handle = nominal Text where nonempty
type Alias  = Handle
type Deep   = nominal Handle
slot h : Handle = "a"
slot d : Deep   = "b"`;
    // An alias names the same type, so it mints the same one.
    expect(inReducer(src, `h := Alias.fresh()`)).toEqual([]);
    // `Deep` was declared a `Handle`, so it goes where a `Handle` is wanted;
    // the reverse is the mistake the narrowing was written to catch.
    expect(inReducer(src, `h := Deep.fresh()`)).toEqual([]);
    expect(inReducer(src, `d := Handle.fresh()`)).toEqual(["E0201 Expected Deep but got Handle"]);
  });
});

/**
 * `fresh` is narrower than `parse`, and the lowering is why: codegen answers
 * every `T.fresh()` with the same `_s.freshId()` — a uuid `Text`, whatever `T`
 * says. So the qualifier can only be believed for a type a `Text` inhabits,
 * which is what stdlib §2.4.1 scopes `fresh` to in the first place.
 *
 * Read without that test, the inference asserted types no `_s.freshId()` ever
 * produces: a `Text` slot refused `Int.fresh()` though the value it gets really
 * is a `Text`, a record type was positively believed of a string, and a
 * `nominal Int` id answered its own base. Each line below is one of those.
 */
describe("what fresh will not claim, because the lowering cannot produce it", () => {
  it("says nothing about a primitive that a uuid Text is not", () => {
    // Clean before this rule and clean after: the value is a `Text`.
    expect(diagnostics(`slot s : Text = Int.fresh()`)).toEqual([]);
    expect(diagnostics(`slot n : Int = Int.fresh()`)).toEqual([]);
    expect(diagnostics(`slot b : Bool = Bool.fresh()`)).toEqual([]);
  });

  it("still answers Text itself, which is the one primitive the lowering does produce", () => {
    expect(diagnostics(`slot s : Text = Text.fresh()`)).toEqual([]);
    expect(diagnostics(`slot n : Int = Text.fresh()`)).toEqual(["E0201 Expected Int but got Text"]);
  });

  it("says nothing about a record or a union, which a uuid Text is not", () => {
    expect(diagnostics(`type Point = {x: Int, y: Int}\nslot s : Text = Point.fresh()`)).toEqual([]);
    expect(diagnostics(`type S = Idle | Busy\nslot s : Text = S.fresh()`)).toEqual([]);
  });

  it("says nothing about a nominal declared over something other than Text", () => {
    // `Cents.fresh()` is a uuid string, not a `Cents` and not an `Int`. Saying
    // so would be asserting the declaration over the lowering.
    const src = `type Cents = nominal Int where positive\nslot c : Cents = 1`;
    expect(inReducer(src, `c := Cents.fresh()`)).toEqual([]);
    expect(diagnostics(`${src}\nslot n : Int = Cents.fresh()`)).toEqual([]);
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

/**
 * `parse` is lowered by the base its qualifier unaliases to, not by its name
 * (#431), so the types it reads are exactly the bases that have a reading of a
 * text: `Int`, `Float`, `Time`, `Bool`, `Text` and `Bytes`. Anything else — a
 * record, a union, `File`, `EffectId`, `Unit` — used to fall into a branch that
 * wrapped the raw string, which the checker then typed `Option(<Type>)`. That
 * is a value no reader of the type can use, so the call is reported where it is
 * written instead of being answered with one.
 */
describe("a parse whose qualifier has no reading of a text", () => {
  const E = (callee: string) =>
    `E0802 Function "${callee}" is documented but not implemented by the runtime`;

  it("reports a record, a union and the primitives no text spells", () => {
    expect(diagnostics(`type Point = {x: Int}\nslot o : Option(Point) = Point.parse("a")`)).toEqual(
      [E("Point.parse")],
    );
    expect(diagnostics(`type Tone = Hi | Lo\nslot o : Option(Tone) = Tone.parse("Hi")`)).toEqual([
      E("Tone.parse"),
    ]);
    expect(diagnostics(`slot o : Option(File) = File.parse("a")`)).toEqual([E("File.parse")]);
    expect(diagnostics(`slot o : Option(EffectId) = EffectId.parse("a")`)).toEqual([
      E("EffectId.parse"),
    ]);
  });

  it("reports a nominal over one of them, because the base is what decides", () => {
    expect(
      diagnostics(`type Doc = nominal {x: Int}\nslot o : Option(Doc) = Doc.parse("a")`),
    ).toEqual([E("Doc.parse")]);
  });

  it("accepts every base that has a reading, directly and through a nominal", () => {
    expect(diagnostics(`slot o : Option(Bool) = Bool.parse("true")`)).toEqual([]);
    expect(
      diagnostics(`type Cents = nominal Int where positive
type Ratio = nominal Float
type Due = nominal Time
type Flag = nominal Bool
type Blob = nominal Bytes
slot c : Option(Cents) = Cents.parse("12")
slot r : Option(Ratio) = Ratio.parse("0.5")
slot d : Option(Due) = Due.parse("2026-01-01")
slot f : Option(Flag) = Flag.parse("true")
slot b : Option(Blob) = Blob.parse("x")`),
    ).toEqual([]);
  });

  it("leaves an undefined qualifier to E0117 alone", () => {
    expect(diagnostics(`slot o : Option(Int) = Nope.parse("1")`)).toEqual([
      'E0117 Reference to undefined type "Nope"',
    ]);
  });
});

describe("the qualifiers that keep their own answers", () => {
  it("leaves Duration's constructors as they were", () => {
    expect(diagnostics(`slot d : Duration = Duration.ms(500)`)).toEqual([]);
  });

  it("leaves Bytes as it was", () => {
    expect(diagnostics(`slot b : Bytes = Bytes.from-text("x")`)).toEqual([]);
  });

  // `parse` is the one member they share with the rule above, and it is the
  // rule above that answers it: an `Option` of the qualifier, like every other
  // type (stdlib §2.4.3). Both used to be caught by the namespace branch and
  // answer the bare type, so the documented spelling was E0201 and the wrong
  // one was clean (#424). Each direction is asserted per qualifier, so a fix
  // that moves only one of the four is caught.
  it("gives Duration.parse the Option the spec gives it", () => {
    expect(diagnostics(`slot o : Option(Duration) = Duration.parse("500")`)).toEqual([]);
    expect(diagnostics(`slot d : Duration = Duration.parse("500")`)).toEqual([
      "E0201 Expected Duration but got Option(Duration)",
    ]);
  });

  it("gives Bytes.parse the Option the spec gives it", () => {
    expect(diagnostics(`slot o : Option(Bytes) = Bytes.parse("x")`)).toEqual([]);
    expect(diagnostics(`slot b : Bytes = Bytes.parse("x")`)).toEqual([
      "E0201 Expected Bytes but got Option(Bytes)",
    ]);
  });

  it("keeps the qualified show a Text, whatever the qualifier", () => {
    expect(diagnostics(`${IDS}\nslot s : Text = PostId.show("a")`)).toEqual([]);
    expect(diagnostics(`slot s : Text = Duration.show(Duration.ms(1))`)).toEqual([]);
  });
});

/**
 * A type only matters where it is read, and `fresh` / `parse` feed four places
 * an id normally travels through. The example asserts these in prose; these
 * assert them as diagnostics.
 */
describe("where the minted type is read", () => {
  it("carries through a let binder", () => {
    expect(inReducer(IDS, `let id = UserId.fresh(); p := id`)).toEqual([
      "E0201 Expected PostId but got UserId",
    ]);
    expect(inReducer(IDS, `let id = PostId.fresh(); p := id`)).toEqual([]);
  });

  it("known gap: a match used as a value has no type, so the arm value is unchecked", () => {
    // `match` is the idiomatic way to open the `Option` that `parse` now
    // produces, and it is the one position of the four that loses the type.
    //
    // The binder is not what loses it — `checkExpr`'s `MatchExpr` case infers
    // the scrutinee and binds the payload, so `| Some(id) -> p := id` and
    // `| Some(id) -> takesPost(id)` both report. What is missing is a
    // `MatchExpr` case in `inferType`: a `match` in value position falls to
    // `default: return null`, so the destination has nothing to compare the arm
    // against. `p := ou.get-or(p)` reports because `getOrResultType` gives that
    // expression a type and a `match` has none.
    //
    // Not this rule's doing — an `Option(UserId)` slot shows the same silence —
    // and not this PR's to fix. #435 carries it; both lines change when it
    // lands.
    const body = (q: string) => `p := match ${q}.parse("a") with | Some(id) -> id | None -> p`;
    expect(inReducer(IDS, body("UserId"))).toEqual([]);
    expect(inReducer(IDS, body("PostId"))).toEqual([]);
    // The binder itself is typed, which is what scopes the gap to the value
    // position — this half reports today.
    expect(
      inReducer(
        `${IDS}\nslot hit : Bool = false`,
        `match UserId.parse("a") with | Some(id) -> p := id | None -> hit := true`,
      ),
    ).toEqual(["E0201 Expected PostId but got UserId"]);
  });

  it("is checked against a fn's declared return type", () => {
    expect(diagnostics(`${IDS}\nfn mint() -> PostId = UserId.fresh()`)).toEqual([
      "E0201 Expected PostId but got UserId",
    ]);
    expect(diagnostics(`${IDS}\nfn find(t: Text) -> Option(PostId) = UserId.parse(t)`)).toEqual([
      "E0201 Expected Option(PostId) but got Option(UserId)",
    ]);
    expect(diagnostics(`${IDS}\nfn mint() -> PostId = PostId.fresh()`)).toEqual([]);
  });

  it("reaches the comparison operators, which is the #347 path", () => {
    // A comparison has no destination, so this is the identity read
    // symmetrically — and it is the shape a lookup or a router is written in.
    expect(
      inReducer(`${IDS}\nslot n : Int = 0`, `n := if p == UserId.fresh() then 1 else 2`),
    ).toEqual(['E0201 Operator "==" cannot compare PostId with UserId']);
    expect(
      inReducer(`${IDS}\nslot n : Int = 0`, `n := if p == PostId.fresh() then 1 else 2`),
    ).toEqual([]);
  });
});

describe("a qualifier that names no type infers nothing", () => {
  it("reports the undefined type once and nothing about the value", () => {
    // E0117 owns this report (#276), and answering `null` is what keeps
    // `qualifiedType` honest rather than what keeps the count at one: `relate`
    // short-circuits on a `TypeRef` it cannot unalias, so an inferred reference
    // to a name with no definition would add nothing either way. The guard that
    // does carry weight is the arity one, below.
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

  it("known gap: a constructor that still wants its arguments reports nothing at all", () => {
    // `Box` names a type but `Box` alone is not one, so there is no type to
    // answer with — an unapplied `TypeRef` would unalias into an unsubstituted
    // body and mismatch against every real type, which is the half of
    // `qualifiedType`'s guard that carries weight.
    //
    // The empty list is the pre-existing state, not a correct answer: E0117
    // declines (the name *is* a type's), E0116 declines (the callee resolves),
    // and E0201 declines (nothing to compare), so a uuid string lands in an
    // `Int` slot unremarked. #432 is the report that does not exist yet; these
    // two flip to it when it does.
    expect(diagnostics(`type Box(T) = nominal List(T)\nslot n : Int = Box.fresh()`)).toEqual([]);
    expect(diagnostics(`slot l : List(Int) = List.fresh()`)).toEqual([]);
  });
});
