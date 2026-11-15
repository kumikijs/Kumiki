import { readFileSync } from "node:fs";
import {
  editDef,
  listDefs,
  load,
  patchRevert,
  removeDef,
  renameDef,
  replaceDef,
  viewDef,
  viewHash,
} from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.ts";
import { APP_A, seed, seedCopy, storeOf } from "./helpers/files.ts";
import { lastOp } from "./helpers/op-log.ts";

const EXAMPLE = feature("282-definition-token-span");
const ORIGINAL = readFileSync(EXAMPLE, "utf8");

const read = (file: string): string => readFileSync(file, "utf8");

const DOUBLE = "fn double(x: Int) -> Int = x * 2";
/** `fn double` and `slot step` on one line. */
const SHARED = `${DOUBLE}   slot step : Int = 2`;
/** A string over two lines, the second of which starts with `#`. */
const NOTES = 'slot notes : Text = "Counts up by two.\n## Doubled"';
const REDUCER = "reducer inc on=ui.click(IncBtn) do= count := count + step";

/** The line of the example, past its comment, that `text` starts on. */
const lineOf = (text: string): number =>
  ORIGINAL.split("\n").findIndex((l) => !l.startsWith("#") && l.includes(text.split("\n")[0]!)) + 1;

describe("a definition is its text from its first token to its last", () => {
  it("is what list and view print for one that shares its line with another", () => {
    const line = lineOf(SHARED);

    const list = runCli(["list", EXAMPLE]);
    const view = runCli(["view", EXAMPLE, "fn.double"]);

    expect(list.stdout).toContain(`fn       double  (${line}-${line})\n`);
    expect(list.stdout).toContain(`slot     step  (${line}-${line})\n`);
    expect(view).toMatchObject({ stdout: `${DOUBLE}\n`, code: 0 });
  });

  it.each([
    ["fn.double", DOUBLE],
    ["slot.step", "slot step : Int = 2"],
    ["slot.notes", NOTES],
  ])("view %s prints that definition's text and no other", (qname, text) => {
    const store = load(EXAMPLE);

    expect(viewDef(store, qname)).toBe(text);
    const { startLine, endLine } = store.byQName.get(qname)!.range;
    expect([startLine, endLine]).toEqual([
      lineOf(text),
      lineOf(text) + text.split("\n").length - 1,
    ]);
  });

  it("ends a definition that ends in a string at its closing quote, past every escape in it", () => {
    const text = 'slot quote : Text = "say \\"hi\\"\\n"';

    expect(viewDef(storeOf(`${text}   slot b : Int = 0\n`), "slot.quote")).toBe(text);
  });

  it("lists every definition in the order of the file, each on lines of its own text", () => {
    const ranges = listDefs(load(EXAMPLE)).map((e) => e.range);

    for (const [i, r] of ranges.entries()) {
      expect(r.startLine, `definition ${i}`).toBeLessThanOrEqual(r.endLine);
      expect(r.start, `definition ${i}`).toBeGreaterThanOrEqual(ranges[i - 1]?.end ?? 0);
    }
  });

  it("view --hash is the same whether a definition shares its line or not", () => {
    const apart = storeOf(ORIGINAL.replace(SHARED, `${DOUBLE}\nslot step : Int = 2`));
    const together = load(EXAMPLE);

    for (const qname of ["fn.double", "slot.step", "tile.App"]) {
      expect(viewHash(together, qname), qname).toBe(viewHash(apart, qname));
    }
  });

  it("view --hash reads a string over two lines as the one literal it is", () => {
    const escaped = storeOf(ORIGINAL.replace(NOTES, NOTES.replace("\n", "\\n")));

    expect(viewHash(load(EXAMPLE), "slot.notes")).toBe(viewHash(escaped, "slot.notes"));
  });
});

type Write = { what: string; run: (file: string) => string; from: string; to: string };

const WRITES: Write[] = [
  {
    what: "replace slot.step",
    run: (f) => replaceDef(f, "slot.step", "Int = 3").opId,
    from: SHARED,
    to: `${DOUBLE}   slot step : Int = 3`,
  },
  {
    what: "replace fn.double",
    run: (f) => replaceDef(f, "fn.double", "(x: Int) -> Int = x + x").opId,
    from: SHARED,
    to: "fn double(x: Int) -> Int = x + x   slot step : Int = 2",
  },
  {
    what: "edit slot.step",
    run: (f) => editDef(f, "slot.step", { find: "2", replace: "3" }),
    from: SHARED,
    to: `${DOUBLE}   slot step : Int = 3`,
  },
  {
    what: "replace slot.notes",
    run: (f) => replaceDef(f, "slot.notes", 'Text = "Counts up."').opId,
    from: NOTES,
    to: 'slot notes : Text = "Counts up."',
  },
  {
    what: "edit slot.notes",
    run: (f) => editDef(f, "slot.notes", { find: "## Doubled", replace: "Then doubled." }),
    from: NOTES,
    to: 'slot notes : Text = "Counts up by two.\nThen doubled."',
  },
];

describe("a write op writes the definition it names and no other", () => {
  it.each(WRITES)("$what", ({ run, from, to }) => {
    const file = seedCopy(EXAMPLE);

    run(file);

    expect(read(file)).toBe(ORIGINAL.replace(from, to));
  });

  it("edit does not find what only the definition sharing its line holds", () => {
    const file = seedCopy(EXAMPLE);

    expect(() => editDef(file, "slot.step", { find: "x * 2", replace: "x * 3" })).toThrowError(
      'edit rejected: "x * 2" not present in slot.step',
    );
    expect(read(file)).toBe(ORIGINAL);
  });

  it("remove takes a definition off the line it shares, and leaves the other there", () => {
    const file = seedCopy(EXAMPLE);

    removeDef(file, "slot.step", true);

    expect(read(file)).toBe(ORIGINAL.replace(SHARED, DOUBLE).replace(`${REDUCER}\n`, ""));
  });

  it("remove takes all the lines of a string, and the definitions that read it", () => {
    const file = seedCopy(EXAMPLE);

    const { removed } = removeDef(file, "slot.notes", true);

    expect(removed).toEqual(["slot.notes", "app.TokenSpan", "tile.App"]);
    expect(read(file)).toBe(ORIGINAL.replace(`${NOTES}\n`, "").replace(/tile App[\s\S]*$/, "\n"));
  });

  it("rename finds a definition's name on the line after its keyword", () => {
    const split = ORIGINAL.replace("slot step : Int = 2", "slot\n    step : Int = 2");
    const file = seed(split);

    renameDef(file, "slot.step", "stride");

    expect(read(file)).toBe(
      split.replace("    step : Int", "    stride : Int").replace("count + step", "count + stride"),
    );
  });
});

// Nothing references either definition on the shared line, so a write that took the other one
// with it would still pass validation.
const UNREFERENCED = `slot a : Int = 0
fn helper(x: Int) -> Int = x + 1   slot c : Int = 2
tile App = column(text("a=" + a))
${APP_A}`;

describe("a definition sharing its line with one nothing references", () => {
  it.each([
    ["slot.c", "fn helper(x: Int) -> Int = x + 1"],
    ["fn.helper", "slot c : Int = 2"],
  ])("remove %s leaves the other on the line", (qname, left) => {
    const file = seed(UNREFERENCED);

    removeDef(file, qname, false);

    expect(read(file).split("\n")[1]).toBe(left);
  });

  it("replace slot.c leaves fn.helper on the line", () => {
    const file = seed(UNREFERENCED);

    replaceDef(file, "slot.c", "Int = 3");

    expect(read(file).split("\n")[1]).toBe("fn helper(x: Int) -> Int = x + 1   slot c : Int = 3");
  });
});

describe("a tile that shares its line with another", () => {
  const SOURCE = `slot name : Text = "Ada"
tile Oops = text("boom")   tile Greeting error-boundary=Oops = heading(name)
tile App = column(Greeting)
${APP_A}`;

  it("keeps the clauses a replace body does not state", () => {
    const file = seed(SOURCE);

    replaceDef(file, "tile.Greeting", 'heading("Hello, " + name)');

    expect(read(file)).toBe(SOURCE.replace("heading(name)", 'heading("Hello, " + name)'));
    expect(lastOp(file).body).toBe('error-boundary=Oops = heading("Hello, " + name)');
  });
});

describe("a comment after a definition's last token, on its last line", () => {
  const SOURCE = "slot a : Int = 0\nslot b : Int = 1   # the second\nslot c : Int = 2\n";

  it("is not part of what view prints, and replace leaves it", () => {
    const file = seed(SOURCE);

    expect(viewDef(load(file), "slot.b")).toBe("slot b : Int = 1");
    replaceDef(file, "slot.b", "Int = 5");

    expect(read(file)).toBe(SOURCE.replace("Int = 1", "Int = 5"));
  });

  it("goes with the line when remove takes the line, and comes back with the revert", () => {
    const file = seed(SOURCE);

    const { opId } = removeDef(file, "slot.b", false);
    expect(read(file)).toBe("slot a : Int = 0\nslot c : Int = 2\n");
    patchRevert(file, opId);

    expect(read(file)).toBe(SOURCE);
  });
});

describe("patch revert of a write on such a definition", () => {
  it.each(WRITES)("puts the file back byte for byte after $what", ({ run }) => {
    const file = seedCopy(EXAMPLE);

    patchRevert(file, run(file));

    expect(read(file)).toBe(ORIGINAL);
  });

  it("puts the file back byte for byte after a remove of a string over two lines", () => {
    const file = seedCopy(EXAMPLE);

    patchRevert(file, removeDef(file, "slot.notes", true).opId);

    expect(read(file)).toBe(ORIGINAL);
  });

  it("puts a definition that shared a line back on a line of its own, after the one it followed", () => {
    const file = seedCopy(EXAMPLE);

    const { opId } = removeDef(file, "slot.step", true);
    expect(lastOp(file).bodies?.[0]).toMatchObject({
      text: "slot step : Int = 2",
      after: "fn.double",
      gap: 0,
    });
    patchRevert(file, opId);

    expect(read(file)).toBe(ORIGINAL.replace(SHARED, `${DOUBLE}\nslot step : Int = 2`));
  });
});

describe("on a file saved with CRLF", () => {
  const CRLF = ORIGINAL.replaceAll("\n", "\r\n");

  it("view prints a string over two lines with the line break \\n", () => {
    expect(viewDef(storeOf(CRLF), "slot.notes")).toBe(NOTES);
  });

  it.each(WRITES)("$what writes CRLF line ends", ({ run, from, to }) => {
    const file = seed(CRLF);

    run(file);

    expect(read(file)).toBe(ORIGINAL.replace(from, to).replaceAll("\n", "\r\n"));
  });
});
