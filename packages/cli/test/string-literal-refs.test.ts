import { readFileSync } from "node:fs";
import { patchApplyFile, patchRevert, renameDef } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { APP_A, renamed, seed, seedCopy } from "./helpers/files.ts";

const EXAMPLE = feature("181-string-literal-refs");
const MOTION = feature("30-motion");

const SHARED = `# Spin turns the badge; this comment only names it.
motion Spin = {keyframes: {from: {rotate: 0}, to: {rotate: 360}}}
tile App = box(text("Spin")) {motion: "Spin"}
${APP_A}`;

type Edit = readonly [from: string, to: string];

/** `source` with the first occurrence of each edit's `from` replaced by its `to`. */
const edited = (source: string, edits: readonly Edit[]): string =>
  edits.reduce((s, [from, to]) => s.replace(from, to), source);

// Each `from` is spelled as the code has it, not as the example's header names it in prose.
const SPINNER_TO_WHIRL: readonly Edit[] = [
  ["motion Spin = {", "motion Whirl = {"],
  ['box(text("Loading")) {motion: "Spin"}', 'box(text("Loading")) {motion: "Whirl"}'],
];

describe("a definition named in a string literal", () => {
  it.each([
    {
      what: "inside the quotes when a tile's motion names it",
      file: EXAMPLE,
      qname: "motion.Spin",
      to: "Whirl",
      edits: SPINNER_TO_WHIRL,
    },
    {
      what: "inside the quotes when a link's prefetch names it",
      file: EXAMPLE,
      qname: "reducer.loadTodo",
      to: "fetchTodo",
      edits: [
        ["reducer loadTodo\n", "reducer fetchTodo\n"],
        ['prefetch: "loadTodo",', 'prefetch: "fetchTodo",'],
      ] as const,
    },
    {
      what: "in the motion example, and the other motion keeps its name",
      file: MOTION,
      qname: "motion.Spin",
      to: "Whirl",
      edits: SPINNER_TO_WHIRL,
    },
  ])("is renamed $what", ({ file, qname, to, edits }) => {
    // The whole file, so a comment that names the definition in prose is seen to keep its text.
    expect(renamed(seedCopy(file), qname, to)).toBe(edited(readFileSync(file, "utf8"), edits));
  });

  it("leaves a comment and another string literal that share the name alone", () => {
    expect(renamed(seed(SHARED), "motion.Spin", "Whirl")).toBe(
      edited(SHARED, [
        ["motion Spin = {", "motion Whirl = {"],
        ['{motion: "Spin"}', '{motion: "Whirl"}'],
      ]),
    );
  });

  it("is renamed back between the quotes when the rename is reverted", () => {
    const file = seed(SHARED);
    patchRevert(file, renameDef(file, "motion.Spin", "Whirl"));
    expect(readFileSync(file, "utf8")).toBe(SHARED);
  });

  it("is renamed between the quotes when the rename is replayed onto a copy", () => {
    const made = seed(SHARED);
    const after = renamed(made, "motion.Spin", "Whirl");

    const replayed = seed(SHARED, "replayed.kumiki");
    expect(patchApplyFile(replayed, `${made}.kumiki-ops.jsonl`)).toHaveLength(1);
    expect(readFileSync(replayed, "utf8")).toBe(after);
  });

  it("is not renamed when the quotes spell it with an escape, and the file is left as it was", () => {
    const source = SHARED.replace('{motion: "Spin"}', '{motion: "Sp\\u{69}n"}');
    const file = seed(source);
    expect(() => renameDef(file, "motion.Spin", "Whirl")).toThrow("rename aborted");
    expect(readFileSync(file, "utf8")).toBe(source);
  });
});
