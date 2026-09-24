// The `latest-per-key` key runs when the effect dispatches, so a name nothing
// checked there was a `ReferenceError` on the first dispatch rather than a
// diagnostic — the app imported, mounted and rendered first.

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

type LoadedApp = {
  live: Record<string, unknown>;
  effects: Record<string, { policy?: { keyOf?: (input: unknown) => string } }>;
  reducers: {
    name: string;
    apply: (
      live: Record<string, unknown>,
      payload: Record<string, unknown>,
    ) => { slots: Record<string, unknown> };
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

describe("the EffectId an `emit` expression yields", () => {
  // The id is `"<effect>:" + key`, built inside the reducer body. The
  // dispatcher computes its own key with the effect's `keyOf` once the
  // reducer's writes are applied, and registers the request under that. When
  // the two disagree, `emit cancel(id)` names nothing in flight.
  it("agrees with the dispatcher's key when the reducer wrote the key slot first", {
    timeout: 30_000,
  }, async () => {
    const app = await load(`slot noteKey : Text     = "a"
slot lastId  : EffectId = EffectId.none
effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key(noteKey)
reducer go on=ui.click(B) do= noteKey := "b"
                              lastId := emit load("x")
tile B = button(text="b", onClick=go)
tile Home = column(B)
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]`);
    const go = app.reducers.find((r) => r.name === "go");
    if (!go) expect.fail("no reducer named go");
    const { slots } = go.apply(app.live, {});
    // What the runtime does between the reducer and the dispatch.
    Object.assign(app.live, slots);
    const keyOf = app.effects.load?.policy?.keyOf;
    if (!keyOf) expect.fail("load has no keyOf");
    expect(slots.lastId).toBe(`load:${keyOf("x")}`);
    expect(slots.lastId).toBe("load:b");
  });
});
