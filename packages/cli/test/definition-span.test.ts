import { readFileSync, writeFileSync } from "node:fs";
import {
  editDef,
  listDefs,
  load,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  viewDef,
  viewHash,
} from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.ts";
import { APP_A, read, seed, seedCopy, storeOf } from "./helpers/files.ts";
import { lastOp } from "./helpers/op-log.ts";

const EXAMPLE = feature("282-definition-token-span");
const ORIGINAL = readFileSync(EXAMPLE, "utf8");

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

  it.each([
    "fn.double",
    "slot.step",
    "tile.App",
  ])("view --hash of %s is the same whether it shares its line or not", (qname) => {
    const apart = storeOf(ORIGINAL.replace(SHARED, `${DOUBLE}\nslot step : Int = 2`));

    expect(viewHash(load(EXAMPLE), qname)).toBe(viewHash(apart, qname));
  });

  // The op log keeps these digests, so they must not move. Each is what the store that read a
  // definition by its lines gave it, with every definition on lines of its own and the string on one.
  it.each([
    ["slot.count", "22e063467235bb30"],
    ["fn.double", "ab2d50e78bd9e739"],
    ["slot.step", "e7e5c07902c20aad"],
    ["slot.notes", "81d3ea3f959edbf8"],
    ["reducer.inc", "b1f5ce9d49c66ef7"],
    ["tile.App", "de7b700266d59450"],
  ])("view --hash of %s is %s", (qname, digest) => {
    expect(viewHash(load(EXAMPLE), qname)).toBe(digest);
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
const HELPER_AND_C = "fn helper(x: Int) -> Int = x + 1   slot c : Int = 2";
const UNREFERENCED = `slot a : Int = 0
${HELPER_AND_C}
tile App = column(text("a=" + a))
${APP_A}`;

describe("a definition sharing its line with one nothing references", () => {
  it.each([
    ["slot.c", "fn helper(x: Int) -> Int = x + 1"],
    ["fn.helper", "slot c : Int = 2"],
  ])("remove %s leaves the other on the line", (qname, left) => {
    const file = seed(UNREFERENCED);

    removeDef(file, qname, false);

    expect(read(file)).toBe(UNREFERENCED.replace(HELPER_AND_C, left));
  });

  it("replace slot.c leaves fn.helper on the line", () => {
    const file = seed(UNREFERENCED);

    replaceDef(file, "slot.c", "Int = 3");

    expect(read(file)).toBe(UNREFERENCED.replace("slot c : Int = 2", "slot c : Int = 3"));
  });
});

const HELPER = "fn helper(x: Int) -> Int = x + 1";
const C = "slot c : Int = 2";

/** `fn helper` and `slot c` on one line, `slot c` first or second; nothing references either. */
const sharing = (line: string): string => `slot a : Int = 0
${line}
tile App = column(text("a=" + a))
${APP_A}`;
const C_FIRST = sharing(`${C}   ${HELPER}`);
const C_SECOND = sharing(`${HELPER}   ${C}`);

const replaceC = (body: string) => (file: string) => replaceDef(file, "slot.c", body).opId;
const editC = (replace: string) => (file: string) =>
  editDef(file, "slot.c", { find: "2", replace });

// A comment runs to the end of its line, so a text that ends in one, written where another
// definition follows on the line, would take that one into the comment.
describe("a write to a definition whose new text ends in a comment", () => {
  it.each([
    { what: "replace", run: replaceC("Int = 3 # was 2") },
    { what: "replace with a comment line", run: replaceC("Int = 3\n# was 2") },
    { what: "edit", run: editC("3 # bumped") },
  ])("$what is rejected, writing nothing, when another definition follows it on its line", ({
    run,
  }) => {
    const file = seed(C_FIRST);

    expect(() => run(file)).toThrowError(/rejected: writing slot\.c would change fn\.helper too$/);

    expect(read(file)).toBe(C_FIRST);
    expect(readOpLog(file)).toEqual([]);
  });

  it.each([
    { what: "replace", run: replaceC("Int = 3 # was 2"), to: "slot c : Int = 3 # was 2" },
    { what: "edit", run: editC("3 # bumped"), to: "slot c : Int = 3 # bumped" },
  ])("$what writes it when the definition ends its line, and the revert takes it out", ({
    run,
    to,
  }) => {
    const file = seed(C_SECOND);

    const opId = run(file);
    expect(read(file)).toBe(C_SECOND.replace(C, to));
    patchRevert(file, opId);

    expect(read(file)).toBe(C_SECOND);
  });
});

describe("patch revert of a replace whose text is followed on its line", () => {
  it("by the definition that shares the line puts back the text alone", () => {
    const file = seed(C_FIRST);

    patchRevert(file, replaceC("Int = 3")(file));

    expect(read(file)).toBe(C_FIRST);
  });

  // Edited by hand, the comment the replace wrote is no longer all of what follows on its line.
  it.each([
    ["# a + 1", "slot c : Int = 2 # a + 1"],
    ["# ab", "slot c : Int = 2 # ab"],
  ])("by a comment edited to %s since leaves that comment after the text put back", (edited, back) => {
    const source = "slot c : Int = 2\nslot d : Int = 5\n";
    const file = seed(source);
    const opId = replaceC("Int = 3 # a")(file);
    writeFileSync(file, read(file).replace("# a", edited));

    patchRevert(file, opId);

    expect(read(file)).toBe(source.replace(C, back));
  });
});

describe("a remove --cascade of definitions that share a line", () => {
  const SOURCE = `slot count : Int = 0
slot step : Int = 2   ${REDUCER}  # note
tile IncBtn = button(text="+")
`;

  it("records each one as what it cut, the comment at the end of the line included", () => {
    const file = seed(SOURCE);

    removeDef(file, "slot.step", true);

    expect(read(file)).toBe('slot count : Int = 0\ntile IncBtn = button(text="+")\n');
    expect(lastOp(file).bodies?.map((b) => b.text)).toEqual([
      "slot step : Int = 2",
      `${REDUCER}  # note`,
    ]);
  });

  it("puts each back on a line of its own on revert, and the comment with the one it ended", () => {
    const file = seed(SOURCE);

    patchRevert(file, removeDef(file, "slot.step", true).opId);

    expect(read(file)).toBe(SOURCE.replace(`slot step : Int = 2   `, "slot step : Int = 2\n"));
  });
});

describe("a definition that shares its line with the definitions on both sides", () => {
  const SOURCE = `slot a : Int = 0   slot b : Int = 1   slot c : Int = 2
tile App = column(text("a=" + a + c))
${APP_A}`;

  it("remove cuts it with the spaces toward the one before it", () => {
    const file = seed(SOURCE);

    removeDef(file, "slot.b", false);

    expect(read(file)).toBe(SOURCE.replace("slot b : Int = 1   ", ""));
  });

  it("goes back on revert on the line after the one it shared", () => {
    const file = seed(SOURCE);

    patchRevert(file, removeDef(file, "slot.b", false).opId);

    expect(read(file)).toBe(
      SOURCE.replace("slot b : Int = 1   ", "").replace("Int = 2\n", "Int = 2\nslot b : Int = 1\n"),
    );
  });
});

describe("a shared first line of a file that starts with a byte order mark", () => {
  const SOURCE = `\uFEFF${C}   ${HELPER}
tile App = column(text("c"))
${APP_A}`;

  it("view prints the first definition without the mark", () => {
    expect(viewDef(storeOf(SOURCE), "slot.c")).toBe(C);
  });

  it.each([
    { what: "remove slot.c", run: (f: string) => removeDef(f, "slot.c", false).opId, to: HELPER },
    { what: "replace slot.c", run: replaceC("Int = 3"), to: `slot c : Int = 3   ${HELPER}` },
  ])("$what writes after the mark, and the revert puts the file back", ({ run, to }) => {
    const file = seed(SOURCE);

    const opId = run(file);
    expect(read(file)).toBe(SOURCE.replace(`${C}   ${HELPER}`, to));
    patchRevert(file, opId);

    expect(read(file)).toBe(to === HELPER ? SOURCE.replace(`${C}   `, `${C}\n`) : SOURCE);
  });
});

describe("a string that ends in an escaped backslash, right before the next definition", () => {
  const S = 'slot s : Text = "a\\\\"';
  const SOURCE = `${S}   ${C}
tile App = column(text(s))
${APP_A}`;

  it("ends at its closing quote", () => {
    expect(viewDef(storeOf(SOURCE), "slot.s")).toBe(S);
  });

  it("is left as it is by a replace of the next definition", () => {
    const file = seed(SOURCE);

    replaceC("Int = 3")(file);

    expect(read(file)).toBe(SOURCE.replace(C, "slot c : Int = 3"));
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

  it.each(WRITES)("patch revert puts the file back byte for byte after $what", ({ run }) => {
    const file = seed(CRLF);

    patchRevert(file, run(file));

    expect(read(file)).toBe(CRLF);
  });

  it("patch revert puts the file back byte for byte after a remove of a string over two lines", () => {
    const file = seed(CRLF);

    patchRevert(file, removeDef(file, "slot.notes", true).opId);

    expect(read(file)).toBe(CRLF);
  });
});
