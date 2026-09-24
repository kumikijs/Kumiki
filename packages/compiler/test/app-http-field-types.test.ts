import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `app.http`'s value fields are expressions evaluated per request, and only
// their names were checked (http.md §6.3.1). A value of the wrong type ran and
// did the wrong thing: `base-url: 42` sent the request to `42/ping`,
// `timeout: "soon"` reached `setTimeout` as `NaN` and aborted every request
// before it could answer, and `credentials: "bogus"` is a `fetch` init a
// browser refuses.
//
// `base-url` is a `Text`; `timeout` is a `Duration` or an `Int` of
// milliseconds — the runtime's reading, and the one every example writes;
// `credentials` is a `Text`, and a literal is one of the three Fetch modes.
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
  it("reports each field of the issue's repro at the field", () => {
    expect(diagnostics(app("", `base-url: 42, timeout: "soon", credentials: "bogus"`))).toEqual([
      "E0201 7:25 Expected Text but got Int",
      "E0201 7:38 Expected Duration or Int (milliseconds) but got Text",
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
      "E0201 7:24 Expected Duration or Int (milliseconds) but got Text",
    ]);
    expect(diagnostics(app("", `timeout: 5000`))).toEqual([]);
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
});
