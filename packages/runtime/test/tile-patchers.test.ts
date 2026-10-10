import type { AppShape, MountedApp, TileCtx, TileNode } from "@kumikijs/runtime";
import { inputPatchers, inputTiles, mount, textPatchers, textTiles } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { bareApp, mountApp } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";

const ctx: TileCtx = { render: () => document.createElement("div") };

type Of<K extends TileNode["kind"]> = Extract<TileNode, { kind: K }>;

afterEach(() => {
  document.body.replaceChildren();
});

describe("markdown", () => {
  const md = (text: string): Of<"markdown"> => ({ kind: "markdown", text });
  const paragraphs = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll("p"), (p) => p.textContent ?? "");

  it("makes one paragraph per blank-line-separated block and keeps single line breaks", () => {
    const el = defined(textTiles.markdown, "markdown")(md("one\ntwo\n\n three "), ctx);
    expect(paragraphs(el)).toEqual(["one\ntwo", "three"]);
    expect(el.querySelector("p")?.style.whiteSpace).toBe("pre-wrap");
  });

  it("patches paragraphs in place and drops the ones the new text no longer has", () => {
    const before = md("a\n\nb\n\nc");
    const el = defined(textTiles.markdown, "markdown")(before, ctx);
    const first = el.querySelector("p");
    defined(textPatchers.markdown, "markdown patcher")(el, before, md("A"), ctx);
    expect(paragraphs(el)).toEqual(["A"]);
    expect(el.querySelector("p")).toBe(first);
  });
});

describe("select", () => {
  const select = (options: NonNullable<Of<"select">["options"]>, value: unknown): Of<"select"> => ({
    kind: "select",
    options,
    value,
  });
  const labels = (el: HTMLElement): string[] =>
    Array.from((el as HTMLSelectElement).options, (o) => o.textContent ?? "");

  it("relabels and reselects an option whose value stays, keeping its element", () => {
    const before = select(
      [
        { label: "One", value: 1 },
        { label: "Two", value: 2 },
      ],
      1,
    );
    const el = defined(inputTiles.select, "select")(before, ctx) as HTMLSelectElement;
    const second = el.options[1];
    const after = select(
      [
        { label: "One", value: 1 },
        { label: "Deux", value: 2 },
      ],
      2,
    );
    defined(inputPatchers.select, "select patcher")(el, before, after, ctx);
    expect(labels(el)).toEqual(["One", "Deux"]);
    expect(el.options[1]).toBe(second);
    expect(el.selectedIndex).toBe(1);
  });

  it("removes the options the new list no longer has", () => {
    const before = select(
      [
        { label: "One", value: 1 },
        { label: "Two", value: 2 },
        { label: "Three", value: 3 },
      ],
      1,
    );
    const el = defined(inputTiles.select, "select")(before, ctx);
    defined(inputPatchers.select, "select patcher")(
      el,
      before,
      select([{ label: "One", value: 1 }], 1),
      ctx,
    );
    expect(labels(el)).toEqual(["One"]);
  });
});

describe("radio", () => {
  const radio = (label?: string): Of<"radio"> =>
    label === undefined ? { kind: "radio" } : { kind: "radio", props: { label } };
  const labelOf = (el: HTMLElement): string | undefined =>
    el.querySelector("span")?.textContent ?? undefined;

  it.each([
    ["changes", "Red", "Blue", "Blue"],
    ["gains", undefined, "Blue", "Blue"],
    ["loses", "Red", undefined, undefined],
  ])("%s its label text when patched", (_, from, to, shown) => {
    const before = radio(from);
    const el = defined(inputTiles.radio, "radio")(before, ctx);
    defined(inputPatchers.radio, "radio patcher")(el, before, radio(to), ctx);
    expect(labelOf(el)).toBe(shown);
  });
});

describe("icon", () => {
  const PATH = "M0 0h24v24H0z";

  function iconApp(name: string): MountedApp {
    const app: AppShape = bareApp({
      icons: { known: PATH },
      slots: { name: { value: name }, size: { value: "sm" } },
      root: () => ({ kind: "icon", name: String(app.live?.name), props: { size: app.live?.size } }),
    });
    return mountApp(app);
  }

  it("drops the placeholder text once an unresolved name resolves", () => {
    const app = iconApp("missing");
    const span = defined(document.querySelector("[data-kumiki-tile=icon]"), "icon");
    expect(span.textContent).toBe("[missing]");
    app._setSlot("name", "known");
    expect(span.textContent).toBe("");
    expect(span.querySelector("path")?.getAttribute("d")).toBe(PATH);
  });

  it("resizes the same icon without rebuilding its svg", () => {
    const app = iconApp("known");
    const svg = defined(document.querySelector("svg"), "svg");
    expect(svg.getAttribute("width")).toBe("16px");
    app._setSlot("size", "lg");
    expect(document.querySelector("svg")).toBe(svg);
    expect(svg.getAttribute("width")).toBe("32px");
    expect(svg.getAttribute("height")).toBe("32px");
  });
});

describe("card padding", () => {
  it.each([
    ["applies the default padding when the card names none", undefined, "16px"],
    ["yields to the padding the card asks for", "sm", "8px"],
  ])("%s", (_, pad, padding) => {
    const props = pad === undefined ? {} : { pad };
    const root = freshRoot();
    mount(bareApp({ root: () => ({ kind: "card", children: [], props }) }), root);
    const card = defined(root.querySelector<HTMLElement>("[data-kumiki-tile=card]"), "card");
    expect(card.style.padding).toBe(padding);
  });
});
