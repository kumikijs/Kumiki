import { describe, expect, it } from "vitest";
import { find, mountFeature, stubViewport } from "./helpers/dom.ts";

/** The inline styles the theme example paints on its two cards, their column and a label, at `width`px. */
async function paintedAt(width: number) {
  stubViewport(width);
  const { root, errors } = await mountFeature("277-theme-lengths-from-zero");
  const style = (id: string): CSSStyleDeclaration => find(root, `#${id}`).style;
  return {
    flush: style("flush"),
    label: style("flush-label"),
    nudged: style("nudged"),
    cards: style("cards"),
    errors,
  };
}

describe("a theme whose spacing and radius start at 0 and whose md starts at 500px", () => {
  it("gives the card on `flush: 0` no padding and the card on `nudge: 4` four pixels", async () => {
    const { flush, nudged, errors } = await paintedAt(1024);
    expect([flush.padding, nudged.padding]).toEqual(["0px", "4px"]);
    expect(errors).toEqual([]);
  });

  it("gives the card on `square: 0` square corners and its label on `fine: 11` an 11px font", async () => {
    const { flush, label } = await paintedAt(1024);
    expect([flush.borderRadius, label.fontSize]).toEqual(["0px", "11px"]);
  });

  it("pulls the second card up by the negative margin its own style block writes", async () => {
    expect((await paintedAt(1024)).nudged.marginTop).toBe("-4px");
  });

  it.each([
    [499, "8px"],
    [500, "24px"],
  ])("spaces the cards at %ipx by %s, since md starts at 500px", async (width, gap) => {
    expect((await paintedAt(width)).cards.gap).toBe(gap);
  });
});
