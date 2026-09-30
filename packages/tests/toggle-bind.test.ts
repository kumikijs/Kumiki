// `check` / `switch` bind a `Bool`, and `radio(group=…, bind=b, value=V)` binds
// one variant of a union (forms.md §5.1.1, §5.5.2). The checker accepted
// `bind=` on all three and codegen dropped it: every box rendered unticked
// whatever the slot held, and ticking one wrote nothing. The scenario beside
// `132-toggle-bind` drives the write-back through its steps; what is here
// drives it from the DOM itself, and asserts what a scenario cannot — which
// boxes are ticked on mount and after a reducer, the bind marker, the served
// HTML, where focus lands after a radio is chosen, and the order of the
// write-back against the control's own handler — and the checker's half of the
// table.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { type AppShape, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "132-toggle-bind.kumiki");

// Every radio of a group shares a `name` on the real document, so the radios
// of an abandoned root would form one group with the next test's.
afterEach(() => {
  document.body.replaceChildren();
});

function box(root: ParentNode, id: string): HTMLInputElement {
  const inp = root.querySelector<HTMLInputElement>(`#${id} input`);
  if (!inp) throw new Error(`#${id} input not found`);
  return inp;
}

const IDS = ["agree", "sw", "rAll", "rActive", "rDone", "news", "sSmall", "sLarge"];

function ticked(root: HTMLElement): Record<string, boolean> {
  return Object.fromEntries(IDS.map((id) => [id, box(root, id).checked]));
}

/** agreed = true, lit = false, filter = Done, prefs = {news: false, size: Large} */
const INITIAL = {
  agree: true,
  sw: false,
  rAll: false,
  rActive: false,
  rDone: true,
  news: false,
  sSmall: false,
  sLarge: true,
};

async function mounted(): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadApp(example);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return { app, root };
}

describe("check / switch / radio bind", () => {
  it("ticks each box from its slot on mount", async () => {
    const { root } = await mounted();
    expect(ticked(root)).toEqual(INITIAL);
  });

  it("writes the box's state back, both ways", async () => {
    const { app, root } = await mounted();
    box(root, "agree").click();
    expect(app.live?.agreed).toBe(false);
    box(root, "agree").click();
    expect(app.live?.agreed).toBe(true);
    box(root, "sw").click();
    expect(app.live?.lit).toBe(true);
    box(root, "sw").click();
    expect(app.live?.lit).toBe(false);
  });

  it("writes the chosen radio's value, and only that radio is selected", async () => {
    const { app, root } = await mounted();
    box(root, "rActive").click();
    expect(app.live?.filter).toEqual({ _tag: "Active" });
    expect(ticked(root)).toEqual({ ...INITIAL, rDone: false, rActive: true });
  });

  it("writes through a path into the one field it names", async () => {
    const { app, root } = await mounted();
    box(root, "news").click();
    expect(app.live?.prefs).toEqual({ news: true, size: { _tag: "Large" } });
    box(root, "sSmall").click();
    expect(app.live?.prefs).toEqual({ news: true, size: { _tag: "Small" } });
    expect(ticked(root)).toEqual({ ...INITIAL, news: true, sSmall: true, sLarge: false });
  });

  it("moves the controls when a reducer rewrites the slots", async () => {
    const { root } = await mounted();
    box(root, "agree").click();
    box(root, "sw").click();
    box(root, "rAll").click();
    box(root, "news").click();
    box(root, "sSmall").click();
    const reset = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "reset",
    );
    reset?.click();
    expect(ticked(root)).toEqual(INITIAL);
  });

  it("marks each bound box with the slot it writes", async () => {
    const { root } = await mounted();
    expect(box(root, "agree").dataset.kumikiBind).toBe("agreed");
    expect(box(root, "sw").dataset.kumikiBind).toBe("lit");
    expect(box(root, "rDone").dataset.kumikiBind).toBe("filter");
    expect(box(root, "news").dataset.kumikiBind).toBe("prefs.news");
    expect(box(root, "sSmall").dataset.kumikiBind).toBe("prefs.size");
  });

  it("keeps focus on the radio chosen, not the first radio sharing its marker", async () => {
    // happy-dom's `.click()` does not move focus, so focus it first, as a
    // browser does on a click; the Chromium tier pins the same thing with a
    // real click (132-toggle-bind.browser.json).
    const { root } = await mounted();
    const chosen = box(root, "rActive");
    chosen.focus();
    chosen.click();
    expect(document.activeElement).toBe(chosen);
  });

  it("serves the ticked boxes and their bind marker", async () => {
    const app = await loadApp(example);
    const { html } = await renderToString(app);
    const served = document.createElement("div");
    served.innerHTML = html;
    const shown = Object.fromEntries(
      IDS.map((id) => [id, box(served, id).hasAttribute("checked")]),
    );
    expect(shown).toEqual(INITIAL);
    expect(box(served, "agree").getAttribute("data-kumiki-bind")).toBe("agreed");
    expect(box(served, "sw").getAttribute("data-kumiki-bind")).toBe("lit");
    expect(box(served, "rDone").getAttribute("data-kumiki-bind")).toBe("filter");
    expect(box(served, "news").getAttribute("data-kumiki-bind")).toBe("prefs.news");
    expect(box(served, "sLarge").getAttribute("data-kumiki-bind")).toBe("prefs.size");
  });
});

describe("the write-back runs before the control's own handler", () => {
  // A `check(value=b, onClick=toggle)` moved to `check(bind=b, onClick=toggle)`
  // inverts `b` twice: the bind writes the new state, then `toggle` reads it
  // and inverts it back. forms.md §5.1.1 states the order; this pins it.
  const src = (kind: string) => `
slot b : Bool = false
slot seen : Bool = false
tile Box = ${kind}(bind=b, onClick=note) {id: "box"}
reducer note on=ui.click(Box) do= seen := b
tile App = column(Box)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
  for (const kind of ["check", "switch"]) {
    it(`${kind}: the handler reads the state the click wrote`, async () => {
      const app = await loadSource(src(kind));
      const root = document.createElement("div");
      document.body.appendChild(root);
      mount(app, root);
      box(root, "box").click();
      expect(app.live).toMatchObject({ b: true, seen: true });
    });
  }
});

function codes(source: string): string[] {
  return check(parse(lex(source))).map((e) => e.code);
}

const HEAD = `
type Filter = All | Active | Done
type Other = X | Y
slot name : Text = ""
slot flag : Bool = false
slot filter : Filter = All
`;
const APP = `
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
const program = (tile: string): string => `${HEAD}tile App = ${tile}${APP}`;

describe("check / switch / radio bind types", () => {
  it("reports a check or switch bound to something other than a Bool", () => {
    expect(codes(program("check(bind=name)"))).toContain("E0201");
    expect(codes(program("switch(bind=name)"))).toContain("E0201");
  });

  it("reports a radio whose value is a variant of another union", () => {
    expect(codes(program(`radio(group="f", bind=filter, value=X)`))).toContain("E0216");
  });

  it("reports a bound radio with no value to write", () => {
    // Without one the radio would write `undefined` into the union slot, then
    // show itself chosen (`undefined == undefined`) while every `match` on the
    // slot fell through.
    const diags = check(parse(lex(program(`radio(group="f", bind=filter) {label: "all"}`))));
    expect(diags.map((d) => [d.code, d.kind, d.severity ?? "error"])).toEqual([
      ["E0225", "radio-bind-without-value", "error"],
    ]);
    // Reported whether or not the bound type can be read.
    expect(codes(program(`radio(group="f", bind=nope)`))).toContain("E0225");
  });

  it("warns about the unbound selection argument written beside a bind", () => {
    const warned = (tile: string) =>
      check(parse(lex(program(tile))))
        .filter((d) => d.code === "W0216")
        .map((d) => [d.kind, d.severity, d.message]);
    expect(warned("check(bind=flag, value=true)")).toEqual([
      [
        "selection-beside-bind",
        "warning",
        `"value" on check() is not read beside bind= — the bound value decides whether it is ticked. Remove it (see docs/spec/forms.md §5.1.1)`,
      ],
    ]);
    expect(warned("switch(bind=flag, value=false)")).toHaveLength(1);
    expect(warned(`radio(group="f", bind=filter, value=All, selected=true)`)).toEqual([
      [
        "selection-beside-bind",
        "warning",
        `"selected" on radio() is not read beside bind= — the bound value decides whether it is chosen. Remove it (see docs/spec/forms.md §5.1.1)`,
      ],
    ]);
    // Without a bind the same arguments are what the control reads.
    expect(codes(program("check(value=flag)"))).not.toContain("W0216");
    expect(codes(program(`radio(group="f", value=All, selected=true)`))).not.toContain("W0216");
  });

  it("accepts the bindings the table lists", () => {
    const src = program(
      `column(check(bind=flag), switch(bind=flag), radio(group="f", bind=filter, value=Done))`,
    );
    expect(codes(src)).toEqual([]);
  });
});
