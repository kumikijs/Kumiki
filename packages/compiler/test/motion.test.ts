import type { MotionDef } from "@kumikijs/compiler";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const checkSrc = (src: string) => check(parse(lex(src)));

const APP_TAIL = `
tile App = box(Spinner) {motion: "Spin"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

const SPIN = `motion Spin = {
    keyframes: {from: {rotate: 0}, to: {rotate: 360}},
    duration: "slow", easing: "linear", iteration: "infinite"
}
tile Spinner = box(text("…")) {motion: "Spin"}`;

describe("motion layer", () => {
  it("parses a `motion` definition as a MotionDef (sibling of theme, not a 7-layer)", () => {
    const program = parse(lex(`${SPIN}${APP_TAIL}`));
    const motions = program.defs.filter((d): d is MotionDef => d.kind === "MotionDef");
    expect(motions.length).toBe(1);
    expect(motions[0]?.name).toBe("Spin");
    expect((motions[0]?.body as Record<string, unknown>).duration).toBe("slow");
  });

  it("accepts a valid motion definition + reference", () => {
    expect(checkSrc(`${SPIN}${APP_TAIL}`)).toEqual([]);
  });

  it("rejects an unknown keyframe property (E0401)", () => {
    const src = `motion Bad = {keyframes: {from: {wobble: 0}, to: {wobble: 1}}}
tile App = box() {motion: "Bad"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const errs = checkSrc(src);
    expect(errs.some((e) => e.code === "E0401")).toBe(true);
  });

  it("rejects an out-of-set timing value (E0402)", () => {
    const src = `motion Bad = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, easing: "bouncy"}
tile App = box() {motion: "Bad"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const errs = checkSrc(src);
    expect(errs.some((e) => e.code === "E0402")).toBe(true);
  });

  it("accepts a positive-integer duration (ms)", () => {
    const src = `motion Ok = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: 250}
tile App = box() {motion: "Ok"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(checkSrc(src)).toEqual([]);
  });

  it("rejects a non-positive-integer duration / iteration (E0402)", () => {
    // duration and iteration are spec'd as positive Ints. 0 and floats reach the
    // validator and must be rejected (they would generate invalid/undefined CSS).
    // Negatives are unrepresentable — a leading `-` is a separate operator token,
    // so the theme-record parser rejects them before typechecking.
    const cases = ["duration: 0", "duration: 1.5", "iteration: 0", "iteration: 2.5"];
    for (const timing of cases) {
      const src = `motion Bad = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, ${timing}}
tile App = box() {motion: "Bad"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
      expect(
        checkSrc(src).some((e) => e.code === "E0402"),
        timing,
      ).toBe(true);
    }
  });

  it("rejects malformed keyframes — missing `to` (E0403)", () => {
    const src = `motion Bad = {keyframes: {from: {opacity: 0}}}
tile App = box() {motion: "Bad"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const errs = checkSrc(src);
    expect(errs.some((e) => e.code === "E0403")).toBe(true);
  });

  it("rejects a tile referencing an undefined motion (E0107)", () => {
    const src = `tile App = box() {motion: "Ghost"}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const errs = checkSrc(src);
    expect(errs.some((e) => e.code === "E0107")).toBe(true);
  });

  it("emits the motion into an `_motions` registry on App (excluded from logic layers)", () => {
    const result = compile(`${SPIN}${APP_TAIL}`, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("const _motions = {");
    expect(result.js).toContain('"Spin"');
    expect(result.js).toContain("motions: _motions,");
  });
});
