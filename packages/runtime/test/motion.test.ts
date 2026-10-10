import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

const motionApp = bareApp({
  motions: {
    Spin: {
      keyframes: { from: { rotate: 0 }, to: { rotate: 360 } },
      duration: "slow",
      easing: "linear",
      iteration: "infinite",
    },
    Fade: {
      keyframes: {
        from: { opacity: 0, "translate-y": 16 },
        to: { opacity: 1, "translate-y": 0 },
      },
    },
  },
  root: () => ({
    kind: "column",
    props: {},
    children: [
      { kind: "box", props: { motion: "Spin" }, children: [{ kind: "text", text: "spin" }] },
      { kind: "card", props: { motion: "Fade" }, children: [{ kind: "text", text: "fade" }] },
    ],
  }),
});

describe("motion layer", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
    document.getElementById("kumiki-motions")?.remove();
  });

  it("injects scoped @keyframes + classes from App.motions and tags the tiles", () => {
    mount(motionApp, root);
    const css = document.getElementById("kumiki-motions")?.textContent ?? "";
    for (const rule of [
      "@keyframes kumiki-motion-Spin",
      "rotate(360deg)",
      "animation-duration: 600ms",
      "animation-iteration-count: infinite",
      "animation-timing-function: linear",
      "@keyframes kumiki-motion-Fade",
      "opacity: 0",
      "translateY(16px)",
      "prefers-reduced-motion: reduce",
    ]) {
      expect(css).toContain(rule);
    }
    expect(root.querySelector(".kumiki-motion-Spin")?.classList.contains("kumiki-motion")).toBe(
      true,
    );
    expect(root.querySelector(".kumiki-motion-Fade")).toBeTruthy();
  });
});
