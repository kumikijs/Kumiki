// The scenario action set is closed: an action outside it fails the run rather
// than being skipped. That makes every prose copy of the set load-bearing — an
// action missing from the description an agent reads is one it will not write,
// and therefore one nothing exercises.
//
// The MCP tool's description is built from `HEADLESS_ACTION_KEYS` and needs no
// test. These three are prose, and had drifted by six actions: `focus`, `blur`,
// `submit` and `wait` were added to the runner and to none of them.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADLESS_ACTION_KEYS } from "@kumikijs/runtime";
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
