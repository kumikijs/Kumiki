import { describe, expect, it } from "vitest";
import { click, mountFeature, mountSource, tick } from "./helpers/dom.ts";

const PROPERTIES = ["padding", "border-radius", "box-shadow", "background", "font-size"] as const;

/** The five properties both cards set, read from each card's inline style. */
function cards(root: HTMLElement): Record<"short" | "refs", string[]> {
  const read = (id: string): string[] => {
    const style = (root.querySelector(`#${id}`) as HTMLElement).style;
    return PROPERTIES.map((p) => style.getPropertyValue(p));
  };
  return { short: read("short"), refs: read("refs") };
}

describe("a style block's @token under the headless loader", () => {
  it("reads the active theme as the shorthands do, falling back to the same default", async () => {
    const { root, errors } = await mountFeature("300-token-refs-read-the-theme");
    const light = ["12px", "8px", "0 1px 2px rgba(0,0,0,0.1)", "#fafafa", "22px"];
    expect(cards(root)).toEqual({ short: light, refs: light });

    click(root, "Toggle theme");
    await tick(0);
    const dark = ["20px", "2px", "0 0 0 1px #444444", "#1c1c1c", "24px"];
    expect(cards(root)).toEqual({ short: dark, refs: dark });
    expect(errors).toEqual([]);
  });

  it("reads a key the built-in defaults lack from the theme", async () => {
    const { root } = await mountSource(`
theme T = {spacing: {md: 99, pull: 4}, colors: {surface: "#123456"}}
tile App = column(
  text("a") {pad: "md", id: "a"},
  text("b") {style: {padding-left: @spacing.md, background: @colors.surface, margin-top: @spacing.pull}, id: "b"})
app A
    caps   = []
    theme  = T
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const style = (id: string): CSSStyleDeclaration =>
      (root.querySelector(`#${id}`) as HTMLElement).style;
    expect(style("a").padding).toBe("99px");
    expect([style("b").paddingLeft, style("b").background, style("b").marginTop]).toEqual([
      "99px",
      "#123456",
      "4px",
    ]);
  });
});
