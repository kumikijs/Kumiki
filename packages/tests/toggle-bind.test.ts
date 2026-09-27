// `check` / `switch` bind a `Bool`, and `radio(group=…, bind=b, value=V)` binds
// one variant of a union (forms.md §5.1.1, §5.5.2). The checker accepted
// `bind=` on all three and codegen dropped it: every box rendered unticked
// whatever the slot held, and ticking one wrote nothing. The scenario beside
// `132-toggle-bind` drives the write-back; what is here is what a scenario
// cannot assert — which boxes are ticked on mount and after a reducer, the
// bind marker, the served HTML — and the checker's half of the table.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { type AppShape, mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "132-toggle-bind.kumiki");

function box(root: HTMLElement, id: string): HTMLInputElement {
  const inp = root.querySelector<HTMLInputElement>(`#${id} input`);
  if (!inp) throw new Error(`#${id} input not found`);
  return inp;
}

function ticked(root: HTMLElement): Record<string, boolean> {
  const ids = ["agree", "sw", "rAll", "rActive", "rDone"];
  return Object.fromEntries(ids.map((id) => [id, box(root, id).checked]));
}

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
    // agreed = true, lit = false, filter = Done
    expect(ticked(root)).toEqual({
      agree: true,
      sw: false,
      rAll: false,
      rActive: false,
      rDone: true,
    });
  });

  it("writes the box's state back, both ways", async () => {
    const { app, root } = await mounted();
    box(root, "agree").click();
    expect(app.live?.agreed).toBe(false);
    box(root, "agree").click();
    expect(app.live?.agreed).toBe(true);
    box(root, "sw").click();
    expect(app.live?.lit).toBe(true);
  });

  it("writes the chosen radio's value, and only that radio is selected", async () => {
    const { app, root } = await mounted();
    box(root, "rActive").click();
    expect(app.live?.filter).toEqual({ _tag: "Active" });
    expect(ticked(root)).toMatchObject({ rAll: false, rActive: true, rDone: false });
  });

  it("moves the controls when a reducer rewrites the slots", async () => {
    const { root } = await mounted();
    box(root, "agree").click();
    box(root, "sw").click();
    box(root, "rAll").click();
    const reset = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "reset",
    );
    reset?.click();
    expect(ticked(root)).toEqual({
      agree: true,
      sw: false,
      rAll: false,
      rActive: false,
      rDone: true,
    });
  });

  it("marks each bound box with the slot it writes", async () => {
    const { root } = await mounted();
    expect(box(root, "agree").dataset.kumikiBind).toBe("agreed");
    expect(box(root, "sw").dataset.kumikiBind).toBe("lit");
    expect(box(root, "rDone").dataset.kumikiBind).toBe("filter");
  });

  it("serves the ticked boxes and their bind marker", async () => {
    const app = await loadApp(example);
    const { html } = await renderToString(app);
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(5);
    const [agree, sw, rAll, rActive, rDone] = inputs;
    expect(agree).toMatch(/ checked[ >]/);
    expect(agree).toContain('data-kumiki-bind="agreed"');
    expect(sw).not.toMatch(/ checked[ >]/);
    expect(sw).toContain('data-kumiki-bind="lit"');
    expect(rAll).not.toMatch(/ checked[ >]/);
    expect(rActive).not.toMatch(/ checked[ >]/);
    expect(rDone).toMatch(/ checked[ >]/);
    expect(rDone).toContain('data-kumiki-bind="filter"');
  });
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

describe("check / switch / radio bind types", () => {
  it("reports a check or switch bound to something other than a Bool", () => {
    expect(codes(`${HEAD}tile App = check(bind=name)${APP}`)).toContain("E0201");
    expect(codes(`${HEAD}tile App = switch(bind=name)${APP}`)).toContain("E0201");
  });

  it("reports a radio whose value is a variant of another union", () => {
    expect(codes(`${HEAD}tile App = radio(group="f", bind=filter, value=X)${APP}`)).toContain(
      "E0216",
    );
  });

  it("accepts the bindings the table lists", () => {
    const src = `${HEAD}tile App = column(check(bind=flag), switch(bind=flag), radio(group="f", bind=filter, value=Done))${APP}`;
    expect(codes(src)).toEqual([]);
  });
});
