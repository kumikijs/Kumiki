import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addDef,
  applyFixPlan,
  editDef,
  load,
  lockDef,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  runFixFromTest,
  unlockDef,
} from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { beforeEach, describe, expect, it } from "vitest";
import { touchedLockViolation } from "../src/mutate/commit.ts";
import { seedCopy } from "./helpers/files.ts";
import { asAgent, logPath } from "./helpers/op-log.ts";

const COUNTER = app("01-counter");

let file = "";
beforeEach(() => {
  file = seedCopy(COUNTER, "c.kumiki");
});

/** Runs `op` as agent:b and asserts it was refused: the file byte-identical, nothing logged. */
const refusedUnchanged = (op: () => unknown, message: RegExp): void => {
  const source = readFileSync(file, "utf8");
  const logged = readOpLog(file).length;
  asAgent("agent:b");
  expect(op).toThrowError(message);
  expect(readFileSync(file, "utf8")).toBe(source);
  expect(readOpLog(file)).toHaveLength(logged);
};

describe("an ownership lock", () => {
  beforeEach(() => {
    asAgent("agent:a");
    lockDef(file, "agent:a", "slot.todos*");
  });

  it("rejects ops from another author within the locked pattern", () => {
    refusedUnchanged(() => addDef(file, "slot", "todosNew", "Int = 0"), /lock violation/);
  });

  it("permits the lock holder to keep editing", () => {
    expect(() => addDef(file, "slot", "todosBackup", "Int = 0")).not.toThrow();
  });

  it("permits unrelated ops by other authors", () => {
    asAgent("agent:b");
    expect(() => addDef(file, "slot", "lastSync", "Option(Time) = None")).not.toThrow();
  });

  it("is released by unlock", () => {
    unlockDef(file, "agent:a");
    asAgent("agent:b");
    expect(() => addDef(file, "slot", "todosNew", "Int = 0")).not.toThrow();
  });
});

describe("remove --cascade", () => {
  it("is refused when a cascaded dependent is locked by another agent", () => {
    lockDef(file, "agent:a", "reducer.*,tile.*");
    refusedUnchanged(
      () => removeDef(file, "slot.count", true),
      /lock violation: reducer\.dec is locked by agent:a/,
    );
    asAgent("agent:a");
    expect(removeDef(file, "slot.count", true).removed).toContain("reducer.dec");
  });
});

describe("rename", () => {
  it("is refused when the new name is locked by another agent", () => {
    lockDef(file, "agent:a", "slot.todos*");
    refusedUnchanged(
      () => renameDef(file, "slot.count", "todos"),
      /lock violation: slot\.todos is locked by agent:a/,
    );
  });

  it("is refused when it would rewrite a definition locked by another agent", () => {
    lockDef(file, "agent:a", "reducer.*,tile.*");
    refusedUnchanged(
      () => renameDef(file, "slot.count", "total"),
      /lock violation: reducer\.dec is locked by agent:a/,
    );
  });

  it("is allowed for the owner of the locked definitions it touches", () => {
    lockDef(file, "agent:a", "slot.todos*,reducer.*,tile.*");
    asAgent("agent:a");
    renameDef(file, "slot.count", "todos");
    const store = load(file);
    expect(store.byQName.has("slot.todos")).toBe(true);
    expect(store.byQName.has("slot.count")).toBe(false);
    expect(readOpLog(file).at(-1)).toMatchObject({ op: "rename", name: "count", newName: "todos" });
  });
});

describe("a body that carries another definition", () => {
  beforeEach(() => lockDef(file, "agent:a", "slot.todos*,reducer.*"));

  it.each([
    [
      "replace cannot create a slot",
      () => replaceDef(file, "slot.count", "N = 0\n\nslot todosX : Int = 0"),
      /lock violation: slot\.todosX is locked by agent:a/,
    ],
    [
      "replace cannot create a reducer",
      () =>
        replaceDef(file, "slot.count", "N = 0\n\nreducer inc2 on=ui.click(IncBtn) do= count := 5"),
      /lock violation: reducer\.inc2 is locked by agent:a/,
    ],
    [
      "add cannot create a second definition",
      () => addDef(file, "slot", "extra", "Int = 0\n\nslot todosX : Int = 0"),
      /lock violation: slot\.todosX is locked by agent:a/,
    ],
    [
      "edit cannot create a definition",
      () =>
        editDef(file, "slot.count", {
          find: "= 0",
          replace: "= 0\n\nreducer inc2 on=ui.click(IncBtn) do= count := 5",
        }),
      /lock violation: reducer\.inc2 is locked by agent:a/,
    ],
  ])("%s inside a locked namespace", (_, op, message) => {
    refusedUnchanged(op, message);
  });

  it("is still allowed when every definition it creates is unlocked", () => {
    asAgent("agent:b");
    replaceDef(file, "slot.count", "N = 0\n\nslot other : Int = 0");
    expect(load(file).byQName.has("slot.other")).toBe(true);
  });
});

describe("patch apply", () => {
  it("replays a cascade through the same check", () => {
    lockDef(file, "agent:a", "tile.App");
    const bundle = join(dirname(file), "ops.jsonl");
    writeFileSync(
      bundle,
      `${JSON.stringify({ op: "remove", layer: "slot", name: "count", cascade: true })}\n`,
    );
    refusedUnchanged(
      () => patchApplyFile(file, bundle),
      /lock violation: tile\.App is locked by agent:a/,
    );
    expect(existsSync(logPath(file))).toBe(false);
  });
});

describe("patch revert", () => {
  it("cannot restore a cascade member locked by another agent", () => {
    asAgent("agent:b");
    const { opId } = removeDef(file, "slot.count", true);
    lockDef(file, "agent:a", "reducer.inc");
    refusedUnchanged(
      () => patchRevert(file, opId),
      /lock violation: reducer\.inc is locked by agent:a/,
    );
  });

  it("cannot revert a restoring add when a member of its set is locked by another agent", () => {
    asAgent("agent:b");
    const { opId } = removeDef(file, "slot.count", true);
    const restoreId = patchRevert(file, opId);
    lockDef(file, "agent:a", "reducer.inc");
    refusedUnchanged(
      () => patchRevert(file, restoreId),
      /lock violation: reducer\.inc is locked by agent:a/,
    );
  });
});

/** The refusal for `qname`, held by agent:a through `pattern`, word for word. */
const message = (qname: string, pattern: string): string =>
  `lock violation: ${qname} is locked by agent:a (pattern "${pattern}"). Set KUMIKI_AUTHOR=agent:a to edit.`;

describe("touchedLockViolation", () => {
  const before = ["slot a : Int = 0", "slot b : Int = 0", ""].join("\n");

  it("is silent when there is no lock file", () => {
    asAgent("agent:b");
    expect(touchedLockViolation(file, before, 'tile T = text("t")\n')).toBeUndefined();
  });

  it("names the first touched definition another agent holds, in qualified-name order", () => {
    lockDef(file, "agent:a", "slot.b,tile.*");
    asAgent("agent:b");
    const withA1 = (rest: string): string => `slot a : Int = 1\n${rest}`;
    // Only the unlocked `slot.a` changes.
    expect(touchedLockViolation(file, before, withA1("slot b : Int = 0\n"))).toBeUndefined();
    // A changed, an added and a removed definition each count as touched.
    expect(touchedLockViolation(file, before, withA1("slot b : Int = 2\n"))).toBe(
      message("slot.b", "slot.b"),
    );
    expect(
      touchedLockViolation(file, before, withA1('slot b : Int = 0\ntile T = text("t")\n')),
    ).toBe(message("tile.T", "tile.*"));
    expect(touchedLockViolation(file, before, withA1(""))).toBe(message("slot.b", "slot.b"));
    // `tile.T` comes first in the file, `slot.b` first by name.
    expect(touchedLockViolation(file, before, 'tile T = text("t")\nslot a : Int = 0\n')).toBe(
      message("slot.b", "slot.b"),
    );
    // The lock's owner may touch all of it.
    asAgent("agent:a");
    expect(touchedLockViolation(file, before, 'tile T = text("t")\n')).toBeUndefined();
  });
});

describe("fix --apply", () => {
  // The repair rewrites both `tile.App` and `reducer.inc`; the tile comes first in the file.
  const TWO_TYPOS = [
    "slot count : Int = 0",
    "tile App = column(Btn, text(cout.show))",
    "reducer inc on=ui.click(Btn) do= count := cout + 1",
    'tile Btn = button(text="+", onClick=inc)',
    "app C",
    "    caps   = []",
    '    routes = {"/" -> App, "/404" -> App}',
    "    init   = []",
    "",
  ].join("\n");

  it("is refused when the repair changes a definition locked by another agent", () => {
    writeFileSync(file, TWO_TYPOS);
    lockDef(file, "agent:a", "tile.*");
    asAgent("agent:b");
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(0);
    expect(result.blocked).toEqual({ reason: "locked", message: message("tile.App", "tile.*") });
    // The file's own errors, which the refused repair was for.
    expect(result.remaining.map((e) => e.code)).toEqual(["E0103", "E0103"]);
    expect(result.after).toBe(TWO_TYPOS);
    expect(readFileSync(file, "utf8")).toBe(TWO_TYPOS);
  });

  it("names the first locked definition in qualified-name order, not in file order", () => {
    writeFileSync(file, TWO_TYPOS);
    lockDef(file, "agent:a", "tile.App,reducer.inc");
    asAgent("agent:b");
    expect(applyFixPlan(file, undefined).blocked).toEqual({
      reason: "locked",
      message: message("reducer.inc", "reducer.inc"),
    });
    expect(readFileSync(file, "utf8")).toBe(TWO_TYPOS);
  });
});

describe("fix --auto-patch --apply", () => {
  // The compile tier repairs `tile.App`; the behavioural tier then patches `reducer.greet`.
  const TYPO_AND_FAILING_TEST = [
    'slot greeting : Text = "hi"',
    'reducer greet on=ui.click(Btn) do= greeting := "world"',
    'tile Btn = button(text="click", onClick=greet)',
    "tile App = column(heading(greting), Btn)",
    "app A",
    "    caps   = []",
    '    routes = {"/" -> App, "/404" -> App}',
    "    init   = []",
    "test greet-says-planet =",
    "    reducer-test greet",
    '        given  = {slots: {greeting: "hi"}, event: {type: ui.click, target: Btn}}',
    '        expect = {slots: {greeting: "planet"}, effects: []}',
    "",
  ].join("\n");

  it("refuses a compile fix that changes a locked definition", async () => {
    writeFileSync(file, TYPO_AND_FAILING_TEST);
    lockDef(file, "agent:a", "tile.App");
    asAgent("agent:b");
    const outcome = await runFixFromTest(file, "greet-says-planet", true);
    expect(outcome).toMatchObject({
      ok: false,
      status: "compile-blocked",
      blocked: { reason: "locked", message: message("tile.App", "tile.App") },
    });
    expect(readFileSync(file, "utf8")).toBe(TYPO_AND_FAILING_TEST);
  });

  it("refuses a behavioural patch that changes a locked definition, keeping the compile fix", async () => {
    writeFileSync(file, TYPO_AND_FAILING_TEST);
    lockDef(file, "agent:a", "reducer.*");
    asAgent("agent:b");
    const outcome = await runFixFromTest(file, "greet-says-planet", true);
    expect(outcome).toMatchObject({
      ok: false,
      status: "test-blocked",
      compileFixes: 1,
      blocked: { reason: "locked", message: message("reducer.greet", "reducer.*") },
    });
    // `tile.App` is not locked, so its repair stands; `reducer.greet` is as it was.
    expect(readFileSync(file, "utf8")).toBe(
      TYPO_AND_FAILING_TEST.replace("heading(greting)", "heading(greeting)"),
    );
  });
});
