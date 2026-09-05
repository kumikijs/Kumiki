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

  /**
   * The same fixture with two more tiles beside `T`, for the cases that name
   * one. `Other` renders nothing that fires a constrained handler and `Fires`
   * does, so a handler written on a user tile can be asked both questions —
   * whether the binding resolved, and whether the tile it landed on can fire
   * it — without either answer standing in for the other.
   */
  const neighbour = (tile: string) => `slot n : Int = 0
reducer bump on=app.start do= n := 1
reducer Bump on=app.start do= n := 2
tile Other = box(text("y"))
tile Fires = button(text="y")
tile T = ${tile}
tile App = column(T, Other, Fires, text(n.show))
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

  /**
   * The same references, each rendered as the source text its recorded position
   * actually points at.
   *
   * `refsOf` answers layer and name, which is what `refs` *prints* and not what
   * `rename` *consumes*: `renameDef` rewrites at `r.pos`
   * (`packages/cli/src/mutate.ts`). A correct layer paired with a drifted span
   * rewrites the wrong bytes while every layer/name assertion above stays
   * green, so the span is checked here against the token it claims to name —
   * `reducer.Bump@Bump` reads "the reducer edge, recorded on the letters
   * `Bump`". A reference with no position of its own renders as `@<none>`,
   * which `rename` refuses rather than half-rewriting.
   */
  function refSitesOf(tile: string): string[] {
    const src = source(tile);
    const program = parse(lex(src));
    const def = program.defs.find((d) => "name" in d && d.name === "T");
    if (!def) throw new Error("fixture has no tile T");
    const lines = src.split("\n");
    return referencesIn(def, buildDefIndex(program)).map((r) => {
      if (!r.pos) return `${r.layer}.${r.name}@<none>`;
      const text = (lines[r.pos.line - 1] ?? "").slice(
        r.pos.col - 1,
        r.pos.col - 1 + r.name.length,
      );
      return `${r.layer}.${r.name}@${text}`;
    });
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
        // The layer alone is not enough for `rename` — see `refSitesOf`.
        expect(refSitesOf(bind(handler, "Bump"))).toEqual(["reducer.Bump@Bump"]);
      });

      // The original defect was that the name RENDERED: taken as a nested tile
      // it reached codegen as a child. `_h("Bump")` above says the listener is
      // wired and says nothing about that, so the absence is asserted on its
      // own — a future change that wires the handler and ALSO emits the child
      // would keep every other assertion in this file green.
      //
      // Written as "take the handler wirings away and see what is left" rather
      // than as a `not.toContain` of some rendering helper: the fixture
      // legitimately renders `T` through `_named` and `_children`, so naming a
      // helper would either match that or drift out of step with codegen. Nor
      // a raw occurrence count — the tile body is inlined once per route, so
      // that number tracks the fixture's route table rather than this.
      it(`${handler} (${form}) = <capitalised reducer> is not also rendered`, () => {
        const js = jsFor(bind(handler, "Bump"));
        expect(js).toContain(`${handler}: _h("Bump")`);
        // What remains is the reducer table's own `name: "Bump"`, once. A
        // second survivor is the name used as something other than a handler.
        expect(js.replace(/_h\("Bump"\)/g, "").match(/"Bump"/g)).toEqual([`"Bump"`]);
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

  // A handler on a user tile takes the same branch and reports the same
  // binding code. Asked on `Fires`, so the binding answer arrives on its own:
  // the tempting tidy-up ("checkHandlerTarget only reports builtins anyway, so
  // only run the handler branch for them") would put this case back to silence
  // unnoticed, and a W0213 riding along would hide it happening.
  it("reports a handler bound to a tile on a user tile too", () => {
    expect(codesForNeighbour("Fires(onClick=Other)")).toEqual(["E0102"]);
  });

  it("leaves a handler bound to a reducer on a firing user tile alone", () => {
    expect(codesForNeighbour("Fires(onClick=bump)")).toEqual([]);
    expect(codesForNeighbour("Fires(onClick=Bump)")).toEqual([]);
  });

  // The user-tile mirror of the builtin co-occurrence pinned at the matrix
  // above: both codes, in that order. `checkHandlerTarget` runs before the
  // name is resolved, and an inert target must not swallow the binding error
  // (nor arrive after it) on either kind of tile.
  it("reports the inert target and the undefined reducer together, in order", () => {
    expect(codesForNeighbour("Other(onClick=Other)")).toEqual(["W0213", "E0102"]);
  });

  // The matrix above binds through `box` throughout, and a named argument of a
  // tile-taking builtin is the `TileCall` shape. `parseArgValue` branches on the
  // PARENT tile, not on argument-vs-prop, so a named argument of a value-arg
  // builtin or of a user tile is a `Variant` — the same shape the props block
  // produces, reached by a path the matrix never walks. Both sit here so the
  // arg form is not silently `TileCall`-only.
  describe("the Variant-in-argument shape", () => {
    const withTile = (tile: string) => `slot n : Int = 0
reducer Bump on=app.start do= n := 1
tile Plus = button(text="plus")
tile T = ${tile}
tile App = column(T, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    const codes = (tile: string) => check(parse(lex(withTile(tile)))).map((e) => e.code);
    const js = (tile: string) => {
      const r = compile(withTile(tile), { runtimeSpecifier: "./runtime.js" });
      if (r.kind !== "ok")
        throw new Error(`compile failed: ${r.errors.map((e) => e.code).join(", ")}`);
      return r.js;
    };

    for (const [what, tile, expected] of [
      // `link` fires no `onClick` (`HANDLER_PROP_TILES`), so W0213 rides along
      // — the binding is still resolved and still wired, which is the point.
      ["a value-arg builtin", 'link(text="go", to="/", onClick=Bump)', ["W0213"]],
      ["a user tile", "Plus(onClick=Bump)", []],
    ] as const) {
      it(`binds a capitalised reducer written as a named argument of ${what}`, () => {
        expect(codes(tile)).toEqual(expected);
        expect(js(tile)).toContain(`onClick: _h("Bump")`);
      });
    }
  });

  // A tile and a reducer may share a name — `findDuplicateDefinitions` is per
  // layer — so the handler position has to pick one, and §1.7.3 says which.
  // Nothing would fail today if a later change made it fall back to the tile
  // layer, which is exactly the silent rewiring this file exists to catch.
  it("resolves a name shared by a tile and a reducer in the reducer layer", () => {
    const src = `slot n : Int = 0
reducer Bump on=app.start do= n := 1
tile Bump = button(text="bump")
tile T = box(text("x"), onClick=Bump)
tile App = column(T, Bump, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual(["W0213"]);
    const program = parse(lex(src));
    const def = program.defs.find((d) => d.kind === "TileDef" && d.name === "T");
    if (!def) throw new Error("fixture has no tile T");
    expect(referencesIn(def, buildDefIndex(program)).map((r) => `${r.layer}.${r.name}`)).toEqual([
      "reducer.Bump",
    ]);
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

/**
 * A handler on a USER tile that renders nothing able to fire it — issue #329.
 *
 * No tier FAILS on the fixture below, which is why the warning has to say it:
 * W0213 is non-fatal, so `check` exits 0 (`ok (1 warning)`) and `build` still
 * emits, and `smoke` sees a tile that mounts and renders with nothing to
 * click. Reported here or nowhere.
 */
describe("a handler on an inert user tile is W0213", () => {
  const app = (tiles: string, call: string) => `slot n : Int = 0
reducer bump on=app.start do= n := n + 1
${tiles}
tile App = column(${call}, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  const diags = (tiles: string, call: string) => check(parse(lex(app(tiles, call))));
  const codes = (tiles: string, call: string) => diags(tiles, call).map((e) => e.code);

  const INERT = 'tile Inner = box(text("clickme"))';

  // Both forms, because both are how the drop was written in the report and
  // the two reach `checkHandlerBinding` down different branches of
  // `checkTileCall` — a named argument and a props entry.
  for (const [form, call] of [
    ["prop", "Inner() {onClick: bump}"],
    ["arg", "Inner(onClick=bump)"],
  ] as const) {
    it(`reports the ${form} form, as a warning`, () => {
      const [d, ...rest] = diags(INERT, call);
      expect(rest).toEqual([]);
      expect(d?.code).toBe("W0213");
      // `kind` is what `kumiki fix` and the MCP tools read, and it is asserted
      // nowhere else in the suite — so a typo in the one constructor that
      // builds this diagnostic would reach them unnoticed.
      expect(d?.kind).toBe("handler-on-inert-tile");
      expect(d?.severity).toBe("warning");
      // What the tile does render, and where the handler would work: without
      // both, the reader is told "not here" and given nowhere to go.
      expect(d?.message).toContain("observed in body: box, text");
      expect(d?.message).toContain("button");
    });
  }

  // The other side of the same check: a warning that also fires on the shape
  // people write on purpose is noise, and noise is how a warning gets ignored.
  it("says nothing when the tile's own root fires the handler", () => {
    expect(codes('tile Inner = button(text="go")', "Inner() {onClick: bump}")).toEqual([]);
    expect(codes('tile Inner = check(label="go")', "Inner() {onChange: bump}")).toEqual([]);
    expect(codes('tile Inner = form(text("go"))', "Inner() {onSubmit: bump}")).toEqual([]);
    // The overlay row of `HANDLER_PROP_TILES`, which no ui-event lifts to.
    expect(codes('tile Inner = modal(text("go"))', "Inner() {onClose: bump}")).toEqual([]);
  });

  // The overlay row again, from the reporting side: it is the one entry the
  // lift table cannot supply, so a user tile is the only place its two halves
  // could come apart without the `onClick` cases noticing.
  it("reports onClose on a user tile that renders no overlay", () => {
    const [d, ...rest] = diags(INERT, "Inner() {onClose: bump}");
    expect(rest).toEqual([]);
    expect(d?.code).toBe("W0213");
    expect(d?.message).toContain("drawer / modal / popover");
  });

  // A firing kind that is NOT the root also suppresses the warning, and there
  // the suppression is a false negative rather than a correct answer — the
  // prop lands on the root and the handler is dropped anyway. That is a
  // divergence from what the check ought to say, so it is pinned as one, in
  // `spec-divergences.test.ts` ("known gap: W0213 does not see a firing kind
  // that is not the root"), where a bare `toEqual([])` cannot be mistaken for
  // the legitimate suppression above.

  // The four the runtime attaches to whatever element a tile produced are not
  // this check's to answer, on a user tile no more than on a builtin.
  it("says nothing about the handlers the runtime wires universally", () => {
    for (const handler of ["onKeyDown", "onMouseEnter", "onFocus", "onBlur"]) {
      expect(codes(INERT, `Inner() {${handler}: bump}`), handler).toEqual([]);
    }
  });

  // An empty answer is where W0212 declines to guess, and this declines in the
  // same place and for the same reason: it means "nothing was learned", not
  // "nothing fires". Each case below already has a code that names it, and a
  // second, vaguer diagnostic beside it helps nobody.
  describe("says nothing when the walk finds no kind at all", () => {
    it("a tile that is not declared at all", () => {
      expect(codes(INERT, "Nope() {onClick: bump}")).toEqual(["E0105"]);
    });

    it("a tile whose own root names one that is not declared", () => {
      expect(codes("tile Inner = Nope()", "Inner() {onClick: bump}")).toEqual(["E0105"]);
    });

    it("a tile that expands into itself", () => {
      expect(codes("tile Inner = Inner()", "Inner() {onClick: bump}")).toEqual(["E0005"]);
    });
  });

  // The reach of that skip, which is narrower than "an unresolvable tree":
  // only the ROOT being unresolvable empties the set. Nested, the kinds around
  // it are still a true answer about the root — the tile really does render a
  // `box` there and the handler really is dropped — so the warning stands
  // beside the code that names the unresolvable part rather than deferring to
  // it. Pinned because the spec used to promise the wider skip.
  describe("still reports when only a nested part is unresolvable", () => {
    // The two orders differ, and the difference is where each error is found:
    // E0105 comes from walking `Inner`'s own body, which happens before the
    // `App` that calls it, while the cycle search is a whole-program pass that
    // appends after. Written out rather than sorted, so a diagnostic moving
    // between those phases shows up here.
    it("an undeclared name inside a resolvable body", () => {
      expect(codes("tile Inner = box(Nope())", "Inner() {onClick: bump}")).toEqual([
        "E0105",
        "W0213",
      ]);
    });

    it("a cycle reached through a resolvable body", () => {
      expect(codes("tile Inner = box(Inner())", "Inner() {onClick: bump}")).toEqual([
        "W0213",
        "E0005",
      ]);
    });
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
