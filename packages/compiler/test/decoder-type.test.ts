// `Decoder` is the type of what `Decoder.Json(T)`, `Decoder.Text`, `Decoder.Bytes` and
// `Decoder.None` build. The handler decodes the answer by it, so a `decode` holding anything
// else names no decoding.

import { describe, expect, it } from "vitest";
import { locatedSummariesOf, posOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

/** The request records http.md declares with a `decode: Decoder` field, as written there. */
const DECLARED: [effect: string, cap: string, inType: string, out: string][] = [
  [
    "http-get",
    "http.get",
    `{
                  url: Url,
                  headers: Map(Text, Text),
                  query: Map(Text, Text),
                  decode: Decoder
                }`,
    "Result(Text, HttpError)",
  ],
  ["storage-read", "storage.read", "{key: Text, decode: Decoder}", "Result(Option(Text), Text)"],
  ["session-read", "session.read", "{key: Text, decode: Decoder}", "Result(Option(Text), Text)"],
  [
    "indexed-read",
    "indexed.read",
    "{store: Text, key: Text, decode: Decoder}",
    "Result(Option(Text), Text)",
  ],
];

const DECODERS = ["Decoder.Json(Text)", "Decoder.Text", "Decoder.Bytes", "Decoder.None"];

/** A storage read declared as http.md declares it, emitted with `request`. */
const emitted = (request: string): string =>
  withApp(
    `effect storage-read cap=storage.read
                    in={key: Text, decode: Decoder}
                    out=Result(Option(Text), Text)
tile B = button(text="x")
tile App = column(B)
reducer r on=ui.click(B) do= emit storage-read(${request})`,
    { caps: "storage.read" },
  );

/** A storage read on `in=${input}` whose `map-request` is `request`, plus `extra` definitions. */
const mapped = (request: string, input = "Text", extra = ""): string =>
  withApp(
    `slot mode : Text = "text"
${extra}
effect load cap=storage.read
            in=${input}
            out=Result(Option(Text), Text)
            map-request=${request}
tile App = text("x")`,
    { caps: "storage.read" },
  );

/** One E0201 naming `actual`, at `value` where `src` first writes it. */
const refusedAt = (src: string, value: string, actual: string): string[] => {
  const { line, col } = posOf(src, value);
  return [`E0201 ${line}:${col} Expected Decoder but got ${actual}`];
};

describe("the request records http.md declares", () => {
  it.each(DECLARED)("checks %s's in= as written", (effect, cap, inType, out) => {
    const src = withApp(
      `effect ${effect} cap=${cap}
                in=${inType}
                out=${out}
tile App = text("x")`,
      { caps: cap },
    );
    expect(locatedSummariesOf(src)).toEqual([]);
  });

  it.each(DECODERS)("takes %s as the decode an emit passes", (decoder) => {
    expect(locatedSummariesOf(emitted(`{key: "note", decode: ${decoder}}`))).toEqual([]);
  });

  it("refuses a decode that is not a Decoder as the emit's argument, at the value", () => {
    const src = emitted(`{key: "note", decode: "TEXT"}`);
    const { line, col } = posOf(src, `"TEXT"`);
    expect(locatedSummariesOf(src)).toEqual([`E0202 ${line}:${col} Expected Decoder but got Text`]);
  });
});

describe("a map-request's decode", () => {
  it.each(DECODERS)("takes %s", (decoder) => {
    expect(locatedSummariesOf(mapped(`{key: $1, decode: ${decoder}}`))).toEqual([]);
  });

  it.each([
    ["a Text literal", `"TEXT"`, `"TEXT"`, "Text"],
    ["a Text slot", "mode", "mode}", "Text"],
    ["the effect's Text input", "$1", "$1}", "Text"],
    ["an Int", "1", "1}", "Int"],
    ["a record", "{kind: mode}", "{kind: mode}", "{kind: Text}"],
    ["an Option's None", "None", "None}", 'variant "None"'],
    ["a tag no type declares", "Nonsense", "Nonsense}", 'variant "Nonsense"'],
    ["{}", "{}", "{}}", "{}, an empty Map, Set or record"],
  ])("refuses %s at the value", (_what, value, at, actual) => {
    const src = mapped(`{key: "note", decode: ${value}}`);
    expect(locatedSummariesOf(src)).toEqual(refusedAt(src, at, actual));
  });

  it.each([
    [
      "each branch of an if",
      `if $1 == "" then {key: "a", decode: Decoder.Text} else {key: $1, decode: mode}`,
      "Text",
      "mode}",
    ],
    ["the body of a let", "let d = mode in {key: $1, decode: d}", "Text", "d}"],
    [
      "an arm of a match",
      'match $1 with | Some(k) -> {key: k, decode: k} | None -> {key: "none", decode: Decoder.Text}',
      "Option(Text)",
      "k}",
    ],
    // A literal with quoted keys is a map, and lowers to the same object.
    ["a map literal's text key", `{"key": $1, "decode": mode}`, "Text", "mode}"],
  ])("checks the value where %s writes it", (_where, request, input, at) => {
    const src = mapped(request, input);
    expect(locatedSummariesOf(src)).toEqual(refusedAt(src, at, "Text"));
  });

  it.each([
    ["the effect's input", "{key: $1.key, decode: $1.decode}", "{key: Text, decode: Decoder}", ""],
    ["a let", "let d = Decoder.Text in {key: $1, decode: d}", "Text", ""],
    [
      "a fn that answers one",
      "{key: $1, decode: pick($1)}",
      "Text",
      `fn pick(k: Text) -> Decoder = if k == "raw" then Decoder.Text else Decoder.Json(Text)`,
    ],
  ])("takes a Decoder read from %s", (_from, request, input, extra) => {
    expect(locatedSummariesOf(mapped(request, input, extra))).toEqual([]);
  });
});

describe("a Decoder is no other type", () => {
  it.each(DECODERS)("refuses %s where a Text goes", (decoder) => {
    const src = withApp(`slot t : Text = ""
tile B = button(text="x")
tile App = column(B, text(t))
reducer r on=ui.click(B) do= t := ${decoder}`);
    const { line, col } = posOf(src, decoder);
    expect(locatedSummariesOf(src)).toEqual([`E0201 ${line}:${col} Expected Text but got Decoder`]);
  });
});

describe("the decode an effect with no map-request declares in its input", () => {
  /** A storage read on `in=${input}` emitted with `request`, which goes to the handler as is. */
  const declared = (input: string, request: string, extra = ""): string =>
    withApp(
      `${extra}
effect r cap=storage.read in=${input} out=Result(Option(Text), Text)
tile B = button(text="x")
tile App = column(B)
reducer go on=ui.click(B) do= emit r(${request})`,
      { caps: "storage.read" },
    );
  const why = `with no map-request, effect "r"'s input is the storage.read request`;

  it.each([
    ["a Text", "{key: Text, decode: Text}", `{key: "k", decode: "TEXT"}`, "decode: Text", "Text"],
    ["an Int", "{key: Text, decode: Int}", `{key: "k", decode: 1}`, "decode: Int", "Int"],
    [
      "an Option of a Decoder",
      "{key: Text, decode: Option(Decoder)}",
      `{key: "k", decode: Some(Decoder.Text)}`,
      "decode: Option",
      "Option(Decoder)",
    ],
  ])("refuses %s, once, at the type the field declares", (_what, input, request, at, actual) => {
    const src = declared(input, request);
    const { line, col } = posOf(src, at);
    expect(locatedSummariesOf(src)).toEqual([
      `E0201 ${line}:${col + "decode: ".length} Expected Decoder but got ${actual}: ${why}`,
    ]);
  });

  it("refuses it through an alias, at the name the effect declares", () => {
    const src = declared(
      "Req",
      `{key: "k", decode: "TEXT"}`,
      "type Req = {key: Text, decode: Text}",
    );
    const { line, col } = posOf(src, "in=Req");
    expect(locatedSummariesOf(src)).toEqual([
      `E0201 ${line}:${col + "in=".length} Expected Decoder but got Text: ${why}`,
    ]);
  });

  it("leaves the input of an effect whose map-request builds the request to it", () => {
    const src = mapped("{key: $1.key, decode: Decoder.Text}", "{key: Text, decode: Text}");
    expect(locatedSummariesOf(src)).toEqual([]);
  });

  it("leaves a decode on a capability whose request has none", () => {
    const src = withApp(
      `effect w cap=storage.write in={key: Text, value: Text, decode: Text} out=Result(Unit, Text)
tile App = text("x")`,
      { caps: "storage.write" },
    );
    expect(locatedSummariesOf(src)).toEqual([]);
  });
});

describe("the decode of an indexed.read by key", () => {
  const RECORD = "an indexed.read by key reads a stored record, which has no text to read";
  /** An indexed read whose `map-request` is `request`, on `in=${input}`. */
  const indexed = (request: string, input = "Text"): string =>
    withApp(
      `slot pick : Decoder = Decoder.Text
effect r cap=indexed.read in=${input} out=Result(Option(Text), Text) map-request=${request}
tile App = text("x")`,
      { caps: "indexed.read" },
    );
  const refused = (src: string, at: string, decoder: string, code = "E0201"): string[] => {
    const { line, col } = posOf(src, at);
    return [
      `${code} ${line}:${col} Expected Decoder.Json(T) or Decoder.None but got ${decoder}: ${RECORD}`,
    ];
  };

  it.each(["Decoder.Text", "Decoder.Bytes"])("refuses %s written as the value", (decoder) => {
    const src = indexed(`{store: "s", key: $1, decode: ${decoder}}`);
    expect(locatedSummariesOf(src)).toEqual(refused(src, `${decoder}}`, decoder));
  });

  it("refuses one a branch of the value writes", () => {
    const src = indexed(
      `{store: "s", key: $1, decode: if $1 == "" then Decoder.None else Decoder.Bytes}`,
    );
    expect(locatedSummariesOf(src)).toEqual(refused(src, "Decoder.Bytes}", "Decoder.Bytes"));
  });

  it.each(["Decoder.Json(Text)", "Decoder.None"])("takes %s", (decoder) => {
    expect(locatedSummariesOf(indexed(`{store: "s", key: $1, decode: ${decoder}}`))).toEqual([]);
  });

  it("leaves a decoder held in a name to run time", () => {
    expect(locatedSummariesOf(indexed(`{store: "s", key: $1, decode: pick}`))).toEqual([]);
  });

  it("refuses it in an emit's argument, which goes to the handler as is", () => {
    const src = withApp(
      `effect r cap=indexed.read in={store: Text, key: Text, decode: Decoder} out=Result(Option(Text), Text)
tile B = button(text="x")
tile App = column(B)
reducer go on=ui.click(B) do= emit r({store: "s", key: "k", decode: Decoder.Text})`,
      { caps: "indexed.read" },
    );
    expect(locatedSummariesOf(src)).toEqual(refused(src, "Decoder.Text}", "Decoder.Text", "E0202"));
  });
});

describe("a map-request's decode, where a let and a match both bind", () => {
  it.each([
    [
      "a let inside a match arm",
      'match $1 with | Some(k) -> let d = Decoder.Text in {key: k, decode: d} | None -> let e = mode in {key: "none", decode: e}',
    ],
    [
      "a match inside a let",
      'let e = mode in match $1 with | Some(k) -> {key: k, decode: Decoder.Text} | None -> {key: "none", decode: e}',
    ],
  ])("checks the value %s binds", (_where, request) => {
    const src = mapped(request, "Option(Text)");
    expect(locatedSummariesOf(src)).toEqual(refusedAt(src, "e}", "Text"));
  });
});

describe("a Decoder rendered as text is E0204", () => {
  const rendered = (content: string): string =>
    withApp(`slot d : Decoder = Decoder.Json(Email)
tile App = column(${content})`);
  it.each([
    ["text(d)", "d)", "text(...)"],
    ["button(text=d)", "d)", "button(...)"],
    ['text(fmt("{0}", d))', "d))", "fmt(...)"],
    ["text(d.show)", "d.show", ".show"],
    ["text(d.show())", "d.show", ".show"],
    ["text(Decoder.show(d))", "d))", ".show"],
    ['text("show=" + d)', "d)", 'Operator "+"'],
  ])("%s", (content, at, renderer) => {
    const src = rendered(content);
    const { line, col } = posOf(src, at);
    expect(locatedSummariesOf(src)).toEqual([
      `E0204 ${line}:${col} ${renderer} cannot render Decoder — it is an opaque handle`,
    ]);
  });
});

describe("== and != on a type holding a Decoder are E0201", () => {
  it.each([
    ["two Decoders", "Decoder", "x == Decoder.Json(Int)", "Decoder", "Decoder", "is"],
    ["!= on two Decoders", "Decoder", "x != Decoder.Text", "Decoder", "Decoder", "is"],
    [
      "records holding one",
      "{d: Decoder}",
      "x == {d: Decoder.Text}",
      "{d: Decoder}",
      "{d: Decoder}",
      "holds",
    ],
    ["Lists of them", "List(Decoder)", "x == []", "List(Decoder)", "List(?)", "holds"],
    ["an Option of one", "Option(Decoder)", "x == None", "Option(Decoder)", "Option(?)", "holds"],
  ])("%s", (_what, param, body, lt, rt, holds) => {
    const src = withApp(`fn f(x: ${param}) -> Bool = ${body}
tile App = text("x")`);
    const { line, col } = posOf(src, body);
    const why =
      holds === "is" ? "a Decoder has no equality" : `${lt} holds a Decoder, which has no equality`;
    expect(locatedSummariesOf(src)).toEqual([
      `E0201 ${line}:${col} Operator "${body.includes("!=") ? "!=" : "=="}" cannot compare ${lt} with ${rt}: ${why}`,
    ]);
  });
});

describe("a Decoder as a Map key or a Set element is E0204", () => {
  const typed = (type: string, extra = ""): string =>
    withApp(`${extra}
slot s : ${type} = {}
tile App = text("x")`);
  const WHY = "— it is an opaque handle";
  it.each([
    ["a Set of Decoders", "Set(Decoder)", "Decoder)", "A Decoder cannot be a Set element"],
    ["a Map from Decoders", "Map(Decoder, Int)", "Decoder,", "A Decoder cannot be a Map key"],
    [
      "a Map from records holding one",
      "Map({d: Decoder}, Int)",
      "{d: Decoder}",
      "A Map key of type {d: Decoder} cannot hold a Decoder",
    ],
    [
      "a Set of Options of one",
      "Set(Option(Decoder))",
      "Option(Decoder)",
      "A Set element of type Option(Decoder) cannot hold a Decoder",
    ],
    [
      "a Set of an alias holding one",
      "Set(Holder)",
      "Holder)",
      "A Set element of type Holder cannot hold a Decoder",
    ],
    [
      "a generic that keys a Set by its argument",
      "Bag(Decoder)",
      "Bag(Decoder)",
      "Bag(Decoder): a Decoder cannot be a Set element",
    ],
  ])("refuses %s, at the key", (_what, type, at, message) => {
    const src = typed(type, "type Holder = {d: Decoder}\ntype Bag(T) = Set(T)");
    const { line, col } = posOf(src, `slot s : ${type}`);
    const offset = `slot s : ${type}`.indexOf(at);
    expect(locatedSummariesOf(src)).toEqual([`E0204 ${line}:${col + offset} ${message} ${WHY}`]);
  });

  it("refuses one a type definition writes, once, where it writes it", () => {
    const src = withApp(`type Bad = Set(Decoder)
slot s : Bad = {}
tile App = text("x")`);
    const { line, col } = posOf(src, "Decoder)");
    expect(locatedSummariesOf(src)).toEqual([
      `E0204 ${line}:${col} A Decoder cannot be a Set element ${WHY}`,
    ]);
  });

  it.each([
    ["a Map to Decoders", "Map(Text, Decoder)"],
    ["a List of them", "List(Decoder)"],
    ["a generic keying a Set by an Int", "Bag(Int)"],
  ])("takes %s", (_what, type) => {
    const src = withApp(`type Bag(T) = Set(T)
slot s : ${type} = ${type.startsWith("List") ? "[]" : "{}"}
tile App = text("x")`);
    expect(locatedSummariesOf(src)).toEqual([]);
  });
});

describe("the walk that looks for a Decoder", () => {
  // Each instantiation along two growing branches is new, so a walk bounded only per path would
  // enter about 2^32 of them before it reaches the Decoder the last variant holds.
  it("ends on a generic growing its argument along two branches", () => {
    const src = withApp(`type G(T) = Leaf(T) | Node(G(List(T)), G(Option(T))) | Held(Decoder)
fn f(x: G(Int)) -> Bool = x == x
slot s : Set(G(Int)) = {}
tile App = text("x")`);
    expect(locatedSummariesOf(src)).toEqual([
      'E0201 2:27 Operator "==" cannot compare G(Int) with G(Int): G(Int) holds a Decoder, which has no equality',
      "E0204 3:14 A Set element of type G(Int) cannot hold a Decoder — it is an opaque handle",
    ]);
  });
});
