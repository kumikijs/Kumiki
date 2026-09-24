import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// A `fn` is not a value in Kumiki — there are no lambdas (language.md §1.9.1)
// — but a `fn` name written without its parentheses was accepted wherever a
// value goes (#390). It lowered to the generated function itself, so
// `emit load(label)` dispatched a *function* where the effect declares
// `in=Text`: a storage key stringified to the function's source, an HTTP body
// serialised to `undefined`, and every tier stayed silent.
//
// The one position that takes a fn name is the fragment argument of a
// higher-order method — `items.map(double)`, §1.8.6 — which is a call the
// method makes, not a value.

type Diagnostic = { code: string; message: string; text: string };

const diagnose = (src: string): Diagnostic[] =>
  check(parse(lex(src)))
    .filter((e) => e.severity !== "warning")
    .map((e) => ({
      code: e.code,
      message: e.message,
      text: (src.split("\n")[e.pos.line - 1] ?? "").slice(e.pos.col - 1),
    }));

const app = (defs: string, init = "", caps = ""): string => `${defs}
tile B = button(text="x")
tile Home = column(B)
app R
    caps   = [${caps}]
    routes = {"/" -> Home, "/404" -> Home}
    init   = [${init}]`;

const LOAD = `fn label() -> Text = "x"
effect load cap=storage.read in=Text out=Result(Text, Text) map-request={key: $1, decode: Decoder.Json(Text)}`;

const lines = (d: Diagnostic[]) => d.map((x) => `${x.code} ${x.message}`);

describe("a fn name in a value position is E0127", () => {
  it("at an emit argument, which is the repro", () => {
    const d = diagnose(
      app(`${LOAD}\nreducer go on=ui.click(B) do= emit load(label)`, "", "storage.read"),
    );
    expect(lines(d)).toEqual([
      'E0127 "label" is a fn, and a fn is not a value — write the call: label()',
    ]);
    expect(d[0]?.text).toMatch(/^label\)$/);
  });

  it("at an app.init argument", () => {
    expect(lines(diagnose(app(LOAD, "load(label)", "storage.read")))).toEqual([
      'E0127 "label" is a fn, and a fn is not a value — write the call: label()',
    ]);
  });

  it("names the parameters the call needs", () => {
    expect(
      lines(
        diagnose(
          app(`fn greet(first: Text, last: Text) -> Text = first + last
slot s : Text = greet`),
        ),
      ),
    ).toEqual([
      'E0127 "greet" is a fn, and a fn is not a value — write the call: greet(first, last)',
    ]);
  });

  it("in a tile, an assignment, and an argument that is not a fragment", () => {
    expect(
      lines(diagnose(app(`fn label() -> Text = "x"\ntile T = text(label)`))).map((l) =>
        l.slice(0, 5),
      ),
    ).toEqual(["E0127"]);
    expect(
      lines(
        diagnose(
          app(
            `fn label() -> Text = "x"\nslot s : Text = ""\nreducer r on=ui.click(B) do= s := label`,
          ),
        ),
      ).map((l) => l.slice(0, 5)),
    ).toEqual(["E0127"]);
    // `push` appends a value; its argument is not a fragment.
    expect(
      lines(
        diagnose(
          app(
            `fn label() -> Text = "x"\nslot xs : List(Text) = []\nreducer r on=ui.click(B) do= xs := xs.push(label)`,
          ),
        ),
      ).map((l) => l.slice(0, 5)),
    ).toEqual(["E0127"]);
  });

  it("inside a fn body, where the name is another fn", () => {
    expect(
      lines(diagnose(app(`fn label() -> Text = "x"\nfn twice() -> Text = label + label`))).map(
        (l) => l.slice(0, 5),
      ),
    ).toEqual(["E0127", "E0127"]);
  });
});

describe("what stays a value or a call", () => {
  it("accepts the call", () => {
    expect(
      diagnose(
        app(
          `${LOAD}\nreducer go on=ui.click(B) do= emit load(label())`,
          "load(label())",
          "storage.read",
        ),
      ),
    ).toEqual([]);
  });

  it("lets a parameter or a let of the same name shadow the fn", () => {
    expect(diagnose(app(`fn label() -> Text = "x"\nfn echo(label: Text) -> Text = label`))).toEqual(
      [],
    );
    expect(
      diagnose(app(`fn label() -> Text = "x"\nslot s : Text = let label = "y" in label`)),
    ).toEqual([]);
  });
});

describe("the fragment argument of a higher-order method takes a fn name (§1.8.6)", () => {
  const FNS = `fn double(n: Int) -> Int = n * 2
fn positive(n: Int) -> Bool = n > 0
fn add(acc: Int, n: Int) -> Int = acc + n
fn triple(a: Int, b: Int, c: Int) -> Int = a + b + c
slot xs : List(Int) = [1, 2, 3]
slot n  : Int       = 0`;

  it("accepts it in each fragment position", () => {
    for (const body of [
      "xs := xs.map(double)",
      "xs := xs.filter(positive)",
      "n := xs.find(positive).get-or(0)",
      "xs := xs.sort-by(double)",
      "n := xs.fold(0, add)",
    ]) {
      expect(diagnose(app(`${FNS}\nreducer r on=ui.click(B) do= ${body}`)), body).toEqual([]);
    }
  });

  it("refuses a fn that takes more than the fragment binds", () => {
    // A list fragment binds `$1` and `$2`; nothing supplies a third.
    expect(
      lines(diagnose(app(`${FNS}\nreducer r on=ui.click(B) do= xs := xs.map(triple)`))),
    ).toEqual(['E0213 Function "triple" expects 3 argument(s) but .map supplies at most 2']);
  });

  it("is a value again anywhere else in the same call", () => {
    // `fold`'s first argument is the initial accumulator, not a fragment.
    expect(
      lines(
        diagnose(
          app(`${FNS}\nfn zero() -> Int = 0\nreducer r on=ui.click(B) do= n := xs.fold(zero, add)`),
        ),
      ).map((l) => l.slice(0, 5)),
    ).toEqual(["E0127"]);
  });
});
