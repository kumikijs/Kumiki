// Issue #92: stdlib methods that have both a parenthesis-free FieldAccess
// shortcut and a paren-form MethodCall must lower to the same runtime helper.
// Without these tests, the paren form silently falls through to the generic
// fallback `(recv).method(...)` and delegates to native JS — wrong behavior for
// `.is-ok()` (variant tag check) and friends.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const compileOk = (src: string): string => {
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (r.kind !== "ok") throw new Error(`compile failed: ${JSON.stringify(r)}`);
  return r.js;
};

// One slot per receiver type so each method's call sites have a sensible base.
const APP_SHELL = `slot r : Result(Int, Text) = Ok(0)
slot m : Map(Text, Int) = {}
slot t : Text = ""
slot xs : List(Int) = []
slot du : Duration = Duration.ms(0)
`;

function appWith(body: string): string {
  return `${APP_SHELL}tile App = column(${body})
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
}

// (receiver, method-without-parens, method-with-parens, expected runtime-helper
// fragment that must appear in BOTH lowered outputs, spec section).
const METHODS: ReadonlyArray<{
  recv: string;
  no: string;
  paren: string;
  expect: string;
  spec: string;
}> = [
  { recv: "r", no: ".is-ok", paren: ".is-ok()", expect: `_s.variantIs(`, spec: "§2.2.5" },
  { recv: "r", no: ".is-err", paren: ".is-err()", expect: `_s.variantIs(`, spec: "§2.2.5" },
  { recv: "m", no: ".values", paren: ".values()", expect: "_s.mapValues(", spec: "§2.2.1" },
  { recv: "m", no: ".entries", paren: ".entries()", expect: "_s.mapEntries(", spec: "§2.2.1" },
  { recv: "t", no: ".lower", paren: ".lower()", expect: ".toLowerCase()", spec: "§2.2.6" },
  { recv: "t", no: ".upper", paren: ".upper()", expect: ".toUpperCase()", spec: "§2.2.6" },
  { recv: "xs", no: ".sort", paren: ".sort()", expect: "_s.listSort(", spec: "§2.2.3" },
];

describe("Issue #92: paren-form stdlib methods do not fall through to native JS", () => {
  it("every paren-form call type-checks (no E0801)", () => {
    const body = METHODS.map((m) => `heading((${m.recv}${m.paren}).show)`).join(", ");
    const errs = check(parse(lex(appWith(body))));
    expect(errs.filter((e) => e.code === "E0801")).toEqual([]);
  });

  for (const m of METHODS) {
    it(`${m.spec} ${m.recv}${m.paren} lowers to the runtime helper, not native JS`, () => {
      const jsNoParen = compileOk(appWith(`heading((${m.recv}${m.no}).show)`));
      const jsParen = compileOk(appWith(`heading((${m.recv}${m.paren}).show)`));
      expect(jsNoParen, "no-paren form must use the runtime helper").toContain(m.expect);
      expect(jsParen, "paren form must use the SAME runtime helper").toContain(m.expect);
    });
  }

  // `.ms` / `.ms()` are identity passthrough (Duration is stored as raw ms),
  // so there is no `_s.*` helper to look for. Verify symmetry by isolating the
  // single differing line — comparing whole files would also flip on any other
  // change to the generated scaffolding (slot map, header, etc.).
  it("§2.2.9 du.ms and du.ms() lower identically (Duration → ms identity)", () => {
    const jsNoParen = compileOk(appWith(`heading((du.ms).show)`));
    const jsParen = compileOk(appWith(`heading((du.ms()).show)`));
    const onlyDuLines = (js: string): string[] =>
      js.split("\n").filter((line) => line.includes('"du"'));
    expect(onlyDuLines(jsParen)).toEqual(onlyDuLines(jsNoParen));
    // Belt-and-braces: neither form may fall through to native `).ms(`.
    expect(jsParen).not.toMatch(/\)\.ms\(/);
    expect(jsNoParen).not.toMatch(/\)\.ms\(/);
  });

  it("no listed method falls through to the native-JS fallback shape", () => {
    const body = METHODS.map((m) => `heading((${m.recv}${m.paren}).show)`).join(", ");
    const js = compileOk(appWith(body));
    // Dash-named methods would be wrapped in bracket access by the fallback:
    //   `(_live["r"])["is-ok"]()`
    expect(js, "is-ok must not fall through").not.toMatch(/\)\["is-ok"\]\(/);
    expect(js, "is-err must not fall through").not.toMatch(/\)\["is-err"\]\(/);
    // Plain-named methods would appear as `).values(` / `).entries(` /
    // `).lower(` / `).upper(`. The runtime helpers never produce that shape.
    expect(js, "values must not fall through").not.toMatch(/\)\.values\(/);
    expect(js, "entries must not fall through").not.toMatch(/\)\.entries\(/);
    expect(js, "lower must not fall through").not.toMatch(/\)\.lower\(/);
    expect(js, "upper must not fall through").not.toMatch(/\)\.upper\(/);
  });
});

// AC1: Bytes constructors lower to `_s.bytesFrom*` runtime helpers. Without
// the codegen case, `Bytes.from-text("x")` would be treated as a user-defined
// fn call and runtime would throw on the missing identifier.
describe("Issue #92: Bytes constructors (docs/spec/stdlib.md §2.1.1 / §2.2.10)", () => {
  function bytesAppWith(expr: string): string {
    return `slot b : Bytes = ${expr}
tile App = column(heading("ok"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  }

  it("Bytes.from-text(text) lowers to _s.bytesFromText", () => {
    const js = compileOk(bytesAppWith(`Bytes.from-text("hi")`));
    expect(js).toContain("_s.bytesFromText(");
  });

  it("Bytes.from-base64(text) lowers to _s.bytesFromBase64", () => {
    const js = compileOk(bytesAppWith(`Bytes.from-base64("aGk=")`));
    expect(js).toContain("_s.bytesFromBase64(");
  });

  it("Bytes.from-bytes(list) lowers to _s.bytesFromBytes", () => {
    const js = compileOk(bytesAppWith(`Bytes.from-bytes([1, 2, 3])`));
    expect(js).toContain("_s.bytesFromBytes(");
  });
});
