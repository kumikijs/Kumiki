import { describe, expect, it } from "vitest";
import type { UiEventKind } from "../src/ast.ts";
import { compile } from "../src/compile.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { buildDefIndex, referencesIn } from "../src/references.ts";
import { check } from "../src/typecheck.ts";
import { HANDLER_NAMES, UI_EVENT_TILE_KINDS, UI_LIFTS } from "../src/ui-lifts.ts";

const ALL_UI_EVENT_KINDS: ReadonlyArray<UiEventKind> = [
  "click",
  "submit",
  "change",
  "input",
  "focus",
  "blur",
  "key",
  "hover",
];

describe("UI_LIFTS", () => {
  it("covers every UiEventKind exactly once", () => {
    const evs = UI_LIFTS.map((l) => l.ev).sort();
    const expected = [...ALL_UI_EVENT_KINDS].sort();
    expect(evs).toEqual(expected);
    expect(new Set(evs).size).toBe(UI_LIFTS.length);
  });

  it("emits distinct handler-prop names per ui-kind", () => {
    const handlers = UI_LIFTS.map((l) => l.handler);
    expect(new Set(handlers).size).toBe(handlers.length);
  });

  it("uses `null` only for `hover` (the universal-fire ui-kind)", () => {
    const nullTiles = UI_LIFTS.filter((l) => l.tiles === null).map((l) => l.ev);
    expect(nullTiles).toEqual(["hover"]);
  });

  it("declares the tile kinds each ui-event is restricted to", () => {
    const byEv = new Map(UI_LIFTS.map((l) => [l.ev, l]));
    expect(byEv.get("click")?.tiles).toEqual(new Set(["button", "check", "switch", "radio"]));
    expect(byEv.get("submit")?.tiles).toEqual(new Set(["form"]));
    expect(byEv.get("change")?.tiles).toEqual(
      new Set(["select", "input", "textarea", "check", "radio", "switch", "slider"]),
    );
    expect(byEv.get("input")?.tiles).toEqual(new Set(["input", "textarea"]));
    expect(byEv.get("key")?.tiles).toEqual(new Set(["input", "textarea", "button"]));
    expect(byEv.get("focus")?.tiles).toEqual(new Set(["input", "textarea", "button", "select"]));
    expect(byEv.get("blur")?.tiles).toEqual(new Set(["input", "textarea", "button", "select"]));
  });
});

describe("UI_EVENT_TILE_KINDS (derived)", () => {
  it("mirrors UI_LIFTS keyed by ui-kind", () => {
    for (const lift of UI_LIFTS) {
      expect(UI_EVENT_TILE_KINDS[lift.ev]).toBe(lift.tiles);
    }
  });

  it("contains exactly the UiEventKind values as keys", () => {
    expect(Object.keys(UI_EVENT_TILE_KINDS).sort()).toEqual([...ALL_UI_EVENT_KINDS].sort());
  });
});

describe("HANDLER_NAMES (derived)", () => {
  it("includes every handler from UI_LIFTS", () => {
    for (const lift of UI_LIFTS) {
      expect(HANDLER_NAMES.has(lift.handler)).toBe(true);
    }
  });

  it("includes `onClose` (explicit-only, no implicit lift)", () => {
    expect(HANDLER_NAMES.has("onClose")).toBe(true);
  });

  it("size equals UI_LIFTS handler count + 1 (onClose)", () => {
    expect(HANDLER_NAMES.size).toBe(UI_LIFTS.length + 1);
  });
});

/**
 * A handler prop is the one place a bare identifier names a reducer instead of
 * a value, so a consumer has to recognise the prop name to resolve it at all.
 * `typecheck` used to keep its own copy of this set, which drifted:
 * `onKeyDown=bump` compiled into a working listener and was simultaneously
 * reported as an undefined reference.
 *
 * Three consumers read the table, each in both syntactic forms — the checker's
 * named-arg and props-block branches, codegen's two, and the reference walker's
 * two — so all six sites run here. Halves failing apart is the actual defect: a
 * name the checker rejects but codegen wires, or one codegen drops while the
 * checker stays silent (the same bug inverted, and invisible until `smoke`), or
 * one the reference walker cannot see, which is how `rename` rewrites a program
 * into a different one.
 *
 * The tile kind is the same throughout on purpose. The checker gates handler
 * *names*, not which tile they sit on: `UI_LIFTS.tiles` drives W0212, which
 * applies to `ui.<ev>(T)` selectors rather than explicit handler bindings, so
 * `box(text("x"), onSubmit=bump)` typechecks clean despite `onSubmit`'s
 * `tiles` being `{form}`.
 */
describe("every HANDLER_NAMES entry resolves as a reducer reference", () => {
  const BINDINGS = [
    { form: "arg", bind: (h: string, v: string) => `box(text("x"), ${h}=${v})` },
    { form: "prop", bind: (h: string, v: string) => `box(text("x")) {${h}: ${v}}` },
  ] as const;

  const source = (tile: string) => `slot n : Int = 0
reducer bump on=app.start do= n := 1
tile T = ${tile}
tile App = column(T, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  const codesFor = (tile: string) => check(parse(lex(source(tile)))).map((e) => e.code);

  function jsFor(tile: string): string {
    const result = compile(source(tile), { runtimeSpecifier: "./runtime.js" });
    if (result.kind !== "ok") {
      throw new Error(`compile failed: ${result.errors.map((e) => e.code).join(", ")}`);
    }
    return result.js;
  }

  /** What the AI-editing verbs see `tile T` referring to. */
  function refsOf(tile: string): string[] {
    const program = parse(lex(source(tile)));
    const def = program.defs.find((d) => "name" in d && d.name === "T");
    if (!def) throw new Error("fixture has no tile T");
    return referencesIn(def, buildDefIndex(program)).map((r) => `${r.layer}.${r.name}`);
  }

  for (const handler of HANDLER_NAMES) {
    for (const { form, bind } of BINDINGS) {
      it(`${handler} (${form}) = <reducer> resolves for all three consumers`, () => {
        expect(codesFor(bind(handler, "bump"))).toEqual([]);
        expect(jsFor(bind(handler, "bump"))).toContain(`${handler}: _h("bump")`);
        expect(refsOf(bind(handler, "bump"))).toEqual(["reducer.bump"]);
      });

      it(`${handler} (${form}) = <undefined> reports exactly E0102`, () => {
        // E0103 would mean the value fell through to the ordinary-expression
        // path — the exact symptom of a half-wired handler name.
        expect(codesFor(bind(handler, "nope"))).toEqual(["E0102"]);
      });

      it(`${handler} (${form}) = <non-reference> reports exactly E0201`, () => {
        // Quieter than the undefined case under drift: nothing at all.
        expect(codesFor(bind(handler, "1"))).toEqual(["E0201"]);
      });
    }
  }
});
