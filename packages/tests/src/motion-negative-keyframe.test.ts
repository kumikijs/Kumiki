import { feature } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
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
  afterEach(() => {
    document.getElementById("kumiki-motions")?.remove();
  });

  it.each([
    [
      "starts the slide left of the resting place",
      "@keyframes kumiki-motion-SlideFromLeft { from { opacity: 0; transform: translateX(-24px) } to { opacity: 1; transform: translateX(0px) } }",
    ],
    [
      "starts the turn a quarter counter-clockwise",
      "@keyframes kumiki-motion-TurnBack { from { transform: rotate(-90deg) } to { transform: rotate(0deg) } }",
    ],
  ])("%s", async (_what, keyframes) => {
    expect(await motionCss()).toContain(keyframes);
  });
});
