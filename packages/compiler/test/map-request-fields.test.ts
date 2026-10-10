// The built-in handler reads the fields its request defines and nothing else,
// so a field outside that set is a value no handler reads: a misspelt
// `headers` is a header that is never sent.

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

const FIELDS: [cap: string, fields: string[]][] = [
  ["http.get", ["url", "headers", "query", "decode"]],
  ["http.post", ["url", "headers", "query", "body", "decode"]],
  ["http.put", ["url", "headers", "query", "body", "decode"]],
  ["http.patch", ["url", "headers", "query", "body", "decode"]],
  ["http.delete", ["url", "headers", "query", "body", "decode"]],
  ["storage.read", ["key", "decode"]],
  ["storage.write", ["key", "value"]],
  ["session.read", ["key", "decode"]],
  ["session.write", ["key", "value"]],
  ["indexed.read", ["store", "key", "decode", "index", "range"]],
  ["indexed.write", ["store", "key", "value"]],
  ["indexed.delete", ["store", "key"]],
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

const fieldsOf = (cap: string): string[] => FIELDS.find(([c]) => c === cap)?.[1] ?? [];

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

  // The method is the capability, and `timeout` / `credentials` are `app.http`'s.
  it.each(["method", "timeout", "credentials"])("refuses %s on http.get", (field) => {
    const found = checkSource(program("http.get", `{url: "/x", ${field}: "x"}`));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0215", "unknown-record-field"]]);
    expect(found[0]?.message).toContain(`"${field}"`);
  });
});

describe("the fields are the capability's own", () => {
  it.each(FIELDS)("%s accepts every field its request has", (cap, fields) => {
    expect(checkSource(program(cap, record(fields)))).toEqual([]);
  });

  // Every field some other capability's request has, and this one's does not.
  const everyField = [...new Set(FIELDS.flatMap(([, fields]) => fields))];
  const foreign = FIELDS.flatMap(([cap, fields]) =>
    everyField.filter((f) => !fields.includes(f)).map((f) => [cap, f] as [string, string]),
  );

  it.each(foreign)("%s refuses %s", (cap, field) => {
    const found = checkSource(program(cap, record([...fieldsOf(cap).slice(0, 1), field])));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0215", "unknown-record-field"]]);
    expect(found[0]?.message).toContain(`"${field}"`);
    expect(found[0]?.message).toContain(cap);
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
