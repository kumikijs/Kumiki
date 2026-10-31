import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { type AppShape, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const example = feature("132-toggle-bind");

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
  return { app, root: mountApp(app).root };
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
    click(root, "reset");
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
    // happy-dom's `.click()` does not move focus, so focus it first, as a browser does on a click; the Chromium tier pins the same thing with a real click.
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
  const src = (kind: string) =>
    withApp(`slot b : Bool = false
slot seen : Bool = false
tile Box = ${kind}(bind=b, onClick=note) {id: "box"}
reducer note on=ui.click(Box) do= seen := b
tile App = column(Box)`);

  it.each(["check", "switch"])("%s: the handler reads the state the click wrote", async (kind) => {
    const app = await loadSource(src(kind));
    box(mountApp(app).root, "box").click();
    expect(app.live).toMatchObject({ b: true, seen: true });
  });
});

function codes(source: string): string[] {
  return check(parse(lex(source))).map((e) => e.code);
}

const program = (tile: string): string =>
  withApp(`type Filter = All | Active | Done
type Other = X | Y
slot name : Text = ""
slot flag : Bool = false
slot filter : Filter = All
tile App = ${tile}`);

describe("check / switch / radio bind types", () => {
  it("reports a check or switch bound to something other than a Bool", () => {
    expect(codes(program("check(bind=name)"))).toContain("E0201");
    expect(codes(program("switch(bind=name)"))).toContain("E0201");
  });

  it("reports a radio whose value is a variant of another union", () => {
    expect(codes(program(`radio(group="f", bind=filter, value=X)`))).toContain("E0216");
  });

  it("reports a bound radio with no value to write", () => {
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
        expect.stringContaining(
          `"value" on check() is not read beside bind= — the bound value decides whether it is ticked. Remove it`,
        ),
      ],
    ]);
    expect(warned("switch(bind=flag, value=false)")).toHaveLength(1);
    expect(warned(`radio(group="f", bind=filter, value=All, selected=true)`)).toEqual([
      [
        "selection-beside-bind",
        "warning",
        expect.stringContaining(
          `"selected" on radio() is not read beside bind= — the bound value decides whether it is chosen. Remove it`,
        ),
      ],
    ]);
    expect(codes(program("check(value=flag)"))).not.toContain("W0216");
    expect(codes(program(`radio(group="f", value=All, selected=true)`))).not.toContain("W0216");
  });

  it("reads bind, value and selected in the {…} block as it reads the arguments", () => {
    expect(codes(program(`radio(group="f", bind=filter) {value: Done}`))).toEqual([]);
    expect(codes(program(`radio(group="f") {bind: filter}`))).toContain("E0225");
    expect(codes(program(`radio(group="f", value=X) {bind: filter}`))).toContain("E0216");
    expect(codes(program("check() {bind: name}"))).toContain("E0201");
    expect(codes(program("check(bind=flag) {value: true}"))).toContain("W0216");
    expect(codes(program(`radio(group="f", bind=filter, value=All) {selected: true}`))).toContain(
      "W0216",
    );
  });

  it("accepts the bindings the table lists", () => {
    const src = program(
      `column(check(bind=flag), switch(bind=flag), radio(group="f", bind=filter, value=Done))`,
    );
    expect(codes(src)).toEqual([]);
  });
});
