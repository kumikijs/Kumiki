import { describe, expect, it } from "vitest";
import { nearestName, nearestNames } from "../src/text-distance.ts";

// The ties list their candidates out of sorted order, and the two-way ones in both orders: a
// ranking that keeps whichever it met first answers one name where all of them are expected.
describe("nearestNames", () => {
  it.each<[string, string, string[], string[], string[]]>([
    ["the one closest candidate", "cnt", ["count", "total"], [], ["count"]],
    [
      "every candidate tied at the best distance",
      "count",
      ["countA", "countB"],
      [],
      ["countA", "countB"],
    ],
    [
      "a tie whatever order it is listed in",
      "count",
      ["countB", "countA"],
      [],
      ["countA", "countB"],
    ],
    [
      "a three-way tie whole",
      "count",
      ["countC", "countA", "countB"],
      [],
      ["countA", "countB", "countC"],
    ],
    [
      "a tie without a farther candidate",
      "count",
      ["countB", "counter", "countA"],
      [],
      ["countA", "countB"],
    ],
    // Two layers can hold one name, and both entries write the same text.
    ["a name listed twice as one candidate", "cnt", ["count", "count"], [], ["count"]],
    ["an alternative to an echo of the written name", "App", ["App", "Apps"], [], ["Apps"]],
    ["an alternative listed before the echo", "App", ["Apps", "App"], [], ["Apps"]],
    ["nothing for only an echo", "App", ["App"], [], []],
    // Five edits from both, past both thresholds (2, and a quarter of five).
    ["nothing for a tie none of which is close enough", "zzzzz", ["aaaaa", "bbbbb"], [], []],
    ["nothing from no candidates", "count", [], [], []],
    // `Filtre` is two edits from the declared `Filter` and from the built-in `File`.
    [
      "the preferred one of two at the same distance",
      "Filtre",
      ["Filter", "File"],
      ["Filter"],
      ["Filter"],
    ],
    ["the preferred one listed second", "Filtre", ["File", "Filter"], ["Filter"], ["Filter"]],
    ["the closer one before the preferred one", "Fil", ["Filter", "File"], ["Filter"], ["File"]],
    [
      "a tie among preferred candidates whole",
      "count",
      ["countC", "countB", "countA"],
      ["countB", "countA"],
      ["countA", "countB"],
    ],
    [
      "a tie among the rest when no preferred one is as close",
      "count",
      ["counter", "countB", "countA"],
      ["counter"],
      ["countA", "countB"],
    ],
  ])("answers %s", (_, written, candidates, preferred, expected) => {
    expect(nearestNames(written, candidates, preferred)).toEqual(expected);
  });
});

describe("nearestName", () => {
  it.each<[string, string[], string[], string | null]>([
    ["cnt", ["count", "total"], [], "count"],
    ["count", ["countA", "countB"], [], null],
    ["count", ["countB", "countA"], [], null],
    ["zzzzz", ["aaaaa"], [], null],
    ["Filtre", ["File", "Filter"], ["Filter"], "Filter"],
  ])("answers %s among %j (preferring %j) with %s", (written, candidates, preferred, expected) => {
    expect(nearestName(written, candidates, preferred)).toBe(expected);
  });
});
