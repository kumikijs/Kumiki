// stdlib.md §2.3.4 / §2.3.5 and forms.md §5.3 / §5.5.2: the props the input
// elements list reach the page — `check`'s `label`, `fieldset`'s `legend` in
// both spellings, a radio grouped by `name=`, and a `slider`'s one-way
// `value=` — on the mounted app and in server rendering alike. The scenario
// beside `204-input-props-rendered` drives the example; what is here reads
// what a scenario cannot: where each element sits, the `name` attribute, a
// slider's `.value`, and the served HTML.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "204-input-props-rendered.kumiki");

// Every mount is torn down here rather than at the end of its test, so a
// failing assertion cannot leave a live app in the document — and its radios
// in the next test's group.
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function mounted(
  src?: string,
): Promise<{ root: HTMLElement; live: Record<string, unknown> | undefined }> {
  const app = src === undefined ? await loadApp(example) : await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  cleanups.push(() => root.remove());
  const handle = mount(app, root);
  cleanups.unshift(() => handle.dispose());
  return {
    root,
    get live() {
      return app.live;
    },
  };
}

async function served(src?: string): Promise<HTMLElement> {
  const app = src === undefined ? await loadApp(example) : await loadSource(src);
  const host = document.createElement("div");
  host.innerHTML = (await renderToString(app)).html;
  return host;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function one<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll("button")).find((x) => x.textContent === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}

/** Each element child of `el` as its tag and the text it holds. */
function parts(el: Element): string[] {
  return Array.from(el.children).map((c) => `${c.tagName.toLowerCase()}:${c.textContent}`);
}

/** What each `fieldset` tile renders, child by child. */
function fieldsets(root: ParentNode): string[][] {
  return Array.from(root.querySelectorAll("[data-kumiki-tile='fieldset']")).map(parts);
}

/** The DOM half and the served half of the example read the same way. */
const RENDERED = {
  check: ["input:", "span:I agree to the terms"],
  fieldsets: [
    ["legend:Terms", "label:I agree to the terms"],
    ["legend:Mode: a", "label:Option A", "label:Option B"],
  ],
  radioNames: ["mode", "mode"],
};

describe("the props the input elements list are rendered", () => {
  it("shows a check's label beside its box, and the box still toggles", async () => {
    const app = await mounted();
    const check = one(app.root, "[data-kumiki-tile='check']");
    expect(parts(check)).toEqual(RENDERED.check);
    one<HTMLInputElement>(check, "input").click();
    await settle();
    expect(app.live?.agreed).toBe(true);
    expect(parts(check)).toEqual(RENDERED.check);
  });

  it("renders a fieldset's legend ahead of its fields, in either spelling", async () => {
    const { root } = await mounted();
    expect(fieldsets(root)).toEqual(RENDERED.fieldsets);
  });

  it("keeps a legend read from a slot in step with it, on the same element", async () => {
    const app = await mounted();
    const legend = one(
      app.root,
      "[data-kumiki-tile='fieldset'] + [data-kumiki-tile='fieldset']",
    ).firstElementChild;
    app.root.querySelectorAll<HTMLInputElement>("input[type='radio']")[1]?.click();
    await settle();
    expect(app.live?.mode).toBe("b");
    expect(fieldsets(app.root)[1]).toEqual(["legend:Mode: b", "label:Option A", "label:Option B"]);
    expect(app.root.querySelectorAll("legend")[1]).toBe(legend);
  });

  it("names the radios written with name= as one group", async () => {
    const { root } = await mounted();
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']"));
    expect(radios.map((r) => r.getAttribute("name"))).toEqual(RENDERED.radioNames);
  });

  it("shows a slider's one-way value, and moves it when a reducer writes the slot", async () => {
    const app = await mounted();
    const slider = one<HTMLInputElement>(app.root, "input[type='range']");
    expect(slider.value).toBe("10");
    button(app.root, "Louder").click();
    await settle();
    expect(app.live?.vol).toBe(20);
    expect(slider.value).toBe("20");
  });

  it("serves the same elements from renderToString", async () => {
    const host = await served();
    expect(parts(one(host, "[data-kumiki-tile='check']"))).toEqual(RENDERED.check);
    expect(fieldsets(host)).toEqual(RENDERED.fieldsets);
    const radios = Array.from(host.querySelectorAll("input[type='radio']"));
    expect(radios.map((r) => r.getAttribute("name"))).toEqual(RENDERED.radioNames);
    expect(one(host, "input[type='range']").getAttribute("value")).toBe("10");
  });
});

function appOf(slots: string, body: string): string {
  return `
${slots}
tile App = column(${body})
app P
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

describe("the same props in their other forms", () => {
  it("reads a check's label written as a named argument", async () => {
    const src = appOf("", `check(label="Remember me")`);
    const { root } = await mounted(src);
    expect(parts(one(root, "[data-kumiki-tile='check']"))).toEqual(["input:", "span:Remember me"]);
    expect(parts(one(await served(src), "[data-kumiki-tile='check']"))).toEqual([
      "input:",
      "span:Remember me",
    ]);
  });

  it("adds and drops a check's label and a fieldset's legend as a slot says", async () => {
    const src = appOf(
      `slot lit : Bool = false
reducer flip on=ui.click(FlipBtn) do= lit := not lit
tile FlipBtn = button(text="Flip")`,
      `fieldset(check(value=lit) {label: if lit then "On" else ""}) {legend: if lit then "Lit" else ""},
       FlipBtn`,
    );
    const { root } = await mounted(src);
    const fieldset = one(root, "[data-kumiki-tile='fieldset']");
    const check = one(root, "[data-kumiki-tile='check']");
    expect(fieldsets(root)).toEqual([["label:"]]);
    expect(parts(check)).toEqual(["input:"]);
    button(root, "Flip").click();
    await settle();
    expect(fieldsets(root)).toEqual([["legend:Lit", "label:On"]]);
    expect(parts(check)).toEqual(["input:", "span:On"]);
    button(root, "Flip").click();
    await settle();
    expect(fieldsets(root)).toEqual([["label:"]]);
    expect(parts(check)).toEqual(["input:"]);
    // Both were patched where they stood, not built again.
    expect(one(root, "[data-kumiki-tile='fieldset']")).toBe(fieldset);
    expect(one(root, "[data-kumiki-tile='check']")).toBe(check);
  });

  it("keeps the legend ahead of the children a keyed for adds, moves and drops", async () => {
    const src = appOf(
      `slot n : Int = 0
reducer step on=ui.click(StepBtn) do= n := n + 1
tile StepBtn = button(text="Step")`,
      `fieldset(for x in (if n == 0 then [] else if n == 1 then ["b", "c"] else if n == 2 then ["a", "c", "b"] else ["c"])
                text(x) {key: x}) {legend: "Items"},
       StepBtn`,
    );
    const { root } = await mounted(src);
    const seen = [fieldsets(root)];
    for (let i = 0; i < 3; i++) {
      button(root, "Step").click();
      await settle();
      seen.push(fieldsets(root));
    }
    expect(seen).toEqual([
      [["legend:Items"]],
      [["legend:Items", "span:b", "span:c"]],
      [["legend:Items", "span:a", "span:c", "span:b"]],
      [["legend:Items", "span:c"]],
    ]);
  });

  it("names a radio by group= when it also says name=", async () => {
    const src = appOf("", `radio(group="g", name="n", value="a") {label: "A"}`);
    const { root } = await mounted(src);
    expect(one(root, "input[type='radio']").getAttribute("name")).toBe("g");
    expect(one(await served(src), "input[type='radio']").getAttribute("name")).toBe("g");
  });

  it("shows a bound slider's slot over a value= beside it", async () => {
    const src = appOf("slot v : Int = 3", "slider(bind=v, value=7, min=0, max=10)");
    const { root } = await mounted(src);
    expect(one<HTMLInputElement>(root, "input[type='range']").value).toBe("3");
  });
});
