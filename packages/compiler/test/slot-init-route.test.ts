import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { check } from "../src/typecheck.ts";

/** An app whose first definitions are the parameter; `App` reads nothing of them. */
const program = (defs: string) => `${defs}
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const diagnostics = (defs: string) => check(parse(lex(program(defs))));
const codes = (defs: string) => diagnostics(defs).map((e) => e.code);

/** Where `needle` is written on the line of `slot <slot>`, 1-based. */
const positionIn = (defs: string, slot: string, needle: string) => {
  const lines = program(defs).split("\n");
  const line = lines.findIndex((l) => l.startsWith(`slot ${slot} `));
  const col = (lines[line] ?? "").indexOf(needle);
  if (line < 0 || col < 0) throw new Error(`"${needle}" is not on the line of slot ${slot}`);
  return { line: line + 1, col: col + 1 };
};

describe("route read directly in a slot initializer", () => {
  it("is reported at the read, once", () => {
    const defs = "slot at : Text = route.path";
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0304"]);
    expect(errs[0]?.kind).toBe("derived-slot");
    expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "route"));
  });

  it("is reported for the bare slot, not only for a field read off it", () => {
    expect(codes("slot at : Route = route")).toEqual(["E0304"]);
  });

  const readSites: [string, string][] = [
    ["an if branch", 'slot at : Text = if true then route.path else "x"'],
    ["a let value", "slot at : Text = let x = route.path in x"],
    ["a let body", 'slot at : Text = let x = "a" in route.path + x'],
    ["a match arm", 'slot at : Text = match "a" with | k -> route.path + k'],
    ["a method argument", 'slot at : List(Text) = ["a"].map(route.path + $1)'],
    ["a record field", "slot at : {p: Text} = {p: route.path}"],
    ["a list element", "slot at : List(Text) = [route.path]"],
    ["an argument to a fn that does not read the route", "slot at : Text = wrap(route.path)"],
  ];
  for (const [where, decl] of readSites) {
    it(`is reported in ${where}, once, at the read`, () => {
      const defs = `${decl}\nfn wrap(t: Text) -> Text = t`;
      const errs = diagnostics(defs);
      expect(errs.map((e) => e.code)).toEqual(["E0304"]);
      expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "route"));
    });
  }

  it("is reported beside an ordinary slot read, each with its own message", () => {
    const defs = `slot other : Text = ""
slot at : Text = other + route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0304", "E0304"]);
    const slotRead = errs.find((e) => e.message.includes('reads slot "other"'));
    const routeRead = errs.find((e) => e.message.includes('reads "route"'));
    expect(slotRead?.pos).toEqual(positionIn(defs, "at", "other"));
    expect(slotRead?.message).toContain("compute it in a fn");
    expect(routeRead?.pos).toEqual(positionIn(defs, "at", "route"));
    expect(routeRead?.message).not.toContain("compute it in a fn");
    expect(routeRead?.message).not.toContain('slot "other"');
  });

  it("is reported once when the program also declares a slot named route", () => {
    const defs = `slot route : Int = 0
slot at : Int = route`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0115", "E0304"]);
    expect(errs[1]?.message).toContain('reads "route" in its initial value');
    expect(errs[1]?.pos).toEqual(positionIn(defs, "at", "route"));
  });

  it("sends the author to a route.enter reducer, not to a fn", () => {
    const message = diagnostics("slot at : Text = route.path")[0]?.message ?? "";
    expect(message).toContain('"route"');
    expect(message).toContain("route.enter");
    expect(message).not.toContain("compute it in a fn");
  });

  it("is not reported for a local bind that shadows the name", () => {
    expect(codes('slot at : Text = let route = "x" in route')).toEqual([]);
  });

  it("leaves $route to the undefined-name report it already gets at the read", () => {
    const defs = "slot at : Text = $route.path";
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0103"]);
    expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "$route"));
  });
});

describe("route reached through a fn call in a slot initializer", () => {
  it("is reported at the call, with the chain that reaches the route", () => {
    const defs = `slot at : Text = here()
fn here() -> Text = route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0304"]);
    expect(errs[0]?.message).toContain('through "here" (here → route)');
    expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "here()"));
  });

  it("follows the chain through more than one hop", () => {
    const defs = `slot at : Text = outer()
fn outer() -> Text = inner()
fn inner() -> Text = route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0304"]);
    expect(errs[0]?.message).toContain("outer → inner → route");
    expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "outer()"));
  });

  it("finds a call nested inside another call's argument", () => {
    const defs = `slot at : Text = wrap(inner())
fn wrap(t: Text) -> Text = t
fn inner() -> Text = route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0304"]);
    expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "inner()"));
  });

  it("reports the direct read and the hop separately when both are written", () => {
    const defs = `slot at : Text = route.path + here()
fn here() -> Text = route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0304", "E0304"]);
    expect(errs.map((e) => e.pos)).toEqual([
      positionIn(defs, "at", "route"),
      positionIn(defs, "at", "here()"),
    ]);
  });

  it("reports the call to a fn that reads $route too, beside the body's own report", () => {
    const defs = `slot at : Text = here()
fn here() -> Text = $route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code).sort()).toEqual(["E0103", "E0304"]);
    const hop = errs.find((e) => e.code === "E0304");
    expect(hop?.message).toContain("here → $route");
    expect(hop?.pos).toEqual(positionIn(defs, "at", "here()"));
  });

  it("does not report a fn whose parameter is named route", () => {
    expect(
      codes(`slot at : Text = echo("x")
fn echo(route: Text) -> Text = route`),
    ).toEqual([]);
  });

  it("terminates on a fn cycle, and still finds the route behind it", () => {
    const errs = diagnostics(`slot at : Text = ping()
fn ping() -> Text = pong()
fn pong() -> Text = if true then ping() else route.path`);
    expect(errs.map((e) => e.code).sort()).toEqual(["E0006", "E0304"]);
    expect(errs.find((e) => e.code === "E0304")?.message).toContain("ping → pong → route");
  });
});

describe("one fn called from both pre-mount positions", () => {
  const defs = `slot at : Text = here()
fn here() -> Text = route.path
effect load cap=storage.read in=Text out=Result(Text, Text)`;
  const app = `tile App = column(text("x"))
app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[load(here())]`;
  const layouts: [string, string][] = [
    ["the slot before the app", `${defs}\n${app}\n`],
    ["the app before the slot", `${app}\n${defs}\n`],
  ];
  /** Where `needle` is written on the first line starting with `prefix`, 1-based. */
  const at = (src: string, prefix: string, needle: string) => {
    const lines = src.split("\n");
    const line = lines.findIndex((l) => l.startsWith(prefix));
    return { line: line + 1, col: (lines[line] ?? "").indexOf(needle) + 1 };
  };
  for (const [order, src] of layouts) {
    it(`reports each call in its own position's code, with ${order}`, () => {
      const errs = check(parse(lex(src)));
      expect(errs.map((e) => e.code).sort()).toEqual(["E0120", "E0304"]);
      const slotHop = errs.find((e) => e.code === "E0304");
      const initHop = errs.find((e) => e.code === "E0120");
      expect(slotHop?.pos).toEqual(at(src, "slot at ", "here()"));
      expect(slotHop?.message).toContain("here → route");
      expect(initHop?.pos).toEqual(at(src, "app A", "here()"));
      expect(initHop?.message).toContain("here → route");
    });
  }
});

describe("what stays legal", () => {
  it("now in a slot initializer — a module import, not something a mount installs", () => {
    expect(codes("slot started : Text = now.show")).toEqual([]);
  });

  it("a fn that reads the route, called from a tile and a reducer", () => {
    expect(
      check(
        parse(
          lex(`slot at : Text = ""
fn here() -> Text = route.path
reducer enter on=route.enter("/") do= at := here()
tile App = column(text(here()), text(at))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`),
        ),
      ),
    ).toEqual([]);
  });

  it("a route read in an effect's map-request, which borrows the slot-initializer scope", () => {
    expect(
      check(
        parse(
          lex(`effect fetchIt cap=http.get in=Unit out=Result(Text, HttpError)
    map-request={url: "/api" + route.path, decode: Decoder.Text}
slot got : Text = ""
reducer go on=ui.click(Go) do= emit fetchIt()
tile Go = button(text="go", onClick=go)
tile App = column(Go, text(got))
app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
`),
        ),
      ),
    ).toEqual([]);
  });
});
