// The fields an effect's `map-request` may build, per capability (http.md
// §6.6.1). The built-in handler reads the fields its request defines and
// nothing else, so a field outside that set is a value no handler reads: a
// misspelt `headers` is a header that is never sent. The checker holds a
// record literal's fields to the set and names the nearest one.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

type Diagnostic = { code: string; kind: string; message: string; line: number; col: number };

function diagnose(source: string): Diagnostic[] {
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    kind: e.kind,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

/** The text at a diagnostic's own line and column, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

/** A program with one effect on `cap` whose `map-request` is `request`. */
function program(cap: string, request: string, types = ""): string {
  const out = cap.startsWith("http.") ? "Result(Text, HttpError)" : "Result(Unit, Text)";
  return `${types}
effect run cap=${cap} in=Text out=${out}
           map-request=${request}
tile Home = text("x")
app M caps=[${cap}] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

/** The fields each capability's request has, as http.md §6.6.1 lists them. */
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

describe("a map-request field its capability's request does not have", () => {
  // The issue's program: `headrs` is a misspelt `headers`, and `nope` is close
  // to nothing.
  const issue = `effect loadNote cap=http.get
                in=Unit
                out=Result(Text, HttpError)
                map-request={url: "/api/note", decode: Decoder.Text, headrs: {"X": "1"}, nope: 1}
tile Home = text("x")
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;

  it("is E0215 at the field, naming the nearest field the request has", () => {
    const [headrs, nope, ...rest] = diagnose(issue);
    expect(rest).toEqual([]);
    expect(headrs?.code).toBe("E0215");
    expect(headrs?.kind).toBe("unknown-record-field");
    expect(headrs?.message).toContain('"headrs"');
    expect(headrs?.message).toContain('did you mean "headers"?');
    expect(headrs?.message).toContain("http.get");
    expect(textAt(issue, headrs ?? { line: 0, col: 0 })).toMatch(/^headrs:/);
    expect(nope?.code).toBe("E0215");
    expect(textAt(issue, nope ?? { line: 0, col: 0 })).toMatch(/^nope:/);
  });

  it("names no field when none is close, and lists the ones the request has", () => {
    const nope = diagnose(issue).find((d) => d.message.includes('"nope"'));
    expect(nope?.code).toBe("E0215");
    expect(nope?.message).not.toContain("did you mean");
    expect(nope?.message).toContain("url, headers, query, decode");
  });

  // `method`, `timeout` and `credentials` are not the request's: the method is
  // the capability, and the other two are `app.http`'s (§6.3.1).
  it.each(["method", "timeout", "credentials"])("refuses %s on http.get", (field) => {
    const found = diagnose(program("http.get", `{url: "/x", ${field}: "x"}`));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0215", "unknown-record-field"]]);
    expect(found[0]?.message).toContain(`"${field}"`);
  });
});

describe("the fields are the capability's own", () => {
  it.each(FIELDS)("%s accepts every field its request has", (cap, fields) => {
    expect(diagnose(program(cap, record(fields)))).toEqual([]);
  });

  // Every field some other capability's request has, and this one's does not.
  const everyField = [...new Set(FIELDS.flatMap(([, fields]) => fields))];
  const foreign = FIELDS.flatMap(([cap, fields]) =>
    everyField.filter((f) => !fields.includes(f)).map((f) => [cap, f] as [string, string]),
  );

  it.each(foreign)("%s refuses %s", (cap, field) => {
    const found = diagnose(program(cap, record([...fieldsOf(cap).slice(0, 1), field])));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0215", "unknown-record-field"]]);
    expect(found[0]?.message).toContain(`"${field}"`);
    expect(found[0]?.message).toContain(cap);
  });

  // §6.7.2 declares `storage-read` as `in={key: Text, decode: Decoder}`.
  it("accepts decode on storage.read", () => {
    const source = program("storage.read", `{key: $1, decode: Decoder.Json(Text)}`).replace(
      "Result(Unit, Text)",
      "Result(Option(Text), Text)",
    );
    expect(diagnose(source)).toEqual([]);
  });

  it("refuses url, an http field, on storage.read", () => {
    const source = program("storage.read", `{key: $1, url: "/x"}`);
    const [url, ...rest] = diagnose(source);
    expect(rest).toEqual([]);
    expect(url?.code).toBe("E0215");
    expect(url?.message).toContain('"url"');
    expect(url?.message).toContain("storage.read");
    expect(url?.message).toContain("key, decode");
    expect(url?.message).not.toContain("did you mean");
    expect(textAt(source, url ?? { line: 0, col: 0 })).toMatch(/^url:/);
  });
});

describe("where the record is written", () => {
  it("checks each branch of an if that builds the request", () => {
    const source = program(
      "http.get",
      `if $1 == "" then {url: "/a"} else {urll: "/b", decode: Decoder.Text}`,
    );
    const found = diagnose(source);
    expect(found.map((d) => d.code)).toEqual(["E0215"]);
    expect(found[0]?.message).toContain('did you mean "url"?');
    expect(textAt(source, found[0] ?? { line: 0, col: 0 })).toMatch(/^urll:/);
  });

  it("checks the body of a let and each arm of a match", () => {
    const source = `effect run cap=http.get in=Option(Text) out=Result(Text, HttpError)
           map-request=let base = "/a" in match $1 with
                         | Some(q) -> {url: base, qurey: {"q": q}}
                         | None    -> {url: base}
tile Home = text("x")
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
    const found = diagnose(source);
    expect(found.map((d) => d.code)).toEqual(["E0215"]);
    expect(found[0]?.message).toContain('did you mean "query"?');
    expect(textAt(source, found[0] ?? { line: 0, col: 0 })).toMatch(/^qurey:/);
  });

  // A literal with quoted keys is a map, and lowers to the same object.
  it("checks a map literal's text keys", () => {
    const source = program("http.get", `{"url": "/a", "decod": Decoder.Text}`);
    const found = diagnose(source);
    expect(found.map((d) => d.code)).toEqual(["E0215"]);
    expect(found[0]?.message).toContain('did you mean "decode"?');
    expect(textAt(source, found[0] ?? { line: 0, col: 0 })).toMatch(/^"decod"/);
  });
});

describe("a capability with no request schema", () => {
  // A custom capability's request goes to its host provider as built, and
  // that provider reads whatever it reads.
  it("leaves a custom capability's map-request alone", () => {
    const source = `effect track cap=telemetry.track in={n: Text} out=Unit map-request={name: $1.n}
tile Home = text("x")
app M caps=[telemetry.track] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(check(parse(lex(source)), { capabilities: ["telemetry.track"] })).toEqual([]);
  });

  // A declared effect on `log.write` has no built-in handler either: its
  // request reaches only a host provider.
  it("leaves a standard capability with no built-in handler alone", () => {
    const source = `effect ping cap=log.write in=Unit out=Unit map-request={level: "info", message: "ping"}
tile Home = text("x")
app M caps=[log.write] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(diagnose(source)).toEqual([]);
  });

  // `http.cancel` takes no `map-request` at all, which E0303 says once.
  it("reports a map-request on http.cancel as E0303 alone", () => {
    const source = `effect cancel cap=http.cancel in=EffectId out=Unit map-request={nope: 1}
tile Home = text("x")
app M caps=[http.cancel] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(diagnose(source).map((d) => d.code)).toEqual(["E0303"]);
  });
});

function fieldsOf(cap: string): string[] {
  return FIELDS.find(([c]) => c === cap)?.[1] ?? [];
}
