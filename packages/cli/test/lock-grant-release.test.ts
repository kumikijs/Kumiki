// Granting and releasing an ownership lock (§9.8.3, and the `lock` / `unlock`
// row of §9.2.5). Enforcing one at op time is lock-every-touched-def.test.ts.
//
// A pattern names one or more globs. `lock` grants them only when no other
// agent holds a glob that some name with exactly one dot, the shape of every
// qualified name, could match as well. Granting an overlapping glob leaves each
// agent refused by the other's lock on the names both cover, so nobody can
// edit them. `unlock` releases what the agent holds, and refuses when that is
// nothing.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lockDef, readOpLog, replaceDef, unlockDef } from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const COUNTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../examples/apps/01-counter/app.kumiki",
);

let dir = "";
let file = "";
let locks = "";
let prevAuthor: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-lock-grant-"));
  file = join(dir, "c.kumiki");
  locks = `${file}.kumiki-locks.json`;
  copyFileSync(COUNTER, file);
  prevAuthor = process.env.KUMIKI_AUTHOR;
});
afterEach(() => {
  if (prevAuthor === undefined) delete process.env.KUMIKI_AUTHOR;
  else process.env.KUMIKI_AUTHOR = prevAuthor;
  rmSync(dir, { recursive: true, force: true });
});

const as = (agent: string): void => {
  process.env.KUMIKI_AUTHOR = agent;
};

const held = (): unknown => JSON.parse(readFileSync(locks, "utf8"));

/** Runs `op` and asserts it threw `message` without writing the lock file. */
const refusedUnchanged = (op: () => unknown, message: string | RegExp): void => {
  const before = readFileSync(locks, "utf8");
  const { ino } = statSync(locks, { bigint: true });
  expect(op).toThrowError(message);
  expect(readFileSync(locks, "utf8")).toBe(before);
  // The lock file is replaced by rename, so a rewrite with the same bytes is
  // still a new inode.
  expect(statSync(locks, { bigint: true }).ino).toBe(ino);
};

/** The refusal `lock` gives `asked` while `holder` holds `pattern`. */
const conflict = (asked: string, pattern: string, holder: string): string =>
  `lock conflict: "${asked}" overlaps "${pattern}", held by ${holder}. None of the request was granted: ${holder} has to unlock first, or ask for a glob that does not overlap "${pattern}".`;

/**
 * Asserts `x` and `y` overlap whichever of them agent:a holds: agent:b is
 * refused the other, and the lock file is left as it was.
 */
const overlapBothWays = (x: string, y: string): void => {
  const ways: ReadonlyArray<readonly [mine: string, asked: string]> = [
    [x, y],
    [y, x],
  ];
  for (const [mine, asked] of ways) {
    lockDef(file, "agent:a", mine);
    refusedUnchanged(() => lockDef(file, "agent:b", asked), conflict(asked, mine, "agent:a"));
    unlockDef(file, "agent:a");
  }
};

describe("lock", () => {
  it("refuses a pattern inside or around one another agent holds", () => {
    overlapBothWays("slot.count", "slot.*");
  });

  it("refuses a pattern that shares a name with another agent's, though neither covers the other", () => {
    // Both match `slot.ab`.
    overlapBothWays("slot.a*", "slot.*b");
    // Both match `reducer.inc`.
    overlapBothWays("*.inc", "reducer.*");
    // Both match `tile.IncBtn`, the dot falling inside both `*`s.
    overlapBothWays("t*Btn", "tile*");
    // Both match `slot.count`, the two `*`s spelling the dot between them.
    overlapBothWays("slot*", "*count");
  });

  it("passes over a held glob that shares no name with the request, to one that does", () => {
    lockDef(file, "agent:a", "slot.a*,reducer.*");
    // Only a name with a second dot, like `slot.a.inc`, matches both `slot.a*`
    // and `*.inc`.
    refusedUnchanged(
      () => lockDef(file, "agent:b", "*.inc"),
      conflict("*.inc", "reducer.*", "agent:a"),
    );
  });

  it("grants none of a request when one of its globs overlaps", () => {
    lockDef(file, "agent:a", "tile.*");
    // The lock file is unchanged, so agent:b holds no `slot.count` either.
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.count,tile.App"),
      conflict("tile.App", "tile.*", "agent:a"),
    );
  });

  it("compares the request with every other agent's locks, the caller's own coming first", () => {
    lockDef(file, "agent:b", "tile.*");
    lockDef(file, "agent:a", "slot.*");
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.count"),
      conflict("slot.count", "slot.*", "agent:a"),
    );
  });

  it("leaves the holder able to edit what it locked", () => {
    lockDef(file, "agent:a", "slot.*");
    expect(() => lockDef(file, "agent:b", "slot.count")).toThrowError(/lock conflict/);
    as("agent:a");
    replaceDef(file, "slot.count", "N = 1");
    expect(readOpLog(file).at(-1)).toMatchObject({ op: "replace", name: "count" });
    as("agent:b");
    expect(() => replaceDef(file, "slot.count", "N = 2")).toThrowError(
      /lock violation: slot\.count is locked by agent:a/,
    );
  });

  it("grants patterns no other agent's pattern shares a name with", () => {
    lockDef(file, "agent:a", "slot.todos*,reducer.todo-*,tile.*Row");
    lockDef(file, "agent:b", "slot.todo,slot.user*,reducer.user-*,tile.*Card");
    expect(held()).toEqual({
      entries: [
        { agent: "agent:a", patterns: ["slot.todos*", "reducer.todo-*", "tile.*Row"] },
        { agent: "agent:b", patterns: ["slot.todo", "slot.user*", "reducer.user-*", "tile.*Card"] },
      ],
    });
  });

  it("grants a pattern that matches another agent's on no qualified name", () => {
    // `slotcount`, missing its dot, matches no definition.
    lockDef(file, "agent:a", "reducer.todo-*,slotcount");
    // What `*.user-*` and `reducer.todo-*` both match has a second dot, like
    // `reducer.todo-.user-x`; what `slot*` and `slotcount` both match has none.
    lockDef(file, "agent:b", "*.user-*,slot*");
    expect(held()).toEqual({
      entries: [
        { agent: "agent:a", patterns: ["reducer.todo-*", "slotcount"] },
        { agent: "agent:b", patterns: ["*.user-*", "slot*"] },
      ],
    });
  });

  it("grants a pattern again to the agent that holds it, and one overlapping only its own", () => {
    lockDef(file, "agent:a", "slot.*");
    lockDef(file, "agent:a", "slot.*");
    lockDef(file, "agent:a", "slot.count");
    expect(held()).toEqual({ entries: [{ agent: "agent:a", patterns: ["slot.*", "slot.count"] }] });
  });

  it("refuses a pattern that names no glob, creating no lock file and rewriting none", () => {
    const refusal = (pattern: string): string =>
      `lock pattern "${pattern}" names no glob. Give one or more, comma-separated, like "slot.todos*,reducer.todo-*".`;
    for (const pattern of ["", ",", " ", " , "]) {
      expect(() => lockDef(file, "agent:a", pattern)).toThrowError(refusal(pattern));
    }
    expect(existsSync(locks)).toBe(false);

    lockDef(file, "agent:b", "slot.*");
    refusedUnchanged(() => lockDef(file, "agent:a", ","), refusal(","));
    refusedUnchanged(() => lockDef(file, "agent:b", " , "), refusal(" , "));
    // So agent:a holds nothing to unlock.
    refusedUnchanged(() => unlockDef(file, "agent:a"), /nothing to unlock: agent:a holds no lock/);
  });

  it("compares globs of any length", () => {
    lockDef(file, "agent:a", "slot.*y");
    // Every name this matches ends in `x`, and every name agent:a's matches in `y`.
    const long = `slot.${"*x".repeat(10_000)}`;
    lockDef(file, "agent:b", long);
    expect(held()).toEqual({
      entries: [
        { agent: "agent:a", patterns: ["slot.*y"] },
        { agent: "agent:b", patterns: [long] },
      ],
    });
    const literal = `slot.${"x".repeat(20_000)}y`;
    refusedUnchanged(
      () => lockDef(file, "agent:c", literal),
      conflict(literal, "slot.*y", "agent:a"),
    );
  });

  // `lock` and every op read a glob the same way. In both, `*` takes the dot of
  // a qualified name like any other character.
  it.each([
    "*count",
    "slot*",
  ])("reads the `*` of %s as taking a dot, at lock and at each op", (glob) => {
    lockDef(file, "agent:a", glob);
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.count"),
      conflict("slot.count", glob, "agent:a"),
    );
    as("agent:b");
    expect(() => replaceDef(file, "slot.count", "N = 1")).toThrowError(
      `lock violation: slot.count is locked by agent:a (pattern "${glob}")`,
    );
  });

  // `*` is the only wildcard. The check `lock` makes and the one every op runs
  // must read a pattern the same way: if `?` made the `t` before it optional
  // for ops, agent:a's `slot.count?` would cover `slot.count`, which agent:b was
  // just granted, and neither could edit it.
  it("reads every character but `*` as itself", () => {
    lockDef(file, "agent:a", "slot.count?");
    lockDef(file, "agent:b", "slot.count");
    as("agent:b");
    expect(() => replaceDef(file, "slot.count", "N = 1")).not.toThrow();
    as("agent:a");
    expect(() => replaceDef(file, "slot.count", "N = 2")).toThrowError(
      /lock violation: slot\.count is locked by agent:b/,
    );
  });
});

describe("unlock", () => {
  it("refuses an agent that holds no lock, creating no lock file", () => {
    expect(() => unlockDef(file, "agent:x")).toThrowError(
      `nothing to unlock: agent:x holds no lock on ${file}. No agent holds one.`,
    );
    expect(existsSync(locks)).toBe(false);
  });

  it("refuses an agent that holds no lock, naming those that do and leaving their locks unwritten", () => {
    lockDef(file, "agent:a", "slot.*");
    lockDef(file, "agent:b", "tile.*");
    refusedUnchanged(
      () => unlockDef(file, "agent-a"),
      `nothing to unlock: agent-a holds no lock on ${file}. Locks on it are held by agent:a, agent:b.`,
    );
  });

  it("releases every pattern of the agent and nothing of anyone else's, once", () => {
    lockDef(file, "agent:a", "slot.*");
    lockDef(file, "agent:a", "tile.*");
    lockDef(file, "agent:b", "reducer.*");
    unlockDef(file, "agent:a");
    expect(held()).toEqual({ entries: [{ agent: "agent:b", patterns: ["reducer.*"] }] });
    refusedUnchanged(
      () => unlockDef(file, "agent:a"),
      `nothing to unlock: agent:a holds no lock on ${file}. Locks on it are held by agent:b.`,
    );
  });
});
