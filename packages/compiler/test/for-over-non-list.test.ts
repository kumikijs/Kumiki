import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const DECLS = `type Item  = {name: Text, tags: List(Text)}
type State = {items: List(Item)}
type Shape = Circle | Square
type Box   = Option(List(Int))
type Rows  = List(Int)
type Ids   = nominal List(Int)
type Name  = nominal Text
type Pairs(T) = List(Tuple(T, T))
slot xs     : List(Text)              = ["a"]
slot rows   : Rows                    = [1]
slot ids    : Ids                     = [2]
slot pairs  : Pairs(Int)              = [(1, 2)]
slot m      : Map(Text, Int)          = {"k": 1}
slot ml     : Map(Text, List(Int))    = {"k": [1]}
slot st     : Set(Text)               = ["s"]
slot state  : State                   = {items: [{name: "n", tags: ["t"]}]}
slot loaded : Option(List(Text))      = Some(["a"])
slot res    : Result(List(Int), Text) = Ok([1])
slot o      : Option(Int)             = Some(1)
slot ri     : Result(Int, Text)       = Ok(1)
slot t      : Text                    = "a,b"
slot i      : Int                     = 3
slot b      : Bool                    = true
slot f      : Float                   = 1.5
slot rec    : {a: Int}                = {a: 1}
slot sh     : Shape                   = Circle
slot tp     : Tuple(Int, Text)        = (1, "a")
slot bx     : Box                     = None
slot lr     : Option(Rows)            = None
slot nm     : Name                    = "n"
fn rowsOf(ys: List(Text)) -> List(Text) = ys
fn pick() -> Option(List(Int)) = None
fn one(a: Int) -> Int = a
`;

const FORMS = {
  tile: (target: string) =>
    withApp(`${DECLS}
tile App = column(for x in ${target} text("row"))`),
  reducer: (target: string) =>
    withApp(`${DECLS}
slot n : Int = 0
reducer tally on=ui.click(Tally) do=
    for x in ${target} { n := n + 1 }
tile Tally = button(text="tally")
tile App = column(Tally)`),
} as const;

const FORM_NAMES = Object.keys(FORMS) as (keyof typeof FORMS)[];

const diagnose = (src: string) => checkSource(src);

const HEAD = '"for" iterates a List, but this is';

function checkAndBuild(src: string): { checked: string[]; built: string[] } {
  const checked = checkSource(src).map((e) => `${e.code} ${e.message}`);
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  const built = r.kind === "fail" ? r.errors.map((e) => `${e.code} ${e.message}`) : [];
  return { checked, built };
}

/** Every decided type that is not a List, and what E0218 says about it. */
const NOT_A_LIST: [target: string, message: string][] = [
  ["loaded", `${HEAD} Option(List(Text)) — iterate its .get-or([]), or match on Some / None`],
  ["res", `${HEAD} Result(List(Int), Text) — iterate its .get-or([]), or match on Ok / Err`],
  ["bx", `${HEAD} Box — iterate its .get-or([]), or match on Some / None`],
  ["lr", `${HEAD} Option(Rows) — iterate its .get-or([]), or match on Some / None`],
  ["pick()", `${HEAD} Option(List(Int)) — iterate its .get-or([]), or match on Some / None`],
  ["o", `${HEAD} Option(Int) — match on Some / None to take out its value`],
  ["xs.head", `${HEAD} Option(Text) — match on Some / None to take out its value`],
  ["ri", `${HEAD} Result(Int, Text) — match on Ok / Err to take out its value`],
  ["t", `${HEAD} Text — .split(sep) breaks it into a List(Text)`],
  ["nm", `${HEAD} Name — .split(sep) breaks it into a List(Text)`],
  ["i", `${HEAD} Int`],
  ["xs.length", `${HEAD} Int`],
  ["b", `${HEAD} Bool`],
  ["f", `${HEAD} Float`],
  ["rec", `${HEAD} {a: Int}`],
  ["sh", `${HEAD} Shape`],
  ["tp", `${HEAD} Tuple(Int, Text)`],
  ["m", `${HEAD} a Map — iterate its .keys (or .values, which binds the value)`],
  ["st", `${HEAD} a Set — iterate its .to-list`],
];

describe("a for over a decided type that is not a List is E0218", () => {
  for (const form of FORM_NAMES) {
    it.each(NOT_A_LIST)(`${form} form: for x in %s`, (target, message) => {
      const diags = diagnose(FORMS[form](target));
      expect(diags.map((d) => [d.code, d.kind, d.message])).toEqual([
        ["E0218", "for-over-non-list", message],
      ]);
    });
  }

  it("points at the iterated expression", () => {
    const src = FORMS.tile("loaded");
    const line = src.split("\n").findIndex((l) => l.startsWith("tile App")) + 1;
    const [d] = diagnose(src);
    expect(d?.pos).toEqual({ line, col: "tile App = column(for x in ".length + 1 });
  });
});

describe("the accessor kumiki fix appends", () => {
  // Only a Map's `.keys` and a Set's `.to-list` repair the target by themselves.
  it.each([
    ["m", "keys"],
    ["st", "to-list"],
  ])("for x in %s carries %s", (target, accessor) => {
    for (const form of FORM_NAMES) {
      expect(diagnose(FORMS[form](target)).map((d) => d.accessor)).toEqual([accessor]);
    }
  });

  it.each(["loaded", "res", "t", "i", "rec"])("for x in %s carries none", (target) => {
    for (const form of FORM_NAMES) {
      const diags = diagnose(FORMS[form](target));
      expect(diags.map((d) => d.code)).toEqual(["E0218"]);
      expect(diags[0]).not.toHaveProperty("accessor");
    }
  });
});

describe("a for over a List is accepted", () => {
  const LISTS = [
    "xs",
    '["p", "q"]',
    "m.keys",
    "m.values",
    "m.entries",
    "st.to-list",
    "rowsOf(xs)",
    "rows.filter($1 > 0).map($1 * 2)",
    "rows.chunk(1)",
    "rows.zip(rows)",
    "state.items",
    "rows",
    "ids",
    "pairs",
    "loaded.get-or([])",
    "res.get-or([])",
    "o.to-list",
    't.split(",")',
    'ml.get-or("k", [])',
  ];

  for (const form of FORM_NAMES) {
    it.each(LISTS)(`${form} form: for x in %s`, (target) => {
      expect(diagnose(FORMS[form](target))).toEqual([]);
    });
  }

  it("takes a tile's $1 declared in=List(X), and a for over the loop variable's List field", () => {
    const src = withApp(`${DECLS}
tile Each in=List(Item) = column(for it in $1 column(for tg in it.tags text(tg)))
tile App = column(Each(state.items))`);
    expect(diagnose(src)).toEqual([]);
  });

  it("takes the List a match arm binds, in a tile and in a reducer", () => {
    const src = withApp(`${DECLS}
slot n : Int = 0
reducer tally on=ui.click(Tally) do=
    match loaded with
      | Some(ys) -> for y in ys { n := n + 1 }
      | None -> n := 0
tile Tally = button(text="tally")
tile App = column(
  Tally,
  match loaded with
    | Some(ys) -> column(for y in ys text(y))
    | None -> text("none"))`);
    expect(diagnose(src)).toEqual([]);
  });

  it("takes a List a reducer's let binds, and a nested for over a field of the loop variable", () => {
    const src = withApp(`${DECLS}
slot n : Int = 0
reducer tally on=ui.click(Tally) do=
    let zs = xs.filter($1 != "")
    for z in zs { n := n + 1 }
reducer tags on=ui.click(Tally) do=
    for it in state.items { for tg in it.tags { n := n + 1 } }
tile Tally = button(text="tally")
tile App = column(Tally)`);
    expect(diagnose(src)).toEqual([]);
  });
});

describe("a target E0218 cannot judge is not reported", () => {
  // `null` from the inferencer means "cannot tell", never "not a List".
  for (const form of FORM_NAMES) {
    it(`${form} form: a fn result with no -> is undecided`, () => {
      const src = FORMS[form]("untyped(rows)").replace(
        "fn one(",
        "fn untyped(ys: List(Int)) = ys.head\nfn one(",
      );
      expect(diagnose(src)).toEqual([]);
    });

    it(`${form} form: a type that names nothing is undecided, and E0117 says why`, () => {
      const src = FORMS[form]("q").replace("fn one(", "slot q : Lst(Int) = []\nfn one(");
      expect(diagnose(src).map((d) => d.code)).not.toContain("E0218");
    });

    it(`${form} form: a call with the wrong arity is E0213 alone`, () => {
      expect(diagnose(FORMS[form]("one(1, 2)")).map((d) => d.code)).toEqual(["E0213"]);
    });

    it(`${form} form: a name that resolves to nothing is E0103 alone`, () => {
      expect(diagnose(FORMS[form]("nope")).map((d) => d.code)).toEqual(["E0103"]);
    });
  }

  it("an untyped reducer payload is undecided", () => {
    expect(diagnose(FORMS.reducer("$event.rows"))).toEqual([]);
  });

  it("a field holding an untyped value is undecided, though its record is not", () => {
    const src = FORMS.reducer("box.rows").replace(
      "    for x in box.rows",
      "    let box = {rows: $event.rows}\n    for x in box.rows",
    );
    expect(diagnose(src)).toEqual([]);
  });
});

describe("a for over an Option(List(T)) it has not unwrapped", () => {
  const REDUCER_FORM = withApp(`slot loaded : Option(List(Text)) = Some(["a", "b"])
slot count  : Int                = 0

reducer tally on=ui.click(Tally)
    do= for x in loaded { count := count + 1 }

tile Tally = button(text="tally") {id: "tally"}
tile App = column(Tally, text("count: " + count.show))`);

  const TILE_FORM = withApp(`slot loaded : Option(List(Text)) = Some(["a", "b"])
tile App = column(for x in loaded text(x))`);

  const OPTION_MESSAGE = `${HEAD} Option(List(Text)) — iterate its .get-or([]), or match on Some / None`;

  it.each([
    ["reducer", REDUCER_FORM],
    ["tile", TILE_FORM],
  ])("%s form: check reports it and build refuses it", (_form, src) => {
    const { checked, built } = checkAndBuild(src);
    expect(checked).toEqual([`E0218 ${OPTION_MESSAGE}`]);
    expect(built).toEqual([`E0218 ${OPTION_MESSAGE}`]);
  });

  it.each([
    ["reducer", REDUCER_FORM],
    ["tile", TILE_FORM],
  ])("%s form: the unwrapped target checks and builds", (_form, src) => {
    const { checked, built } = checkAndBuild(src.replace("in loaded", "in loaded.get-or([])"));
    expect(checked).toEqual([]);
    expect(built).toEqual([]);
  });
});

describe("every decided non-List target in one program is reported, not only the Map", () => {
  const TARGET_DECLS = `slot t   : Text                    = "abc"
slot r   : Result(List(Int), Text) = Ok([1])
slot i   : Int                     = 3
slot m   : Map(Text, Int)          = {}
slot rec : {a: Int}                = {a: 1}
`;
  const TARGETS = ["t", "r", "i", "m", "rec"];

  function expectEachReported(src: string): void {
    const lines = src.split("\n");
    const { checked, built } = checkAndBuild(src);
    expect(checked.map((c) => c.slice(0, 5))).toEqual(TARGETS.map(() => "E0218"));
    expect(built).toEqual(checked);
    const reported = checkSource(src).map((e) => lines[e.pos.line - 1]);
    expect(reported).toEqual(TARGETS.map((x) => expect.stringContaining(`for v in ${x} `)));
  }

  it("reducer form", () => {
    const reducers = TARGETS.map(
      (x, k) => `reducer r${k} on=ui.click(B) do= for v in ${x} { n := n + 1 }`,
    ).join("\n");
    expectEachReported(
      withApp(`${TARGET_DECLS}slot n : Int = 0
${reducers}
tile B = button(text="b") {id: "b"}
tile App = column(B)`),
    );
  });

  it("tile form", () => {
    const loops = TARGETS.map((x) => `for v in ${x} text("${x}")`).join(",\n  ");
    expectEachReported(
      withApp(`${TARGET_DECLS}tile App = column(
  ${loops})`),
    );
  });
});
