import { describe, expect, it } from "vitest";
import { locatedSummariesOf, pointedErrorsOf } from "./helpers/diagnostics.ts";

const app = (slots: string, http: string): string =>
  `${slots}
effect ping cap=http.get in=Unit out=Result(Text, Text) map-request={url: "/ping"}
reducer boot on=app.start do= emit ping()
tile Main = column(text("hi"))
app Types
    caps   = [http.get]
    http   = {${http}}
    routes = {"/" -> Main, "/404" -> Main}
    init   = []`;

const outOfRange = (literal: string): string =>
  `timeout ${literal} is not a number of milliseconds from 1 to 2147483647; every request is aborted before it can answer`;

const notMode = (mode: string): string =>
  `credentials "${mode}" is not one of omit / same-origin / include; a browser refuses the request`;

describe("app.http value fields are checked against their types", () => {
  it("reports each field at its own position, in the order they are written", () => {
    expect(
      locatedSummariesOf(
        app("", `base-url: 42, headers: 7, timeout: "soon", credentials: "bogus"`),
      ),
    ).toEqual([
      "E0201 7:25 Expected Text but got Int",
      "E0201 7:38 Expected Map(Text, Text) but got Int",
      "E0201 7:50 Expected Int but got Text",
      `E0201 7:71 ${notMode("bogus")}`,
    ]);
  });

  it("base-url takes a Text, including a slot of a type built on Text", () => {
    expect(
      locatedSummariesOf(
        app(
          `slot endpoint : Url = "https://api.example.com"
slot port : Int = 80`,
          `base-url: endpoint, headers: {"X-Port": port.show}, timeout: port`,
        ),
      ),
    ).toEqual([]);
    expect(locatedSummariesOf(app(`slot port : Int = 80`, `base-url: port`))).toEqual([
      "E0201 7:25 Expected Text but got Int",
    ]);
  });

  it("timeout takes an Int of milliseconds or a Duration, and nothing else", () => {
    expect(
      locatedSummariesOf(
        app(
          `slot d : Duration = Duration.s(5)
slot label : Text = "5s"`,
          `timeout: d, base-url: d`,
        ),
      ),
    ).toEqual(["E0201 8:37 Expected Text but got Duration"]);
    expect(locatedSummariesOf(app(`slot label : Text = "5s"`, `timeout: label`))).toEqual([
      "E0201 7:24 Expected Int but got Text",
    ]);
    expect(locatedSummariesOf(app("", `timeout: 5000`))).toEqual([]);
    expect(locatedSummariesOf(app("", `timeout: Duration.s(5)`))).toEqual([]);
  });

  it("timeout takes a user nominal Int, since the boundary is assignable to Int", () => {
    expect(
      locatedSummariesOf(
        app(
          `type Cents = nominal Int
slot c : Cents = 5`,
          `timeout: c`,
        ),
      ),
    ).toEqual([]);
  });

  it("timeout refuses a Float: 5.5 is not an Int, by choice", () => {
    expect(locatedSummariesOf(app("", `timeout: 5.5`))).toEqual([
      "E0201 7:24 Expected Int but got Float",
    ]);
  });

  it.each([
    "0",
    "-1",
    "-0",
    "00",
    "0.0",
    "2147483648",
  ])("timeout refuses the literal %s, quoted as written: a timer cannot hold it", (literal) => {
    expect(locatedSummariesOf(app("", `timeout: ${literal}`))).toEqual([
      `E0201 7:24 ${outOfRange(literal)}`,
    ]);
  });

  it.each(["1", "2147483647"])("timeout takes the literal %s", (literal) => {
    expect(locatedSummariesOf(app("", `timeout: ${literal}`))).toEqual([]);
  });

  it.each([
    [`slot t : Int = 0`, `t`],
    ["", `Duration.ms(0)`],
    ["", `let n = 0 in n`],
    ["", `0 + 0`],
  ])("timeout leaves a value decided at run time alone: %s %s", (slots, timeout) => {
    expect(locatedSummariesOf(app(slots, `timeout: ${timeout}`))).toEqual([]);
  });

  it("timeout reports each bad literal of one value, in source order", () => {
    expect(
      pointedErrorsOf(app(`slot fast : Bool = true`, `timeout: if fast then 0 else -1`)),
    ).toEqual([
      { code: "E0201", message: outOfRange("0"), text: "0 else -1}" },
      { code: "E0201", message: outOfRange("-1"), text: "-1}" },
    ]);
  });

  it("timeout holds a literal to Int before holding it to positive: -5.5 is one report", () => {
    expect(locatedSummariesOf(app("", `timeout: -5.5`))).toEqual([
      "E0201 7:24 Expected Int but got Float",
    ]);
  });

  it("timeout reports a wrong branch of an if, and a bare union tag, at the value", () => {
    expect(
      locatedSummariesOf(
        app(
          `slot fast : Bool = true
type Speed = Quick | Slow`,
          `timeout: if fast then 5000 else "soon"`,
        ),
      ),
    ).toEqual(["E0201 8:47 Expected Int but got Text"]);
    expect(locatedSummariesOf(app(`type Speed = Quick | Slow`, `timeout: Quick`))).toEqual([
      'E0201 7:24 Expected Int but got variant "Quick"',
    ]);
  });

  it("timeout is held to Int exactly as base-url is held to Text, shape for shape", () => {
    const pre = `slot fast : Bool = true
type Speed = Quick | Slow
slot cfg : {ms: Int, label: Text} = {ms: 5, label: "x"}
fn five() = 5
fn soon() = "soon"`;
    const shapes: [base: string, timeout: string][] = [
      [`if fast then "a" else 5`, `if fast then 5000 else "soon"`],
      [`five()`, `soon()`],
      [`{}`, `{}`],
      [`Quick`, `Quick`],
      [`cfg["ms"]`, `cfg["label"]`],
      [`cfg.ms`, `cfg.label`],
    ];
    for (const [base, timeout] of shapes) {
      const b = locatedSummariesOf(app(pre, `base-url: ${base}`)).length;
      const t = locatedSummariesOf(app(pre, `timeout: ${timeout}`)).length;
      expect([base, timeout, b, t]).toEqual([base, timeout, 1, 1]);
    }
  });

  it("credentials accepts the three modes as literals and a Text slot", () => {
    for (const mode of ["omit", "same-origin", "include"]) {
      expect(locatedSummariesOf(app("", `credentials: "${mode}"`))).toEqual([]);
    }
    expect(locatedSummariesOf(app(`slot mode : Text = "include"`, `credentials: mode`))).toEqual(
      [],
    );
    expect(locatedSummariesOf(app(`slot mode : Bool = true`, `credentials: mode`))).toEqual([
      "E0201 7:28 Expected Text but got Bool",
    ]);
  });

  it("a misspelt mode is reported, not merely a non-Text", () => {
    expect(locatedSummariesOf(app("", `credentials: "includes"`))).toEqual([
      `E0201 7:28 ${notMode("includes")}`,
    ]);
  });

  it("a misspelt mode in a literal branch of an if is reported at the branch", () => {
    expect(
      locatedSummariesOf(
        app(`slot secure : Bool = true`, `credentials: if secure then "include" else "bogus"`),
      ),
    ).toEqual([`E0201 7:58 ${notMode("bogus")}`]);
    expect(
      locatedSummariesOf(
        app(`slot secure : Bool = true`, `credentials: if secure then "include" else "omit"`),
      ),
    ).toEqual([]);
    // A branch that is not a literal is held to `Text`, as the field itself is.
    expect(
      locatedSummariesOf(
        app(`slot secure : Bool = true`, `credentials: if secure then "include" else 5`),
      ),
    ).toEqual(["E0201 7:58 Expected Text but got Int"]);
  });
});

describe("app.http headers is a Map(Text, Text)", () => {
  it.each([
    ["an Int", ``, `headers: 42`, "E0201 7:24 Expected Map(Text, Text) but got Int"],
    ["a Text", ``, `headers: "x"`, "E0201 7:24 Expected Map(Text, Text) but got Text"],
    [
      "a value that is not a Text, at the value",
      ``,
      `headers: {"X-A": 1}`,
      "E0201 7:32 Expected Text but got Int",
    ],
    [
      "an Option(Text) value, which has to be unwrapped first",
      `slot session : Option(Text) = None`,
      `headers: {"Authorization": session}`,
      "E0201 7:42 Expected Text but got Option(Text)",
    ],
    [
      "a key that is not a Text, at the key",
      ``,
      `headers: {1: "a"}`,
      "E0201 7:25 Expected Text but got Int",
    ],
    [
      "a branch of an if that is not a map, at the branch",
      `slot secure : Bool = true`,
      `headers: if secure then {"X-A": "x"} else 42`,
      "E0201 7:57 Expected Map(Text, Text) but got Int",
    ],
    [
      "a slot of the wrong type, at the field",
      `slot hs : Map(Text, Int) = {}`,
      `headers: hs`,
      "E0201 7:24 Expected Map(Text, Text) but got Map(Text, Int)",
    ],
  ])("reports %s", (_, slots, http, expected) => {
    expect(locatedSummariesOf(app(slots, http))).toEqual([expected]);
  });

  it("refuses bare header names: an unquoted key makes a record, not a map", () => {
    const pre = `slot token : Text = "t"`;
    expect(
      locatedSummariesOf(
        app(pre, `headers: {Content-Type: "application/json", Authorization: token}`),
      ),
    ).toEqual([
      "E0201 7:24 Expected Map(Text, Text) but got {Content-Type: Text, Authorization: Text}",
    ]);
    expect(
      locatedSummariesOf(
        app(pre, `headers: {"Content-Type": "application/json", "Authorization": token}`),
      ),
    ).toEqual([]);
  });

  it("accepts a map of Text values, computed, read from a slot or returned by a fn", () => {
    expect(
      locatedSummariesOf(
        app(
          `slot session : Option(Text) = None
slot token : Text = "t"
slot hs : Map(Text, Text) = {}`,
          `headers: {"Authorization": fmt("Bearer {0}", session.get-or("anon")), "X-Token": token}`,
        ),
      ),
    ).toEqual([]);
    expect(locatedSummariesOf(app(`slot hs : Map(Text, Text) = {}`, `headers: hs`))).toEqual([]);
    expect(
      locatedSummariesOf(app(`fn extra() -> Map(Text, Text) = {"X-A": "a"}`, `headers: extra()`)),
    ).toEqual([]);
    expect(locatedSummariesOf(app("", `headers: {}`))).toEqual([]);
  });

  it("accepts a type built on Text, as a value and as a map's value type", () => {
    const pre = `type Token = nominal Text
slot trace : Url = "https://trace.example.com"
slot token : Token = "t"
slot urls : Map(Text, Url) = {}
slot tokens : Map(Text, Token) = {}`;
    expect(
      locatedSummariesOf(app(pre, `headers: {"X-Trace": trace, "Authorization": token}`)),
    ).toEqual([]);
    expect(locatedSummariesOf(app(pre, `headers: urls`))).toEqual([]);
    expect(locatedSummariesOf(app(pre, `headers: tokens`))).toEqual([]);
  });
});

describe("the literals that reach timeout and credentials", () => {
  const pre = `slot fast : Bool = true
type Speed = Quick | Slow
slot speed : Speed = Quick`;
  const shapes = [
    `X`,
    `if fast then Y else X`,
    `if fast then X else Y`,
    `if fast then (if fast then Y else X) else Y`,
    `match speed with | Quick -> Y | Slow -> X`,
    `let n = 1 in X`,
  ];
  const fields = [
    { field: "timeout", bad: "0", good: "5000", message: outOfRange("0") },
    { field: "credentials", bad: `"bogus"`, good: `"omit"`, message: notMode("bogus") },
  ];
  const cases = shapes.flatMap((shape) => fields.map((f) => ({ shape, ...f })));

  it.each(cases)("$field reports the bad literal in `$shape` where it is written", ({
    shape,
    field,
    bad,
    good,
    message,
  }) => {
    const value = shape.replaceAll("Y", good).replace("X", bad);
    const at = `${shape.slice(shape.indexOf("X")).replaceAll("Y", good).replace("X", bad)}}`;
    expect(pointedErrorsOf(app(pre, `${field}: ${value}`))).toEqual([
      { code: "E0201", message, text: at },
    ]);
  });
});
