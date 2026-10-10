import { describe, expect, it } from "vitest";
import type { UiEventKind } from "../src/ast.ts";
import { BUILTIN_TILES } from "../src/builtins.ts";
import { compile } from "../src/compile.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { buildDefIndex, referencesIn } from "../src/references.ts";
import {
  firesUnheardIn,
  HANDLER_NAMES,
  HANDLER_PROP_TILES,
  UI_EVENT_TILE_KINDS,
  UI_LIFTS,
  wrappedUnreached,
} from "../src/ui-lifts.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

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
    const focusable = [
      "input",
      "textarea",
      "button",
      "select",
      "slider",
      "editable",
      "link",
      "video",
    ];
    expect(byEv.get("key")?.tiles).toEqual(new Set([...focusable, "check", "radio", "switch"]));
    expect(byEv.get("focus")?.tiles).toEqual(new Set(focusable));
    expect(byEv.get("blur")?.tiles).toEqual(new Set(focusable));
  });
});

describe("wrappedUnreached", () => {
  const WRAPPED = ["check", "radio", "switch", "details"];
  const LABEL = { wrapper: "label", focused: "input" } as const;
  const DETAILS = { wrapper: "details", focused: "summary" } as const;

  it("answers focus and blur for every wrapped kind, which do not bubble to the wrapper", () => {
    const groups = [
      { kinds: ["check", "radio", "switch"], ...LABEL, bubbles: false },
      { kinds: ["details"], ...DETAILS, bubbles: false },
    ];
    expect(wrappedUnreached("focus", WRAPPED)).toEqual(groups);
    expect(wrappedUnreached("blur", WRAPPED)).toEqual(groups);
  });

  it("answers key for details alone, whose wrapper holds its panel too", () => {
    expect(wrappedUnreached("key", WRAPPED)).toEqual([
      { kinds: ["details"], ...DETAILS, bubbles: true },
    ]);
  });

  it("answers no other event", () => {
    const answered = ALL_UI_EVENT_KINDS.filter((ev) => wrappedUnreached(ev, WRAPPED).length > 0);
    expect(answered.sort()).toEqual(["blur", "focus", "key"]);
  });

  it("names only kinds the event's row leaves out, so W0212 can give it as the reason", () => {
    for (const ev of ALL_UI_EVENT_KINDS) {
      const row = UI_EVENT_TILE_KINDS[ev];
      for (const { kinds } of wrappedUnreached(ev, WRAPPED)) {
        for (const kind of kinds) expect(row?.has(kind), `${kind} in the ${ev} row`).toBe(false);
      }
    }
  });

  it("keeps the wrapped kinds of a body and drops the rest, sorted", () => {
    expect(wrappedUnreached("focus", ["text", "switch", "details", "box", "check"])).toEqual([
      { kinds: ["check", "switch"], ...LABEL, bubbles: false },
      { kinds: ["details"], ...DETAILS, bubbles: false },
    ]);
    expect(wrappedUnreached("focus", ["box", "text", "video"])).toEqual([]);
  });
});

describe("firesUnheard / firesUnheardIn", () => {
  it("records only builtin kinds that its row leaves out", () => {
    for (const lift of UI_LIFTS) {
      for (const kind of Object.keys(lift.firesUnheard ?? {})) {
        expect(BUILTIN_TILES.has(kind), `${kind} in the ${lift.ev} record`).toBe(true);
        expect(lift.tiles?.has(kind), `${kind} in the ${lift.ev} row`).toBe(false);
      }
    }
  });

  it("records the absences whose renderer does something else: link for click, five for input", () => {
    const recorded = Object.fromEntries(
      UI_LIFTS.filter((l) => l.firesUnheard).map((l) => [
        l.ev,
        Object.keys(l.firesUnheard ?? {}).sort(),
      ]),
    );
    expect(recorded).toEqual({
      click: ["link"],
      input: ["check", "radio", "select", "slider", "switch"],
    });
  });

  it("groups the kinds of a body by what their renderer does instead, naming the row's handler", () => {
    expect(firesUnheardIn("input", ["text", "switch", "slider", "check"])).toEqual([
      { kinds: ["check", "switch"], reason: 'listens for "change" instead, never calling onInput' },
      { kinds: ["slider"], reason: "listens for it only to write the bind, never calling onInput" },
    ]);
  });

  it("gives the click row a default for every kind it leaves out, which only click has", () => {
    expect(UI_LIFTS.filter((l) => l.everyElementFires).map((l) => l.ev)).toEqual(["click"]);
  });

  it("answers every kind the click row leaves out: link with its own reason, the rest the default", () => {
    const leftOut = [...BUILTIN_TILES].filter((k) => !UI_EVENT_TILE_KINDS.click?.has(k)).sort();
    expect(firesUnheardIn("click", BUILTIN_TILES)).toEqual([
      { kinds: leftOut.filter((k) => k !== "link"), reason: "never calls onClick" },
      { kinds: ["link"], reason: "keeps it for navigation, never calling onClick" },
    ]);
  });

  it("answers nothing for a kind whose element fires nothing, a lifted kind, or a row with no record", () => {
    expect(firesUnheardIn("input", ["button", "text"])).toEqual([]);
    expect(firesUnheardIn("change", ["editable"])).toEqual([]);
    expect(firesUnheardIn("focus", ["box", "text"])).toEqual([]);
    expect(firesUnheardIn("click", ["button", "check", "radio", "switch"])).toEqual([]);
    expect(firesUnheardIn("focus", ["check"])).toEqual([]);
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

  const codesFor = (tile: string) => codesOf(source(tile));

  const neighbour = (tile: string) => `slot n : Int = 0
reducer bump on=app.start do= n := 1
reducer Bump on=app.start do= n := 2
tile Other = box(text("y"))
tile Fires = button(text="y")
tile T = ${tile}
tile App = column(T, Other, Fires, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  const errorsForNeighbour = (tile: string) => checkSource(neighbour(tile));
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
      const inert = HANDLER_PROP_TILES[handler] == null ? [] : ["W0213"];

      it(`${handler} (${form}) = <reducer> resolves for all three consumers`, () => {
        expect(codesFor(bind(handler, "bump"))).toEqual(inert);
        expect(jsFor(bind(handler, "bump"))).toContain(`${handler}: _h("bump")`);
        expect(refsOf(bind(handler, "bump"))).toEqual(["reducer.bump"]);
      });

      it(`${handler} (${form}) = <undefined> reports exactly E0102`, () => {
        expect(codesFor(bind(handler, "nope"))).toEqual([...inert, "E0102"]);
      });

      it(`${handler} (${form}) = <non-reference> reports exactly E0201`, () => {
        // Quieter than the undefined case under drift: nothing at all.
        expect(codesFor(bind(handler, "1"))).toEqual([...inert, "E0201"]);
      });

      it(`${handler} (${form}) = <capitalised reducer> resolves for all three consumers`, () => {
        expect(codesFor(bind(handler, "Bump"))).toEqual(inert);
        expect(jsFor(bind(handler, "Bump"))).toContain(`${handler}: _h("Bump")`);
        expect(refsOf(bind(handler, "Bump"))).toEqual(["reducer.Bump"]);
        // The layer alone is not enough for `rename` — see `refSitesOf`.
        expect(refSitesOf(bind(handler, "Bump"))).toEqual(["reducer.Bump@Bump"]);
      });

      it(`${handler} (${form}) = <capitalised reducer> is not also rendered`, () => {
        const js = jsFor(bind(handler, "Bump"));
        expect(js).toContain(`${handler}: _h("Bump")`);
        expect(js.replace(/_h\("Bump"\)/g, "").match(/"Bump"/g)).toEqual([`"Bump"`]);
      });

      it(`${handler} (${form}) = <tile> reports exactly E0102`, () => {
        const errors = errorsForNeighbour(bind(handler, "Other"));
        expect(errors.map((e) => e.code)).toEqual([...inert, "E0102"]);
        expect(errors.find((e) => e.code === "E0102")?.message).toBe(
          `Reference to undefined reducer "Other"`,
        );
      });

      for (const [what, value] of [
        ["a variant tag with a payload", "Some(1)"],
        ["a tile call with arguments", 'box(text("z"))'],
      ] as const) {
        it(`${handler} (${form}) = ${what} reports exactly E0201`, () => {
          const errors = errorsForNeighbour(bind(handler, value));
          expect(errors.map((e) => e.code)).toEqual([...inert, "E0201"]);
          expect(errors.find((e) => e.code === "E0201")?.message).toBe(
            `Event handler ${form} "${handler}" must be a reducer name`,
          );
        });
      }
    }
  }

  it("reports a handler bound to a tile on a user tile too", () => {
    expect(codesForNeighbour("Fires(onClick=Other)")).toEqual(["E0102"]);
  });

  it("leaves a handler bound to a reducer on a firing user tile alone", () => {
    expect(codesForNeighbour("Fires(onClick=bump)")).toEqual([]);
    expect(codesForNeighbour("Fires(onClick=Bump)")).toEqual([]);
  });

  it("reports the inert target and the undefined reducer together, in order", () => {
    expect(codesForNeighbour("Other(onClick=Other)")).toEqual(["W0213", "E0102"]);
  });

  describe("the Variant-in-argument shape", () => {
    const withTile = (tile: string) => `slot n : Int = 0
reducer Bump on=app.start do= n := 1
tile Plus = button(text="plus")
tile T = ${tile}
tile App = column(T, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    const codes = (tile: string) => codesOf(withTile(tile));
    const js = (tile: string) => {
      const r = compile(withTile(tile), { runtimeSpecifier: "./runtime.js" });
      if (r.kind !== "ok")
        throw new Error(`compile failed: ${r.errors.map((e) => e.code).join(", ")}`);
      return r.js;
    };

    for (const [what, tile, expected] of [
      ["a value-arg builtin", 'link(text="go", to="/", onClick=Bump)', ["W0213"]],
      ["a user tile", "Plus(onClick=Bump)", []],
    ] as const) {
      it(`binds a capitalised reducer written as a named argument of ${what}`, () => {
        expect(codes(tile)).toEqual(expected);
        expect(js(tile)).toContain(`onClick: _h("Bump")`);
      });
    }
  });

  it("resolves a name shared by a tile and a reducer in the reducer layer", () => {
    const src = `slot n : Int = 0
reducer Bump on=app.start do= n := 1
tile Bump = button(text="bump")
tile T = box(text("x"), onClick=Bump)
tile App = column(T, Bump, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codesOf(src)).toEqual(["W0213"]);
    const program = parse(lex(src));
    const def = program.defs.find((d) => d.kind === "TileDef" && d.name === "T");
    if (!def) throw new Error("fixture has no tile T");
    expect(referencesIn(def, buildDefIndex(program)).map((r) => `${r.layer}.${r.name}`)).toEqual([
      "reducer.Bump",
    ]);
  });

  it("reports only the binding when the handler names an enclosing tile", () => {
    expect(codesFor('box(text("x"), onClick=App)')).toEqual(["W0213", "E0102"]);
  });

  it("leaves a tile written as an ordinary argument alone", () => {
    expect(codesForNeighbour('box(text("x"), Other)')).toEqual([]);
    expect(codesForNeighbour('box(Other, text("x"))')).toEqual([]);
  });
});

describe("a handler on an inert user tile is W0213", () => {
  const app = (tiles: string, call: string) => `slot n : Int = 0
reducer bump on=app.start do= n := n + 1
${tiles}
tile App = column(${call}, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  const diags = (tiles: string, call: string) => checkSource(app(tiles, call));
  const codes = (tiles: string, call: string) => diags(tiles, call).map((e) => e.code);

  const INERT = 'tile Inner = box(text("clickme"))';

  for (const [form, call] of [
    ["prop", "Inner() {onClick: bump}"],
    ["arg", "Inner(onClick=bump)"],
  ] as const) {
    it(`reports the ${form} form, as a warning`, () => {
      const [d, ...rest] = diags(INERT, call);
      expect(rest).toEqual([]);
      expect(d?.code).toBe("W0213");
      expect(d?.kind).toBe("handler-on-inert-tile");
      expect(d?.severity).toBe("warning");
      expect(d?.message).toContain("observed in body: box, text");
      expect(d?.message).toContain("button");
    });
  }

  it("says nothing when the tile's own root fires the handler", () => {
    expect(codes('tile Inner = button(text="go")', "Inner() {onClick: bump}")).toEqual([]);
    expect(codes('tile Inner = check(label="go")', "Inner() {onChange: bump}")).toEqual([]);
    expect(codes('tile Inner = form(text("go"))', "Inner() {onSubmit: bump}")).toEqual([]);
    // The overlay row of `HANDLER_PROP_TILES`, which no ui-event lifts to.
    expect(codes('tile Inner = modal(text("go"))', "Inner() {onClose: bump}")).toEqual([]);
  });

  it("reports onClose on a user tile that renders no overlay", () => {
    const [d, ...rest] = diags(INERT, "Inner() {onClose: bump}");
    expect(rest).toEqual([]);
    expect(d?.code).toBe("W0213");
    expect(d?.message).toContain("drawer / modal / popover");
  });

  it("says nothing about the handlers the runtime wires universally", () => {
    for (const handler of ["onKeyDown", "onMouseEnter", "onFocus", "onBlur"]) {
      expect(codes(INERT, `Inner() {${handler}: bump}`), handler).toEqual([]);
    }
  });

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

  describe("still reports when only a nested part is unresolvable", () => {
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

describe("HANDLER_PROP_TILES", () => {
  it("has an entry for every handler name, including onClose", () => {
    const missing = [...HANDLER_NAMES].filter((h) => !(h in HANDLER_PROP_TILES));
    expect(missing).toEqual([]);
  });

  it("keeps every constrained set in step with the lift table", () => {
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
