import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// A `fn` is not a value in Kumiki — there are no lambdas (language.md §1.9.1)
// — but a `fn` name written without its parentheses was accepted wherever a
// value goes. It lowered to the generated function itself, so
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

  it("lets a slot of the same name shadow the fn", () => {
    expect(
      diagnose(app(`fn label() -> Text = "x"\nslot label : Text = "y"\ntile T = text(label)`)),
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

  const OTHERS = `fn half(n: Int) -> Option(Int) = Some(n)
fn loud(t: Text) -> Text = t
fn zero() -> Int = 0
fn pair(a: Int, b: Int) -> Option(Int) = Some(a + b)
fn join2(a: Text, b: Text) -> Text = a + b
fn keep(k: Text, v: Int) -> Bool = v > 0
fn entry(k: Text, v: Int) -> Text = k + v.show
slot m : Map(Text, Int)    = {"a": 1}
slot o : Option(Int)       = None
slot r : Result(Int, Text) = Err("x")
slot t : Text              = ""`;

  /** The E0213 lines for a reducer that does `body`. */
  const arity = (body: string) =>
    lines(diagnose(app(`${FNS}\n${OTHERS}\nreducer r on=ui.click(B) do= ${body}`))).filter((l) =>
      l.startsWith("E0213"),
    );

  it("accepts it in each fragment position", () => {
    for (const body of [
      "xs := xs.map(double)",
      "xs := xs.filter(positive)",
      "n := xs.find(positive).get-or(0)",
      "xs := xs.sort-by(double)",
      "n := xs.fold(0, add)",
      "o := o.flat-map(half)",
      'm := m.update("a", double)',
      "t := match r.map-err(loud) with | Ok(v) -> v.show | Err(e) -> e",
    ]) {
      expect(
        diagnose(app(`${FNS}\n${OTHERS}\nreducer r on=ui.click(B) do= ${body}`)),
        body,
      ).toEqual([]);
    }
  });

  it("refuses a fn that takes more than the fragment binds", () => {
    // A list fragment binds `$1` and `$2`; nothing supplies a third.
    expect(arity("xs := xs.map(triple)")).toEqual([
      'E0213 Function "triple" expects 3 argument(s) but .map supplies at most 2',
    ]);
    // `flat-map`, `update` and `map-err` bind `$1` alone.
    expect(arity("o := o.flat-map(pair)")).toEqual([
      'E0213 Function "pair" expects 2 argument(s) but .flat-map supplies at most 1',
    ]);
    expect(arity('m := m.update("a", add)')).toEqual([
      'E0213 Function "add" expects 2 argument(s) but .update supplies at most 1',
    ]);
    expect(arity("t := match r.map-err(join2) with | Ok(v) -> v.show | Err(e) -> e")).toEqual([
      'E0213 Function "join2" expects 2 argument(s) but .map-err supplies at most 1',
    ]);
  });

  it("refuses a fn that takes nothing, which would drop the element", () => {
    expect(arity("xs := xs.map(zero)")).toEqual([
      'E0213 Function "zero" expects 0 argument(s) but .map needs at least 1',
    ]);
  });

  it("gives fold's fn both the accumulator and the element, never fewer or more", () => {
    // A `fn` of one is applied to the accumulator alone and folds nothing in.
    expect(arity("n := xs.fold(0, double)")).toEqual([
      'E0213 Function "double" expects 1 argument(s) but .fold supplies exactly 2 — the accumulator and the element',
    ]);
    expect(arity("n := xs.fold(0, triple)")).toEqual([
      'E0213 Function "triple" expects 3 argument(s) but .fold supplies exactly 2 — the accumulator and the element',
    ]);
  });

  it("binds a second positional only over a key/value pair", () => {
    // Over a plain list the second argument would be the JS index, and over
    // an Option the element again.
    const only =
      "supplies 1 — a second positional is bound only over a Map or a List of pairs (.entries)";
    expect(arity("xs := xs.map(add)")).toEqual([
      `E0213 Function "add" expects 2 argument(s) but .map on "List(Int)" ${only}`,
    ]);
    expect(arity("xs := xs.sort-by(add)")).toEqual([
      `E0213 Function "add" expects 2 argument(s) but .sort-by on "List(Int)" ${only}`,
    ]);
    expect(arity("o := o.map(add)")).toEqual([
      `E0213 Function "add" expects 2 argument(s) but .map on "Option(Int)" ${only}`,
    ]);
    // A Map and its `.entries` bind `$1` to the key and `$2` to the value.
    expect(arity("m := m.filter(keep)")).toEqual([]);
    expect(arity('t := m.entries.map(entry).join(",")')).toEqual([]);
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

describe("a shadowed fn name in a fragment position is the value", () => {
  it("is not checked as the fn", () => {
    // `positive` is the parameter here, a Bool; the fragment is that value.
    expect(
      lines(
        diagnose(
          app(`fn positive() -> Int = 1
slot xs : List(Int) = [1]
fn f(positive: Bool) -> List(Int) = xs.filter(positive)`),
        ),
      ).filter((l) => l.startsWith("E0213") || l.startsWith("E0127")),
    ).toEqual([]);
  });

  it("lowers to the parameter, not a call to the fn of that name", {
    timeout: 30_000,
  }, async () => {
    const src = app(`fn double(n: Int) -> Int = n * 2
fn scale(double: Int) -> List(Int) = [1, 2].map(double)
slot result : List(Int) = []
reducer subject on=ui.click(B) do= result := scale(5)`);
    const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
    if (result.kind !== "ok")
      expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
    const tmp = resolve(__dirname, "test-tmp");
    mkdirSync(tmp, { recursive: true });
    const file = join(mkdtempSync(join(tmp, "fn-name-")), "app.mjs");
    writeFileSync(file, result.js);
    const mod: {
      createApp: () => {
        reducers: {
          name: string;
          apply: (live: object, payload: object) => { slots: Record<string, unknown> };
        }[];
      };
    } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    const subject = mod.createApp().reducers.find((r) => r.name === "subject");
    if (!subject) expect.fail("the compiled module has no reducer named subject");
    expect(subject.apply({ result: [] }, {}).slots.result).toEqual([5, 5]);
  });
});

describe("a fn named in a fragment runs where the method does", () => {
  // The method applies it, so a slot initializer or an `app.init` argument
  // that names it runs its body before the mount installs the route — the
  // same as writing the call `here($1)`.
  const HERE = "fn here(n: Int) -> Text = route.path";
  const codesOf = (src: string) => check(parse(lex(src))).map((e) => e.code);
  const program = (defs: string, init = "", caps = "") => `${HERE}
${defs}
tile App = column(text("x"))
app A caps=[${caps}] routes={"/" -> App, "/404" -> App} init=[${init}]
`;

  it("is E0304 in a slot initializer", () => {
    expect(codesOf(program("slot names : List(Text) = [1, 2].map(here)"))).toEqual(["E0304"]);
  });

  it("is E0304 through a fn the slot initializer calls", () => {
    expect(
      codesOf(
        program(`fn all() -> List(Text) = [1, 2].map(here)
slot names : List(Text) = all()`),
      ),
    ).toEqual(["E0304"]);
  });

  it("is E0120 in an app.init argument", () => {
    expect(
      codesOf(
        program(
          `effect load cap=storage.read in=Text out=Result(Text, Text) map-request={key: $1, decode: Decoder.Json(Text)}`,
          'load([1].map(here).head.get-or(""))',
          "storage.read",
        ),
      ),
    ).toEqual(["E0120"]);
  });

  it("is not the fn when a parameter of the same name shadows it", () => {
    // Regression guard: `here` inside `pick` is the Int parameter, so the
    // route-reading fn is never reached.
    expect(
      codesOf(
        program(`fn pick(here: Int) -> List(Int) = [1, 2].map(here)
slot picked : List(Int) = pick(3)`),
      ),
    ).toEqual([]);
  });
});
