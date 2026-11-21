import type { AppShape } from "@kumikijs/runtime";
import { _stdlib, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

function makeStyledApp(): AppShape {
  return bareApp({
    themes: {
      Light: {
        colors: { surface: "rgb(240, 240, 240)" },
        spacing: { md: "12px" },
      },
    },
    themeName: "Light",
    root: () => ({
      kind: "box",
      children: [],
      props: {
        style: {
          background: _stdlib.token("colors", ["surface"]),
          padding: _stdlib.token("spacing", ["md"]),
          "border-radius": "4px",
        },
      },
    }),
  });
}

describe("style block application", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    root.remove();
  });

  it("applies each style-block key as a CSS property on the rendered element", () => {
    mount(makeStyledApp(), root);
    const box = root.querySelector<HTMLElement>('[data-kumiki-tile="box"]');
    expect(box?.style.background).toBe("rgb(240, 240, 240)");
    expect(box?.style.padding).toBe("12px");
    expect(box?.style.borderRadius).toBe("4px");
  });

  it("says so when the selected theme name matches no declared theme", () => {
    const warnings = captureConsole("warn");
    const app = makeStyledApp();
    app.themeName = "Ligth";
    mount(app, root);
    expect(warnings.join(" ")).toContain('Theme "Ligth" is not declared');
  });
});

describe("a style block's token the theme leaves out", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The theme declares each section with another key, so only the default can answer.
  const PARTIAL_THEME = {
    spacing: { xs: "1px" },
    radius: { sm: "1px" },
    shadow: { lg: "none" },
    colors: { muted: "#000" },
    typography: { size: { sm: "1px" } },
  };

  it.each([
    ["a spacing", "spacing", ["md"], { pad: "md" }, "padding", "16px"],
    ["a radius", "radius", ["md"], { radius: "md" }, "border-radius", "8px"],
    ["a shadow", "shadow", ["sm"], { shadow: "sm" }, "box-shadow", "0 1px 2px rgba(0,0,0,0.1)"],
    ["a color", "colors", ["surface"], { bg: "surface" }, "background", "#f7f7f7"],
    ["a font size", "typography", ["size", "lg"], { size: "lg" }, "font-size", "20px"],
  ])("takes %s shorthand's default, under no theme and a theme without the key", (_label, group, path, shorthand, property, expected) => {
    for (const themes of [undefined, { T: PARTIAL_THEME }]) {
      const root = freshRoot();
      mount(
        bareApp({
          ...(themes && { themes, themeName: "T" }),
          root: () => ({
            kind: "column",
            children: [
              { kind: "box", children: [], props: { ...shorthand, id: "short" } },
              {
                kind: "box",
                children: [],
                props: { style: { [property]: _stdlib.token(group, path) }, id: "ref" },
              },
            ],
          }),
        }),
        root,
      );
      const shown = (id: string): string =>
        (root.querySelector(`#${id}`) as HTMLElement).style.getPropertyValue(property);
      expect([shown("short"), shown("ref")]).toEqual([expected, expected]);
      root.remove();
    }
  });
});
