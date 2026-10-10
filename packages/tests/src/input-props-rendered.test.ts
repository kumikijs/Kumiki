import { feature } from "@kumikijs/examples";
import { mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { button, find, freshRoot, tick } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const example = feature("204-input-props-rendered");

// Torn down here rather than at the end of each test, so a failing assertion cannot leave its radios in the next test's group.
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function mounted(
  src?: string,
): Promise<{ root: HTMLElement; live: Record<string, unknown> | undefined }> {
  const app = src === undefined ? await loadApp(example) : await loadSource(src);
  const root = freshRoot();
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
    const check = find(app.root, "[data-kumiki-tile='check']");
    expect(parts(check)).toEqual(RENDERED.check);
    find<HTMLInputElement>(check, "input").click();
    await tick(0);
    expect(app.live?.agreed).toBe(true);
    expect(parts(check)).toEqual(RENDERED.check);
  });

  it("renders a fieldset's legend ahead of its fields, in either spelling", async () => {
    const { root } = await mounted();
    expect(fieldsets(root)).toEqual(RENDERED.fieldsets);
  });

  it("keeps a legend read from a slot in step with it, on the same element", async () => {
    const app = await mounted();
    const legend = find(
      app.root,
      "[data-kumiki-tile='fieldset'] + [data-kumiki-tile='fieldset']",
    ).firstElementChild;
    app.root.querySelectorAll<HTMLInputElement>("input[type='radio']")[1]?.click();
    await tick(0);
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
    const slider = find<HTMLInputElement>(app.root, "input[type='range']");
    expect(slider.value).toBe("10");
    button(app.root, "Louder").click();
    await tick(0);
    expect(app.live?.vol).toBe(20);
    expect(slider.value).toBe("20");
  });

  it("serves the same elements from renderToString", async () => {
    const host = await served();
    expect(parts(find(host, "[data-kumiki-tile='check']"))).toEqual(RENDERED.check);
    expect(fieldsets(host)).toEqual(RENDERED.fieldsets);
    const radios = Array.from(host.querySelectorAll("input[type='radio']"));
    expect(radios.map((r) => r.getAttribute("name"))).toEqual(RENDERED.radioNames);
    expect(find(host, "input[type='range']").getAttribute("value")).toBe("10");
  });
});

const appOf = (slots: string, body: string): string =>
  withApp(`${slots}\ntile App = column(${body})`);

describe("the same props in their other forms", () => {
  it("reads a check's label written as a named argument", async () => {
    const src = appOf("", `check(label="Remember me")`);
    const { root } = await mounted(src);
    expect(parts(find(root, "[data-kumiki-tile='check']"))).toEqual(["input:", "span:Remember me"]);
    expect(parts(find(await served(src), "[data-kumiki-tile='check']"))).toEqual([
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
    const fieldset = find(root, "[data-kumiki-tile='fieldset']");
    const check = find(root, "[data-kumiki-tile='check']");
    expect(fieldsets(root)).toEqual([["label:"]]);
    expect(parts(check)).toEqual(["input:"]);
    button(root, "Flip").click();
    await tick(0);
    expect(fieldsets(root)).toEqual([["legend:Lit", "label:On"]]);
    expect(parts(check)).toEqual(["input:", "span:On"]);
    button(root, "Flip").click();
    await tick(0);
    expect(fieldsets(root)).toEqual([["label:"]]);
    expect(parts(check)).toEqual(["input:"]);
    expect(find(root, "[data-kumiki-tile='fieldset']")).toBe(fieldset);
    expect(find(root, "[data-kumiki-tile='check']")).toBe(check);
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
      await tick(0);
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
    expect(find(root, "input[type='radio']").getAttribute("name")).toBe("g");
    expect(find(await served(src), "input[type='radio']").getAttribute("name")).toBe("g");
  });

  it("shows a bound slider's slot over a value= beside it", async () => {
    const src = appOf("slot v : Int = 3", "slider(bind=v, value=7, min=0, max=10)");
    const { root } = await mounted(src);
    expect(find<HTMLInputElement>(root, "input[type='range']").value).toBe("3");
  });
});
