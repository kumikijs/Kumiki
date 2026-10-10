import { readFileSync, writeFileSync } from "node:fs";
import {
  addDef,
  editDef,
  load,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  viewDef,
  viewHash,
  viewHistory,
} from "@kumikijs/cli";
import { describe, expect, it } from "vitest";
import { seed as seedFile } from "./helpers/files.ts";
import { rewriteLogEntry, snapshot } from "./helpers/op-log.ts";

const seed = (source: string): string => seedFile(source, "h.kumiki");

const view = (file: string, qname: string): string | null => viewDef(load(file), qname);
const hashOf = (file: string, qname: string): string => viewHash(load(file), qname);
const historyOf = (file: string, qname: string): string[] =>
  viewHistory(file, qname).map((e) => e["op-id"]);

/** `slot.count` added, replaced, then renamed to `total`; the op ids in order. */
const renamedFixture = (): { file: string; add: string; replace: string; rename: string } => {
  const file = seed("slot a : Int = 0\n");
  const add = addDef(file, "slot", "count", "Int = 1");
  const { opId: replace } = replaceDef(file, "slot.count", "Int = 2");
  const rename = renameDef(file, "slot.count", "total");
  return { file, add, replace, rename };
};

/**
 * `slot.count` added, replaced and removed; then a new `slot.count` added and renamed to `foo`. The op ids in order.
 */
const removedFixture = (): {
  file: string;
  first: string;
  replace: string;
  removed: string;
  again: string;
  rename: string;
} => {
  const file = seed("slot a : Int = 0\n");
  const first = addDef(file, "slot", "count", "Int = 1");
  const { opId: replace } = replaceDef(file, "slot.count", "Int = 2");
  const { opId: removed } = removeDef(file, "slot.count", false);
  const again = addDef(file, "slot", "count", "Int = 99");
  const rename = renameDef(file, "slot.count", "foo");
  return { file, first, replace, removed, again, rename };
};

describe("history across a rename", () => {
  it("lists the ops made under the old name in the new name's history", () => {
    const { file, add, replace, rename } = renamedFixture();

    expect(historyOf(file, "slot.total")).toEqual([add, replace, rename]);
    // The old name keeps them too, as that name's history.
    expect(historyOf(file, "slot.count")).toEqual([add, replace, rename]);
  });

  it("keeps the ops of an earlier definition that was removed from the new name", () => {
    // A removed definition is looked up by the name it had, so a later rename onto that name must not hide its ops.
    const file = seed("slot a : Int = 0\n");
    const first = addDef(file, "slot", "total", "Int = 5");
    const { opId: removed } = removeDef(file, "slot.total", false);
    const add = addDef(file, "slot", "count", "Int = 1");
    const rename = renameDef(file, "slot.count", "total");

    expect(historyOf(file, "slot.total")).toEqual([first, removed, add, rename]);
  });

  it("follows a chain of renames back to the first name", () => {
    const { file, add, replace, rename } = renamedFixture();
    const again = renameDef(file, "slot.total", "sum");

    expect(historyOf(file, "slot.sum")).toEqual([add, replace, rename, again]);
  });

  it("starts at the add that created the definition, not at an earlier one under its old name", () => {
    const { file, first, replace, removed, again, rename } = removedFixture();

    expect(historyOf(file, "slot.foo")).toEqual([again, rename]);
    // The name keeps every op made under it, both definitions' alike.
    expect(historyOf(file, "slot.count")).toEqual([first, replace, removed, again, rename]);
  });

  it("starts at the add, though no op removed the earlier definition under its old name", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "count", "Int = 1");
    replaceDef(file, "slot.count", "Int = 2");
    writeFileSync(file, readFileSync(file, "utf8").replace("slot count : Int = 2", ""));
    const again = addDef(file, "slot", "count", "Int = 99");
    const rename = renameDef(file, "slot.count", "foo");

    expect(historyOf(file, "slot.foo")).toEqual([again, rename]);
  });

  it("lists a removed definition's ops under its earlier name", () => {
    const file = seed("slot a : Int = 0\n");
    const add = addDef(file, "slot", "count", "Int = 1");
    const rename = renameDef(file, "slot.count", "total");
    const { opId: removed } = removeDef(file, "slot.total", false);

    expect(historyOf(file, "slot.total")).toEqual([add, rename, removed]);
  });

  it("follows a definition back to the restore that lists its old name in `with`, and no further", () => {
    // The cascade lists `tile.Show` in `removed`: it ended the definition the restore's `with` then added under the same name.
    const file = seed("slot a : Int = 0\nslot b : Int = 1\ntile Show = text(b.show)\n");
    const { opId: cascade, removed } = removeDef(file, "slot.b", true);
    expect(removed).toEqual(["slot.b", "tile.Show"]);
    const restore = patchRevert(file, cascade);
    const rename = renameDef(file, "tile.Show", "View");

    expect(historyOf(file, "tile.View")).toEqual([restore, rename]);
    expect(historyOf(file, "tile.Show")).toEqual([cascade, restore, rename]);
  });
});

const TREE = "slot a : Int = 0\n\ntype Tree = { v: Int, kids: List(Tree) }\n";

describe("patch revert across a rename", () => {
  it("reverts a replace made before the rename on the renamed definition", () => {
    const { file, replace } = renamedFixture();

    patchRevert(file, replace);

    expect(view(file, "slot.total")).toBe("slot total : Int = 1");
    expect(view(file, "slot.count")).toBeNull();
  });

  it("reverts it on the renamed definition, not on a new one that took the old name", () => {
    const { file, replace } = renamedFixture();
    addDef(file, "slot", "count", "Int = 7");

    patchRevert(file, replace);

    expect(view(file, "slot.total")).toBe("slot total : Int = 1");
    expect(view(file, "slot.count")).toBe("slot count : Int = 7");
  });

  it("finds the prior body logged under the name the definition had before", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "x", "Int = 1");
    renameDef(file, "slot.x", "count");
    const { opId: replace } = replaceDef(file, "slot.count", "Int = 2");
    // Logged without the body it replaced, so the revert looks back through the log.
    rewriteLogEntry(file, replace, (e) => {
      delete e.prev;
    });

    patchRevert(file, replace);

    expect(view(file, "slot.count")).toBe("slot count : Int = 1");
  });

  it("removes the renamed definition when reverting its add", () => {
    const { file, add } = renamedFixture();

    patchRevert(file, add);

    expect(view(file, "slot.total")).toBeNull();
    expect(view(file, "slot.a")).toBe("slot a : Int = 0");
  });

  it("reverts an earlier rename on the definition under its latest name", () => {
    const { file, rename } = renamedFixture();
    renameDef(file, "slot.total", "sum");

    patchRevert(file, rename);

    expect(view(file, "slot.count")).toBe("slot count : Int = 2");
    expect(view(file, "slot.sum")).toBeNull();
  });

  it("reverts each replace on its own definition after two definitions swap names", () => {
    const file = seed("slot a : Int = 1\nslot b : Int = 2\n");
    const { opId: onA } = replaceDef(file, "slot.a", "Int = 10");
    const { opId: onB } = replaceDef(file, "slot.b", "Int = 20");
    renameDef(file, "slot.a", "tmp");
    renameDef(file, "slot.b", "a");
    renameDef(file, "slot.tmp", "b");

    patchRevert(file, onA);
    expect(view(file, "slot.b")).toBe("slot b : Int = 1");
    expect(view(file, "slot.a")).toBe("slot a : Int = 20");

    patchRevert(file, onB);
    expect(view(file, "slot.a")).toBe("slot a : Int = 2");
  });

  it("refuses to revert a replace of a definition removed since, rather than rewrite one added under its name", () => {
    const { file, replace, removed } = removedFixture();
    const before = snapshot(file);

    expect(() => patchRevert(file, replace)).toThrowError(
      `patch revert: ${replace} replaced slot.count, which is no longer in the file: ${removed} removed slot.count; nothing was written`,
    );
    expect(snapshot(file)).toEqual(before);
  });

  it("refuses to revert the add of a definition removed since, rather than remove one added under its name", () => {
    const { file, first, removed } = removedFixture();
    const before = snapshot(file);

    expect(() => patchRevert(file, first)).toThrowError(
      `patch revert: ${first} added slot.count, which is no longer in the file: ${removed} removed slot.count; nothing was written`,
    );
    expect(snapshot(file)).toEqual(before);
  });

  it("refuses to revert a replace of a definition removed since onto one renamed to its name", () => {
    const file = seed("slot a : Int = 0\nslot other : Int = 5\n");
    addDef(file, "slot", "count", "Int = 1");
    const { opId: replace } = replaceDef(file, "slot.count", "Int = 2");
    const { opId: removed } = removeDef(file, "slot.count", false);
    renameDef(file, "slot.other", "count");
    const before = snapshot(file);

    expect(() => patchRevert(file, replace)).toThrowError(
      `patch revert: ${replace} replaced slot.count, which is no longer in the file: ${removed} removed slot.count; nothing was written`,
    );
    expect(snapshot(file)).toEqual(before);
  });

  it.each([
    "add",
    "rename",
  ] as const)("refuses to revert a replace of a definition deleted by hand, once an %s gave its name to another", (how) => {
    const file = seed("slot a : Int = 0\nslot other : Int = 5\n");
    addDef(file, "slot", "count", "Int = 1");
    const { opId: replace } = replaceDef(file, "slot.count", "Int = 2");
    writeFileSync(file, readFileSync(file, "utf8").replace("slot count : Int = 2", ""));
    const gave =
      how === "add"
        ? addDef(file, "slot", "count", "Int = 99")
        : renameDef(file, "slot.other", "count");
    const before = snapshot(file);

    expect(() => patchRevert(file, replace)).toThrowError(
      `patch revert: ${replace} replaced slot.count, which is no longer in the file: ${gave} gave slot.count to another definition; nothing was written`,
    );
    expect(snapshot(file)).toEqual(before);
  });

  it.each([
    ["remove", (file: string) => removeDef(file, "slot.count", false)],
    ["rename", (file: string) => renameDef(file, "slot.count", "total")],
  ] as const)("looks for a prior body no further back than a %s that took the name from an earlier definition", (_how, takeName) => {
    // `slot count` is written by hand after the earlier one lost the name, so
    // no op adds it: the walk back must stop where the name changed hands.
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "count", "Int = 1");
    takeName(file);
    writeFileSync(file, `${readFileSync(file, "utf8")}\nslot count : Int = 5\n`);
    const { opId: replace } = replaceDef(file, "slot.count", "Int = 2");
    rewriteLogEntry(file, replace, (e) => {
      delete e.prev;
    });

    expect(() => patchRevert(file, replace)).toThrowError(
      "patch revert: no prior body found for slot.count",
    );
  });

  it("looks for a prior body past a rename to the name the definition already had", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "count", "Int = 1");
    replaceDef(file, "slot.count", "Int = 2");
    renameDef(file, "slot.count", "count");
    const { opId: replace } = replaceDef(file, "slot.count", "Int = 3");
    rewriteLogEntry(file, replace, (e) => {
      delete e.prev;
    });

    patchRevert(file, replace);

    expect(view(file, "slot.count")).toBe("slot count : Int = 2");
  });

  it("writes a self-referencing type's body back under the name the type has now", () => {
    const file = seed(TREE);
    const { opId: replace } = replaceDef(file, "type.Tree", "{ v: Text, kids: List(Tree) }");
    renameDef(file, "type.Tree", "G");

    patchRevert(file, replace);

    expect(view(file, "type.G")).toBe("type G = { v: Int, kids: List(G) }");
  });

  it("writes it back on the renamed type, referring to itself, not to a new type that took the old name", () => {
    const file = seed(TREE);
    const { opId: replace } = replaceDef(file, "type.Tree", "{ v: Text, kids: List(Tree) }");
    renameDef(file, "type.Tree", "G");
    addDef(file, "type", "Tree", "{ name: Text }");

    patchRevert(file, replace);

    expect(view(file, "type.G")).toBe("type G = { v: Int, kids: List(G) }");
    expect(view(file, "type.Tree")).toBe("type Tree = { name: Text }");
  });

  it("reverts an edit made before the rename, self-references included", () => {
    const file = seed(TREE);
    const edit = editDef(file, "type.Tree", { find: "v: Int", replace: "v: Text" });
    renameDef(file, "type.Tree", "G");

    patchRevert(file, edit);

    expect(view(file, "type.G")).toBe("type G = { v: Int, kids: List(G) }");
  });
});

const COUNTER = `slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1
reducer reset on=ui.click(ResetBtn) do= count := 0

tile IncBtn = button(text="+")
tile ResetBtn = button(text="0")
tile App = column(heading("Count: " + count), IncBtn, ResetBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("content hash across a rename", () => {
  it("is unchanged for the renamed definition and every definition referencing it", () => {
    const file = seed(COUNTER);
    const before = ["slot.count", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );
    // Four definitions, four hashes: the comparison below can tell them apart.
    expect(new Set(before).size).toBe(4);

    renameDef(file, "slot.count", "total");

    const after = ["slot.total", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );
    expect(after).toEqual(before);
  });

  it("is unchanged by a rename of a referenced tile that reorders the referrer's deps", () => {
    // `tile.App` references `IncBtn` and `ResetBtn`; `UpBtn` sorts after `ResetBtn`, so ordering the deps by name would change App's hash.
    const file = seed(COUNTER);
    const before = ["tile.IncBtn", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );
    expect(new Set(before).size).toBe(4);

    renameDef(file, "tile.IncBtn", "UpBtn");

    const after = ["tile.UpBtn", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );
    expect(after).toEqual(before);
  });

  it("is unchanged by whitespace and comments, and changed by a change of meaning", () => {
    const file = seed(COUNTER);
    // `tile.App` and `app.Counter` sit below the reformatted reducer, which gains a line: every one of their tokens moves down a line.
    const qnames = ["slot.count", "reducer.inc", "tile.App", "app.Counter"];
    const hashes = (): string[] => qnames.map((q) => hashOf(file, q));
    const before = hashes();

    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace("slot count : Int = 0", "slot   count  :  Int  =  0   # how many")
        .replace("do= count := count + 1", "do=\n    count := count  +  1"),
    );
    expect(view(file, "tile.App")).not.toBeNull();
    expect(hashes()).toEqual(before);

    // The slot's own value changes its hash, and with it every dependent's.
    replaceDef(file, "slot.count", "Int = 1");
    const after = hashes();
    for (const [i, h] of after.entries()) expect(h, qnames[i]).not.toBe(before[i]);
  });

  it("is the same for two definitions that differ only in their names", () => {
    const file = seed("slot a : Int = 0\nslot b : Int = 0\nslot c : Int = 1\n");

    expect(hashOf(file, "slot.a")).toBe(hashOf(file, "slot.b"));
    expect(hashOf(file, "slot.a")).not.toBe(hashOf(file, "slot.c"));
  });

  it("keeps a recursive type's hash across a rename, and tells it from one that is not recursive", () => {
    const file = seed(`${TREE}\ntype Flat = { v: Int, kids: List(Int) }\n`);
    const before = hashOf(file, "type.Tree");
    expect(before).not.toBe(hashOf(file, "type.Flat"));

    renameDef(file, "type.Tree", "G");

    expect(hashOf(file, "type.G")).toBe(before);
  });

  it("keeps a depends-on digest recorded before the rename matching view --hash after it", () => {
    const file = seed(COUNTER);
    const { opId: replace } = replaceDef(
      file,
      "reducer.inc",
      "on=ui.click(IncBtn) do= count := count + 2",
    );
    const recorded = readOpLog(file)
      .find((e) => e["op-id"] === replace)
      ?.["depends-on"].find((d) => d.startsWith("slot:count@h:"));
    expect(recorded).toBeDefined();

    renameDef(file, "slot.count", "total");

    expect(`@h:${hashOf(file, "slot.total")}`).toBe(recorded?.slice("slot:count".length));
  });
});

const CYCLE = "slot z : Int = 0\n\ntype A = { b: List(B) }\n\ntype B = { a: List(A) }\n";

describe("content hash of a reference cycle", () => {
  it("is the one view --hash gives, in a depends-on digest, for every member", () => {
    const file = seed(CYCLE);
    const add = addDef(file, "type", "C", "{ a: A, b: B }");

    expect(readOpLog(file).find((e) => e["op-id"] === add)?.["depends-on"]).toEqual([
      `type:A@h:${hashOf(file, "type.A")}`,
      `type:B@h:${hashOf(file, "type.B")}`,
    ]);
  });

  it("is unchanged by a rename of a member, and changed by a change to one", () => {
    const file = seed(`${CYCLE}\ntype C = { a: A, b: B }\n`);
    const before = ["type.A", "type.B", "type.C"].map((q) => hashOf(file, q));
    expect(new Set(before).size).toBe(3);

    renameDef(file, "type.A", "Z");
    expect(["type.Z", "type.B", "type.C"].map((q) => hashOf(file, q))).toEqual(before);

    // `B` changes, and so does `Z`, which refers to it.
    replaceDef(file, "type.B", "{ a: List(Z), n: Int }");
    const after = ["type.Z", "type.B", "type.C"].map((q) => hashOf(file, q));
    for (const [i, h] of after.entries()) expect(h).not.toBe(before[i]);
  });

  it("counts which member refers to which, and every member's content", () => {
    // Three cycles of the same three bodies. `P1 -> Q1 -> R1 -> P1` and
    // `P3 -> Q3 -> R3 -> P3` are wired alike; `P2 -> R2 -> Q2 -> P2` runs the
    // other way round.
    const cycle = (n: number, next: Record<"P" | "Q" | "R", "P" | "Q" | "R">): string =>
      [
        `type P${n} = { a: Int, n: List(${next.P}${n}) }`,
        `type Q${n} = { b: Text, n: List(${next.Q}${n}) }`,
        `type R${n} = { c: Bool, n: List(${next.R}${n}) }`,
      ].join("\n\n");
    const file = seed(
      [
        "slot z : Int = 0",
        cycle(1, { P: "Q", Q: "R", R: "P" }),
        cycle(2, { P: "R", Q: "P", R: "Q" }),
        cycle(3, { P: "Q", Q: "R", R: "P" }),
      ].join("\n\n"),
    );
    const p1 = hashOf(file, "type.P1");

    expect(hashOf(file, "type.P3")).toBe(p1);
    expect(hashOf(file, "type.P2")).not.toBe(p1);

    // `R1` is two references away from `P1`, which still changes with it.
    replaceDef(file, "type.R1", "{ c: Int, n: List(P1) }");
    expect(hashOf(file, "type.P1")).not.toBe(p1);
  });
});

const SWAPPED = `slot a : Int = 0
slot b : Int = 0
slot c : Int = 1

tile Btn = button(text="go")

reducer ab on=ui.click(Btn) do= a := b
reducer ba on=ui.click(Btn) do= b := a
reducer ac on=ui.click(Btn) do= a := c

tile App = column(Btn)

app Main
    caps   = []
    routes = {"/" -> App}
    init   = []
`;

describe("content hash of references to definitions of the same content", () => {
  it("cannot tell `a := b` from `b := a` when `a` and `b` hash alike (known limitation)", () => {
    const file = seed(SWAPPED);

    expect(hashOf(file, "reducer.ab")).toBe(hashOf(file, "reducer.ba"));
    // A slot of other content is told apart.
    expect(hashOf(file, "reducer.ac")).not.toBe(hashOf(file, "reducer.ab"));
  });
});
