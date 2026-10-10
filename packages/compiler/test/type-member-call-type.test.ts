import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, summariesOf } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const diagnostics = (src: string) => summariesOf(withButtonApp(src));

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
    expect(inReducer(src, `h := Deep.fresh()`)).toEqual([]);
    expect(inReducer(src, `d := Handle.fresh()`)).toEqual(["E0201 Expected Deep but got Handle"]);
  });
});

describe("fresh on a type a uuid Text is not", () => {
  const E0802 = (t: string) =>
    `E0802 "${t}" is not a Text, and fresh mints a uuid Text — declare the id nominal Text`;

  it("reports a nominal declared over Int", () => {
    const src = `type TaskId = nominal Int\nslot t : TaskId = 1`;
    expect(inReducer(src, `t := TaskId.fresh()`)).toEqual([E0802("TaskId")]);
    const cents = `type Cents = nominal Int where positive\nslot c : Cents = 1`;
    expect(inReducer(cents, `c := Cents.fresh()`)).toEqual([E0802("Cents")]);
  });

  it("reports a primitive other than Text, whatever the value lands in", () => {
    expect(diagnostics(`slot s : Text = Int.fresh()`)).toEqual([E0802("Int")]);
    expect(diagnostics(`slot n : Int = Int.fresh()`)).toEqual([E0802("Int")]);
    expect(diagnostics(`slot b : Bool = Bool.fresh()`)).toEqual([E0802("Bool")]);
  });

  it("reports a record or a union", () => {
    expect(diagnostics(`type Point = {x: Int, y: Int}\nslot s : Text = Point.fresh()`)).toEqual([
      E0802("Point"),
    ]);
    expect(diagnostics(`type S = Idle | Busy\nslot s : Text = S.fresh()`)).toEqual([E0802("S")]);
  });

  it("still answers Text itself, which is the one primitive the lowering does produce", () => {
    expect(diagnostics(`slot s : Text = Text.fresh()`)).toEqual([]);
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

describe("a parse whose qualifier has no reading of a text", () => {
  const E = (qualifier: string) =>
    `E0802 "${qualifier}" has no reading of a text — parse into Int, Float, Time, Bool, Text or Bytes and build it in a fn`;

  it("reports a record, a union and the primitives no text spells", () => {
    expect(diagnostics(`type Point = {x: Int}\nslot o : Option(Point) = Point.parse("a")`)).toEqual(
      [E("Point")],
    );
    expect(diagnostics(`type Tone = Hi | Lo\nslot o : Option(Tone) = Tone.parse("Hi")`)).toEqual([
      E("Tone"),
    ]);
    expect(diagnostics(`slot o : Option(File) = File.parse("a")`)).toEqual([E("File")]);
    expect(diagnostics(`slot o : Option(EffectId) = EffectId.parse("a")`)).toEqual([E("EffectId")]);
    expect(diagnostics(`slot o : Option(Unit) = Unit.parse("a")`)).toEqual([E("Unit")]);
  });

  it("reports a nominal over one of them, because the base is what decides", () => {
    expect(
      diagnostics(`type Doc = nominal {x: Int}\nslot o : Option(Doc) = Doc.parse("a")`),
    ).toEqual([E("Doc")]);
  });

  const PARSE_BASE =
    " and whose base has a reading of a text (Int, Float, Time, Bool, Text or Bytes)";
  it("reports a type constructor written without its arguments", () => {
    const E0124 = (q: string, args: string) =>
      `E0124 Type "${q}" takes ${args}, so it is not a type on its own — "${q}.parse" needs one that takes none${PARSE_BASE}`;
    const wanted: Record<string, string> = {
      List: "1 type argument",
      Option: "1 type argument",
      Map: "2 type arguments",
      Result: "2 type arguments",
      Set: "1 type argument",
      Tuple: "type arguments",
    };
    for (const [q, args] of Object.entries(wanted)) {
      expect(inReducer(`slot o : Option(Int) = None`, `o := ${q}.parse("x")`), q).toEqual([
        E0124(q, args),
      ]);
    }
    expect(
      inReducer(`type Box(T) = {v: T}\nslot o : Option(Int) = None`, `o := Box.parse("x")`),
    ).toEqual([E0124("Box", "1 type argument")]);
  });

  it("accepts every base that has a reading, directly and through a nominal", () => {
    expect(diagnostics(`slot o : Option(Bool) = Bool.parse("true")`)).toEqual([]);
    expect(
      diagnostics(`type Cents = nominal Int where positive
type Ratio = nominal Float
type Due = nominal Time
type Flag = nominal Bool
type Blob = nominal Bytes
type Count = Int
type Tally = nominal Cents
slot c : Option(Cents) = Cents.parse("12")
slot r : Option(Ratio) = Ratio.parse("0.5")
slot d : Option(Due) = Due.parse("2026-01-01")
slot f : Option(Flag) = Flag.parse("true")
slot b : Option(Blob) = Blob.parse("x")
slot n : Option(Count) = Count.parse("3")
slot t : Option(Tally) = Tally.parse("4")`),
    ).toEqual([]);
  });

  it("leaves an undefined qualifier to E0117 alone", () => {
    expect(diagnostics(`slot o : Option(Int) = Nope.parse("1")`)).toEqual([
      'E0117 Reference to undefined type "Nope"',
    ]);
  });

  it("adds nothing to an alias that resolves to nothing", () => {
    expect(
      diagnostics(`type Foo = Bar\nslot o : Option(Int) = None
reducer r on=ui.click(B) do= o := Foo.parse("1")`),
    ).toEqual(['E0117 Reference to undefined type "Bar"']);
    const cyclic = diagnostics(`type P = Q\ntype Q = P\nslot o : Option(Int) = None
reducer r on=ui.click(B) do= o := P.parse("1")`);
    expect(cyclic.some((d) => d.startsWith("E0009"))).toBe(true);
    expect(cyclic.filter((d) => d.startsWith("E0802"))).toEqual([]);
  });
});

describe("the text a parse reads", () => {
  it("is checked to be a Text", () => {
    expect(inReducer(`slot o : Option(Int) = None`, `o := Int.parse(true)`)).toEqual([
      "E0201 Expected Text but got Bool",
    ]);
    expect(
      inReducer(`type Flag = nominal Bool\nslot o : Option(Flag) = None`, `o := Flag.parse(1)`),
    ).toEqual(["E0201 Expected Text but got Int"]);
    expect(inReducer(`slot o : Option(Int) = None`, `o := Int.parse("1")`)).toEqual([]);
  });
});

describe("a parse that checks clean compiles", () => {
  const DEFS = `type Point = {x: Int}
type Tone = Hi | Lo
type Box(T) = {v: T}
type Cents = nominal Int where positive
type Slug = nominal Text
type Doc = nominal {x: Int}
type Count = Int
type Tally = nominal Cents`;
  const QUALIFIERS = [
    "Int",
    "Float",
    "Time",
    "Bool",
    "Text",
    "Bytes",
    "Unit",
    "File",
    "EffectId",
    "Duration",
    "List",
    "Option",
    "Map",
    "Result",
    "Set",
    "Tuple",
    "Point",
    "Tone",
    "Box",
    "Cents",
    "Slug",
    "Doc",
    "Count",
    "Tally",
  ];

  it("builds every qualifier check accepts", () => {
    let clean = 0;
    for (const q of QUALIFIERS) {
      const src = withButtonApp(
        `${DEFS}\nslot o : Text = ""\nreducer r on=ui.click(B) do= o := ${q}.parse("x").show`,
      );
      if (checkSource(src).some((e) => e.severity !== "warning")) continue;
      clean += 1;
      expect(compile(src, { runtimeSpecifier: "./runtime.js" }).kind, q).toBe("ok");
    }
    // The readings plus Duration and the definitions over them.
    expect(clean).toBe(11);
  });
});

describe("the qualifiers that keep their own answers", () => {
  it("leaves Duration's constructors as they were", () => {
    expect(diagnostics(`slot d : Duration = Duration.ms(500)`)).toEqual([]);
  });

  it("leaves Bytes as it was", () => {
    expect(diagnostics(`slot b : Bytes = Bytes.from-text("x")`)).toEqual([]);
  });

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

describe("where the minted type is read", () => {
  it("carries through a let binder", () => {
    expect(inReducer(IDS, `let id = UserId.fresh(); p := id`)).toEqual([
      "E0201 Expected PostId but got UserId",
    ]);
    expect(inReducer(IDS, `let id = PostId.fresh(); p := id`)).toEqual([]);
  });

  it("carries through a match arm to the destination", () => {
    const body = (q: string) => `p := match ${q}.parse("a") with | Some(id) -> id | None -> p`;
    expect(inReducer(IDS, body("UserId"))).toEqual(["E0201 Expected PostId but got UserId"]);
    expect(inReducer(IDS, body("PostId"))).toEqual([]);
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

  it("reaches the comparison operators", () => {
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
    expect(inReducer(IDS, `p := Nope.fresh()`)).toEqual([
      'E0117 Reference to undefined type "Nope"',
    ]);
    expect(diagnostics(`${IDS}\nslot o : Option(PostId) = Nope.parse("a")`)).toEqual([
      'E0117 Reference to undefined type "Nope"',
    ]);
  });

  it("reads the qualifier by the one spelling rule the lowering does", () => {
    expect(inReducer(IDS, `p := Post-Id.fresh()`)).toEqual([
      'E0116 Call to undefined function "Post-Id.fresh"',
    ]);
  });
});

describe("a qualifier that is a type constructor, not a type", () => {
  const E = (name: string, args: string, callee: string) =>
    `E0124 Type "${name}" takes ${args}, so it is not a type on its own — "${callee}" needs one that takes none`;

  const FRESH = " and that a Text goes into";

  it("reports a declared constructor at the call", () => {
    expect(diagnostics(`type Box(T) = nominal List(T)\nslot n : Int = Box.fresh()`)).toEqual([
      `${E("Box", "1 type argument", "Box.fresh")}${FRESH}`,
    ]);
  });

  it("reports the built-in constructors, for every type member", () => {
    expect(diagnostics(`slot l : List(Int) = List.fresh()`)).toEqual([
      `${E("List", "1 type argument", "List.fresh")}${FRESH}`,
    ]);
    expect(diagnostics(`slot o : Option(Map(Text, Int)) = Map.parse("a")`)).toEqual([
      `${E("Map", "2 type arguments", "Map.parse")} and whose base has a reading of a text (Int, Float, Time, Bool, Text or Bytes)`,
    ]);
    expect(diagnostics(`slot s : Text = Option.show(None)`)).toEqual([
      E("Option", "1 type argument", "Option.show"),
    ]);
  });

  it("reports Tuple, whose variadic arity is still not zero", () => {
    expect(diagnostics(`slot t : Text = Tuple.fresh()`)).toEqual([
      `${E("Tuple", "type arguments", "Tuple.fresh")}${FRESH}`,
    ]);
  });

  it("answers exactly as any other type for a qualifier that applies the constructor", () => {
    expect(
      diagnostics(
        `type Box(T) = nominal List(T)\ntype IntBox = Box(Int)\nslot n : Int = IntBox.fresh()`,
      ),
    ).toEqual([
      `E0802 "IntBox" is not a Text, and fresh mints a uuid Text — declare the id nominal Text`,
    ]);
    expect(diagnostics(`${IDS}\nslot o : Option(PostId) = UserId.parse("a")`)).toEqual([
      "E0201 Expected Option(PostId) but got Option(UserId)",
    ]);
  });
});
