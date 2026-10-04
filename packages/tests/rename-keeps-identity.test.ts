// A rename changes a definition's label, not the definition (ai-edit.md §9.5).
// The op log, the history, `patch revert` and the content hash all used to key
// a definition by its literal `(layer, name)`, so after `rename slot.count
// total`:
//
// - `view --history slot.total` reported no history: every earlier op was
//   logged under `count`;
// - `patch revert` of a replace made before the rename looked for
//   `slot.count`, which was gone (or was another definition by then);
// - `view --hash` hashed the raw source lines, own name, referenced names and
//   whitespace included, so the rename changed the hash of the renamed
//   definition and of everything referencing it, and so did a reformat. The
//   `depends-on` digests recorded before the rename no longer matched.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDef,
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
import { afterEach, describe, expect, it } from "vitest";

let dir = "";
const seed = (source: string): string => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-rename-identity-"));
  const file = join(dir, "h.kumiki");
  writeFileSync(file, source);
  return file;
};
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const view = (file: string, qname: string): string | null => viewDef(load(file), qname);
const hashOf = (file: string, qname: string): string => viewHash(load(file), qname);

/** `slot.count` added, replaced, then renamed to `total`; the op ids in order. */
const renamedFixture = (): { file: string; add: string; replace: string; rename: string } => {
  const file = seed("slot a : Int = 0\n");
  const add = addDef(file, "slot", "count", "Int = 1");
  const replace = replaceDef(file, "slot.count", "Int = 2");
  const rename = renameDef(file, "slot.count", "total");
  return { file, add, replace, rename };
};

describe("history across a rename", () => {
  it("lists the ops made under the old name in the new name's history", () => {
    const { file, add, replace, rename } = renamedFixture();

    expect(viewHistory(file, "slot.total").map((e) => e["op-id"])).toEqual([add, replace, rename]);
    // The old name keeps them too, as that name's history.
    expect(viewHistory(file, "slot.count").map((e) => e["op-id"])).toEqual([add, replace, rename]);
  });

  it("keeps the ops of an earlier definition that was removed from the new name", () => {
    // A removed definition is looked up by the name it had, so a later rename
    // onto that name must not hide its ops.
    const file = seed("slot a : Int = 0\n");
    const first = addDef(file, "slot", "total", "Int = 5");
    const { opId: removed } = removeDef(file, "slot.total", false);
    const add = addDef(file, "slot", "count", "Int = 1");
    const rename = renameDef(file, "slot.count", "total");

    expect(viewHistory(file, "slot.total").map((e) => e["op-id"])).toEqual([
      first,
      removed,
      add,
      rename,
    ]);
  });

  it("follows a chain of renames back to the first name", () => {
    const { file, add, replace, rename } = renamedFixture();
    const again = renameDef(file, "slot.total", "sum");

    expect(viewHistory(file, "slot.sum").map((e) => e["op-id"])).toEqual([
      add,
      replace,
      rename,
      again,
    ]);
  });
});

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
    const replace = replaceDef(file, "slot.count", "Int = 2");

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

    renameDef(file, "slot.count", "total");

    const after = ["slot.total", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );
    expect(after).toEqual(before);
  });

  it("is unchanged by a rename of a referenced tile that reorders the referrer's deps", () => {
    // `tile.App` references `IncBtn` and `ResetBtn`; `UpBtn` sorts after
    // `ResetBtn`, so ordering the deps by name would change App's hash.
    const file = seed(COUNTER);
    const before = ["tile.IncBtn", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );

    renameDef(file, "tile.IncBtn", "UpBtn");

    const after = ["tile.UpBtn", "reducer.inc", "tile.App", "app.Counter"].map((q) =>
      hashOf(file, q),
    );
    expect(after).toEqual(before);
  });

  it("is unchanged by whitespace and comments, and changed by a change of meaning", () => {
    const file = seed(COUNTER);
    const hashes = (): string[] => [hashOf(file, "slot.count"), hashOf(file, "reducer.inc")];
    const before = hashes();

    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace("slot count : Int = 0", "slot   count  :  Int  =  0   # how many")
        .replace("do= count := count + 1", "do=\n    count := count  +  1"),
    );
    expect(hashes()).toEqual(before);

    // The slot's own value changes its hash, and with it every dependent's.
    replaceDef(file, "slot.count", "Int = 1");
    const [slot, reducer] = hashes();
    expect(slot).not.toBe(before[0]);
    expect(reducer).not.toBe(before[1]);
  });

  it("is the same for two definitions that differ only in their names", () => {
    const file = seed("slot a : Int = 0\nslot b : Int = 0\nslot c : Int = 1\n");

    expect(hashOf(file, "slot.a")).toBe(hashOf(file, "slot.b"));
    expect(hashOf(file, "slot.a")).not.toBe(hashOf(file, "slot.c"));
  });

  it("keeps a depends-on digest recorded before the rename matching view --hash after it", () => {
    const file = seed(COUNTER);
    const replace = replaceDef(file, "reducer.inc", "on=ui.click(IncBtn) do= count := count + 2");
    const recorded = readOpLog(file)
      .find((e) => e["op-id"] === replace)
      ?.["depends-on"].find((d) => d.startsWith("slot:count@h:"));
    expect(recorded).toBeDefined();

    renameDef(file, "slot.count", "total");

    expect(`@h:${hashOf(file, "slot.total")}`).toBe(recorded?.slice("slot:count".length));
  });
});
