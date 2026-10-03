// The scenario action set is closed: an action outside it fails the run rather
// than being skipped. That makes every prose copy of the set load-bearing — an
// action missing from the description an agent reads is one it will not write,
// and therefore one nothing exercises.
//
// The MCP tool's description is built from `HEADLESS_ACTION_KEYS` and needs no
// test. These three are prose, and had drifted by six actions: `focus`, `blur`,
// `submit` and `wait` were added to the runner and to none of them.
//
// The `expect` set is the same closed set with the same problem, and its prose
// copies are one more: the MCP description spells those out by hand rather than
// building them from the list. Adding `actionErrorIncludes` (#369) touched four
// files, which is exactly the count that makes a drift guard worth having.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADLESS_ACTION_KEYS, HEADLESS_EXPECT_KEYS } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the enumeration ends: the first sentence terminator after a `}`. */
function sentenceEnd(block: string): number {
  const match = /}`?[^.。]*([.。])/.exec(block);
  return match ? match.index + match[0].length : block.length;
}

/** Each file, and the line that enumerates the actions in it. */
const SURFACES: { path: string; startsWith: string }[] = [
  { path: join("docs", "spec", "testing.md"), startsWith: "- **Action**:" },
  { path: join("docs", "ja", "spec", "testing.md"), startsWith: "- **操作（action）**:" },
  {
    path: join(".claude", "skills", "kumiki-iterate", "SKILL.md"),
    startsWith: "- Actions:",
  },
];

describe("every surface that lists the scenario actions lists all of them", () => {
  for (const { path, startsWith } of SURFACES) {
    it(path, () => {
      const lines = readFileSync(join(repoRoot, path), "utf8").split("\n");
      const start = lines.findIndex((l) => l.startsWith(startsWith));
      expect(start, `no line starting with "${startsWith}"`).toBeGreaterThanOrEqual(0);
      // The list may wrap over several lines, and prose about the actions
      // follows it. Only the enumeration counts: a sentence that happens to
      // name four of them is not a list of twelve, and taking the whole bullet
      // let one stay green with an action removed from the list itself.
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((l) => l.trim() === "" || l.startsWith("- "));
      const block = [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join(" ");
      const listed = block.slice(0, sentenceEnd(block));
      for (const action of HEADLESS_ACTION_KEYS) {
        expect(listed, `${path} does not list "${action}"`).toContain(`{${action}`);
      }
    });
  }
});

/**
 * Each file, and the enumeration of the `expect` keys in it. Located by the
 * list's own first key rather than by a line prefix: the MCP description is one
 * template literal on one line, carrying several other `{ ... }` along the way,
 * and the two spec tracks write the bullet's label in different languages.
 */
const EXPECT_SURFACES: string[] = [
  join("docs", "spec", "testing.md"),
  join("docs", "ja", "spec", "testing.md"),
  join(".claude", "skills", "kumiki-iterate", "SKILL.md"),
  // Not prose but a template literal, and the one surface an agent reads before
  // it has seen any of the others.
  join("packages", "mcp", "src", "index.ts"),
];

/** The index of the `}` closing the `{` at `open`, or -1 if there is none. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

describe("every surface that lists the scenario expect keys lists all of them", () => {
  const opens = `{ ${HEADLESS_EXPECT_KEYS[0]}`;
  for (const path of EXPECT_SURFACES) {
    it(path, () => {
      const text = readFileSync(join(repoRoot, path), "utf8");
      const start = text.indexOf(opens);
      expect(start, `no expect enumeration starting "${opens}" in ${path}`).toBeGreaterThanOrEqual(
        0,
      );
      // The braces alone, not the paragraph around them: prose that goes on to
      // discuss four of the keys is not a list of six, and taking the sentence
      // would keep this green with one dropped from the enumeration itself.
      // Matched, not the first `}`: `state?: {slot: value}` is nested in three
      // of the four, and stopping at it hid the two keys that follow.
      const end = matchingBrace(text, start);
      expect(end, `unterminated expect enumeration in ${path}`).toBeGreaterThan(start);
      const listed = text.slice(start, end);
      for (const key of HEADLESS_EXPECT_KEYS) {
        expect(listed, `${path} does not list "${key}"`).toContain(key);
      }
    });
  }
});
