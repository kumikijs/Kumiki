// `HttpBody(T)` is the type of a request body, `Json` carrying the program's `T`, and
// `IndexRange(K)` the range an `indexed-query` reads, over keys of the program's `K`. http.md
// declares the standard effects' requests with both.

import { describe, expect, it } from "vitest";
import { codesOf, locatedSummariesOf, posOf } from "./helpers/diagnostics.ts";
import { withApp, withReducer } from "./helpers/programs.ts";

const NOTE = "type Note = {id: Text, at: Int}";

const HTTP_SEND = `{
                   url: Url,
                   headers: Map(Text, Text),
                   query: Map(Text, Text),
                   body: HttpBody(Note),
                   decode: Decoder
                 }`;

const QUERY = "{store: Text, index: Option(Text), range: Option(IndexRange(Int))}";

/** The request records http.md declares with a body or a range, as written there. */
const DECLARED: [effect: string, cap: string, inType: string, out: string][] = [
  ["http-post", "http.post", HTTP_SEND, "Result(Text, HttpError)"],
  ["http-put", "http.put", HTTP_SEND, "Result(Text, HttpError)"],
  ["http-patch", "http.patch", HTTP_SEND, "Result(Text, HttpError)"],
  ["http-delete", "http.delete", HTTP_SEND, "Result(Text, HttpError)"],
  ["indexed-query", "indexed.read", QUERY, "Result(List(Note), Text)"],
];

/** An `http-post` declared as http.md declares it, emitted with `body`. */
const posted = (body: string): string =>
  withReducer(
    `${NOTE}
effect http-post cap=http.post in=${HTTP_SEND} out=Result(Text, HttpError)`,
    `emit http-post({url: "/notes", headers: {}, query: {}, body: ${body}, decode: Decoder.Text})`,
    { caps: "http.post" },
  );

/** An `indexed-query` declared as http.md declares it, emitted with `range`. */
const queried = (range: string): string =>
  withReducer(
    `${NOTE}
effect indexed-query cap=indexed.read in=${QUERY} out=Result(List(Note), Text)`,
    `emit indexed-query({store: "notes", index: Some("at"), range: ${range}})`,
    { caps: "indexed.read" },
  );

const VARIANTS = [
  `Json({id: "a", at: 1})`,
  `Form({"a": "b"})`,
  `Multipart({"a": TextV("b")})`,
  `Text("t")`,
  `Bytes(Bytes.from-text("b"))`,
  "Empty",
];

describe("the declarations http.md writes", () => {
  it.each(DECLARED)("checks %s as written", (effect, cap, inType, out) => {
    const defs = `${NOTE}\neffect ${effect} cap=${cap} in=${inType} out=${out}\ntile App = text("x")`;
    expect(locatedSummariesOf(withApp(defs, { caps: cap }))).toEqual([]);
  });

  it.each([
    ["HttpBody", "body: HttpBody"],
    ["IndexRange", "range: Option(IndexRange)"],
  ])("reports %s written without the type it is generic in", (_name, field) => {
    const src = withApp(
      `effect e cap=custom.thing in={${field}} out=Result(Unit, Text)\ntile App = text("x")`,
    );
    expect(codesOf(src)).toEqual(["E0210"]);
  });
});

describe("a body declared HttpBody(T)", () => {
  it.each(VARIANTS)("takes the variant %s", (body) => {
    expect(locatedSummariesOf(posted(body))).toEqual([]);
  });

  it("holds Json's payload to T", () => {
    const src = posted(`Json({id: "a", at: "noon"})`);
    const { line, col } = posOf(src, `"noon"`);
    expect(locatedSummariesOf(src)).toEqual([`E0202 ${line}:${col} Expected Int but got Text`]);
  });

  it.each([
    ["a record, which Json(…) carries", `{id: "a", at: 1}`, "{id: Text, at: Int}"],
    ["a bare Text, which Text(…) carries", `"t"`, "Text"],
  ])("refuses %s at the value", (_what, body, actual) => {
    const src = posted(body);
    const { line, col } = posOf(src, `body: ${body}`);
    expect(locatedSummariesOf(src)).toEqual([
      `E0202 ${line}:${col + "body: ".length} Expected HttpBody(Note) but got ${actual}`,
    ]);
  });

  it("refuses a tag HttpBody does not declare", () => {
    const src = posted(`TextV("t")`);
    const { line, col } = posOf(src, `TextV("t")`);
    expect(locatedSummariesOf(src)).toEqual([
      `E0216 ${line}:${col} Variant "TextV" is not a member of type "HttpBody(Note)"`,
    ]);
  });

  const ARMS = `| Json(n) -> n.id | Form(_) -> "form" | Multipart(_) -> "multipart" | Text(t) -> t | Bytes(_) -> "bytes"`;

  it("is matched over its six variants", () => {
    const src = withApp(`${NOTE}
fn kind(b: HttpBody(Note)) -> Text = match b with ${ARMS} | Empty -> "empty"
tile App = text(kind(Empty))`);
    expect(locatedSummariesOf(src)).toEqual([]);
  });

  it("is E0227 in a match that leaves Empty out", () => {
    const src = withApp(`${NOTE}
fn kind(b: HttpBody(Note)) -> Text = match b with ${ARMS}
tile App = text(kind(Empty))`);
    expect(codesOf(src)).toEqual(["E0227"]);
  });
});

describe("a map-request's body, which is not checked for its type", () => {
  it.each([...VARIANTS, `{sku: $1}`, "$1", "[1, 2]"])("takes %s", (body) => {
    const src = withApp(
      `effect send cap=http.post in=Text out=Result(Text, HttpError)
           map-request={url: "/x", body: ${body}, decode: Decoder.Text}
tile App = text("x")`,
      { caps: "http.post" },
    );
    expect(locatedSummariesOf(src)).toEqual([]);
  });
});

describe("a program's own union that shares a tag with HttpBody", () => {
  const box = (extra: string): string =>
    withReducer(`type Box = Full(Int) | Empty\nslot b : Box = Empty\n${extra}`, "b := Full(1)");

  it("keeps Empty as its own", () => {
    const src = box(`fn label(x: Box) -> Text = match x with | Full(n) -> n.show | Empty -> "empty"
reducer clear on=app.start do= b := Empty`);
    expect(locatedSummariesOf(src)).toEqual([]);
  });

  it("is the type a match on it covers", () => {
    const src = box(`fn label(x: Box) -> Text = match x with | Full(n) -> n.show`);
    const { line, col } = posOf(src, "match x");
    expect(locatedSummariesOf(src)).toEqual([
      `E0227 ${line}:${col} This match on "Box" has no arm for Empty, and a match used as a value has to evaluate to one of its arms. Add the missing arms, or end with \`_ -> …\``,
    ]);
  });

  it("does not take HttpBody's other tags", () => {
    const src = box(`reducer fill on=app.start do= b := Json(1)`);
    const { line, col } = posOf(src, "Json(1)");
    expect(locatedSummariesOf(src)).toEqual([
      `E0216 ${line}:${col} Variant "Json" is not a member of type "Box"`,
    ]);
  });

  it("names Text and Json as variants of its own", () => {
    const src = withReducer(
      `type Payload = Text(Text) | Json(Int)
slot p : Payload = Text("a")
fn size(x: Payload) -> Int = match x with | Text(t) -> t.length | Json(n) -> n`,
      "p := Json(size(p))",
    );
    expect(locatedSummariesOf(src)).toEqual([]);
  });
});

describe("a range declared IndexRange(K)", () => {
  it.each([
    ["both bounds", `Some({lower: Some(1), upper: Some(9), lowerOpen: false, upperOpen: true})`],
    ["one bound", `Some({lower: None, upper: Some(9), lowerOpen: false, upperOpen: false})`],
    ["no range", "None"],
  ])("takes %s", (_what, range) => {
    expect(locatedSummariesOf(queried(range))).toEqual([]);
  });

  it.each([
    [
      "a bound of another type",
      `Some({lower: Some("a"), upper: None, lowerOpen: false, upperOpen: false})`,
      `"a"`,
      "Expected Int but got Text",
    ],
    [
      "an open flag that is not a Bool",
      `Some({lower: None, upper: None, lowerOpen: "no", upperOpen: false})`,
      `"no"`,
      "Expected Bool but got Text",
    ],
  ])("refuses %s at the value", (_what, range, at, message) => {
    const src = queried(range);
    const { line, col } = posOf(src, at);
    expect(locatedSummariesOf(src)).toEqual([`E0202 ${line}:${col} ${message}`]);
  });

  it("refuses a range that leaves out the open flags", () => {
    expect(codesOf(queried(`Some({lower: Some(1), upper: None})`))).toEqual(["E0214", "E0214"]);
  });

  it("is a record a slot holds and a fn reads", () => {
    const range = `{lower: Some("a"), upper: None, lowerOpen: false, upperOpen: false}`;
    const src = withApp(`slot r : IndexRange(Text) = ${range}
fn from(x: IndexRange(Text)) -> Text = x.lower.get-or("")
tile App = text(from(r))`);
    expect(locatedSummariesOf(src)).toEqual([]);
  });
});
