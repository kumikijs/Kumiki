import { describe, expect, it } from "vitest";
import { pointedErrorsOf } from "./helpers/diagnostics.ts";

const SLOTS = `type Kind = Ka | Kb
slot cfg : {ms: Int, label: Text} = {ms: 5, label: "x"}
slot key : Text = "ms"
fn five() = 5
fn soon() = "soon"`;

const program = (defs: string, http = ""): string => `${SLOTS}
${defs}
tile B = button(text="x")
tile Home = column(B)
app R
    caps   = []${http ? `\n    http   = {${http}}` : ""}
    routes = {"/" -> Home, "/404" -> Home}
    init   = []`;

const reported = (src: string): string[] =>
  pointedErrorsOf(src).map((d) => `${d.code} ${d.message} @ ${d.text}`);

/** As `reported`, with the text cut to `value` when the diagnostic starts at it. */
const reportedAt = (src: string, value: string): string[] =>
  pointedErrorsOf(src).map(
    (d) => `${d.code} ${d.message} @ ${d.text.startsWith(value) ? value : d.text}`,
  );

/** A value of `ty` that every position below starts from. */
const ZERO: Record<string, string> = { Int: "0", Text: `""` };

/**
 * Each typed position, as a program that writes `value` where a `ty` is
 * declared. `noSlotReads` marks the one position that may not read a slot — a
 * slot's initial value (E0304) — which a value that reads one skips.
 */
const POSITIONS: {
  name: string;
  build: (value: string, ty: "Int" | "Text") => string;
  noSlotReads?: true;
}[] = [
  {
    name: "a slot's initial value",
    build: (v, ty) => program(`slot probe : ${ty} = ${v}`),
    noSlotReads: true,
  },
  {
    name: "an assignment",
    build: (v, ty) =>
      program(`slot probe : ${ty} = ${ZERO[ty]}\nreducer act on=ui.click(B) do= probe := ${v}`),
  },
  {
    name: "a record field",
    build: (v, ty) =>
      program(
        `slot probe : {v: ${ty}} = {v: ${ZERO[ty]}}\nreducer act on=ui.click(B) do= probe := {v: ${v}}`,
      ),
  },
  {
    name: "a fn argument",
    build: (v, ty) =>
      program(
        `fn take(x: ${ty}) -> ${ty} = x\nslot probe : ${ty} = ${ZERO[ty]}\nreducer act on=ui.click(B) do= probe := take(${v})`,
      ),
  },
  {
    name: "app.http (timeout is an Int, base-url a Text)",
    build: (v, ty) => program("", ty === "Int" ? `timeout: ${v}` : `base-url: ${v}`),
  },
];

const other = (ty: "Int" | "Text"): "Int" | "Text" => (ty === "Int" ? "Text" : "Int");

describe("a value whose type is known is held to the declared type in every typed position", () => {
  // [the value, the type it has, whether it reads a slot]
  const shapes: [string, "Int" | "Text", boolean][] = [
    ["five()", "Int", false],
    ["soon()", "Text", false],
    [`cfg["ms"]`, "Int", true],
    [`cfg["label"]`, "Text", true],
  ];
  for (const pos of POSITIONS) {
    for (const [value, has, reads] of shapes) {
      if (reads && pos.noSlotReads) continue;
      it(`${value} in ${pos.name}: accepted as ${has}, E0201 at the value as ${other(has)}`, () => {
        expect(reported(pos.build(value, has))).toEqual([]);
        expect(reportedAt(pos.build(value, other(has)), value)).toEqual([
          `E0201 Expected ${other(has)} but got ${has} @ ${value}`,
        ]);
      });
    }
  }
});

describe("a call to a fn with no -> has its body's type", () => {
  it("through a chain of fns that each leave out ->", () => {
    const defs = `fn outer() = middle()\nfn middle() = inner()\nfn inner() = "x"`;
    expect(reported(program(`${defs}\nslot probe : Text = outer()`))).toEqual([]);
    expect(reported(program(`${defs}\nslot probe : Int = outer()`))).toEqual([
      "E0201 Expected Int but got Text @ outer()",
    ]);
  });

  it("whatever its parameters are, since the body is read with each one's declared type", () => {
    const defs = `fn label(n: Int, unit: Text) = n.show + unit`;
    expect(reported(program(`${defs}\nslot probe : Int = label(3, "px")`))).toEqual([
      'E0201 Expected Int but got Text @ label(3, "px")',
    ]);
  });

  it("as a record, so a field read off the call has that field's type", () => {
    const defs = `fn pair() = {count: 1, name: "a"}`;
    expect(reported(program(`${defs}\nslot probe : Text = pair().name`))).toEqual([]);
    expect(reported(program(`${defs}\nslot probe : Int = pair().name`))).toEqual([
      "E0201 Expected Int but got Text @ pair().name",
    ]);
  });

  it("as an operand, so an operator that needs a number reports a Text result", () => {
    expect(reported(program(`slot probe : Int = soon() - 1`))).toEqual([
      'E0201 Operator "-" expects a number but got Text @ soon() - 1',
    ]);
  });

  it("as a receiver, so a fragment over its List binds the element's type", () => {
    const defs = `fn loud(t: Text) -> Text = t\nfn digits(n: Int) = [n, n + 1]`;
    expect(reported(program(`${defs}\nslot probe : List(Text) = digits(1).map(loud($1))`))).toEqual(
      ["E0201 Expected Text but got Int @ $1))"],
    );
  });

  it("an Int body into a Float and into a nominal Int, which both take an Int", () => {
    expect(reported(program(`slot probe : Float = five()`))).toEqual([]);
    expect(reported(program(`type Cents = nominal Int\nslot probe : Cents = five()`))).toEqual([]);
  });
});

describe("a call to a fn with no -> stays unchecked where its body's type cannot be known", () => {
  // Each row is wrong where it lands, and is paired with a twin whose fns declare their results:
  // the twin is E0201 at the same call, so what the row shows missing is the type, not the check.
  const e0201s = (src: string): string[] =>
    pointedErrorsOf(src)
      .filter((d) => d.code === "E0201")
      .map((d) => `${d.message} @ ${d.text}`);
  const codes = (src: string): string[] => pointedErrorsOf(src).map((d) => d.code);
  const LOOP = `fn a(n: Int) = w(n) + 1
fn w(n: Int) = g(n)
fn g(n: Int) = p(n) - q(n)
fn p(n: Int) = g(n) - 1`;

  // [what, the fns, their twin with ->, the call read into a Text, its type in the twin, a loop]
  it.each([
    [
      "a fn that calls itself",
      "fn countdown(n: Int) = if n == 0 then 0 else countdown(n - 1) - 1",
      "fn countdown(n: Int) -> Int = if n == 0 then 0 else countdown(n - 1) - 1",
      "countdown(3)",
      "Int",
      true,
    ],
    [
      "the first of two fns that call each other",
      "fn ping(n: Int) = pong(n) - 1\nfn pong(n: Int) = ping(n) - 1",
      "fn ping(n: Int) -> Int = pong(n) - 1\nfn pong(n: Int) -> Int = ping(n) - 1",
      "ping(1)",
      "Int",
      true,
    ],
    [
      "the second of two fns that call each other",
      "fn ping(n: Int) = pong(n) - 1\nfn pong(n: Int) = ping(n) - 1",
      "fn ping(n: Int) -> Int = pong(n) - 1\nfn pong(n: Int) -> Int = ping(n) - 1",
      "pong(1)",
      "Int",
      true,
    ],
    [
      "a fn on a loop through an operand the checker answers without reading",
      "fn f(n: Int) = f(n) == 1",
      "fn f(n: Int) -> Bool = f(n) == 1",
      "f(1)",
      "Bool",
      true,
    ],
    [
      "a fn on a loop that a fn off it reaches first",
      `${LOOP}\nfn q(n: Int) = p(n) - 1`,
      `${LOOP}\nfn q(n: Int) -> Int = p(n) - 1`,
      "q(1)",
      "Int",
      true,
    ],
    [
      "a fn on a loop that no fn off it reaches",
      `${LOOP.slice(LOOP.indexOf("\n") + 1)}\nfn q(n: Int) = p(n) - 1`,
      `${LOOP.slice(LOOP.indexOf("\n") + 1)}\nfn q(n: Int) -> Int = p(n) - 1`,
      "q(1)",
      "Int",
      true,
    ],
    [
      "a fn on a loop that another fn on it declares ->",
      "fn a(n: Int) -> Int = b(n)\nfn b(n: Int) = a(n) - 1",
      "fn a(n: Int) -> Int = b(n)\nfn b(n: Int) -> Int = a(n) - 1",
      "b(1)",
      "Int",
      true,
    ],
    [
      "a fn that calls one on a loop, though it is not on the loop",
      "fn spin(n: Int) = spin(n) - 1\nfn viaSpin() = spin(3)",
      "fn spin(n: Int) -> Int = spin(n) - 1\nfn viaSpin() = spin(3)",
      "viaSpin()",
      "Int",
      true,
    ],
    [
      "a body that is a fragment's result",
      "fn bumped(xs: List(Int)) = xs.map($1 + 1)",
      "fn bumped(xs: List(Int)) -> List(Int) = xs.map($1 + 1)",
      "bumped([1])",
      "List(Int)",
      false,
    ],
    [
      "a body that is {}",
      "fn blank() = {}",
      "fn blank() -> Map(Text, Int) = {}",
      "blank()",
      "Map(Text, Int)",
      false,
    ],
  ] as [
    string,
    string,
    string,
    string,
    string,
    boolean,
  ][])("%s", (_what, defs, twin, call, twinType, loop) => {
    const src = program(`${defs}\nslot probe : Text = ${call}`);
    const twinSrc = program(`${twin}\nslot probe : Text = ${call}`);
    expect(e0201s(src)).toEqual([]);
    expect(e0201s(twinSrc)).toEqual([`Expected Text but got ${twinType} @ ${call}`]);
    expect(codes(src).includes("E0006")).toBe(loop);
  });

  it("a fn that calls one on a loop keeps its own type, though a slot asks it before any fn is checked", () => {
    // `outer` is on no loop, and `spin(3) - 1` is an Int whatever `spin` answers.
    const src = program(
      `slot probe : Text = outer()\nfn outer() = spin(3) - 1\nfn spin(n: Int) = spin(n) - 1`,
    );
    expect(e0201s(src)).toEqual(["Expected Text but got Int @ outer()"]);
    expect(codes(src)).toContain("E0006");
  });
});

describe("a call to a fn whose body is a literal has the literal's own type", () => {
  // Written inline, a literal takes its shape from the position; through a fn it arrives with the
  // type its body has, so a Set position no longer makes it a Set.
  const FNS = `fn ids() = [1, 2]\nfn empty() = []\nfn none() = None\nfn fail() = Err("x")`;

  it.each([
    ["List(Int)", "empty()"],
    ["Option(Int)", "none()"],
    ["Result(Int, Text)", "fail()"],
    ["List(Int)", "ids()"],
  ])("accepted as %s: %s", (ty, call) => {
    expect(reported(program(`${FNS}\nslot probe : ${ty} = ${call}`))).toEqual([]);
  });

  it.each([
    ["Set(Int)", "ids()", "List(Int)"],
    ["Set(Int)", "empty()", "List(?)"],
    ["Text", "none()", "Option(?)"],
  ])("refused as %s: %s, which is a %s", (ty, call, has) => {
    expect(reported(program(`${FNS}\nslot probe : ${ty} = ${call}`))).toEqual([
      `E0201 Expected ${ty} but got ${has} @ ${call}`,
    ]);
  });
});

describe("a record read through a literal key has that field's type", () => {
  it("in a fn body against its ->", () => {
    const rec = `c: {ms: Int, label: Text}`;
    expect(reported(program(`fn f(${rec}) -> Int = c["ms"]`))).toEqual([]);
    expect(reported(program(`fn f(${rec}) -> Int = c["label"]`))).toEqual([
      'E0201 Expected Int but got Text @ c["label"]',
    ]);
  });

  it("a key that is not a literal names no one field, so nothing is checked against it", () => {
    // No field of `cfg` is a Bool, so any type read off `cfg[key]` would be reported.
    const read = (key: string) =>
      program(`slot probe : Bool = false\nreducer act on=ui.click(B) do= probe := cfg[${key}]`);
    expect(reported(read("key"))).toEqual([]);
    expect(reported(read(`"label"`))).toEqual(['E0201 Expected Bool but got Text @ cfg["label"]']);
  });
});

describe("{} is an empty Map, Set or record, and is reported where none of those is declared", () => {
  const MESSAGE = (ty: string) => `E0201 Expected ${ty} but got {}, an empty Map, Set or record`;

  for (const pos of POSITIONS) {
    for (const ty of ["Int", "Text"] as const) {
      it(`in ${pos.name} declared ${ty}`, () => {
        expect(reportedAt(pos.build("{}", ty), "{}")).toEqual([`${MESSAGE(ty)} @ {}`]);
      });
    }
  }

  it.each([
    "List(Int)",
    "Option(Int)",
    "Option(Map(Text, Int))",
    "Result(Int, Text)",
    "Tuple(Int, Int)",
    "Kind",
    "Bool",
    "Unit",
    "Float",
    "Time",
    "Bytes",
    "File",
    "Url",
  ])("declared %s", (ty) => {
    expect(reported(program(`slot probe : ${ty} = {}`))).toEqual([`${MESSAGE(ty)} @ {}`]);
  });

  it("at the {} itself, inside a branch, an item or a value the declared type reaches", () => {
    expect(reported(program(`slot probe : Int = if true then 1 else {}`))).toEqual([
      `${MESSAGE("Int")} @ {}`,
    ]);
    expect(reported(program(`slot probe : List(Int) = [1, {}]`))).toEqual([
      `${MESSAGE("Int")} @ {}]`,
    ]);
    expect(reported(program(`slot probe : Map(Text, Int) = {"a": {}}`))).toEqual([
      `${MESSAGE("Int")} @ {}}`,
    ]);
    expect(reported(program(`fn f() -> Text = {}`))).toEqual([`${MESSAGE("Text")} @ {}`]);
  });

  it("under emit's own code at an emit argument", () => {
    const src = program(
      `effect save cap=storage.write in=Text out=Unit map-request={key: "k", value: $1}
reducer act on=ui.click(B) do= emit save({})`,
    ).replace("caps   = []", "caps   = [storage.write]");
    expect(reported(src)).toEqual([
      "E0202 Expected Text but got {}, an empty Map, Set or record @ {})",
    ]);
  });

  it.each([
    "Map(Text, Int)",
    "Set(Int)",
    "List(Map(Text, Int))",
  ])("is accepted declared %s, where {} or an item of it is one of the three", (ty) => {
    const value = ty.startsWith("List") ? "[{}]" : "{}";
    expect(reported(program(`slot probe : ${ty} = ${value}`))).toEqual([]);
  });

  it.each([
    ["{a: Int}", ['field "a" of type Int']],
    ["{a: Option(Int)}", ['field "a" of type Option(Int)']],
    ["{ms: Int, label: Text}", ['field "ms" of type Int', 'field "label" of type Text']],
  ])("declared the record %s, is a record literal missing every field", (ty, missing) => {
    expect(reported(program(`slot probe : ${ty} = {}`))).toEqual(
      missing.map((m) => `E0214 Record literal is missing field ${m.slice(6)} @ {}`),
    );
  });

  it("is a record literal missing every field at an emit argument, except those the effect lets go", () => {
    const effect = program(
      `effect save cap=storage.write in={key: Text, value: Text} out=Unit map-request=$1
reducer act on=ui.click(B) do= emit save({})`,
    ).replace("caps   = []", "caps   = [storage.write]");
    expect(reported(effect)).toEqual([
      'E0214 Record literal is missing field "key" of type Text @ {})',
      'E0214 Record literal is missing field "value" of type Text @ {})',
    ]);
    // `duration` is an Option, which a standard effect's argument may leave out.
    const toast = program(`reducer act on=ui.click(B) do= emit toast({})`).replace(
      "caps   = []",
      "caps   = [notification.show]",
    );
    expect(reported(toast)).toEqual([
      'E0214 Record literal is missing field "kind" of type Text @ {})',
      'E0214 Record literal is missing field "text" of type Text @ {})',
    ]);
  });

  it("is accepted against a type the checker cannot read, which it does not speak for", () => {
    // `Mapp` names no type: E0117 reports the name, and the value is not
    // blamed for a type that has no shape.
    expect(
      pointedErrorsOf(program(`slot probe : Mapp(Text, Int) = {}`)).map((d) => d.code),
    ).toEqual(["E0117"]);
  });
});
