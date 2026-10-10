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
