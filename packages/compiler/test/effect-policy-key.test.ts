// An effect's own expressions — its `latest-per-key` key and its `map-request`.
//
// The checker tests come first: the key runs away from where it is written, so
// a name nothing checked there was a `ReferenceError` on the first dispatch
// rather than a diagnostic — the app imported, mounted and rendered first.
//
// The last block compiles a program, imports the generated module and runs one
// reducer, to pin *when* the key is evaluated: at the emit, against the slot
// values the reducer body has written so far.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

function diagnose(source: string): { code: string; message: string; line: number; col: number }[] {
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

function codes(source: string): string[] {
  return diagnose(source).map((e) => e.code);
}

/** The one diagnostic a source is expected to draw, so a position can be read off it. */
function only(source: string): { code: string; message: string; line: number; col: number } {
  const found = diagnose(source);
  expect(found).toHaveLength(1);
  const first = found[0];
  if (!first) throw new Error("expected one diagnostic");
  return first;
}

/** The text at a diagnostic's own line and column, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

/** A program whose only variable is the effect's `policy=` key. */
function app(key: string): string {
  return `slot query : Text = ""
effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key(${key})
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

/** The same program with the expression in `map-request`, which shares the key's scope. */
function mapRequestApp(expr: string): string {
  return `slot query : Text = ""
effect persist cap=storage.write in=Text out=Result(Unit, Text)
               map-request={key: ${expr}, value: $1}
tile B = button(text="b")
tile Home = column(B)
app M caps=[storage.write] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

describe("an effect's latest-per-key key is checked", () => {
  it("reports a misspelled name as E0103 at the key", () => {
    const source = app("quary");
    const at = only(source);
    expect(at.code).toBe("E0103");
    expect(at.message).toContain('"quary"');
    expect(textAt(source, at)).toMatch(/^quary/);
  });

  it("reports a built-in call missing its argument as E0213 at the key", () => {
    const source = app("Bytes.from-text()");
    const at = only(source);
    expect(at.code).toBe("E0213");
    expect(at.message).toContain("Bytes.from-text");
    expect(textAt(source, at)).toMatch(/^Bytes\.from-text\(\)/);
  });

  // The measurement that motivated the fix: before the key was walked, a
  // misspelled name built cleanly and lowered to a bare global, so the app
  // imported, mounted and rendered before dying on the first dispatch.
  it("no longer lowers an undefined name into the generated dispatch", () => {
    const result = compile(app("quary"), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
  });

  // The key's own binds, unchanged: `$1` is the effect's input, a slot is
  // readable (codegen lowers one through the live slot map), and a `fn` is
  // callable. None of these may become E0103 on the way to the two above.
  it.each([
    ["the effect input", "$1"],
    ["a slot", "query"],
    ["an expression over both", "$1 + query"],
  ])("accepts %s in the key", (_what, key) => {
    expect(codes(app(key))).toEqual([]);
  });

  it("accepts a fn call in the key", () => {
    const source = `slot query : Text = ""
fn norm(s: Text) -> Text = s
effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key(norm($1))
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(codes(source)).toEqual([]);
  });

  // `$route` is a payload field, and the key is applied to the effect's input
  // and nothing else — the same `no-payload` answer `map-request` gives, so
  // the name means nothing here rather than being a bind out of its scope.
  it("reports $route in the key as an undefined name", () => {
    expect(codes(app("$route.path"))).toEqual(["E0103"]);
  });

  // Every other policy carries no expression, so nothing new is walked.
  it("leaves a policy that carries no expression alone", () => {
    const source = `effect load cap=http.get in=Text out=Result(Text, HttpError) policy=debounce(300ms)
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(codes(source)).toEqual([]);
  });
});

// `map-request` shares `pureScope` with the key, so a change made for the key's
// sake changes `map-request` too. These pin its half of that scope.
describe("an effect's map-request is checked in the same scope", () => {
  it("reports a misspelled name as E0103", () => {
    const at = only(mapRequestApp("quary"));
    expect(at.code).toBe("E0103");
    expect(at.message).toContain('"quary"');
  });

  it.each([
    ["the effect input", "$1"],
    ["a slot", "query"],
  ])("accepts %s", (_what, expr) => {
    expect(codes(mapRequestApp(expr))).toEqual([]);
  });

  it("reports $route as an undefined name", () => {
    expect(codes(mapRequestApp("$route.path"))).toEqual(["E0103"]);
  });
});

/** A program whose one effect takes `in=${input}` and declares `clauses`. */
function inputApp(input: string, clauses: string): string {
  return `type UserQuery = {id: Text, size: Int}
type QueryAlias = UserQuery
type UserId = nominal Text
type Shape = Circle(Int) | Square(Int)
effect load cap=http.get in=${input} out=Result(Text, HttpError)
            ${clauses}
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

/** `inputApp` with `url` as the `map-request`'s url. */
function urlApp(input: string, url: string): string {
  return inputApp(input, `map-request={url: ${url}, decode: Decoder.Text}`);
}

// language.md §1.5.2: both expressions are applied to the effect's input, so
// `$1` is that input — with the type `in=` declares, the way a tile's `$1` has
// the type of its own `in=`. A member the type does not have is E0108 there as
// it is on a tile's `$1`.
describe("`$1` in an effect's own expressions has the effect's in= type", () => {
  it.each([
    ["map-request", `map-request={url: "/api/users/" + $1.idd, decode: Decoder.Text}`],
    ["the latest-per-key key", "policy=latest-per-key($1.idd)"],
  ])("reports a field the in= record lacks, in %s, as E0108 at the access", (_where, clauses) => {
    const source = inputApp("UserQuery", clauses);
    const at = only(source);
    expect(at.code).toBe("E0108");
    expect(at.message).toBe('Record type has no field or method ".idd"');
    expect(textAt(source, at)).toMatch(/^\$1\.idd/);
  });

  it.each([
    ["map-request", `map-request={url: "/api/users/" + $1.id, decode: Decoder.Text}`],
    ["the latest-per-key key", "policy=latest-per-key($1.id)"],
    [
      "map-request's query, headers and body",
      `map-request={url: "/u", query: {"size": $1.size.show}, headers: {"X-Id": $1.id}, body: Json({"id": $1.id}), decode: Decoder.Text}`,
    ],
  ])("accepts a field the in= record has, in %s", (_where, clauses) => {
    expect(codes(inputApp("UserQuery", clauses))).toEqual([]);
  });

  // The receiver the member table reads is the in= type through any alias or
  // `nominal`, as for every other receiver.
  it.each([
    ["an alias of a record", "QueryAlias", 'Record type has no field or method ".idd"'],
    ["a nominal over Text", "UserId", 'Type "Text" has no member ".idd"'],
    ["Text", "Text", 'Type "Text" has no member ".idd"'],
    ["Int", "Int", 'Type "Int" has no member ".idd"'],
    ["an Option", "Option(Text)", 'Type "Option" has no member ".idd"'],
    ["a List", "List(Text)", 'Type "List" has no member ".idd"'],
  ])("reports a member %s does not have as E0108", (_what, input, message) => {
    const at = only(urlApp(input, `"/u/" + $1.idd`));
    expect(at.code).toBe("E0108");
    expect(at.message).toBe(message);
  });

  it.each([
    ["an alias of a record", "QueryAlias", `"/u/" + $1.id`],
    ["a nominal over Text", "UserId", `"/u/" + $1 + $1.lower`],
    ["Text", "Text", `"/u/" + $1.lower`],
    ["Int", "Int", `"/u/" + $1 + "/" + $1.show`],
    ["an Option", "Option(Text)", `"/u/" + $1.get-or("none")`],
    ["a List", "List(Text)", `"/u/" + $1.join(",")`],
  ])("accepts what %s has", (_what, input, url) => {
    expect(codes(urlApp(input, url))).toEqual([]);
  });

  it("accepts Text as a latest-per-key key on in=Text", () => {
    expect(codes(inputApp("Text", "policy=latest-per-key($1)"))).toEqual([]);
  });

  // Not only member names: every check that reads an operand's type reads
  // `$1`'s, as it would anywhere else.
  it.each([
    ["map-request", "UserQuery", `map-request={url: "/u/" + ($1 * 2).show, decode: Decoder.Text}`],
    ["the latest-per-key key", "Text", "policy=latest-per-key($1 - 1)"],
  ])("reports an operator applied to an input of the wrong type, in %s, as E0201", (_w, input, clauses) => {
    const source = inputApp(input, clauses);
    const at = only(source);
    expect(at.code).toBe("E0201");
    expect(textAt(source, at)).toMatch(/^\$1 [*-]/);
  });

  // A union's members are not the member table's to judge, so a member read
  // on one draws nothing — as on a tile's `$1`. The operator still does.
  it("leaves a member of a union in= unjudged", () => {
    expect(codes(urlApp("Shape", `"/u/" + $1.idd`))).toEqual([]);
    expect(codes(urlApp("Shape", `"/u/" + ($1 * 2).show`))).toEqual(["E0201"]);
  });

  // An undecided `$1` reports nothing, which is the answer for these two:
  // `in=Unit` declares an effect emitted with no argument, so `$1` holds no
  // value to type; and an `in=` naming no type is E0117 already.
  it.each([
    ["Unit", "Unit", []],
    ["a type that does not exist", "Nope", ["E0117"]],
  ])("leaves the input undecided on %s", (_what, input, expected) => {
    const clauses = `policy=latest-per-key($1.idd)
            map-request={url: "/u/" + $1.idd + ($1 * 2).show, decode: Decoder.Text}`;
    expect(codes(inputApp(input, clauses))).toEqual(expected);
  });

  it("leaves the input undecided on Unit through an alias", () => {
    const source = `type Nothing = Unit
${inputApp("Nothing", `map-request={url: "/u/" + $1.idd + ($1 * 2).show, decode: Decoder.Text}`)}`;
    expect(codes(source)).toEqual([]);
  });
});

type LoadedApp = {
  live: Record<string, unknown>;
  reducers: {
    name: string;
    apply: (
      live: Record<string, unknown>,
      payload: Record<string, unknown>,
    ) => { slots: Record<string, unknown>; emits: { effect: string; key?: string }[] };
  }[];
};

/** Compile `source`, import the module from disk, and build one app instance. */
async function load(source: string): Promise<LoadedApp> {
  const result = compile(source, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok")
    expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  const dir = mkdtempSync(join(TMP_ROOT, "policy-key-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { createApp: () => LoadedApp } = await import(
    `${pathToFileURL(file).href}?t=${Date.now()}`
  );
  return mod.createApp();
}

/** A `latest-per-key(noteKey)` effect and one reducer `go` whose body is `body`. */
function keyedApp(body: string[]): string {
  const [first, ...rest] = body;
  return `slot noteKey : Text     = "a"
slot lastId  : EffectId = EffectId.none
effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key(noteKey)
reducer go on=ui.click(B) do= ${first}
${rest.map((s) => `                              ${s}`).join("\n")}
tile B = button(text="b", onClick=go)
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

/** Run `go` once against the declared defaults: the id it kept, and the key its emit record carries. */
async function runGo(body: string[]): Promise<{ id: unknown; key: unknown }> {
  const app = await load(keyedApp(body));
  const go = app.reducers.find((r) => r.name === "go");
  if (!go) expect.fail("no reducer named go");
  const { slots, emits } = go.apply(app.live, {});
  expect(emits.map((e) => e.effect)).toEqual(["load"]);
  return { id: slots.lastId, key: emits[0]?.key };
}

describe("a `latest-per-key` key is evaluated at the emit (http.md §6.4)", () => {
  // The key is computed once, where the emit runs in the reducer body: a slot
  // it reads has the value the body has written so far, and a write after the
  // emit is not seen. That one value is both the key the `emit` expression's id
  // is built from and the key the emit record carries to the dispatcher. That
  // the dispatcher runs the request under the carried key is pinned through the
  // real dispatcher in `packages/tests/emit-id-after-key-write.test.ts`.
  const EMIT = `lastId := emit load("x")`;

  it.each([
    ["a key write before the emit", [`noteKey := "b"`, EMIT], "b"],
    ["a key write after the emit", [EMIT, `noteKey := "b"`], "a"],
    [
      "an emit under `let … in`, after a key write",
      [`noteKey := "b"`, `lastId := let k = "x" in emit load(k)`],
      "b",
    ],
    [
      "an emit in a tuple `match` arm, after a key write",
      [`noteKey := "b"`, `lastId := match ("x", 1) with | (s, _) -> emit load(s)`],
      "b",
    ],
  ])("%s", { timeout: 30_000 }, async (_label, body, expected) => {
    const { id, key } = await runGo(body);
    expect(key).toBe(expected);
    expect(id).toBe(`load:${expected}`);
  });
});
