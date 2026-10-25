import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { VALUE_BUILTIN_CONTENT } from "../src/builtins.ts";
import { type Located, locatedOf, posOf } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";

const DEFS = `slot handle : EffectId = EffectId.none
slot hs : List(EffectId) = []
slot o : Option(EffectId) = None
slot r : {id: EffectId, n: Int} = {id: EffectId.none, n: 0}
slot t : Text = ""
slot busy : Bool = false
effect stop cap=http.cancel in=EffectId out=Unit
tile B = button(text="b")`;

/** `body` comes first, so a needle is found in it before `DEFS`. */
const program = (body: string) =>
  `${body}\n${DEFS}\napp A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]\n`;

const diagnostics = (body: string) => locatedOf(program(body));

/** `body`'s first line, with `expr` inside `column(B, …)`. */
const tile = (expr: string) => `tile App = column(B, ${expr})`;

/** The diagnostic `code` reports with `message` at the first `needle` in `body`. */
const at = (body: string, needle: string, code: string, message: string): Located => ({
  code,
  message,
  ...posOf(program(body), needle),
});

/** The E0204 for the handle `renderer` renders at the first `needle` in `body`. */
const rendered = (body: string, needle: string, renderer: string) =>
  at(body, needle, "E0204", `${renderer} cannot render EffectId — it is an opaque handle`);

/** The E0204 for operator `op` at the first `needle` in `body`. */
const operated = (body: string, needle: string, op: string) =>
  at(
    body,
    needle,
    "E0204",
    `Operator "${op}" cannot be applied to EffectId — only "==" / "!=" are defined`,
  );

/** Arguments a builtin needs beside its content for the call to draw nothing else. */
const BESIDE: Partial<Record<keyof typeof VALUE_BUILTIN_CONTENT, string>> = {
  link: 'to="/"',
  image: 'alt="a"',
};

describe("what a builtin renders as text", () => {
  const call = (name: keyof typeof VALUE_BUILTIN_CONTENT, content: string) =>
    `${name}(${[content, BESIDE[name]].filter(Boolean).join(", ")})`;
  // Each builtin's content where it reads it first, and its `text=` too when it reads both.
  const calls = (
    Object.entries(VALUE_BUILTIN_CONTENT) as [
      keyof typeof VALUE_BUILTIN_CONTENT,
      (typeof VALUE_BUILTIN_CONTENT)[keyof typeof VALUE_BUILTIN_CONTENT],
    ][]
  ).flatMap(([name, reading]): [string, string][] => {
    const named = "named" in reading ? reading.named : undefined;
    const first: [string, string] = [
      name,
      call(name, reading.positional ? "handle" : `${named}=handle`),
    ];
    return reading.positional && named ? [first, [name, call(name, `${named}=handle`)]] : [first];
  });

  it.each([
    ...calls,
    ["button", "button(text=handle)"],
    ["link", 'link(to="/") {text: handle}'],
    ["editable", "editable(bind=handle)"],
  ])("%s refuses %s", (name, expr) => {
    const body = tile(expr);
    expect(diagnostics(body)).toEqual([rendered(body, "handle", `${name}(...)`)]);
  });

  it("refuses a handle a let names, at the let", () => {
    const body = tile("text(let x = handle in x)");
    expect(diagnostics(body)).toEqual([rendered(body, "let", "text(...)")]);
  });
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

  it("refuses a qualified show beside the qualifier's own report", () => {
    const body = tile("text(Itn.show(handle))");
    expect(diagnostics(body)).toEqual([
      rendered(body, "handle", ".show"),
      at(body, "Itn", "E0117", 'Reference to undefined type "Itn"'),
    ]);
  });

  it("refuses a key that shows a handle", () => {
    const body = tile('for x in hs text("row") {key: x.show}');
    expect(diagnostics(body)).toEqual([rendered(body, "x.show", ".show")]);
  });

  it("still shows what a qualified show is given, whatever the qualifier", () => {
    expect(diagnostics(tile(`text(EffectId.show(busy))`))).toEqual([]);
  });
});

describe("a member other than show", () => {
  it.each([
    ["upper", "Text"],
    ["length", "List / Text"],
  ])("is not one an EffectId has: .%s is E0108", (member, owners) => {
    const body = tile(`text(handle.${member})`);
    expect(diagnostics(body)).toEqual([
      at(
        body,
        "handle",
        "E0108",
        `Type "EffectId" has no member ".${member}" — it is a member of ${owners}`,
      ),
    ]);
  });
});

describe("fmt", () => {
  it.each([
    ['fmt("id {0}", handle)', "handle"],
    ["fmt(handle)", "handle"],
    ['fmt("id {0}", let x = handle in x)', "let"],
  ])("refuses text(%s)", (expr, needle) => {
    const body = tile(`text(${expr})`);
    expect(diagnostics(body)).toEqual([rendered(body, needle, "fmt(...)")]);
  });

  it("refuses it in a reducer", () => {
    const body = `reducer z on=ui.click(B) do= t := fmt("id {0}", handle)\n${tile("text(t)")}`;
    expect(diagnostics(body)).toEqual([rendered(body, "handle", "fmt(...)")]);
  });

  it("reports each handle among its arguments", () => {
    const body = tile('text(fmt("{0} {1}", handle, handle))');
    expect(diagnostics(body)).toEqual([
      rendered(body, "handle,", "fmt(...)"),
      rendered(body, "handle)", "fmt(...)"),
    ]);
  });
});

describe("a handle reached through another expression is still a handle", () => {
  it.each([
    ["a record field", "r.id"],
    ["an Option unwrapped", "o.get"],
    ["a list element", "hs[0]"],
    ["a list's head unwrapped", "hs.head.get"],
    ["an if over handles", "if busy then handle else EffectId.none"],
    ["an if over a let", "if busy then (let x = handle in x) else EffectId.none"],
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

  describe.each([
    ["an alias", "type Handle = EffectId"],
    ["a nominal", "type Handle = nominal EffectId"],
  ])("%s of EffectId, which is one", (_label, decl) => {
    const withMine = (body: string) => `${body}\n${decl}\nslot mine : Handle = EffectId.none`;

    it("refuses text(mine) and text(mine.show)", () => {
      const body = withMine(tile("text(mine), text(mine.show)"));
      expect(diagnostics(body)).toEqual([
        rendered(body, "mine)", "text(...)"),
        rendered(body, "mine.show", ".show"),
      ]);
    });

    it.each([
      ['t := mine + "x"', 'mine + "x"', "+"],
      ["busy := mine < mine", "mine < mine", "<"],
    ])("refuses %s, as on EffectId", (stmt, expr, op) => {
      const body = withMine(`reducer z on=ui.click(B) do= ${stmt}\n${tile("text(t)")}`);
      expect(diagnostics(body)).toEqual([operated(body, expr, op)]);
    });
  });
});

describe("one mistake, one report", () => {
  it.each([
    '"id " + handle',
    'handle + "id"',
    "handle + handle",
  ])("text(%s) is the operator's report alone", (sum) => {
    const body = tile(`text(${sum})`);
    expect(diagnostics(body)).toEqual([operated(body, sum, "+")]);
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
    expect(diagnostics(body)).toEqual([]);
  });

  it.each([
    'text(if handle == EffectId.none then "idle" else "busy")',
    "text((handle != EffectId.none).show)",
    'for x in hs text("row") {key: x}',
  ])("renders what is derived from a handle: %s", (expr) => {
    expect(diagnostics(tile(expr))).toEqual([]);
  });

  it.each([
    ["an Option of a handle, which renders its tag", "o"],
    ["a record that holds a handle, which does not render its fields", "r"],
  ])("leaves %s alone", (_label, v) => {
    expect(diagnostics(tile(`text(${v}), text(${v}.show)`))).toEqual([]);
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
    expect(diagnostics(body)).toEqual([]);
  });

  it("renders a File", () => {
    expect(
      diagnostics(`tile F in=File = column(text($1), text($1.show))\n${tile("text(t)")}`),
    ).toEqual([]);
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
    const src = page("text(h), heading(h), text(h.show)");
    expect(compile(src, { runtimeSpecifier: "./runtime.js" }).kind).toBe("fail");
    const message = (renderer: string) =>
      `${renderer} cannot render EffectId — it is an opaque handle`;
    expect(locatedOf(src)).toEqual([
      { code: "E0204", message: message("text(...)"), line: 4, col: 26 },
      { code: "E0204", message: message("heading(...)"), line: 4, col: 38 },
      { code: "E0204", message: message(".show"), line: 4, col: 47 },
    ]);
  });

  it("builds what the page derives from the handle instead", () => {
    compileOrFail(
      page('text(if h == EffectId.none then "idle" else "sent"), text((h != EffectId.none).show)'),
    );
  });
});
