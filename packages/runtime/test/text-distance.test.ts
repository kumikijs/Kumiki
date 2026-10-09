// The did-you-mean ranking every caller shares: `kumiki fix`, which writes the
// name it picks, and the verification tiers' unknown-reducer message, which
// prints it.
//
// A tie is the case that needs pinning. Two candidates at the same distance say
// nothing about which one the author meant, so the answer must be both of them
// in an order the source cannot change, or none at all. The ties below list
// their candidates out of sorted order, and the two-way ones in both orders: a
// ranking that keeps whichever it met first answers one name where all of them
// are expected.

import { describe, expect, it } from "vitest";
import { nearestName, nearestNames } from "../src/text-distance.ts";

describe("nearestNames", () => {
  it("answers the one closest candidate", () => {
    expect(nearestNames("cnt", ["count", "total"])).toEqual(["count"]);
  });

  it("answers every candidate tied at the best distance, sorted", () => {
    expect(nearestNames("count", ["countA", "countB"])).toEqual(["countA", "countB"]);
    expect(nearestNames("count", ["countB", "countA"])).toEqual(["countA", "countB"]);
  });

  it("answers a three-way tie whole", () => {
    expect(nearestNames("count", ["countC", "countA", "countB"])).toEqual([
      "countA",
      "countB",
      "countC",
    ]);
  });

  it("leaves a farther candidate out of the tie", () => {
    expect(nearestNames("count", ["countB", "counter", "countA"])).toEqual(["countA", "countB"]);
  });

  it("counts a name listed twice once, so a duplicate is not a tie", () => {
    // `kumiki fix` searches every definition's name, and two layers can hold
    // one name: both entries write the same text, which is no choice at all.
    expect(nearestNames("cnt", ["count", "count"])).toEqual(["count"]);
  });

  it("skips the written name itself, so an echo neither answers nor ties", () => {
    expect(nearestNames("App", ["App", "Apps"])).toEqual(["Apps"]);
    expect(nearestNames("App", ["Apps", "App"])).toEqual(["Apps"]);
    expect(nearestNames("App", ["App"])).toEqual([]);
  });

  it("answers nothing for a tie no candidate of which is close enough", () => {
    // Five edits from both, past both thresholds (2, and a quarter of five).
    expect(nearestNames("zzzzz", ["aaaaa", "bbbbb"])).toEqual([]);
  });

  it("answers nothing from no candidates", () => {
    expect(nearestNames("count", [])).toEqual([]);
  });
});

describe("nearestNames with preferred candidates", () => {
  // The program's own names beside the built-in ones of the same namespace:
  // `Filtre` is two edits from the declared `Filter` and from the built-in
  // `File`.
  it("answers the preferred one of two at the same distance, in either order", () => {
    expect(nearestNames("Filtre", ["Filter", "File"], ["Filter"])).toEqual(["Filter"]);
    expect(nearestNames("Filtre", ["File", "Filter"], ["Filter"])).toEqual(["Filter"]);
  });

  it("still answers by distance first", () => {
    expect(nearestNames("Fil", ["Filter", "File"], ["Filter"])).toEqual(["File"]);
  });

  it("answers a tie among preferred candidates whole", () => {
    expect(nearestNames("count", ["countC", "countB", "countA"], ["countB", "countA"])).toEqual([
      "countA",
      "countB",
    ]);
  });

  it("answers a tie among the rest when no preferred candidate is as close", () => {
    expect(nearestNames("count", ["counter", "countB", "countA"], ["counter"])).toEqual([
      "countA",
      "countB",
    ]);
  });
});

describe("nearestName", () => {
  it("answers the one closest candidate, and nothing for a tie or when none is close", () => {
    expect(nearestName("cnt", ["count", "total"])).toBe("count");
    expect(nearestName("count", ["countA", "countB"])).toBeNull();
    expect(nearestName("count", ["countB", "countA"])).toBeNull();
    expect(nearestName("zzzzz", ["aaaaa"])).toBeNull();
    expect(nearestName("Filtre", ["File", "Filter"], ["Filter"])).toBe("Filter");
  });
});
