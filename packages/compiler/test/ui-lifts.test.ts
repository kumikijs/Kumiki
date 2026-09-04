import { describe, expect, it } from "vitest";
import type { UiEventKind } from "../src/ast.ts";
import { compile } from "../src/compile.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { buildDefIndex, referencesIn } from "../src/references.ts";
import { check } from "../src/typecheck.ts";
import {
  HANDLER_NAMES,
  HANDLER_PROP_TILES,
  UI_EVENT_TILE_KINDS,
  UI_LIFTS,
} from "../src/ui-lifts.ts";

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
    expect(byEv.get("input")?.tiles).toEqual(new Set(["input", "textarea", "editable"]));
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
 * The tile kind is the same throughout on purpose: what is under test is that
 * a handler NAME resolves the same way through all three consumers, whatever
 * tile it sits on. A `box` fires none of the constrained handlers, so each of
 * those also draws a W0213 — expected below rather than filtered out, which
 * keeps this file honest about the interaction. Which tiles honour which
 * handler is `spec-divergences.test.ts`.
 */
describe("every HANDLER_NAMES entry resolves as a reducer reference", () => {
  const BINDINGS = [
    { form: "arg", bind: (h: string, v: string) => `box(text("x"), ${h}=${v})` },
    { form: "prop", bind: (h: string, v: string) => `box(text("x")) {${h}: ${v}}` },
  ] as const;

  const source = (tile: string) => `slot n : Int = 0
reducer bump on=app.start do= n := 1
reducer Bump on=app.start do= n := 2
tile T = ${tile}
tile App = column(T, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  const codesFor = (tile: string) => check(parse(lex(source(tile)))).map((e) => e.code);

  /** The same fixture with a second tile beside `T`, for the cases that name one. */
  const neighbour = (tile: string) => `slot n : Int = 0
reducer bump on=app.start do= n := 1
reducer Bump on=app.start do= n := 2
tile Other = box(text("y"))
tile T = ${tile}
tile App = column(T, Other, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  const errorsForNeighbour = (tile: string) => check(parse(lex(neighbour(tile))));
  const codesForNeighbour = (tile: string) => errorsForNeighbour(tile).map((e) => e.code);

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
      // A `box` honours the four the runtime attaches to any element and
      // drops the rest, so the constrained ones are reported here.
      const inert = HANDLER_PROP_TILES[handler] == null ? [] : ["W0213"];

      it(`${handler} (${form}) = <reducer> resolves for all three consumers`, () => {
        expect(codesFor(bind(handler, "bump"))).toEqual(inert);
        expect(jsFor(bind(handler, "bump"))).toContain(`${handler}: _h("bump")`);
        expect(refsOf(bind(handler, "bump"))).toEqual(["reducer.bump"]);
      });

      it(`${handler} (${form}) = <undefined> reports exactly E0102`, () => {
        // E0103 would mean the value fell through to the ordinary-expression
        // path — the exact symptom of a half-wired handler name.
        expect(codesFor(bind(handler, "nope"))).toEqual([...inert, "E0102"]);
      });

      it(`${handler} (${form}) = <non-reference> reports exactly E0201`, () => {
        // Quieter than the undefined case under drift: nothing at all.
        expect(codesFor(bind(handler, "1"))).toEqual([...inert, "E0201"]);
      });

      // A capitalised name is not a reference in either form — a tile call as
      // a named argument, a variant tag in the props block — and the position
      // resolves in the reducer namespace, so both read as the reducer they
      // name. Written out as all three consumers, because the shape test used
      // to live in each of them: the checker rejected the name outright, and
      // fixing that alone would have left codegen wiring no listener and the
      // reference walker recording a `tile` edge for a reducer.
      it(`${handler} (${form}) = <capitalised reducer> resolves for all three consumers`, () => {
        expect(codesFor(bind(handler, "Bump"))).toEqual(inert);
        expect(jsFor(bind(handler, "Bump"))).toContain(`${handler}: _h("Bump")`);
        expect(refsOf(bind(handler, "Bump"))).toEqual(["reducer.Bump"]);
      });

      // A capitalised name that names no reducer answers exactly as the
      // lowercase `nope` above does — the handler position knows one
      // namespace, and a tile of that name is not in it. E0201 would be the
      // report that the shape is wrong, and the shape is no longer the
      // question.
      it(`${handler} (${form}) = <tile> reports exactly E0102`, () => {
        const errors = errorsForNeighbour(bind(handler, "Other"));
        expect(errors.map((e) => e.code)).toEqual([...inert, "E0102"]);
        expect(errors.find((e) => e.code === "E0102")?.message).toBe(
          `Reference to undefined reducer "Other"`,
        );
      });

      // What is left of the shape test: a value carrying arguments is no name,
      // whichever shape it arrives in. Dropping the emptiness check would read
      // `Some(1)` as a reducer called `Some` and wire a listener for it.
      for (const [what, value] of [
        ["a variant tag with a payload", "Some(1)"],
        ["a tile call with arguments", 'box(text("z"))'],
      ] as const) {
        it(`${handler} (${form}) = ${what} reports exactly E0201`, () => {
          const errors = errorsForNeighbour(bind(handler, value));
          expect(errors.map((e) => e.code)).toEqual([...inert, "E0201"]);
          // The form is the only caller-supplied value that differs between
          // the two call sites, so the word is where a crossed wiring would
          // show. Looked up by code rather than by position: a diagnostic
          // added later in `checkTileCall` should not fail this.
          expect(errors.find((e) => e.code === "E0201")?.message).toBe(
            `Event handler ${form} "${handler}" must be a reducer name`,
          );
        });
      }
    }
  }

  // A handler on a user tile takes the same branch and reports the same code,
  // with no W0213 — `checkHandlerTarget` has nothing to say about a tile whose
  // renderer it does not own. Nothing pinned that, so the tempting tidy-up
  // ("checkHandlerTarget ignores user tiles anyway, so only run the handler
  // branch for builtins") would put this case back to silence unnoticed.
  it("reports a handler bound to a tile on a user tile too, without W0213", () => {
    expect(codesForNeighbour("Other(onClick=Other)")).toEqual(["E0102"]);
  });

  it("leaves a handler bound to a reducer on a user tile alone", () => {
    expect(codesForNeighbour("Other(onClick=bump)")).toEqual([]);
  });

  // Every consumer that walks a tile body has to agree that a handler is not
  // a child, not just the one that reports the binding: the cycle search
  // followed the same mis-parse and answered that the tile expanded into
  // itself, which is a sentence about a tile that is never rendered.
  it("reports only the binding when the handler names an enclosing tile", () => {
    expect(codesFor('box(text("x"), onClick=App)')).toEqual(["W0213", "E0102"]);
  });

  // The reason the handler branch has to be consulted first rather than the
  // tile branch narrowed: an argument that is a tile is still ordinary.
  it("leaves a tile written as an ordinary argument alone", () => {
    expect(codesForNeighbour('box(text("x"), Other)')).toEqual([]);
    expect(codesForNeighbour('box(Other, text("x"))')).toEqual([]);
  });
});

// `HANDLER_PROP_TILES` answers "which tiles honour this handler when it is
// written on them", which is not the question `UI_EVENT_TILE_KINDS` answers.
// Both are read by checks that report dead handlers, so both have to stay
// total over the handler names the language accepts.
describe("HANDLER_PROP_TILES", () => {
  it("has an entry for every handler name, including onClose", () => {
    const missing = [...HANDLER_NAMES].filter((h) => !(h in HANDLER_PROP_TILES));
    expect(missing).toEqual([]);
  });

  it("keeps every constrained set in step with the lift table", () => {
    // Derived rather than written out: the renderer that reads the prop is the
    // one a selector lands on. `onInput` used to be a hand-written union,
    // because the lift table omitted `editable` and the two questions had
    // different answers for that one kind. Compared by reference, so a copy
    // that happens to hold the same members today still fails.
    for (const [handler, ev] of [
      ["onClick", "click"],
      ["onChange", "change"],
      ["onSubmit", "submit"],
      ["onInput", "input"],
    ] as const) {
      expect(HANDLER_PROP_TILES[handler], handler).toBe(UI_EVENT_TILE_KINDS[ev]);
    }
  });

  it("marks the universally-wired handlers as unconstrained", () => {
    for (const h of ["onKeyDown", "onMouseEnter", "onFocus", "onBlur"]) {
      expect(HANDLER_PROP_TILES[h], h).toBeNull();
    }
  });
});
