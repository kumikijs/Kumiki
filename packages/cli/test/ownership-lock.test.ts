import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { threadId } from "node:worker_threads";
import {
  addDef,
  applyFixPlan,
  editDef,
  load,
  lockDef,
  patchApplyFile,
  patchRevert,
  planFix,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  runFixFromTest,
  unlockDef,
} from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFix } from "../src/fix/compile.ts";
import { touchedLockViolation } from "../src/mutate/commit.ts";
import { writeLockPath } from "../src/write-lock.ts";
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
  const withA1 = (rest: string): string => `slot a : Int = 1\n${rest}`;

  it("is silent when there is no lock file", () => {
    asAgent("agent:b");
    expect(touchedLockViolation(file, before, 'tile T = text("t")\n')).toBeUndefined();
  });

  it.each([
    [
      "is silent when only an unlocked definition changes",
      { agent: "agent:b", after: withA1("slot b : Int = 0\n"), refused: undefined },
    ],
    [
      "names a locked definition that changes",
      {
        agent: "agent:b",
        after: withA1("slot b : Int = 2\n"),
        refused: message("slot.b", "slot.b"),
      },
    ],
    [
      "names a locked definition that is added",
      {
        agent: "agent:b",
        after: withA1('slot b : Int = 0\ntile T = text("t")\n'),
        refused: message("tile.T", "tile.*"),
      },
    ],
    [
      "names a locked definition that is removed",
      { agent: "agent:b", after: withA1(""), refused: message("slot.b", "slot.b") },
    ],
    [
      "names the first locked definition by qualified name, not by place in the file",
      {
        agent: "agent:b",
        after: 'tile T = text("t")\nslot a : Int = 0\n',
        refused: message("slot.b", "slot.b"),
      },
    ],
    [
      "is silent for the lock's owner, whatever it touches",
      { agent: "agent:a", after: 'tile T = text("t")\n', refused: undefined },
    ],
  ])("%s", (_, { agent, after, refused }) => {
    lockDef(file, "agent:a", "slot.b,tile.*");
    asAgent(agent);
    expect(touchedLockViolation(file, before, after)).toBe(refused);
  });
});

/** `cnt` is closest to the slot `cn`, a Text, so the repair breaks the `+` it sits in. */
const REPAIR_INTRODUCES = [
  "slot n  : Int  = 0",
  'slot cn : Text = ""',
  "reducer bump on=ui.click(Btn) do= n := cnt + 1",
  'tile Btn  = button(text="go")',
  "tile Page = column(Btn, text(n))",
  "app A",
  "    caps   = []",
  '    routes = {"/" -> Page, "/404" -> Page}',
  "    init   = []",
  "",
].join("\n");

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

  it("asks the lock before the regression gate, so a repair both would refuse is locked", () => {
    writeFileSync(file, REPAIR_INTRODUCES);
    lockDef(file, "agent:a", "reducer.*");
    asAgent("agent:b");
    const result = applyFixPlan(file, undefined);
    expect(result.blocked).toEqual({
      reason: "locked",
      message: message("reducer.bump", "reducer.*"),
    });
    expect(result.remaining.map((e) => e.code)).toEqual(["E0103"]);
    expect(readFileSync(file, "utf8")).toBe(REPAIR_INTRODUCES);
  });

  it("takes the write lock to write, so it waits on a writer holding it", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    writeFileSync(file, TWO_TYPOS);
    const holder = JSON.stringify({ pid: process.pid, host: hostname(), threadId: threadId + 1 });
    writeFileSync(writeLockPath(file), holder);
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(0);
    expect(result.writeError).toContain(`is being written by kumiki process ${process.pid}`);
    expect(readFileSync(file, "utf8")).toBe(TWO_TYPOS);
  });

  it("plans the same repairs under a lock as without one", () => {
    writeFileSync(file, TWO_TYPOS);
    const descriptions = (): string[] => planFix(file, undefined).patches.map((p) => p.description);
    const unlocked = descriptions();
    lockDef(file, "agent:a", "*");
    asAgent("agent:b");
    expect(unlocked).toHaveLength(2);
    expect(descriptions()).toEqual(unlocked);
  });
});

describe("writeFix", () => {
  const source = (): string => readFileSync(file, "utf8");
  const withCount = (src: string, n: number): string =>
    src.replace("slot   count  : N    = 0", `slot   count  : N    = ${n}`);

  it("writes nothing when the file changed since the repair was planned", () => {
    lockDef(file, "agent:a", "reducer.*");
    const planned = source();
    // While agent:b's repair of `slot.count` waits to be written, agent:a edits its own reducer.
    asAgent("agent:a");
    replaceDef(file, "reducer.reset", "on=ui.click(ResetBtn) do= count := 1");
    const owners = source();
    asAgent("agent:b");
    expect(writeFix(file, planned, withCount(planned, 5))).toEqual({
      writeError: `${file} changed since the repair was planned; nothing was written. Run fix again.`,
    });
    expect(source()).toBe(owners);
  });

  it("asks the lock as it stands when it writes, not as it stood when the repair was planned", () => {
    const planned = source();
    lockDef(file, "agent:a", "slot.*");
    asAgent("agent:b");
    expect(writeFix(file, planned, withCount(planned, 5))).toEqual({
      blocked: { reason: "locked", message: message("slot.count", "slot.*") },
    });
    expect(source()).toBe(planned);
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
  const COMPILE_FIXED = TYPO_AND_FAILING_TEST.replace("heading(greting)", "heading(greeting)");
  const BOTH_FIXED = COMPILE_FIXED.replace(':= "world"', ':= "planet"');

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
    expect(readFileSync(file, "utf8")).toBe(COMPILE_FIXED);
  });

  it("asks the lock before the test gate, so a patch both would refuse is locked", async () => {
    // The test wants 1 where `2 + 3` gives 5; the only `5` is the refinement's bound, which 1 breaks.
    const BREAKS_A_REFINEMENT = [
      "type Small = nominal Int where between(2, 5)",
      "slot count : Int = 0",
      "slot pick : Small = 2",
      "reducer inc on=ui.click(Btn1) do= count := 2 + 3",
      'tile Btn1 = button(text="+")',
      "tile App = column(Btn1)",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
      "test sets-one =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 1}, effects: []}",
      "",
    ].join("\n");
    writeFileSync(file, BREAKS_A_REFINEMENT);
    lockDef(file, "agent:a", "type.*");
    asAgent("agent:b");
    const outcome = await runFixFromTest(file, "sets-one", true);
    expect(outcome).toMatchObject({
      ok: false,
      status: "test-blocked",
      blocked: { reason: "locked", message: message("type.Small", "type.*") },
    });
    expect(readFileSync(file, "utf8")).toBe(BREAKS_A_REFINEMENT);
  });

  it.each([
    ["for the lock's owner", { agent: "agent:a", pattern: "reducer.*" }],
    ["under a lock on no definition the repairs change", { agent: "agent:b", pattern: "slot.*" }],
  ])("writes both tiers %s", async (_, { agent, pattern }) => {
    writeFileSync(file, TYPO_AND_FAILING_TEST);
    lockDef(file, "agent:a", pattern);
    asAgent(agent);
    const outcome = await runFixFromTest(file, "greet-says-planet", true);
    expect(outcome).toMatchObject({ ok: true, status: "applied", compileFixes: 1 });
    expect(readFileSync(file, "utf8")).toBe(BOTH_FIXED);
  });

  it.each([
    ["a compile fix", { source: TYPO_AND_FAILING_TEST, status: "compile-proposed" }],
    ["a behavioural patch", { source: COMPILE_FIXED, status: "proposed" }],
  ])("still proposes %s under a lock on everything, on a dry run", async (_, {
    source,
    status,
  }) => {
    writeFileSync(file, source);
    lockDef(file, "agent:a", "*");
    asAgent("agent:b");
    const outcome = await runFixFromTest(file, "greet-says-planet", false);
    expect(outcome).toMatchObject({ ok: true, status });
    expect(readFileSync(file, "utf8")).toBe(source);
  });
});
