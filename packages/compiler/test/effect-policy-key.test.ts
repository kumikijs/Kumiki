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

  it("leaves a member of a union in= undecided", () => {
    expect(codesOf(urlApp("Shape", `"/u/" + $1.idd`))).toEqual([]);
    expect(codesOf(urlApp("Shape", `"/u/" + ($1 * 2).show`))).toEqual(["E0201"]);
  });

  // `in=Unit` is emitted with no argument, so there is no `$1` to read.
  it.each([
    ["Unit", ""],
    ["an alias of Unit", "type Nothing = Unit"],
    ["a nominal over Unit", "type Nothing = nominal Unit"],
  ])("reports each read of the input as E0103 on an effect declared in=%s", (_what, decl) => {
    const source = `${decl}
${inputApp(decl === "" ? "Unit" : "Nothing", READS_OF_ONE)}`;
    const found = locatedOf(source);
    expect(found.map((d) => [d.code, d.message])).toEqual(
      Array(3).fill([
        "E0103",
        '"$1" is undefined here — effect "load" declares in=Unit, so it is emitted with no argument',
      ]),
    );
    for (const d of found) expect(textAt(source, d)).toMatch(/^\$1/);
  });

  // The in= is E0117, and a type that names nothing leaves `$1` undecided rather than adding a
  // diagnostic at each read.
  it("reports an in= naming no type once, at the type", () => {
    expect(codesOf(inputApp("Nope", READS_OF_ONE))).toEqual(["E0117"]);
  });
});

/** A member read, an operator and a key on `$1`: three reads. */
const READS_OF_ONE = `policy=latest-per-key($1.idd)
            map-request={url: "/u/" + $1.idd + ($1 * 2).show, decode: Decoder.Text}`;

type EffectShape = {
  invoke: (
    input: unknown,
    caps: { provider: () => (req: unknown) => { kind: string; value: unknown } },
    signal: AbortSignal | undefined,
  ) => Promise<{ kind: string; value: unknown }>;
};

/** The request `map-request` builds from `input`, as a provider that answers with it receives it. */
async function requestOf(decls: string, input: string, mapRequest: string, value: unknown) {
  const app = await loadApp<{ effects: Record<string, EffectShape> }>(
    `${decls}
effect send cap=http.post in=${input} out=Result(Text, HttpError)
            map-request=${mapRequest}
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.post] routes={"/" -> Home, "/404" -> Home} init=[]`,
    "effect-input",
  );
  const caps = { provider: () => (req: unknown) => ({ kind: "ok", value: req }) };
  return (await app.effects.send?.invoke(value, caps, undefined))?.value;
}

describe("a member read on `$1` in map-request follows the effect's in= type", () => {
  it.each([
    [
      "a record field named like a stdlib member, as the field",
      "type Page = {get: Text, keys: Text, size: Int}",
      "Page",
      `{url: "/u/" + $1.get + $1.keys + $1.size.show, decode: Decoder.Text}`,
      { get: "g", keys: "k", size: 20 },
      { url: "/u/gk20", decode: "text" },
    ],
    [
      "the keys of a Map(Int, …), as Ints",
      "",
      "Map(Int, Text)",
      `{url: "/m", body: Json($1.keys), decode: Decoder.Text}`,
      { "1": "a" },
      { url: "/m", body: { _tag: "Json", _0: [1] }, decode: "text" },
    ],
    [
      "the entries of a Map(Int, …), with Int keys",
      "",
      "Map(Int, Text)",
      `{url: "/m", body: Json($1.entries), decode: Decoder.Text}`,
      { "1": "a" },
      { url: "/m", body: { _tag: "Json", _0: [[1, "a"]] }, decode: "text" },
    ],
    [
      "the elements of a Set(Int), as Ints",
      "",
      "Set(Int)",
      `{url: "/s", body: Json($1.to-list), decode: Decoder.Text}`,
      { "1": true, "2": true },
      { url: "/s", body: { _tag: "Json", _0: [1, 2] }, decode: "text" },
    ],
  ])("reads %s", { timeout: 30_000 }, async (_what, decls, input, mapRequest, value, sent) => {
    expect(await requestOf(decls, input, mapRequest, value)).toEqual(sent);
  });
});

/** A program whose one effect takes `in=${input}` and is keyed on `key`. */
function keyTypeApp(input: string, key = "$1"): string {
  return `type Spot = {lat: Float, lng: Float}
type Page = {user: Text, page: Int}
type Box(A) = {v: A}
type Pair(A) = {a: A, b: A}
type L(A) = Nil | Cons(A, L(A))
type Chain(A) = {v: A, next: Option(Chain(List(A)))}
type Ph(A) = {name: Text}
type Div(A) = Z | W(Div(Box(A)))
type Tree = Leaf | Node(Tree, Tree)
type TaskId = nominal Int
type Color = Red | Blue
type Upload = Empty | Picked(File)
type Ratio = Float
type Price = nominal Float
type Score = Float where positive
type Doc = File
type Place = nominal Spot
slot ratio : Float = 0.5
slot user : Text = "ada"
effect load cap=http.get in=${input} out=Result(Text, HttpError)
            policy=latest-per-key(${key})
tile B = button(text="b")
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

describe("a latest-per-key key of a type keyed by its value is accepted", () => {
  it.each([
    ["Text", "Text", "$1"],
    ["Int", "Int", "$1"],
    ["Bool", "Bool", "$1"],
    ["Time", "Time", "$1"],
    ["a nominal over Int", "TaskId", "$1"],
    ["Uuid, a nominal over Text", "Uuid", "$1"],
    ["a two-variant enum", "Color", "$1"],
    ["a union whose variant holds itself", "Tree", "$1"],
    ["a record", "Page", "$1"],
    ["a record literal over the input", "Text", "{user: $1, page: 1}"],
    ["a field of the input", "Page", "$1.user"],
    ["a slot", "Text", "user"],
    ["a generic record over Text", "Box(Text)", "$1"],
    ["a tuple", "Tuple(Text, Int)", "$1"],
    ["an Option", "Option(Text)", "$1"],
    ["a Result", "Result(Int, Text)", "$1"],
    ["a List of Text", "List(Text)", "$1"],
    ["a Map of Text to Int", "Map(Text, Int)", "$1"],
    ["the stdlib's HttpError record", "HttpError", "$1"],
    ["Bytes", "Bytes", "$1"],
    ["an EffectId", "EffectId", "$1"],
    ["Unit", "Text", "()"],
    ["a generic applying itself to a growing argument", "Chain(Int)", "$1"],
    ["a generic that does not hold its Float argument", "Ph(Float)", "$1"],
    ["a generic whose Float argument stays in its own type", "Div(Float)", "$1"],
    ["a Float shown as Text", "Spot", "$1.lat.show"],
    ["a File's name and size", "File", "{name: $1.name, size: $1.size}"],
    ["a Map from Float", "Map(Float, Text)", "$1"],
  ])("%s", (_what, input, key) => {
    expect(codesOf(keyTypeApp(input, key))).toEqual([]);
  });
});

describe("a latest-per-key key of a type not keyed by its value is E0233", () => {
  const FLOAT = "it is a Float, and NaN is one key though NaN == NaN is false";
  const HOLDS_FLOAT = "it holds a Float, and inside it NaN, Infinity and -Infinity are one key";
  const FILE =
    "a File, and two Files with the same name, size and type are one key, while == holds only of a File and itself";
  const SET = "a Set, whose == depends on how it was built";
  it.each([
    ["a Float", "Float", "$1", "Float", FLOAT],
    ["a Float slot", "Text", "ratio", "Float", FLOAT],
    ["a division, which is a Float", "Int", "$1 / 2", "Float", FLOAT],
    ["an alias of Float", "Ratio", "$1", "Ratio", FLOAT],
    ["a nominal over Float", "Price", "$1", "Price", FLOAT],
    ["a refinement of Float", "Score", "$1", "Score", FLOAT],
    ["a record holding a Float", "Spot", "$1", "Spot", HOLDS_FLOAT],
    ["a nominal over a record holding a Float", "Place", "$1", "Place", HOLDS_FLOAT],
    ["a record literal holding a Float", "Float", "{at: $1}", "{at: Float}", HOLDS_FLOAT],
    ["a generic record over Float", "Box(Float)", "$1", "Box(Float)", HOLDS_FLOAT],
    ["a generic applied to itself", "Box(Box(Float))", "$1", "Box(Box(Float))", HOLDS_FLOAT],
    [
      "a two-field generic applied to itself",
      "Pair(Pair(Float))",
      "$1",
      "Pair(Pair(Float))",
      HOLDS_FLOAT,
    ],
    ["a recursive union applied to itself", "L(L(Float))", "$1", "L(L(Float))", HOLDS_FLOAT],
    [
      "a generic applied to a List of itself",
      "Box(List(Box(Float)))",
      "$1",
      "Box(List(Box(Float)))",
      HOLDS_FLOAT,
    ],
    ["a List of Float", "List(Float)", "$1", "List(Float)", HOLDS_FLOAT],
    ["an Option of Float", "Option(Float)", "$1", "Option(Float)", HOLDS_FLOAT],
    ["a Map to Float", "Map(Text, Float)", "$1", "Map(Text, Float)", HOLDS_FLOAT],
    ["a File", "File", "$1", "File", `it is ${FILE}`],
    ["an alias of File", "Doc", "$1", "Doc", `it is ${FILE}`],
    ["a union whose variant holds a File", "Upload", "$1", "Upload", `it holds ${FILE}`],
    [
      "the stdlib's FormValue, whose NumberV holds a Float",
      "FormValue",
      "$1",
      "FormValue",
      HOLDS_FLOAT,
    ],
    ["a Set", "Set(Text)", "$1", "Set(Text)", `it is ${SET}`],
    ["a List of Sets", "List(Set(Text))", "$1", "List(Set(Text))", `it holds ${SET}`],
    [
      "a generic applied to itself around a Set",
      "Box(Box(Set(Text)))",
      "$1",
      "Box(Box(Set(Text)))",
      `it holds ${SET}`,
    ],
  ])("%s", (_what, input, key, shown, why) => {
    const source = keyTypeApp(input, key);
    const at = only(source);
    expect(at.code).toBe("E0233");
    expect(at.message).toBe(
      `A latest-per-key key of type ${shown} is not keyed by its value: ${why} (see docs/spec/language.md)`,
    );
    expect(textAt(source, at).startsWith(`${key})`)).toBe(true);
  });

  // A part the checker cannot decide is not judged: a missing diagnostic
  // rather than a wrong one.
  it("leaves a key of an undecided type alone", () => {
    const source = `fn pick(s: Text) = s
${keyTypeApp("Text", "pick($1)")}`;
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
    ) => {
      slots: Record<string, unknown>;
      emits: { effect: string; args: unknown[]; key?: string }[];
    };
  }[];
};

/** Compile `source`, import the module from disk, and build one app instance. */
async function load(source: string): Promise<LoadedApp> {
  return loadApp<LoadedApp>(source, "policy-key");
}

const KEYED_ON_SLOT = `effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key(noteKey)`;

/** A `latest-per-key` effect (on the slot `noteKey` unless `effect` says otherwise) and one reducer `go` whose body is `body`. */
function keyedApp(body: string[], effect = KEYED_ON_SLOT): string {
  const [first, ...rest] = body;
  return `slot noteKey : Text     = "a"
slot lastId  : EffectId = EffectId.none
${effect}
reducer go on=ui.click(B) do= ${first}
${rest.map((s) => `                              ${s}`).join("\n")}
tile B = button(text="b", onClick=go)
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
}

/** Run `go` once against the declared defaults: the id it kept, and the key its emit record carries. */
async function runGo(body: string[], effect?: string): Promise<{ id: unknown; key: unknown }> {
  const app = await load(keyedApp(body, effect));
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

  it("keys on a record field named like a stdlib member, as the field", {
    timeout: 30_000,
  }, async () => {
    const effect = `type Page = {id: Text, size: Int}
effect load cap=http.get in=Page out=Result(Text, HttpError)
            policy=latest-per-key($1.size)`;
    const { id, key } = await runGo([`lastId := emit load({id: "x", size: 20})`], effect);
    expect(key).toBe("20");
    expect(id).toBe("load:20");
  });
});

type KeyedApp = LoadedApp & {
  effects: Record<string, { policy?: { kind: string; keyOf?: (input: unknown) => string } }>;
};

/**
 * Run a reducer that emits a `latest-per-key($1)` effect on `in=${input}` with
 * each of `args` in turn: the key each emit record carries, the id each `emit`
 * yielded, and what the effect table's `keyOf` — the key an `app.init` entry is
 * dispatched under — answers for the same input.
 */
async function emitKeys(
  input: string,
  args: string[],
): Promise<{ keys: unknown[]; ids: unknown[]; keyOf: unknown[] }> {
  const names = args.map((_, i) => `id${i}`);
  const source = `type Color = Red | Blue
${names.map((n) => `slot ${n} : EffectId = EffectId.none`).join("\n")}
effect load cap=http.get in=${input} out=Result(Text, HttpError)
            policy=latest-per-key($1)
reducer go on=ui.click(B) do= ${names.map((n, i) => `${n} := emit load(${args[i]})`).join("\n                              ")}
tile B = button(text="b", onClick=go)
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`;
  const app = (await load(source)) as KeyedApp;
  const go = app.reducers.find((r) => r.name === "go");
  if (!go) expect.fail("no reducer named go");
  const keyOf = app.effects.load?.policy?.keyOf;
  if (!keyOf) expect.fail("load has no keyOf");
  const { slots, emits } = go.apply(app.live, {});
  return {
    keys: emits.map((e) => e.key),
    ids: names.map((n) => slots[n]),
    keyOf: emits.map((e) => keyOf(e.args[0])),
  };
}

// The first two inputs of each row are `==`, the third is not.
describe("a `latest-per-key` key tells its values apart as `==` does", () => {
  it.each([
    ["Text", "Text", [`"x"`, `"x"`, `"y"`]],
    [
      "a record, its fields in either order",
      "{k: Text, n: Int}",
      [`{k: "x", n: 1}`, `{n: 1, k: "x"}`, `{k: "y", n: 1}`],
    ],
    ["a List whose Text holds a comma", "List(Text)", [`["a,b"]`, `["a,b"]`, `["a", "b"]`]],
    ["an Option", "Option(Text)", [`Some("x")`, `Some("x")`, `Some("y")`]],
    ["an enum", "Color", ["Red", "Red", "Blue"]],
    [
      "a tuple whose Text holds a comma",
      "Tuple(Text, Text)",
      [`("a,b", "c")`, `("a,b", "c")`, `("a", "b,c")`],
    ],
    [
      "a Map, its entries in either order",
      "Map(Text, Int)",
      [`{"a": 1, "b": 2}`, `{"b": 2, "a": 1}`, `{"a": 1, "b": 3}`],
    ],
  ])("%s", { timeout: 30_000 }, async (_what, input, args) => {
    const { keys, ids, keyOf } = await emitKeys(input, args);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(ids).toEqual(keys.map((k) => `load:${k}`));
    expect(keyOf).toEqual(keys);
  });
});
