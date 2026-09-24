// A slot's initial value is evaluated in the `_slots` literal, while the
// module is being imported; `route` is installed into the live-value table by
// the mount that follows, and that table is declared *after* `_slots`. A read of
// `route` there lowered to `_live["route"]` above `const _live`, so the module
// threw `Cannot access '_live' before initialization` at import and nothing
// mounted — with `check` and `build` both clean. A `fn` hop walked past the
// same hole: the call is emitted into the `_slots` literal and the `fn` body
// reads `_live` when it runs, which is right there.
//
// `route` is a slot, so this is E0304 `derived-slot` — the rule a read of any
// other slot in the same position already answers, for the same lowering
// reason. What the slot initialiser lacked was the transitive half E0120 has
// for `app.init` arguments; both positions ask the one resolver.

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

describe("route read directly in a slot initialiser", () => {
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

  it("is reported wherever in the initialiser it appears", () => {
    expect(codes('slot at : Text = if true then route.path else "x"')).toEqual(["E0304"]);
  });

  it("sends the author to a route.enter reducer, not to a fn", () => {
    // E0304's own advice for a derived slot is "compute it in a fn", which is
    // the one fix that does not help here: a fn called from the initialiser
    // is reported below for the same reason.
    const message = diagnostics("slot at : Text = route.path")[0]?.message ?? "";
    expect(message).toContain('"route"');
    expect(message).toContain("route.enter");
    expect(message).not.toContain("compute it in a fn");
  });

  it("is not reported for a local bind that shadows the name", () => {
    // Codegen honours the shadow, so the read is the binding and the program
    // works: a report here would reject a program that runs.
    expect(codes('slot at : Text = let route = "x" in route')).toEqual([]);
  });

  it("leaves $route to the undefined-name report it already gets at the read", () => {
    // A slot initialiser is applied with no payload, so `$route` is a name that
    // does not exist there — the same answer a fn or a tile gets. One report,
    // at the read.
    const defs = "slot at : Text = $route.path";
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code)).toEqual(["E0103"]);
    expect(errs[0]?.pos).toEqual(positionIn(defs, "at", "$route"));
  });
});

describe("route reached through a fn call in a slot initialiser", () => {
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
    expect(
      codes(`slot at : Text = route.path + here()
fn here() -> Text = route.path`),
    ).toEqual(["E0304", "E0304"]);
  });

  it("reports the call to a fn that reads $route too, beside the body's own report", () => {
    // The body's `$route` is an undefined name (E0103) wherever the `fn` is
    // called from; the call from the initialiser is wrong on its own account,
    // and stays wrong once the body is fixed to read `route`.
    const defs = `slot at : Text = here()
fn here() -> Text = $route.path`;
    const errs = diagnostics(defs);
    expect(errs.map((e) => e.code).sort()).toEqual(["E0103", "E0304"]);
    const hop = errs.find((e) => e.code === "E0304");
    expect(hop?.message).toContain("here → $route");
    expect(hop?.pos).toEqual(positionIn(defs, "at", "here()"));
  });

  it("does not report a fn whose parameter is named route", () => {
    // The parameter shadows the built-in inside the body, so the body reads
    // the argument — nothing the mount installs.
    expect(
      codes(`slot at : Text = echo("x")
fn echo(route: Text) -> Text = route`),
    ).toEqual([]);
  });

  it("terminates on a fn cycle, and still finds the route behind it", () => {
    // The resolver runs whether or not E0006 is there, so it has to stop on
    // its own — and a cycle on the way must not hide a read further along it.
    const errs = diagnostics(`slot at : Text = ping()
fn ping() -> Text = pong()
fn pong() -> Text = if true then ping() else route.path`);
    expect(errs.map((e) => e.code).sort()).toEqual(["E0006", "E0304"]);
    expect(errs.find((e) => e.code === "E0304")?.message).toContain("ping → pong → route");
  });
});

describe("what stays legal", () => {
  it("now in a slot initialiser — a module import, not something a mount installs", () => {
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

  it("a route read in an effect's map-request, which borrows the slot-initialiser scope", () => {
    // `map-request` is checked in the `slot-init` position (`pureScope`) but is
    // evaluated per request, long after the mount. The rule is about a slot's
    // own initialiser, not about the position it lends its name to.
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
