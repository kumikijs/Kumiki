import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";

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

const METHODS: ReadonlyArray<{
  recv: string;
  no: string;
  paren: string;
  expect: string;
}> = [
  { recv: "r", no: ".is-ok", paren: ".is-ok()", expect: `_s.variantIs(` },
  { recv: "r", no: ".is-err", paren: ".is-err()", expect: `_s.variantIs(` },
  { recv: "m", no: ".values", paren: ".values()", expect: "_s.mapValues(" },
  { recv: "m", no: ".entries", paren: ".entries()", expect: "_s.mapEntries(" },
  { recv: "t", no: ".lower", paren: ".lower()", expect: ".toLowerCase()" },
  { recv: "t", no: ".upper", paren: ".upper()", expect: ".toUpperCase()" },
  { recv: "xs", no: ".sort", paren: ".sort()", expect: "_s.listSort(" },
  { recv: "m", no: ".is-empty", paren: ".is-empty()", expect: "_s.isEmpty(" },
  { recv: "xs", no: ".is-empty", paren: ".is-empty()", expect: "_s.isEmpty(" },
  { recv: "t", no: ".is-empty", paren: ".is-empty()", expect: "_s.isEmpty(" },
];

describe("paren-form stdlib methods do not fall through to native JS", () => {
  it("every paren-form call type-checks (no E0801)", () => {
    const body = METHODS.map((m) => `heading((${m.recv}${m.paren}).show)`).join(", ");
    const errs = checkSource(appWith(body));
    expect(errs.filter((e) => e.code === "E0801")).toEqual([]);
  });

  for (const m of METHODS) {
    it(`${m.recv}${m.paren} lowers to the runtime helper, not native JS`, () => {
      const jsNoParen = compileOrFail(appWith(`heading((${m.recv}${m.no}).show)`));
      const jsParen = compileOrFail(appWith(`heading((${m.recv}${m.paren}).show)`));
      expect(jsNoParen, "no-paren form must use the runtime helper").toContain(m.expect);
      expect(jsParen, "paren form must use the SAME runtime helper").toContain(m.expect);
    });
  }

  it("du.to-ms and du.to-ms() lower identically (Duration → ms identity)", () => {
    const jsNoParen = compileOrFail(appWith(`heading((du.to-ms).show)`));
    const jsParen = compileOrFail(appWith(`heading((du.to-ms()).show)`));
    const onlyDuLines = (js: string): string[] =>
      js.split("\n").filter((line) => line.includes('"du"'));
    expect(onlyDuLines(jsParen)).toEqual(onlyDuLines(jsNoParen));
    expect(jsParen).not.toMatch(/\)(\.to_ms|\["to-ms"\])\(/);
    expect(jsNoParen).not.toMatch(/\)(\.to_ms|\["to-ms"\])\(/);
  });

  it("no listed method falls through to the native-JS fallback shape", () => {
    const body = METHODS.map((m) => `heading((${m.recv}${m.paren}).show)`).join(", ");
    const js = compileOrFail(appWith(body));
    expect(js, "is-ok must not fall through").not.toMatch(/\)(\.is_ok|\["is-ok"\])\(/);
    expect(js, "is-err must not fall through").not.toMatch(/\)(\.is_err|\["is-err"\])\(/);
    expect(js, "is-empty must not fall through").not.toMatch(/\)(\.is_empty|\["is-empty"\])\(/);
    expect(js, "values must not fall through").not.toMatch(/\)\.values\(/);
    expect(js, "entries must not fall through").not.toMatch(/\)\.entries\(/);
    expect(js, "lower must not fall through").not.toMatch(/\)\.lower\(/);
    expect(js, "upper must not fall through").not.toMatch(/\)\.upper\(/);
  });
});

describe("Bytes constructors", () => {
  function bytesAppWith(expr: string): string {
    return `slot b : Bytes = ${expr}
tile App = column(heading("ok"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  }

  it("Bytes.from-text(text) lowers to _s.bytesFromText", () => {
    const js = compileOrFail(bytesAppWith(`Bytes.from-text("hi")`));
    expect(js).toContain("_s.bytesFromText(");
  });

  it("Bytes.from-base64(text) lowers to _s.bytesFromBase64", () => {
    const js = compileOrFail(bytesAppWith(`Bytes.from-base64("aGk=")`));
    expect(js).toContain("_s.bytesFromBase64(");
  });

  it("Bytes.from-bytes(list) lowers to _s.bytesFromBytes", () => {
    const js = compileOrFail(bytesAppWith(`Bytes.from-bytes([1, 2, 3])`));
    expect(js).toContain("_s.bytesFromBytes(");
  });
});
