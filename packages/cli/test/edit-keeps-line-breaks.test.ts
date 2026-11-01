// The LF result is the one each verb has always written, so it is the oracle: on a CRLF copy of
// the same file the verb must write that text with CRLF line ends.

import { readFileSync } from "node:fs";
import {
  addDef,
  editDef,
  patchApplyFile,
  patchRevert,
  removeDef,
  renameDef,
  replaceDef,
} from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { seed } from "./helpers/files.ts";

const LF = readFileSync(app("01-counter"), "utf8").replace(/\r\n/g, "\n");
const crlf = (text: string): string => text.replace(/\n/g, "\r\n");
const CRLF = crlf(LF);

function after(source: string, run: (file: string) => unknown): string {
  const file = seed(source);
  run(file);
  return readFileSync(file, "utf8");
}

const APP_TILE = LF.slice(LF.indexOf("tile   App"), LF.indexOf("\n\napp"));

type Case = {
  verb: string;
  run: (file: string) => unknown;
  expected: (lf: string) => string;
};

const CASES: Case[] = [
  {
    verb: "rename tile.IncBtn PlusBtn (three lines, in three definitions)",
    run: (f) => renameDef(f, "tile.IncBtn", "PlusBtn"),
    expected: (lf) => lf.replaceAll("IncBtn", "PlusBtn"),
  },
  {
    verb: "replace slot.count",
    run: (f) => replaceDef(f, "slot.count", "N = 3"),
    expected: (lf) => lf.replace("slot   count  : N    = 0", "slot count : N = 3"),
  },
  {
    verb: "replace tile.App with a body over three lines",
    run: (f) =>
      replaceDef(
        f,
        "tile.App",
        'column(\n    heading("Total: " + count),\n    row(DecBtn, ResetBtn, IncBtn))',
      ),
    expected: (lf) =>
      lf.replace(
        APP_TILE,
        'tile App = column(\n    heading("Total: " + count),\n    row(DecBtn, ResetBtn, IncBtn))',
      ),
  },
  {
    verb: "edit slot.count",
    run: (f) => editDef(f, "slot.count", { find: "= 0", replace: "= 5" }),
    expected: (lf) => lf.replace("slot   count  : N    = 0", "slot   count  : N    = 5"),
  },
  {
    verb: "edit tile.App, writing a line into it",
    run: (f) =>
      editDef(f, "tile.App", {
        find: 'heading("Count: " + count),',
        replace: 'heading("Count: " + count),\n               text("tap a button"),',
      }),
    expected: (lf) =>
      lf.replace(
        'heading("Count: " + count),',
        'heading("Count: " + count),\n               text("tap a button"),',
      ),
  },
  {
    verb: "remove reducer.reset",
    run: (f) => removeDef(f, "reducer.reset", false),
    expected: (lf) => lf.replace("reducer reset on=ui.click(ResetBtn) do= count := 0\n", ""),
  },
  {
    verb: "remove tile.App --cascade (the last definitions in the file)",
    run: (f) => removeDef(f, "tile.App", true),
    expected: (lf) => `${lf.slice(0, lf.indexOf("tile   App"))}\n`,
  },
  {
    verb: "add slot.extra",
    run: (f) => addDef(f, "slot", "extra", "Int = 0"),
    expected: (lf) => `${lf}\nslot extra : Int = 0\n`,
  },
  {
    verb: "add tile.Footer with a body over two lines",
    run: (f) => addDef(f, "tile", "Footer", 'row(\n    text("footer"))'),
    expected: (lf) => `${lf}\ntile Footer = row(\n    text("footer"))\n`,
  },
];

describe.each(CASES)("$verb", ({ run, expected }) => {
  it("writes on an LF file what it always has", () => {
    expect(expected(LF)).not.toBe(LF);
    expect(after(LF, run)).toBe(expected(LF));
  });

  it("keeps each line of a CRLF file it does not write, and ends the lines it writes with CRLF", () => {
    expect(after(CRLF, run)).toBe(crlf(expected(LF)));
  });
});

describe("a line break inside a body or a patch", () => {
  const BODIES: Array<{ verb: string; run: (file: string) => unknown; line: string }> = [
    {
      verb: "add",
      run: (f) => addDef(f, "tile", "Footer", 'row(\r\n    text("footer"))'),
      line: "tile Footer = row(",
    },
    {
      verb: "replace",
      run: (f) =>
        replaceDef(
          f,
          "tile.App",
          'column(\r\n    heading("Total: " + count),\r\n    row(DecBtn, ResetBtn, IncBtn))',
        ),
      line: "tile App = column(",
    },
    {
      verb: "edit",
      run: (f) =>
        editDef(f, "tile.App", {
          find: 'heading("Count: " + count),',
          replace: 'heading("Count: " + count),\r\n               text("tap a button"),',
        }),
      line: '               heading("Count: " + count),',
    },
  ];

  it.each(BODIES)("is written as LF in an LF file by $verb", ({ run, line }) => {
    const text = after(LF, run);
    expect(text).toContain(`${line}\n`);
    expect(text).not.toContain("\r");
  });

  it.each(BODIES)("is written as CRLF in a CRLF file by $verb", ({ run, line }) => {
    const text = after(CRLF, run);
    expect(text).toContain(`${line}\r\n`);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
});

describe("patch revert and patch apply", () => {
  it("a revert of a cascade writes the definitions it restores with the file's CRLF", () => {
    const revert = (file: string): void => {
      patchRevert(file, removeDef(file, "tile.App", true).opId);
    };
    const lf = after(LF, revert);
    expect(lf).toContain("tile App = column(\n");
    expect(lf).toContain("app Counter\n    caps   = []\n");
    expect(after(CRLF, revert)).toBe(crlf(lf));
  });

  it("a revert of a rename puts a CRLF file back byte for byte", () => {
    const file = seed(CRLF);
    patchRevert(file, renameDef(file, "tile.IncBtn", "PlusBtn"));
    expect(readFileSync(file, "utf8")).toBe(CRLF);
  });

  it("replaying ops made on an LF file onto a CRLF copy writes that copy's CRLF", () => {
    const made = seed(LF);
    renameDef(made, "tile.IncBtn", "PlusBtn");
    replaceDef(made, "slot.count", "N = 3");
    editDef(made, "tile.App", {
      find: 'heading("Count: " + count),',
      replace: 'heading("Count: " + count),\n               text("tap a button"),',
    });
    removeDef(made, "reducer.reset", false);
    addDef(made, "tile", "Footer", 'row(\n    text("footer"))');
    const lf = readFileSync(made, "utf8");

    const replayed = seed(CRLF, "replayed.kumiki");
    expect(patchApplyFile(replayed, `${made}.kumiki-ops.jsonl`)).toHaveLength(5);
    expect(readFileSync(replayed, "utf8")).toBe(crlf(lf));
  });
});

describe("a file whose lines end both ways", () => {
  const MIXED = [
    "slot a : Int = 0\r\n",
    "reducer inc on=ui.click(Btn) do= a := a + 1\n",
    'tile Btn = button(text="+")\r\n',
  ].join("");

  it("keeps each line's own line end", () => {
    const file = seed(MIXED);
    renameDef(file, "slot.a", "x");
    expect(readFileSync(file, "utf8")).toBe(
      [
        "slot x : Int = 0\r\n",
        "reducer inc on=ui.click(Btn) do= x := x + 1\n",
        'tile Btn = button(text="+")\r\n',
      ].join(""),
    );
  });

  it("writes new lines with the first line end in the file", () => {
    const file = seed(MIXED);
    addDef(file, "slot", "d", "Int = 0");
    expect(readFileSync(file, "utf8")).toBe(`${MIXED}\r\nslot d : Int = 0\r\n`);

    const lfFirst = seed("slot a : Int = 0\nslot b : Int = 1\r\n", "lf-first.kumiki");
    addDef(lfFirst, "slot", "d", "Int = 0");
    expect(readFileSync(lfFirst, "utf8")).toBe(
      "slot a : Int = 0\nslot b : Int = 1\r\n\nslot d : Int = 0\n",
    );
  });
});
