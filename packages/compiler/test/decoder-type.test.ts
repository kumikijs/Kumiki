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
