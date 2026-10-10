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
