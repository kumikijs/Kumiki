import { readFileSync, writeFileSync } from "node:fs";
import {
  editDef,
  lockDef,
  type OpLogEntry,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
} from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { renamed, seed, seedCopy } from "./helpers/files.ts";
import { lastOp, rewriteLogEntry, snapshot } from "./helpers/op-log.ts";

const EXAMPLE = feature("280-revert-restores-the-text");
const ABC = "slot a : Int = 0\n\nslot   b : Int = 1\nslot c : Int = 2\n";
const ORIGINAL = readFileSync(EXAMPLE, "utf8");

const read = (file: string): string => readFileSync(file, "utf8");

const replaceCount = (file: string): string => replaceDef(file, "slot.count", "N = 5").opId;
const editReset = (file: string): string =>
  editDef(file, "reducer.reset", { find: "count := 0", replace: "count := 1" });
const removeResetBtn = (file: string): string => removeDef(file, "tile.ResetBtn", true).opId;

/** A remove's entry as a version that recorded only bodies logged it. */
const withoutTexts = (e: Record<string, unknown>): void => {
  e.bodies = (e.bodies as OpLogEntry["bodies"])?.map(({ layer, name, body }) => ({
    layer,
    name,
    body,
  }));
};

const OPS = [
  { what: "a replace", run: replaceCount },
  { what: "an edit", run: editReset },
  { what: "a cascade remove", run: removeResetBtn },
] as const;

describe("patch revert of an op on definitions written by hand", () => {
  it.each(OPS)("puts the file back byte for byte after $what", ({ run }) => {
    const file = seedCopy(EXAMPLE);
    const opId = run(file);
    expect(read(file)).not.toBe(ORIGINAL);

    patchRevert(file, opId);

    expect(read(file)).toBe(ORIGINAL);
  });

  it("puts the file back after each of them in turn", () => {
    const file = seedCopy(EXAMPLE);

    for (const { run } of OPS) {
      patchRevert(file, run(file));
      expect(read(file)).toBe(ORIGINAL);
    }
  });

  it.each([
    {
      what: "a replace whose body ends with a line break",
      run: (file: string) => replaceDef(file, "slot.count", "N = 5\n").opId,
    },
    {
      what: "a replace whose body ends with a comment line",
      run: (file: string) => replaceDef(file, "slot.count", "N = 5\n# Five.").opId,
    },
    {
      what: "an edit that ends the definition with a comment line",
      run: (file: string) =>
        editDef(file, "reducer.reset", { find: "count := 0", replace: "count := 1\n# One." }),
    },
  ])("puts the file back after $what, and back again when that revert is reverted", ({ run }) => {
    const file = seedCopy(EXAMPLE);
    const opId = run(file);
    const written = read(file);

    const revertId = patchRevert(file, opId);
    expect(read(file)).toBe(ORIGINAL);

    patchRevert(file, revertId);
    expect(read(file)).toBe(written);
  });

  it("puts the file back each time a revert is reverted, logging each as a replace that patch apply replays", () => {
    const file = seedCopy(EXAMPLE);
    let opId = replaceCount(file);
    const replaced = read(file);

    for (const expected of [ORIGINAL, replaced, ORIGINAL, replaced]) {
      const replay = seed(read(file), "replay.kumiki");
      opId = patchRevert(file, opId);
      expect(read(file)).toBe(expected);

      const ops = seed(`${JSON.stringify(lastOp(file))}\n`, "ops.jsonl");
      patchApplyFile(replay, ops);
      expect(read(replay)).toBe(
        expected.replace("slot   count  : N    = 0", "slot count : N    = 0"),
      );
    }
  });

  it.each([
    { what: "a replace", run: replaceCount, qname: "slot.count", to: "total" },
    { what: "an edit", run: editReset, qname: "reducer.reset", to: "clear" },
    { what: "a cascade remove", run: removeResetBtn, qname: "reducer.dec", to: "down" },
  ])("puts the text back under the name a rename has given since $what", ({ run, qname, to }) => {
    const file = seedCopy(EXAMPLE);
    const opId = run(file);
    renameDef(file, qname, to);

    patchRevert(file, opId);

    expect(read(file)).toBe(renamed(seedCopy(EXAMPLE), qname, to));
  });

  it("puts the text back under the name a rename has given since, when that name is on the line after its keyword", () => {
    const file = seed("slot\n    count : Int = 0\n");
    const opId = replaceDef(file, "slot.count", "Int = 5").opId;
    renameDef(file, "slot.count", "total");

    patchRevert(file, opId);

    expect(read(file)).toBe("slot\n    total : Int = 0\n");
  });

  it.each([
    { what: "a replace", run: replaceCount, qname: "slot.count" },
    { what: "an edit", run: editReset, qname: "reducer.reset" },
  ])("refuses to revert $what of a definition another agent has locked, writing nothing", ({
    run,
    qname,
  }) => {
    const file = seedCopy(EXAMPLE);
    const opId = run(file);
    lockDef(file, "agent:other", qname);
    const before = snapshot(file);

    expect(() => patchRevert(file, opId)).toThrowError(`lock violation: ${qname}`);

    expect(snapshot(file)).toEqual(before);
  });
});

describe("what a write op records so that it can be reverted", () => {
  it.each([
    { what: "replace", run: replaceCount, text: "slot   count  : N    = 0" },
    { what: "edit", run: editReset, text: "reducer reset  on=ui.click(ResetBtn) do= count := 0" },
  ])("a $what records the definition's text before it as `prev`", ({ run, text }) => {
    const file = seedCopy(EXAMPLE);

    run(file);

    expect(lastOp(file).prev).toBe(text);
  });

  it.each([
    { what: "ends the file with no line break after it", source: ABC.trimEnd(), last: true },
    { what: "has a line break after it", source: ABC, last: undefined },
  ])("a remove records `last` for a definition that $what", ({ source, last }) => {
    const file = seed(source);

    removeDef(file, "slot.c", false);

    expect(lastOp(file).bodies?.[0]?.last).toBe(last);
  });

  it("a remove records each definition's text, the one it followed, and the lines between", () => {
    const file = seedCopy(EXAMPLE);

    removeResetBtn(file);

    const recorded = lastOp(file).bodies?.map(({ name, text, after, gap }) => ({
      name,
      text,
      after,
      gap,
    }));
    expect(recorded).toEqual([
      {
        name: "ResetBtn",
        text: 'tile   ResetBtn = button(text="reset")',
        after: "tile.DecBtn",
        gap: 0,
      },
      {
        name: "Counter",
        text: 'app    Counter\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []',
        after: "tile.App",
        gap: 1,
      },
      {
        name: "reset",
        text: "reducer reset  on=ui.click(ResetBtn) do= count := 0",
        after: "reducer.dec",
        gap: 0,
      },
      {
        name: "App",
        text: 'tile   App = column(\n               heading("Count: " + count),\n               row(DecBtn, ResetBtn, IncBtn) {gap: "sm"})',
        after: "tile.ResetBtn",
        gap: 2,
      },
    ]);
  });
});

describe("where patch revert of a remove puts a definition back", () => {
  it.each([
    { what: "between two others", source: ABC, qname: "slot.b" },
    {
      what: "first, after the lines the file starts with",
      source: `# Note.\n\n${ABC}`,
      qname: "slot.a",
    },
    {
      what: "last, in a file with no line break at its end",
      source: ABC.trimEnd(),
      qname: "slot.c",
    },
    {
      what: "last, after blank lines, in a file with no line break at its end",
      source: "slot a : Int = 0\n\nslot b : Int = 1",
      qname: "slot.b",
    },
    {
      what: "alone, in a file with no line break at its end",
      source: "slot   a : Int = 0",
      qname: "slot.a",
    },
    { what: "alone", source: "slot   a : Int = 0\n", qname: "slot.a" },
  ])("where it was when it stood $what", ({ source, qname }) => {
    const file = seed(source);
    const { opId } = removeDef(file, qname, false);

    patchRevert(file, opId);

    expect(read(file)).toBe(source);
  });

  it("after the definition it followed, renamed since", () => {
    const file = seed(ABC);
    const { opId } = removeDef(file, "slot.b", false);
    renameDef(file, "slot.a", "z");

    patchRevert(file, opId);

    expect(read(file)).toBe(ABC.replace("slot a", "slot z"));
  });

  it("after the definition it followed, with as many lines between, when that one has grown since", () => {
    const file = seed(ABC);
    const { opId } = removeDef(file, "slot.b", false);
    replaceDef(file, "slot.a", "Int =\n    0");

    patchRevert(file, opId);

    expect(read(file)).toBe("slot a : Int =\n    0\n\nslot   b : Int = 1\nslot c : Int = 2\n");
  });

  it.each([
    {
      what: "",
      source: "slot a : Int = 0\n\n\nslot b : Int = 1\nslot c : Int = 2\n",
      edited: "slot a : Int = 0\n\nslot c : Int = 2\n",
      reverted: "slot a : Int = 0\n\nslot b : Int = 1\nslot c : Int = 2\n",
    },
    {
      what: " and the comment lines over it",
      source: "slot a : Int = 0\n\n\nslot b : Int = 1\n# About c.\nslot c : Int = 2\n",
      edited: "slot a : Int = 0\n# About c.\nslot c : Int = 2\n",
      reverted: "slot a : Int = 0\nslot b : Int = 1\n# About c.\nslot c : Int = 2\n",
    },
  ])("right above the next definition$what when fewer lines lie between the two now", ({
    source,
    edited,
    reverted,
  }) => {
    const file = seed(source);
    const { opId } = removeDef(file, "slot.b", false);
    writeFileSync(file, edited);

    patchRevert(file, opId);

    expect(read(file)).toBe(reverted);
  });

  it.each([
    { what: "", source: "slot a : Int = 0\n\n\nslot   b : Int = 1\n" },
    { what: " and no line break at its end", source: "slot a : Int = 0\n\n\nslot   b : Int = 1" },
  ])("at the end of the file, after as many lines, when the file is shorter there now$what", ({
    source,
  }) => {
    const file = seed(source);
    const { opId } = removeDef(file, "slot.b", false);
    writeFileSync(file, "slot a : Int = 0\n");

    patchRevert(file, opId);

    expect(read(file)).toBe(source);
  });

  it.each([
    { what: "newest", order: [1, 0] },
    { what: "oldest", order: [0, 1] },
  ])("where each stood when two removes are reverted $what first", ({ order }) => {
    const file = seed(ABC);
    const removes = [removeDef(file, "slot.b", false).opId, removeDef(file, "slot.a", false).opId];

    for (const i of order) patchRevert(file, removes[i]!);

    expect(read(file)).toBe(ABC);
  });

  it("where the definition it followed stood, when a remove has taken that one since", () => {
    const file = seed(ABC);
    const { opId } = removeDef(file, "slot.b", false);
    removeDef(file, "slot.a", false);

    patchRevert(file, opId);

    expect(read(file)).toBe("\nslot   b : Int = 1\nslot c : Int = 2\n");
  });

  it("each where it stood after a cascade, when a remove has since taken the one they followed", () => {
    const source = 'slot p : Int = 0\n\ntile A = heading("a")\n\ntile B = column(A)\n';
    const file = seed(source);
    const { opId } = removeDef(file, "tile.A", true);
    const removeP = removeDef(file, "slot.p", false).opId;

    patchRevert(file, opId);
    expect(read(file)).toBe(source.replace("slot p : Int = 0\n", ""));

    patchRevert(file, removeP);
    expect(read(file)).toBe(source);
  });

  it.each([
    {
      what: "deleted by hand since",
      since: (file: string) => writeFileSync(file, "slot c : Int = 2\n"),
      reverted: "slot c : Int = 2\n\nslot   b : Int = 1\n",
    },
    {
      what: "removed since by a remove that did not record its text",
      since: (file: string) => {
        const { opId } = removeDef(file, "slot.a", false);
        rewriteLogEntry(file, opId, withoutTexts);
      },
      reverted: "\nslot c : Int = 2\n\nslot   b : Int = 1\n",
    },
    {
      what: "removed since by a remove whose log line has it follow itself",
      since: (file: string) => {
        const { opId } = removeDef(file, "slot.a", false);
        rewriteLogEntry(file, opId, (e) => {
          const [first] = e.bodies as Record<string, unknown>[];
          Object.assign(first ?? {}, { after: "slot.a" });
        });
      },
      reverted: "\nslot c : Int = 2\n\nslot   b : Int = 1\n",
    },
  ])("at the end of the file, as add writes one, when the definition it followed was $what", ({
    since,
    reverted,
  }) => {
    const file = seed(ABC);
    const { opId } = removeDef(file, "slot.b", false);
    since(file);

    patchRevert(file, opId);

    expect(read(file)).toBe(reverted);
  });

  it("logs the restore as an add of the bodies the remove recorded", () => {
    const file = seedCopy(EXAMPLE);
    const opId = removeResetBtn(file);
    const bodies = lastOp(file).bodies?.map(({ layer, name, body }) => ({ layer, name, body }));

    patchRevert(file, opId);

    const { op, layer, name, body, with: rest } = lastOp(file);
    expect({ op, main: { layer, name, body }, rest }).toEqual({
      op: "add",
      main: bodies?.[0],
      rest: bodies?.slice(1),
    });
  });
});

describe("patch revert of an op logged without the text", () => {
  it("writes a removed definition's body back at the end of the file, as add writes one", () => {
    const file = seed(ABC);
    const { opId } = removeDef(file, "slot.b", false);
    rewriteLogEntry(file, opId, withoutTexts);

    patchRevert(file, opId);

    expect(read(file)).toBe("slot a : Int = 0\n\nslot c : Int = 2\n\nslot b : Int = 1\n");
  });

  it("writes a `prev` that is a body back as a replace body", () => {
    const file = seedCopy(EXAMPLE);
    const opId = replaceCount(file);
    rewriteLogEntry(file, opId, (e) => {
      e.prev = "N    = 0";
    });

    patchRevert(file, opId);

    expect(read(file)).toBe(ORIGINAL.replace("slot   count  : N    = 0", "slot count : N    = 0"));
  });

  it.each([
    {
      what: "replace",
      run: replaceCount,
      strip: (e: Record<string, unknown>) => delete e.prev,
      message: () => "patch revert: no prior body found for slot.count",
    },
    {
      what: "edit",
      run: editReset,
      strip: (e: Record<string, unknown>) => delete e.prev,
      message: () => "patch revert: cannot reconstruct prior body for edit of reducer.reset",
    },
    {
      what: "remove",
      run: removeResetBtn,
      strip: (e: Record<string, unknown>) => delete e.bodies,
      message: (opId: string) =>
        `patch revert: cannot reconstruct the body of tile.ResetBtn, app.Counter, reducer.reset, tile.App removed by ${opId}; nothing was written`,
    },
  ])("fails a $what of a definition no op created when nothing recorded its text, writing nothing", ({
    run,
    strip,
    message,
  }) => {
    const file = seedCopy(EXAMPLE);
    const opId = run(file);
    rewriteLogEntry(file, opId, strip);
    const before = snapshot(file);

    expect(() => patchRevert(file, opId)).toThrowError(message(opId));

    expect(snapshot(file)).toEqual(before);
  });
});

describe("a remove's recorded text in the op log", () => {
  it.each([
    ["a text that is not a string", { text: 7 }, "`bodies`[0].text must be a string"],
    ["an after that is not a string", { after: 7 }, "`bodies`[0].after must be a string"],
    ["a gap that is not a whole number", { gap: 1.5 }, "`bodies`[0].gap must be a whole number"],
    ["a negative gap", { gap: -1 }, "`bodies`[0].gap must be a whole number"],
    ["a text without a gap", { gap: undefined }, "`bodies`[0].gap must be a whole number"],
    ["a gap without a text", { text: undefined }, "`bodies`[0].text must be a string"],
    ["a last that is not a boolean", { last: "yes" }, "`bodies`[0].last must be a boolean"],
  ])("is refused with %s, naming the log, the line and the field", (_what, change, problem) => {
    const file = seed(ABC);
    const { opId } = removeDef(file, "slot.b", false);
    rewriteLogEntry(file, opId, (e) => {
      const [first] = e.bodies as Record<string, unknown>[];
      Object.assign(first ?? {}, change);
    });

    expect(() => readOpLog(file)).toThrowError(`kumiki-ops.jsonl:1: ${problem}`);
  });
});
