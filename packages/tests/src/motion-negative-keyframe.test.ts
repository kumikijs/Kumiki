import { feature } from "@kumikijs/examples";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("179-motion-negative-keyframe");

// A scenario cannot read a stylesheet, so the keyframes the example builds are read here.
async function motionCss(): Promise<string> {
  const { root, handle } = mountApp(await loadApp(EXAMPLE));
  const css = document.getElementById("kumiki-motions")?.textContent ?? "";
  handle.dispose();
  root.remove();
  return css;
}

describe("a negative keyframe value", () => {
  let css = "";
  beforeAll(async () => {
    css = await motionCss();
  });
  afterAll(() => {
    document.getElementById("kumiki-motions")?.remove();
  });

  it.each([
    ["starts the slide left of the resting place", "translateX(-24px)"],
    ["starts the turn a quarter counter-clockwise of upright", "rotate(-90deg)"],
  ])("%s", (_what, transform) => {
    expect(css).toContain(transform);
  });
});
