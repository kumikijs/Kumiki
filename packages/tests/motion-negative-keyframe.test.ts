// style.md §4.9.1: `translate-x` / `translate-y` are px and `rotate` is deg,
// each a plain number, and language.md §1.2 makes the sign part of a number
// literal. So a keyframe can start left of the tile's resting place or turn it
// counter-clockwise, and the stylesheet the runtime builds says so. The corpus
// example (`179-motion-negative-keyframe`) shows the app mounting and opening;
// a scenario cannot read a stylesheet, so the keyframes are read here.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "179-motion-negative-keyframe.kumiki");

async function motionCss(): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(await loadApp(EXAMPLE), root);
  const css = document.getElementById("kumiki-motions")?.textContent ?? "";
  handle.dispose();
  root.remove();
  return css;
}

describe("a negative keyframe value", () => {
  afterEach(() => {
    document.getElementById("kumiki-motions")?.remove();
  });

  it("starts the slide left of the resting place", async () => {
    expect(await motionCss()).toContain(
      "@keyframes kumiki-motion-SlideFromLeft { from { opacity: 0; transform: translateX(-24px) } to { opacity: 1; transform: translateX(0px) } }",
    );
  });

  it("starts the turn a quarter counter-clockwise", async () => {
    expect(await motionCss()).toContain(
      "@keyframes kumiki-motion-TurnBack { from { transform: rotate(-90deg) } to { transform: rotate(0deg) } }",
    );
  });
});
