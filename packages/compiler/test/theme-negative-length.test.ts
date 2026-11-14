import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { builtSummariesOf, codesOf, locatedOf, posOf } from "./helpers/diagnostics.ts";

const EXAMPLE = readFileSync(feature("277-theme-lengths-from-zero"), "utf8");

const spacingMessage = (theme: string, key: string, n: number): string =>
  `theme "${theme}": spacing "${key}" is ${n}, and padding and gap cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)`;

const breakpointMessage = (theme: string, key: string, n: number): string =>
  `theme "${theme}": breakpoint "${key}" is ${n}, and a minimum viewport width cannot be negative, so "${key}" is not a breakpoint at all — write a width of 0 or more (see docs/spec/style.md)`;

const radiusMessage = (theme: string, key: string, n: number): string =>
  `theme "${theme}": radius "${key}" is ${n}, and a corner radius cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)`;

const sizeMessage = (theme: string, key: string, n: number): string =>
  `theme "${theme}": typography size "${key}" is ${n}, and a font size cannot be negative, so it has no effect — write a size of 0 or more (see docs/spec/style.md)`;

/** `themes`, the first of them `T`, under an app whose root reads a token from each checked section. */
const program = (themes: string): string => `${themes}

tile App = column(text("hi") {size: "tiny"}) {pad: "nudge", gap: {base: "sm", md: "lg"}, radius: "soft"}

app A
    caps   = []
    theme  = T
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** An E0239 saying `message`, at the number inside the first `entry` (`key: -n`) written in `src`. */
function e0239At(src: string, entry: string, message: string) {
  const at = posOf(src, entry);
  return { code: "E0239", message, line: at.line, col: at.col + entry.indexOf("-") };
}

describe("a negative spacing token, radius, font size or breakpoint width is E0239", () => {
  it("reports each one in a theme, at its number, in source order", () => {
    const src = program(`theme T = {
    spacing: {nudge: -4},
    radius: {soft: -2},
    typography: {size: {tiny: -3}},
    breakpoints: {md: -500}
}`);
    expect(locatedOf(src)).toEqual([
      e0239At(src, "nudge: -4", spacingMessage("T", "nudge", -4)),
      e0239At(src, "soft: -2", radiusMessage("T", "soft", -2)),
      e0239At(src, "tiny: -3", sizeMessage("T", "tiny", -3)),
      e0239At(src, "md: -500", breakpointMessage("T", "md", -500)),
    ]);
  });

  it.each([
    ["spacing", "nudge", "-4", spacingMessage("T", "nudge", -4)],
    ["spacing", "half", "-0.5", spacingMessage("T", "half", -0.5)],
    ["breakpoints", "md", "-500", breakpointMessage("T", "md", -500)],
    ["breakpoints", "wide", "-1.5", breakpointMessage("T", "wide", -1.5)],
    ["radius", "soft", "-4", radiusMessage("T", "soft", -4)],
    ["radius", "hair", "-0.5", radiusMessage("T", "hair", -0.5)],
  ])("%s %s: %s is reported at the number", (section, key, written, message) => {
    const src = program(`theme T = {${section}: {${key}: ${written}}}`);
    expect(locatedOf(src)).toEqual([e0239At(src, `${key}: ${written}`, message)]);
  });

  it.each([
    ["tiny", "-4", sizeMessage("T", "tiny", -4)],
    ["fine", "-0.5", sizeMessage("T", "fine", -0.5)],
  ])("typography size %s: %s is reported at the number", (key, written, message) => {
    const src = program(`theme T = {typography: {family: "serif", size: {${key}: ${written}}}}`);
    expect(locatedOf(src)).toEqual([e0239At(src, `${key}: ${written}`, message)]);
  });

  it.each([
    ["a spacing of 0", "spacing: {nudge: 0}"],
    ["a positive spacing", "spacing: {nudge: 4, half: 0.5}"],
    ["a spacing written as a string", 'spacing: {nudge: "1rem"}'],
    ["a breakpoint of 0", "breakpoints: {md: 0}"],
    ["a positive breakpoint", "breakpoints: {md: 500, wide: 1800.5}"],
    ["a breakpoint written as a string", 'breakpoints: {md: "48rem"}'],
    ["a number nested under a breakpoint, which is no width", "breakpoints: {md: {x: -1}}"],
    ["a radius of 0", "radius: {square: 0}"],
    ["a positive radius", "radius: {soft: 4, hair: 0.5}"],
    ["a radius written as a string", 'radius: {soft: "-4px"}'],
    ["a number nested under a radius, which is no length", "radius: {soft: {x: -1}}"],
    ["a font size of 0", "typography: {size: {hidden: 0}}"],
    ["a positive font size", "typography: {size: {tiny: 11, fine: 10.5}}"],
    ["a font size written as a string", 'typography: {size: {tiny: "-4px"}}'],
    ["a number nested under a font size, which is no size", "typography: {size: {tiny: {x: -1}}}"],
    ["a typography entry other than size", "typography: {weight: {thin: -100}, line-height: -1}"],
    ["a section named by a quoted key holding a dot", '"typography.size": {tiny: -4}'],
    ["a negative number for a section itself", "radius: -4"],
  ])("leaves %s alone", (_what, section) => {
    expect(codesOf(program(`theme T = {${section}}`))).toEqual([]);
  });

  it("checks every theme, whether or not the app selects it", () => {
    const src = program(`theme T = {spacing: {nudge: 4}}
theme Dark = {spacing: {nudge: -4}}`);
    expect(locatedOf(src)).toEqual([
      e0239At(src, "nudge: -4", spacingMessage("Dark", "nudge", -4)),
    ]);
  });

  it("is refused by build too", () => {
    const src = program(
      "theme T = {spacing: {nudge: -4}, radius: {soft: -2}, typography: {size: {tiny: -3}}, breakpoints: {md: -500}}",
    );
    expect(builtSummariesOf(src)).toEqual([
      `E0239 ${spacingMessage("T", "nudge", -4)}`,
      `E0239 ${radiusMessage("T", "soft", -2)}`,
      `E0239 ${sizeMessage("T", "tiny", -3)}`,
      `E0239 ${breakpointMessage("T", "md", -500)}`,
    ]);
  });
});

describe("the example's theme", () => {
  /** The example with `written`, which it holds once, replaced by `wrong`. */
  function respelled(written: string, wrong: string): string {
    expect(EXAMPLE.split(written), `"${written}" is written once`).toHaveLength(2);
    return EXAMPLE.replace(written, wrong);
  }

  it("is clean as written, a 0 spacing and a 0 radius included", () => {
    expect(codesOf(EXAMPLE)).toEqual([]);
  });

  it.each([
    ["{flush: 0, nudge: 4}", "{flush: 0, nudge: -4}", spacingMessage("Compact", "nudge", -4)],
    ["{flush: 0, nudge: 4}", "{flush: -1, nudge: 4}", spacingMessage("Compact", "flush", -1)],
    ["{square: 0}", "{square: -2}", radiusMessage("Compact", "square", -2)],
    ["{fine: 11}", "{fine: -11}", sizeMessage("Compact", "fine", -11)],
    ["{md: 500}", "{md: -500}", breakpointMessage("Compact", "md", -500)],
  ])("respelled from %s to %s, is E0239 at the number", (written, wrong, message) => {
    const src = respelled(written, wrong);
    expect(locatedOf(src)).toEqual([e0239At(src, wrong, message)]);
  });
});
