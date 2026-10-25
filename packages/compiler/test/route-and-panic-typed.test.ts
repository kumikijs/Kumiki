import { emptyRoute, panicInfo, userPanicInfo } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { PANIC_INFO_TYPE, ROUTE_ERROR_INFO_TYPE, ROUTE_TYPE } from "../src/stdlib-types.ts";
import { pointedErrorsOf } from "./helpers/diagnostics.ts";

// Each field's type as the checker should print it. The keys are compared with the runtime's
// values and with the checker's type, and each type with the checker's by a mismatch that names
// it, so a field on one side only, or of another type, fails here.
const ROUTE_FIELDS: Record<string, string> = {
  path: "Text",
  pattern: "Text",
  params: "Map(Text, Text)",
  query: "Map(Text, Text)",
  hash: "Option(Text)",
};
const PANIC_FIELDS: Record<string, string> = {
  message: "Text",
  location: "Text",
  "episode-id": "Option(Text)",
  cause: "Option(Text)",
  category: "Text",
};
// The runtime hands `route.error` a `userPanicInfo` with the matched `pattern` on top.
const ROUTE_ERROR_FIELDS: Record<string, string> = { ...PANIC_FIELDS, pattern: "Text" };

const keysOf = (fields: Record<string, string>): string[] => Object.keys(fields).sort();
const namesOf = (type: typeof ROUTE_TYPE): string[] => type.fields.map((f) => f.name).sort();

const TAIL = `tile Go = button(text="go") {id: "go"}
app R
  caps = []
  routes = {"/" -> App, "/items/:id" -> App, "/404" -> App}
  init = []
`;

/** A reducer on `trigger` writing `read` into a `Bool` slot, so a mismatch names `read`'s type. */
const intoBool = (trigger: string, read: string): string => `slot b : Bool = false
reducer probe on=${trigger} do= b := ${read}
tile App = column(Go, text(b.show))
${TAIL}`;

const mismatch = (read: string, type: string) => ({
  code: "E0201",
  message: `Expected Bool but got ${type}`,
  text: read,
});

describe("the route slot is the runtime's Route", () => {
  it("has the fields the runtime fills, and no others", () => {
    expect(keysOf(ROUTE_FIELDS)).toEqual(Object.keys(emptyRoute()).sort());
    expect(keysOf(ROUTE_FIELDS)).toEqual(namesOf(ROUTE_TYPE));
  });

  it.each(Object.entries(ROUTE_FIELDS))("route.%s is a %s", (field, type) => {
    expect(pointedErrorsOf(intoBool("ui.click(Go)", `route.${field}`))).toEqual([
      mismatch(`route.${field}`, type),
    ]);
  });

  it.each(Object.keys(ROUTE_FIELDS))("route.%s is readable in a tile, a reducer and a fn", (f) => {
    const src = `slot same : Bool = false
fn read() -> Bool = route.${f} == route.${f}
reducer probe on=ui.click(Go) do= same := route.${f} == route.${f}
tile App = column(Go, text(if route.${f} == route.${f} && read() then "y" else "n"))
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([]);
  });

  it("reports a field it does not have, and a field read as another type", () => {
    const src = `slot depth : Int = 0
slot id : Text = ""
reducer measure on=ui.click(Go) do= depth := route.path
reducer pick    on=ui.click(Go) do= id := route.parms.get-or("id", "?")
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toMatchObject([
      { code: "E0201", message: "Expected Int but got Text", text: "route.path" },
      { code: "E0108", text: 'route.parms.get-or("id", "?")' },
    ]);
  });

  it("is named Route, so it fits a slot of that type and a mismatch names it", () => {
    const src = `slot saved : Option(Route) = None
slot t : Text = ""
reducer keep on=ui.click(Go) do= saved := Some(route)
reducer show on=ui.click(Go) do= t := route
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([
      { code: "E0201", message: "Expected Text but got Route", text: "route" },
    ]);
  });

  it("is the same Route through run-reducer(r).slots in a test", () => {
    const src = `slot n : Int = 0
reducer a on=ui.click(Go) do= n := n + 1
tile App = column(Go, text(n.show))
${TAIL}test reads-the-route =
    property-test
        for-all   = {n: Int}
        given     = {slots: {n: n}, event: {type: ui.click, target: Go}}
        invariant = run-reducer(a).slots.route.parms.size == 0
`;
    expect(pointedErrorsOf(src)).toMatchObject([
      { code: "E0108", text: "run-reducer(a).slots.route.parms.size == 0" },
    ]);
  });
});

describe("$event in an app.error reducer is the runtime's PanicInfo", () => {
  it("has the fields the runtime hands it, and no others", () => {
    const handed = userPanicInfo(panicInfo(new Error("x"), "reducer"), 'reducer "r"', undefined);
    expect(keysOf(PANIC_FIELDS)).toEqual(Object.keys(handed).sort());
    expect(keysOf(PANIC_FIELDS)).toEqual(namesOf(PANIC_INFO_TYPE));
  });

  it.each(Object.entries(PANIC_FIELDS))("$event.%s is a %s", (field, type) => {
    expect(pointedErrorsOf(intoBool("app.error", `$event.${field}`))).toEqual([
      mismatch(`$event.${field}`, type),
    ]);
  });

  it("reports a misspelt field, and the fields it is not handed", () => {
    // `pattern` is the matched route's, which only `route.error` carries;
    // `stack` stays in the episode log.
    const src = `slot last : Text = "none"
reducer typo    on=app.error do= last := $event.mesage
reducer pattern on=app.error do= last := $event.pattern
reducer stack   on=app.error do= last := $event.stack
tile App = column(Go, text("last: " + last))
${TAIL}`;
    expect(pointedErrorsOf(src)).toMatchObject([
      { code: "E0108", text: "$event.mesage" },
      { code: "E0108", text: "$event.pattern" },
      { code: "E0108", text: "$event.stack" },
    ]);
  });

  it("is named PanicInfo, so it fits a slot of that type", () => {
    const src = `slot lastError : Option(PanicInfo) = None
reducer keep on=app.error do= lastError := Some($event)
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([]);
  });
});

describe("$event in a route.error reducer is a RouteErrorInfo", () => {
  it("has a PanicInfo's fields and the pattern, and no others", () => {
    expect(keysOf(ROUTE_ERROR_FIELDS)).toEqual(namesOf(ROUTE_ERROR_INFO_TYPE));
  });

  it.each(Object.entries(ROUTE_ERROR_FIELDS))("$event.%s is a %s", (field, type) => {
    expect(pointedErrorsOf(intoBool('route.error("/")', `$event.${field}`))).toEqual([
      mismatch(`$event.${field}`, type),
    ]);
  });

  it("reports a misspelt field", () => {
    const src = `slot m : Text = ""
reducer typo on=route.error("/") do= m := $event.mesage
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toMatchObject([{ code: "E0108", text: "$event.mesage" }]);
  });

  it("is not a PanicInfo: it carries the pattern as well", () => {
    const src = `slot lastError : Option(PanicInfo) = None
reducer keep on=route.error("/") do= lastError := Some($event)
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([
      {
        code: "E0201",
        message: "Expected PanicInfo but got RouteErrorInfo",
        text: "$event)",
      },
    ]);
  });

  it("fits a slot of its own type, and one that declares its six fields", () => {
    const src = `type Failure = {message: Text, location: Text, episode-id: Option(Text), cause: Option(Text), category: Text, pattern: Text}
slot named : Option(RouteErrorInfo) = None
slot spelt : Option(Failure) = None
reducer keep  on=route.error("/") do= named := Some($event)
reducer spell on=route.error("/") do= spelt := Some($event)
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([]);
  });
});

describe("$event on any other trigger has no type", () => {
  it.each([
    'route.enter("/")',
    'route.leave("/")',
    "app.start",
    "tile.mount(App)",
    "timer(1s)",
  ])("on %s", (trigger) => {
    const src = `slot n : Int = 0
reducer probe on=${trigger} do= n := $event.message
tile App = column(Go, text(n.show))
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([]);
  });
});

describe("a program's own type of the same name does not change them", () => {
  it("type Route", () => {
    const src = `type Route = {path: Int}
slot n : Int = 0
slot t : Text = ""
reducer read  on=ui.click(Go) do= n := route.path
reducer bound on=route.enter("/") do= n := $route.path
reducer ok    on=ui.click(Go) do= t := route.params.get-or("id", "?")
tile App = column(Go, text(t))
${TAIL}`;
    expect(pointedErrorsOf(src)).toMatchObject([
      { code: "E0201", message: "Expected Int but got Text", text: "route.path" },
      { code: "E0201", message: "Expected Int but got Text", text: "$route.path" },
    ]);
  });

  it("type PanicInfo, whose name is the program's: a mismatch prints the record", () => {
    const src = `type PanicInfo = Text
slot t : Text = ""
reducer whole on=app.error do= t := $event
reducer field on=app.error do= t := $event.message
reducer onErr on=route.error("/") do= t := $event.message + $event.pattern
tile App = column(Go, text(t))
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([
      {
        code: "E0201",
        message:
          "Expected Text but got {message: Text, location: Text, episode-id: Option(Text), cause: Option(Text), category: Text}",
        text: "$event",
      },
    ]);
  });
});

describe("a program's own slot route", () => {
  it("is E0115 once: its reads keep the slot's type rather than repeat the report", () => {
    const src = `slot route : Int = 0
slot n : Int = 0
reducer bump on=ui.click(Go) do= n := route + 1
tile App = column(Go, text(n.show))
${TAIL}`;
    expect(pointedErrorsOf(src).map((e) => e.code)).toEqual(["E0115"]);
  });
});

describe("a name the program binds is its own", () => {
  it("shadows route, $route and $event with the bind's type", () => {
    const src = `slot n : Int = 0
reducer a on=ui.click(Go) do= let route = 5
                              n := route + 1
reducer b on=route.enter("/") do= let $route = 5
                                  n := $route + 1
reducer c on=app.error do= let $event = 5
                           n := $event + 1
tile App = column(Go, text(let route = 3 in route.show))
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([]);
  });

  it("shadows them when the bind's type is unknown, too", () => {
    // `$el` is untyped: reading the bind must not fall through to the value it shadows.
    const src = `slot n : Int = 0
reducer a on=ui.click(Go) do= let route = $el.depth
                              n := route
reducer b on=route.enter("/") do= let $route = $el.depth
                                  n := $route
reducer c on=app.error do= let $event = $el.depth
                           n := $event
tile App = column(Go)
${TAIL}`;
    expect(pointedErrorsOf(src)).toEqual([]);
  });
});

describe("a link's prefetch-args is the Map(Text, Text) its target reads as $route.params", () => {
  const linking = (args: string, defs = "") => `slot seen : Text = ""
${defs}reducer load on=route.enter("/items/:id") do= seen := $route.params.get-or("id", "?")
tile App = column(Go, link(to="/items/1") {text: "1", prefetch: load, prefetch-args: ${args}})
${TAIL}`;

  it("accepts a map of text to text, written out or held in a slot", () => {
    expect(pointedErrorsOf(linking('{"id": "1"}'))).toEqual([]);
    expect(pointedErrorsOf(linking("args", 'slot args : Map(Text, Text) = {"id": "1"}\n'))).toEqual(
      [],
    );
  });

  it("reports a value of another type", () => {
    expect(pointedErrorsOf(linking('{"id": 1}'))).toEqual([
      { code: "E0201", message: "Expected Text but got Int", text: "1}})" },
    ]);
  });

  it("reports a value that is not a map", () => {
    expect(pointedErrorsOf(linking("5"))).toEqual([
      { code: "E0201", message: "Expected Map(Text, Text) but got Int", text: "5})" },
    ]);
  });
});
