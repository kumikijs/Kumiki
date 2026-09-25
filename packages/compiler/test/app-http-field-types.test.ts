import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `app.http`'s value fields are expressions evaluated per request, and each of
// three has a type it is held to at the field (http.md §6.3.1), reported as
// E0201:
//
// - `base-url` takes anything assignable to `Text` — `Url`, `Email`, `Uuid` and
//   every other type built on `Text` included.
// - `timeout` takes anything assignable to `Int`, read as milliseconds — a
//   `Duration` is one, and so is a user `nominal Int`. A `Float` is not: the
//   field is an `Int`, the same boundary every other `Int` position draws.
// - `credentials` takes anything assignable to `Text`, and each literal that
//   can reach the field — the literal itself, or a literal branch of an `if` —
//   must be one of the three Fetch modes. A value computed any other way is
//   held to `Text` alone.
//
// Every case pairs what must report with what must not in one program and
// asserts the whole list, so a quiet half cannot pass by the field going
// unchecked altogether.

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

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

describe("app.http value fields are checked against their types", () => {
  it("reports base-url / timeout / credentials each at its own field", () => {
    expect(diagnostics(app("", `base-url: 42, timeout: "soon", credentials: "bogus"`))).toEqual([
      "E0201 7:25 Expected Text but got Int",
      "E0201 7:38 Expected Int but got Text",
      'E0201 7:59 credentials "bogus" is not one of omit / same-origin / include; a browser refuses the request',
    ]);
  });

  it("base-url takes a Text, including a slot of a type built on Text", () => {
    expect(
      diagnostics(
        app(
          `slot endpoint : Url = "https://api.example.com"
slot port : Int = 80`,
          `base-url: endpoint, headers: {"X-Port": port.show}, timeout: port`,
        ),
      ),
    ).toEqual([]);
    expect(diagnostics(app(`slot port : Int = 80`, `base-url: port`))).toEqual([
      "E0201 7:25 Expected Text but got Int",
    ]);
  });

  it("timeout takes an Int of milliseconds or a Duration, and nothing else", () => {
    expect(
      diagnostics(
        app(
          `slot d : Duration = Duration.s(5)
slot label : Text = "5s"`,
          `timeout: d, base-url: d`,
        ),
      ),
    ).toEqual(["E0201 8:37 Expected Text but got Duration"]);
    expect(diagnostics(app(`slot label : Text = "5s"`, `timeout: label`))).toEqual([
      "E0201 7:24 Expected Int but got Text",
    ]);
    expect(diagnostics(app("", `timeout: 5000`))).toEqual([]);
  });

  it("timeout takes a user nominal Int, since the boundary is assignable to Int", () => {
    expect(
      diagnostics(
        app(
          `type Cents = nominal Int
slot c : Cents = 5`,
          `timeout: c`,
        ),
      ),
    ).toEqual([]);
  });

  it("timeout refuses a Text under a program's own type Duration = Text", () => {
    // A program's `type Duration` shadows the stdlib one, so the field cannot be
    // held to whatever `Duration` names in scope: here that is `Text`, and a
    // `Text` still reaches `setTimeout` as `NaN`.
    expect(diagnostics(app(`type Duration = Text`, `timeout: "soon"`))).toEqual([
      "E0201 7:24 Expected Int but got Text",
    ]);
  });

  it("timeout refuses a Float: 5.5 is not an Int, by choice", () => {
    // `setTimeout(fn, 5.5)` would run, but the field is an `Int` of
    // milliseconds, and an `Int` position refuses a `Float` everywhere else too.
    expect(diagnostics(app("", `timeout: 5.5`))).toEqual(["E0201 7:24 Expected Int but got Float"]);
  });

  it("timeout does not check the value domain yet: 0 and a negative Int are accepted", () => {
    // This pins today's boundary rather than a wanted one. `setTimeout(abort, 0)`
    // aborts every request as soon as it is issued; refusing a non-positive
    // literal is a separate change, and this test flips when it lands.
    expect(diagnostics(app("", `timeout: 0`))).toEqual([]);
    expect(diagnostics(app("", `timeout: -1`))).toEqual([]);
  });

  it("timeout reports a wrong branch of an if, and a bare union tag, at the value", () => {
    expect(
      diagnostics(
        app(
          `slot fast : Bool = true
type Speed = Quick | Slow`,
          `timeout: if fast then 5000 else "soon"`,
        ),
      ),
    ).toEqual(["E0201 8:47 Expected Int but got Text"]);
    expect(diagnostics(app(`type Speed = Quick | Slow`, `timeout: Quick`))).toEqual([
      'E0201 7:24 Expected Int but got variant "Quick"',
    ]);
  });

  it("timeout is held to Int exactly as base-url is held to Text, shape for shape", () => {
    // The two fields go through one check, so what one reports the other does
    // too. Shapes whose type is not inferred at all (a call to a `fn` with no
    // `->`, an empty `{}`, an index into a record) are silent in both, which is
    // an inference gap shared with every other typed position, not a hole in
    // either field.
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
      const b = diagnostics(app(pre, `base-url: ${base}`)).length;
      const t = diagnostics(app(pre, `timeout: ${timeout}`)).length;
      expect([timeout, t]).toEqual([timeout, b]);
    }
  });

  it("credentials accepts the three modes as literals and a Text slot", () => {
    for (const mode of ["omit", "same-origin", "include"]) {
      expect(diagnostics(app("", `credentials: "${mode}"`))).toEqual([]);
    }
    expect(diagnostics(app(`slot mode : Text = "include"`, `credentials: mode`))).toEqual([]);
    expect(diagnostics(app(`slot mode : Bool = true`, `credentials: mode`))).toEqual([
      "E0201 7:28 Expected Text but got Bool",
    ]);
  });

  it("a misspelt mode is reported, not merely a non-Text", () => {
    expect(diagnostics(app("", `credentials: "includes"`))).toEqual([
      'E0201 7:28 credentials "includes" is not one of omit / same-origin / include; a browser refuses the request',
    ]);
  });

  it("a misspelt mode in a literal branch of an if is reported at the branch", () => {
    expect(
      diagnostics(
        app(`slot secure : Bool = true`, `credentials: if secure then "include" else "bogus"`),
      ),
    ).toEqual([
      'E0201 7:58 credentials "bogus" is not one of omit / same-origin / include; a browser refuses the request',
    ]);
    expect(
      diagnostics(
        app(`slot secure : Bool = true`, `credentials: if secure then "include" else "omit"`),
      ),
    ).toEqual([]);
    // A branch that is not a literal is held to `Text`, as the field itself is.
    expect(
      diagnostics(app(`slot secure : Bool = true`, `credentials: if secure then "include" else 5`)),
    ).toEqual(["E0201 7:58 Expected Text but got Int"]);
  });
});
