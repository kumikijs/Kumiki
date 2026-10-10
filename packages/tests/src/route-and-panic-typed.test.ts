import { check, lex, parse } from "@kumikijs/compiler";
import { emptyRoute, panicInfo, userPanicInfo } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

// The field names come from the runtime, so the checker cannot reject a field the runtime
// supplies without a case here failing.
const ROUTE_FIELDS = Object.keys(emptyRoute());
const PANIC_FIELDS = Object.keys(
  userPanicInfo(panicInfo(new Error("x"), "reducer"), 'reducer "r"', undefined),
);

const TAIL = `tile Go = button(text="go") {id: "go"}
app R
  caps = []
  routes = {"/" -> App, "/items/:id" -> App, "/404" -> App}
  init = []
`;

function diagnostics(src: string): string[] {
  return check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`);
}

/** Where `needle` is written on the first line holding `after`, as a diagnostic's `line:col`. */
function at(src: string, after: string, needle: string): string {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => l.includes(after));
  const col = (lines[line] ?? "").indexOf(needle, (lines[line] ?? "").indexOf(after));
  if (line < 0 || col < 0) throw new Error(`"${needle}" is not on the line holding "${after}"`);
  return `${line + 1}:${col + 1}`;
}

const reducerReading = (trigger: string, read: string): string => `slot same : Bool = false
reducer probe on=${trigger} do= same := ${read} == ${read}
tile App = column(Go, text(same.show))
${TAIL}`;

describe("the route slot is the runtime's Route", () => {
  it.each(ROUTE_FIELDS)("route.%s is readable in a tile, a reducer and a fn", (field) => {
    const src = `slot same : Bool = false
fn read() -> Bool = route.${field} == route.${field}
reducer probe on=ui.click(Go) do= same := route.${field} == route.${field}
tile App = column(Go, text(if route.${field} == route.${field} && read() then "y" else "n"))
${TAIL}`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("reports a field it does not have, and a field read as another type", () => {
    const src = `slot depth : Int = 0
reducer measure on=ui.click(Go) do= depth := route.path
tile App = column(Go, text("id: " + route.parms.get-or("id", "?")))
${TAIL}`;
    expect(diagnostics(src)).toEqual([
      `E0201 ${at(src, "reducer measure", "route.path")}`,
      `E0108 ${at(src, "tile App", "route.parms")}`,
    ]);
  });

  it("holds the whole Route, so it fits a slot of that type", () => {
    const src = `slot saved : Option(Route) = None
reducer keep on=ui.click(Go) do= saved := Some(route)
tile App = column(Go)
${TAIL}`;
    expect(diagnostics(src)).toEqual([]);
  });
});

describe("$route is the runtime's Route where the trigger binds it", () => {
  const TRIGGERS = ['route.enter("/items/:id")', 'route.leave("/items/:id")', 'route.error("/")'];

  for (const trigger of TRIGGERS) {
    it.each(ROUTE_FIELDS)(`$route.%s is readable on ${trigger}`, (field) => {
      expect(diagnostics(reducerReading(trigger, `$route.${field}`))).toEqual([]);
    });

    it(`reports a misspelt field, and a field read as another type, on ${trigger}`, () => {
      const src = `slot n : Int = 0
slot t : Text = ""
reducer wrong on=${trigger} do= n := $route.path
reducer typo  on=${trigger} do= t := $route.parms.get-or("id", "?")
tile App = column(Go)
${TAIL}`;
      expect(diagnostics(src)).toEqual([
        `E0201 ${at(src, "reducer wrong", "$route.path")}`,
        `E0108 ${at(src, "reducer typo", "$route.parms")}`,
      ]);
    });
  }

  it("is a Route in a link's prefetch target too", () => {
    const src = `slot n : Int = 0
reducer load on=ui.click(Go) do= n := $route.path
tile App = column(Go, link(to="/items/1") {text: "1", prefetch: load, prefetch-args: {"id": "1"}})
${TAIL}`;
    expect(diagnostics(src)).toEqual([`E0201 ${at(src, "reducer load", "$route.path")}`]);
  });
});

describe("$event in an app.error reducer is the runtime's PanicInfo", () => {
  it.each(PANIC_FIELDS)("$event.%s is readable", (field) => {
    expect(diagnostics(reducerReading("app.error", `$event.${field}`))).toEqual([]);
  });

  it("reports a misspelt field, and the fields it is not handed", () => {
    // `pattern` is the matched route's, which only `route.error` carries;
    // `stack` stays in the episode log.
    const src = `slot last : Text = "none"
slot n : Int = 0
reducer typo    on=app.error do= last := $event.mesage
reducer pattern on=app.error do= last := $event.pattern
reducer stack   on=app.error do= last := $event.stack
reducer wrong   on=app.error do= n := $event.message
tile App = column(Go, text("last: " + last))
${TAIL}`;
    expect(diagnostics(src)).toEqual([
      `E0108 ${at(src, "reducer typo", "$event.mesage")}`,
      `E0108 ${at(src, "reducer pattern", "$event.pattern")}`,
      `E0108 ${at(src, "reducer stack", "$event.stack")}`,
      `E0201 ${at(src, "reducer wrong", "$event.message")}`,
    ]);
  });

  it("is the whole PanicInfo, so it fits a slot of that type", () => {
    const src = `slot lastError : Option(PanicInfo) = None
reducer keep on=app.error do= lastError := Some($event)
tile App = column(Go)
${TAIL}`;
    expect(diagnostics(src)).toEqual([]);
  });
});

describe("$event in a route.error reducer is PanicInfo plus the matched pattern", () => {
  it.each([...PANIC_FIELDS, "pattern"])("$event.%s is readable", (field) => {
    expect(diagnostics(reducerReading('route.error("/")', `$event.${field}`))).toEqual([]);
  });

  it("reports a misspelt field, and a field read as another type", () => {
    const src = `slot m : Int = 0
reducer typo  on=route.error("/") do= m := $event.mesage
reducer wrong on=route.error("/") do= m := $event.pattern
tile App = column(Go)
${TAIL}`;
    expect(diagnostics(src)).toEqual([
      `E0108 ${at(src, "reducer typo", "$event.mesage")}`,
      `E0201 ${at(src, "reducer wrong", "$event.pattern")}`,
    ]);
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
    expect(diagnostics(src)).toEqual([
      `E0201 ${at(src, "reducer read", "route.path")}`,
      `E0201 ${at(src, "reducer bound", "$route.path")}`,
    ]);
  });

  it("type PanicInfo", () => {
    const src = `type PanicInfo = Text
slot t : Text = ""
reducer whole on=app.error do= t := $event
reducer field on=app.error do= t := $event.message
reducer onErr on=route.error("/") do= t := $event.message + $event.pattern
tile App = column(Go, text(t))
${TAIL}`;
    expect(diagnostics(src)).toEqual([`E0201 ${at(src, "reducer whole", "$event")}`]);
  });
});

describe("a program's own slot route", () => {
  it("is E0115 once: its reads keep the slot's type rather than repeat the report", () => {
    const src = `slot route : Int = 0
slot n : Int = 0
reducer bump on=ui.click(Go) do= n := route + 1
tile App = column(Go, text(n.show))
${TAIL}`;
    expect(diagnostics(src)).toEqual(["E0115 1:1"]);
  });
});

describe("$route where nothing binds one", () => {
  it("is E0119 alone: there is no value to type", () => {
    const src = `slot n : Int = 0
reducer a on=ui.click(Go) do= n := $route.path
tile App = column(Go)
${TAIL}`;
    expect(diagnostics(src)).toEqual([`E0119 ${at(src, "reducer a", "$route")}`]);
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
    expect(diagnostics(src)).toEqual([]);
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
    expect(diagnostics(src)).toEqual([]);
  });
});
