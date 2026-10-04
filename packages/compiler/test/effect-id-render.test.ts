// An `EffectId` is an opaque handle (stdlib.md §2.1.1.1): it is compared with
// `==` / `!=`, stored in a slot of its type and handed to an `http.cancel`
// effect, and nothing else. Rendering one is E0204, wherever the text comes
// from — a value builtin's content, `.show` in each of its spellings, or a
// `fmt` argument — because what the runtime represents a handle as is its own
// business, and a page that shows it breaks the day that changes.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { VALUE_BUILTIN_CONTENT } from "../src/builtins.ts";

const DEFS = `slot handle : EffectId = EffectId.none
slot hs : List(EffectId) = []
slot o : Option(EffectId) = None
slot r : {id: EffectId, n: Int} = {id: EffectId.none, n: 0}
slot t : Text = ""
slot busy : Bool = false
effect stop cap=http.cancel in=EffectId out=Unit
tile B = button(text="b")`;

/** The line `body` starts on: the one after `DEFS`. */
const LINE = DEFS.split("\n").length + 1;

const program = (body: string) =>
  `${DEFS}\n${body}\napp A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]\n`;

const diagnostics = (body: string) =>
  check(parse(lex(program(body)))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (body: string) => check(parse(lex(program(body)))).map((e) => e.code);

/** `body`'s first line, with `expr` inside `column(B, …)`. */
const tile = (expr: string) => `tile App = column(B, ${expr})`;

/** The E0204 at `needle`, the handle `renderer` renders on `body`'s first line. */
const rendered = (body: string, needle: string, renderer: string) =>
  `E0204 ${LINE}:${body.indexOf(needle) + 1} ${renderer} cannot render EffectId — it is an opaque handle`;

/** Arguments a builtin needs beside its content for the call to draw nothing else. */
const BESIDE: Partial<Record<keyof typeof VALUE_BUILTIN_CONTENT, string>> = {
  link: 'to="/"',
  image: 'alt="a"',
};

describe("a value builtin's content", () => {
  // Read off the table the lowering reads its content from, so a builtin added
  // there is held to this rule without a row being written here.
  const builtins = Object.entries(VALUE_BUILTIN_CONTENT) as [
    keyof typeof VALUE_BUILTIN_CONTENT,
    (typeof VALUE_BUILTIN_CONTENT)[keyof typeof VALUE_BUILTIN_CONTENT],
  ][];

  for (const [name, reading] of builtins) {
    const content = reading.positional ? "handle" : `${reading.named}=handle`;
    const call = `${name}(${[content, BESIDE[name]].filter(Boolean).join(", ")})`;
    it(`refuses ${call}`, () => {
      const body = tile(call);
      expect(diagnostics(body)).toEqual([rendered(body, "handle", `${name}(...)`)]);
    });
  }

  // `label`, `link` and `editable` read `text=` when no positional argument is
  // written, so the handle written there is rendered the same way.
  for (const [name, reading] of builtins) {
    if (!reading.positional || !("named" in reading)) continue;
    const call = `${name}(${[`${reading.named}=handle`, BESIDE[name]].filter(Boolean).join(", ")})`;
    it(`refuses ${call}`, () => {
      const body = tile(call);
      expect(diagnostics(body)).toEqual([rendered(body, "handle", `${name}(...)`)]);
    });
  }
});

describe("show", () => {
  // `show` is the one member every other value has (stdlib.md §2.2.7). The
  // qualified spelling discards its qualifier (§2.4.3), so `Int.show(handle)`
  // shows the handle too.
  const spellings = ["handle.show", "handle.show()", "EffectId.show(handle)", "Int.show(handle)"];

  it.each(spellings)("refuses text(%s)", (expr) => {
    const body = tile(`text(${expr})`);
    expect(diagnostics(body)).toEqual([rendered(body, "handle", ".show")]);
  });

  it.each(spellings)("refuses %s outside a tile", (expr) => {
    // Stored as text, the handle's representation is app data from then on.
    const body = `reducer z on=ui.click(B) do= t := ${expr}\n${tile(`text(t)`)}`;
    expect(diagnostics(body)).toEqual([rendered(body, "handle", ".show")]);
  });

  it("still shows what a qualified show is given, whatever the qualifier", () => {
    expect(codes(tile(`text(EffectId.show(busy))`))).toEqual([]);
  });
});

describe("fmt", () => {
  // Every argument, the template included, is rendered the way `+` renders it.
  it.each([
    ['fmt("id {0}", handle)', "handle"],
    ["fmt(handle)", "handle"],
  ])("refuses text(%s)", (expr, needle) => {
    const body = tile(`text(${expr})`);
    expect(diagnostics(body)).toEqual([rendered(body, needle, "fmt(...)")]);
  });
});

describe("a handle reached through another expression is still a handle", () => {
  it.each([
    ["a record field", "r.id"],
    ["an Option unwrapped", "o.get"],
    ["a list element", "hs[0]"],
    ["a list's head unwrapped", "hs.head.get"],
    ["an if over handles", "if busy then handle else EffectId.none"],
    ["the sentinel itself", "EffectId.none"],
  ])("refuses %s", (_label, expr) => {
    const body = tile(`text(${expr})`);
    expect(diagnostics(body)).toEqual([rendered(body, expr, "text(...)")]);
  });

  it("refuses a fn's result", () => {
    const body = `${tile("text(same(handle))")}\nfn same(x: EffectId) -> EffectId = x`;
    expect(diagnostics(body)).toEqual([rendered(body, "same(", "text(...)")]);
  });

  it("refuses a tile's input", () => {
    const body = `tile Show in=EffectId = text($1)\n${tile("Show(handle)")}`;
    expect(diagnostics(body)).toEqual([rendered(body, "$1", "text(...)")]);
  });

  it("refuses a loop variable", () => {
    const body = tile("for x in hs text(x)");
    expect(diagnostics(body)).toEqual([rendered(body, "x)", "text(...)")]);
  });

  it.each([
    ["an alias", "type Handle = EffectId"],
    ["a nominal", "type Handle = nominal EffectId"],
  ])("refuses %s of EffectId, which is one", (_label, decl) => {
    const body = `${tile("text(mine)")}\n${decl}\nslot mine : Handle = EffectId.none`;
    expect(diagnostics(body)).toEqual([rendered(body, "mine", "text(...)")]);
  });

  it("refuses an operator on an alias of EffectId, as on EffectId", () => {
    // One answer to "is this a handle", for the operators and for rendering.
    const body = `${tile("text(t)")}\ntype Handle = EffectId\nslot mine : Handle = EffectId.none\nreducer z on=ui.click(B) do= t := mine + "x"`;
    expect(codes(body)).toEqual(["E0204"]);
  });
});

describe("one mistake, one report", () => {
  // A sum with a handle in it is refused at the operator, and is a `Text` or a
  // number, never a handle — so the content check has nothing to add. The
  // operator's report sits where the sum starts.
  it.each([
    '"id " + handle',
    'handle + "id"',
    "handle + handle",
  ])("text(%s) is the operator's report alone", (sum) => {
    const body = tile(`text(${sum})`);
    expect(diagnostics(body)).toEqual([
      `E0204 ${LINE}:${body.indexOf(sum) + 1} Operator "+" cannot be applied to EffectId — only "==" / "!=" are defined`,
    ]);
  });
});

describe("what an EffectId is for stays clean", () => {
  it("compares, stores and cancels", () => {
    const body = `slot kept : EffectId = EffectId.none
reducer keep   on=ui.click(B) do= kept := handle
                                  busy := handle != EffectId.none
reducer cancel on=ui.click(B) do= emit stop(kept)
                                  kept := EffectId.none
${tile("text(t)")}`;
    expect(codes(body)).toEqual([]);
  });

  it.each([
    'text(if handle == EffectId.none then "idle" else "busy")',
    "text((handle != EffectId.none).show)",
    'for x in hs text("row") {key: x}',
  ])("renders what is derived from a handle: %s", (expr) => {
    expect(codes(tile(expr))).toEqual([]);
  });

  it("leaves an Option of a handle alone, which renders its tag", () => {
    expect(codes(tile("text(o)"))).not.toContain("E0204");
    expect(codes(tile("text(o.show)"))).not.toContain("E0204");
  });

  it.each([
    ["Int", "1"],
    ["Float", "1.5"],
    ["Bool", "true"],
    ["Text", '"x"'],
    ["Time", "now"],
    ["Unit", "()"],
    ["Bytes", 'Bytes.from-text("x")'],
    ["Duration", "Duration.ms(1)"],
  ])("renders a %s, with text and with show", (type, init) => {
    const body = `${tile("text(v), text(v.show)")}\nslot v : ${type} = ${init}`;
    expect(codes(body)).toEqual([]);
  });

  it("renders a File", () => {
    expect(codes(`tile F in=File = column(text($1), text($1.show))\n${tile("text(t)")}`)).toEqual(
      [],
    );
  });
});
