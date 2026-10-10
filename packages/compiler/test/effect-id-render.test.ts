import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { VALUE_BUILTIN_CONTENT } from "../src/builtins.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";

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
  checkSource(program(body)).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (body: string) => codesOf(program(body));

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
  const spellings = ["handle.show", "handle.show()", "EffectId.show(handle)", "Int.show(handle)"];

  it.each(spellings)("refuses text(%s)", (expr) => {
    const body = tile(`text(${expr})`);
    expect(diagnostics(body)).toEqual([rendered(body, "handle", ".show")]);
  });

  it.each(spellings)("refuses %s outside a tile", (expr) => {
    const body = `reducer z on=ui.click(B) do= t := ${expr}\n${tile(`text(t)`)}`;
    expect(diagnostics(body)).toEqual([rendered(body, "handle", ".show")]);
  });

  it("still shows what a qualified show is given, whatever the qualifier", () => {
    expect(codes(tile(`text(EffectId.show(busy))`))).toEqual([]);
  });
});

describe("fmt", () => {
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
    const body = `${tile("text(t)")}\ntype Handle = EffectId\nslot mine : Handle = EffectId.none\nreducer z on=ui.click(B) do= t := mine + "x"`;
    expect(codes(body)).toEqual(["E0204"]);
  });
});

describe("one mistake, one report", () => {
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

describe("a page that renders an EffectId does not build", () => {
  const page = (shown: string) => `slot h : EffectId = EffectId.none
reducer go on=ui.click(Go) do= h := emit toast({kind: "info", text: "x", duration: None})
tile Go = button(text="go") {id: "go"}
tile P = column(Go, ${shown})
app M caps=[notification.show] routes={"/" -> P, "/404" -> P} init=[]
`;

  it("refuses text(h), heading(h) and h.show", () => {
    const r = compile(page("text(h), heading(h), text(h.show)"), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`)).toEqual([
      "E0204 4:26 text(...) cannot render EffectId — it is an opaque handle",
      "E0204 4:38 heading(...) cannot render EffectId — it is an opaque handle",
      "E0204 4:47 .show cannot render EffectId — it is an opaque handle",
    ]);
  });

  it("builds what the page derives from the handle instead", () => {
    compileOrFail(
      page('text(if h == EffectId.none then "idle" else "sent"), text((h != EffectId.none).show)'),
    );
  });
});
