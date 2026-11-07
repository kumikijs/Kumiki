// The built-in handler reads the fields its request defines and nothing else,
// so a field outside that set is a value it never reads: a misspelt `headers`
// is a header that is never sent.

import { describe, expect, it } from "vitest";
import { checkSource, codesOf, textAt } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

/** A program with one effect on `cap` whose `map-request` is `request`. */
function program(cap: string, request: string): string {
  const out = cap.startsWith("http.") ? "Result(Text, HttpError)" : "Result(Unit, Text)";
  return withApp(
    `effect run cap=${cap} in=Text out=${out}
           map-request=${request}
tile App = text("x")`,
    { caps: cap },
  );
}

/** Each request, as a message names it: its capability and the fields it has. */
const REQUESTS: [request: string, cap: string, fields: string[]][] = [
  ["http.get request", "http.get", ["url", "headers", "query", "decode"]],
  ["http.post request", "http.post", ["url", "headers", "query", "body", "decode"]],
  ["http.put request", "http.put", ["url", "headers", "query", "body", "decode"]],
  ["http.patch request", "http.patch", ["url", "headers", "query", "body", "decode"]],
  ["http.delete request", "http.delete", ["url", "headers", "query", "body", "decode"]],
  ["storage.read request", "storage.read", ["key", "decode"]],
  ["storage.write request", "storage.write", ["key", "value"]],
  ["session.read request", "session.read", ["key", "decode"]],
  ["session.write request", "session.write", ["key", "value"]],
  ["indexed.read request with a key", "indexed.read", ["store", "key", "decode"]],
  ["indexed.read request with no key", "indexed.read", ["store", "index", "range"]],
  ["indexed.write request", "indexed.write", ["store", "key", "value"]],
  ["indexed.delete request", "indexed.delete", ["store", "key"]],
];

/** A value of the right kind for each field, so a clean program is clean for the field alone. */
const VALUE: Record<string, string> = {
  url: `"/x"`,
  headers: `{"X-A": "1"}`,
  query: `{"q": $1}`,
  body: `Json($1)`,
  decode: "Decoder.Text",
  key: "$1",
  value: "$1",
  store: `"s"`,
  index: "None",
  range: "None",
};

const record = (fields: string[]): string =>
  `{${fields.map((f) => `${f}: ${VALUE[f] ?? "$1"}`).join(", ")}}`;

const at = (source: string, e: { pos: { line: number; col: number } } | undefined): string =>
  textAt(source, e?.pos ?? { line: 0, col: 0 });

describe("a map-request field its capability's request does not have", () => {
  // `headrs` is a misspelt `headers`, and `nope` is close to nothing.
  const misspelt = withApp(
    `effect loadNote cap=http.get
                in=Unit
                out=Result(Text, HttpError)
                map-request={url: "/api/note", decode: Decoder.Text, headrs: {"X": "1"}, nope: 1}
tile App = text("x")`,
    { caps: "http.get" },
  );

  it("is E0215 at the field, naming the nearest field the request has", () => {
    const [headrs, nope, ...rest] = checkSource(misspelt);
    expect(rest).toEqual([]);
    expect(headrs?.code).toBe("E0215");
    expect(headrs?.kind).toBe("unknown-record-field");
    expect(headrs?.message).toContain('"headrs"');
    expect(headrs?.message).toContain('did you mean "headers"?');
    expect(headrs?.message).toContain("http.get");
    expect(at(misspelt, headrs)).toMatch(/^headrs:/);
    expect(nope?.code).toBe("E0215");
    expect(at(misspelt, nope)).toMatch(/^nope:/);
  });

  it("names no field when none is close, and lists the ones the request has", () => {
    const nope = checkSource(misspelt).find((d) => d.message.includes('"nope"'));
    expect(nope?.code).toBe("E0215");
    expect(nope?.message).not.toContain("did you mean");
    expect(nope?.message).toContain("url, headers, query, decode");
  });

  // The method is the capability's, and `timeout` / `credentials` are `app.http`'s.
  it.each(["method", "timeout", "credentials"])("refuses %s on http.get", (field) => {
    const found = checkSource(program("http.get", `{url: "/x", ${field}: "x"}`));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0215", "unknown-record-field"]]);
    expect(found[0]?.message).toContain(`"${field}"`);
  });
});

describe("the fields are the capability's own", () => {
  it.each(REQUESTS)("the %s accepts every field it has", (_request, cap, fields) => {
    expect(checkSource(program(cap, record(fields)))).toEqual([]);
  });

  // Every field some other request has and this one does not, but `key`, which makes an
  // `indexed.read` request with no key one with a key.
  const everyField = [...new Set(REQUESTS.flatMap(([, , fields]) => fields))];
  const foreign = REQUESTS.flatMap(([request, cap, fields]) =>
    everyField
      .filter((f) => !fields.includes(f) && !(request.endsWith("with no key") && f === "key"))
      .map((f) => [request, f, cap, fields] as const),
  );

  it.each(foreign)("the %s refuses %s", (request, field, cap, fields) => {
    const found = checkSource(program(cap, record([...fields, field])));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0215", "unknown-record-field"]]);
    expect(found[0]?.message).toContain(`The ${request} has no field "${field}"`);
  });

  it("accepts decode on storage.read", () => {
    const source = program("storage.read", `{key: $1, decode: Decoder.Json(Text)}`).replace(
      "Result(Unit, Text)",
      "Result(Option(Text), Text)",
    );
    expect(checkSource(source)).toEqual([]);
  });

  it("refuses url, an http field, on storage.read", () => {
    const source = program("storage.read", `{key: $1, url: "/x"}`);
    const [url, ...rest] = checkSource(source);
    expect(rest).toEqual([]);
    expect(url?.code).toBe("E0215");
    expect(url?.message).toContain('"url"');
    expect(url?.message).toContain("storage.read");
    expect(url?.message).toContain("key, decode");
    expect(url?.message).not.toContain("did you mean");
    expect(at(source, url)).toMatch(/^url:/);
  });
});

// The built-in handler reads one record by key when the request names `key`, and runs a query
// over `index` and `range` when it does not, so each reads only its own fields.
describe("indexed.read, a read by key or a query", () => {
  it.each([
    [
      "a read by key refuses a query's index",
      `{store: "notes", key: $1, index: Some("by-date")}`,
      'The indexed.read request with a key has no field "index" (accepted: store, key, decode)',
      /^index:/,
    ],
    [
      "a query refuses a read's decode",
      `{store: "notes", range: None, decode: Decoder.Json(Text)}`,
      'The indexed.read request with no key has no field "decode" (accepted: store, index, range)',
      /^decode:/,
    ],
  ])("%s", (_, request, message, field) => {
    const source = program("indexed.read", request);
    const found = checkSource(source);
    expect(found.map((d) => [d.code, d.message])).toEqual([["E0215", message]]);
    expect(at(source, found[0])).toMatch(field);
  });

  it("decides each literal by its own fields", () => {
    const source = program(
      "indexed.read",
      `if $1 == "" then {store: "s", index: None} else {store: "s", key: $1, range: None}`,
    );
    const found = checkSource(source);
    expect(found.map((d) => d.message)).toEqual([
      'The indexed.read request with a key has no field "range" (accepted: store, key, decode)',
    ]);
  });
});

describe("where the record is written", () => {
  it.each([
    [
      "each branch of an if",
      program("http.get", `if $1 == "" then {url: "/a"} else {urll: "/b", decode: Decoder.Text}`),
      'did you mean "url"?',
      /^urll:/,
    ],
    [
      "the body of a let and each arm of a match",
      withApp(
        `effect run cap=http.get in=Option(Text) out=Result(Text, HttpError)
           map-request=let base = "/a" in match $1 with
                         | Some(q) -> {url: base, qurey: {"q": q}}
                         | None    -> {url: base}
tile App = text("x")`,
        { caps: "http.get" },
      ),
      'did you mean "query"?',
      /^qurey:/,
    ],
    // A literal with quoted keys is a map, and lowers to the same object.
    [
      "a map literal's text keys",
      program("http.get", `{"url": "/a", "decod": Decoder.Text}`),
      'did you mean "decode"?',
      /^"decod"/,
    ],
  ])("checks %s", (_where, source, hint, field) => {
    const found = checkSource(source);
    expect(found.map((d) => d.code)).toEqual(["E0215"]);
    expect(found[0]?.message).toContain(hint);
    expect(at(source, found[0])).toMatch(field);
  });
});

describe("a capability with no request schema", () => {
  // A custom capability's request goes to its host provider as built.
  it("leaves a custom capability's map-request alone", () => {
    const source = withApp(
      `effect track cap=telemetry.track in={n: Text} out=Unit map-request={name: $1.n}
tile App = text("x")`,
      { caps: "telemetry.track" },
    );
    expect(checkSource(source, { capabilities: ["telemetry.track"] })).toEqual([]);
  });

  // A declared effect on `log.write` reaches only a host provider.
  it("leaves a standard capability with no built-in handler alone", () => {
    const source = withApp(
      `effect ping cap=log.write in=Unit out=Unit map-request={level: "info", message: "ping"}
tile App = text("x")`,
      { caps: "log.write" },
    );
    expect(checkSource(source)).toEqual([]);
  });

  it("reports a map-request on http.cancel as E0303 alone", () => {
    const source = withApp(
      `effect cancel cap=http.cancel in=EffectId out=Unit map-request={nope: 1}
tile App = text("x")`,
      { caps: "http.cancel" },
    );
    expect(codesOf(source)).toEqual(["E0303"]);
  });
});
