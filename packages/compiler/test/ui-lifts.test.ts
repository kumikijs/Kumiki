import { describe, expect, it } from "vitest";
import type { UiEventKind } from "../src/ast.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
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

  it("declares the gates that PR #140 / issue #143 locked in", () => {
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
 * a value, so `typecheck` has to recognise the prop name to resolve it at all.
 * It used to keep its own copy of this set, which drifted: `onKeyDown=bump`
 * compiled into a working listener and was simultaneously reported as an
 * undefined reference. Both sides read `ui-lifts` now, and this suite is driven
 * off `HANDLER_NAMES` itself so a handler added to the table but not wired
 * through fails here rather than in someone's app.
 */
describe("every HANDLER_NAMES entry resolves as a reducer reference", () => {
  /** A tile kind that accepts the handler, preferring the simplest to write. */
  const TILE_FOR: Record<string, string> = {
    ...Object.fromEntries(
      UI_LIFTS.map((l) => [
        l.handler,
        ["input", "button", "form", "box"].find((k) => l.tiles === null || l.tiles.has(k)) ?? "box",
      ]),
    ),
    // No ui-event lifts to `onClose`; overlay tiles accept it explicitly.
    onClose: "modal",
  };

  /** Extra args each tile kind needs to be a well-formed call. */
  const TILE_ARGS: Record<string, string> = {
    input: 'value=""',
    button: 'text="b"',
    form: 'text("x")',
    box: 'text("x")',
    modal: 'text("x"), open=false',
  };

  function program(handler: string, target: string): string {
    const kind = TILE_FOR[handler]!;
    return `slot n : Int = 0
reducer bump on=app.start do= n := 1
tile T = ${kind}(${TILE_ARGS[kind]}, ${handler}=${target})
tile App = column(T, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  }

  const codesFor = (handler: string, target: string) =>
    check(parse(lex(program(handler, target)))).map((e) => e.code);

  for (const handler of HANDLER_NAMES) {
    it(`${handler}=<reducer> typechecks clean`, () => {
      expect(codesFor(handler, "bump")).toEqual([]);
    });

    it(`${handler}=<undefined> reports E0102, not E0103`, () => {
      // E0103 here would mean the checker fell back to treating the value as an
      // ordinary expression — the exact symptom of a half-wired handler name.
      const codes = codesFor(handler, "nope");
      expect(codes).toContain("E0102");
      expect(codes).not.toContain("E0103");
    });
  }
});
