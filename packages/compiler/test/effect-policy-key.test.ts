import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { codesOf, type Located, locatedOf, textAt } from "./helpers/diagnostics.ts";
import { loadApp } from "./helpers/module.ts";

/** The one diagnostic a source is expected to draw, so a position can be read off it. */
function only(source: string): Located {
  const found = locatedOf(source);
  expect(found).toHaveLength(1);
  const first = found[0];
  if (!first) throw new Error("expected one diagnostic");
  return first;
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

  it("no longer lowers an undefined name into the generated dispatch", () => {
    const result = compile(app("quary"), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
  });

  it.each([
    ["the effect input", "$1"],
    ["a slot", "query"],
    ["an expression over both", "$1 + query"],
  ])("accepts %s in the key", (_what, key) => {
    expect(codesOf(app(key))).toEqual([]);
  });

  it("accepts a fn call in the key", () => {
    const source = `slot query : Text = ""
fn norm(s: Text) -> Text = s
effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key(norm($1))
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(codesOf(source)).toEqual([]);
  });

  it("reports $route in the key as an undefined name", () => {
    expect(codesOf(app("$route.path"))).toEqual(["E0103"]);
  });

  // Every other policy carries no expression, so nothing new is walked.
  it("leaves a policy that carries no expression alone", () => {
    const source = `effect load cap=http.get in=Text out=Result(Text, HttpError) policy=debounce(300ms)
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(codesOf(source)).toEqual([]);
  });
});

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
    expect(codesOf(mapRequestApp(expr))).toEqual([]);
  });

  it("reports $route as an undefined name", () => {
    expect(codesOf(mapRequestApp("$route.path"))).toEqual(["E0103"]);
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
    expect(codesOf(inputApp("UserQuery", clauses))).toEqual([]);
  });

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
    expect(codesOf(urlApp(input, url))).toEqual([]);
  });

  it("accepts Text as a latest-per-key key on in=Text", () => {
    expect(codesOf(inputApp("Text", "policy=latest-per-key($1)"))).toEqual([]);
  });

  it.each([
    ["map-request", "UserQuery", `map-request={url: "/u/" + ($1 * 2).show, decode: Decoder.Text}`],
    ["the latest-per-key key", "Text", "policy=latest-per-key($1 - 1)"],
  ])("reports an operator applied to an input of the wrong type, in %s, as E0201", (_w, input, clauses) => {
    const source = inputApp(input, clauses);
    const at = only(source);
    expect(at.code).toBe("E0201");
    expect(textAt(source, at)).toMatch(/^\$1 [*-]/);
  });

  it("leaves a member of a union in= unjudged", () => {
    expect(codesOf(urlApp("Shape", `"/u/" + $1.idd`))).toEqual([]);
    expect(codesOf(urlApp("Shape", `"/u/" + ($1 * 2).show`))).toEqual(["E0201"]);
  });

  // `in=Unit` is emitted with no argument, so `$1` holds no value to type.
  it.each([
    ["Unit", "Unit", []],
    ["a type that does not exist", "Nope", ["E0117"]],
  ])("leaves the input undecided on %s", (_what, input, expected) => {
    const clauses = `policy=latest-per-key($1.idd)
            map-request={url: "/u/" + $1.idd + ($1 * 2).show, decode: Decoder.Text}`;
    expect(codesOf(inputApp(input, clauses))).toEqual(expected);
  });

  it("leaves the input undecided on Unit through an alias", () => {
    const source = `type Nothing = Unit
${inputApp("Nothing", `map-request={url: "/u/" + $1.idd + ($1 * 2).show, decode: Decoder.Text}`)}`;
    expect(codesOf(source)).toEqual([]);
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
  return loadApp<LoadedApp>(source, "policy-key");
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

describe("a `latest-per-key` key is evaluated at the emit", () => {
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
