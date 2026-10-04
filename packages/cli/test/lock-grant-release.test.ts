// Granting and releasing an ownership lock (§9.8.3, and the `lock` / `unlock`
// row of §9.2.5). Enforcing one at op time is lock-every-touched-def.test.ts.
//
// `lock` grants a pattern only when no other agent holds one that some
// qualified name could match as well. Granting an overlapping pattern leaves
// each agent refused by the other's lock on the names both cover, so nobody
// can edit them. `unlock` releases what the agent holds, and refuses when that
// is nothing.

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
const refusedUnchanged = (op: () => unknown, message: RegExp): void => {
  const before = readFileSync(locks, "utf8");
  const { ino } = statSync(locks);
  expect(op).toThrowError(message);
  expect(readFileSync(locks, "utf8")).toBe(before);
  // The lock file is replaced by rename, so a rewrite with the same bytes is
  // still a new inode.
  expect(statSync(locks).ino).toBe(ino);
};

describe("lock", () => {
  it("refuses a pattern inside one another agent holds", () => {
    lockDef(file, "agent:a", "slot.*");
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.count"),
      /lock conflict: "slot\.count" overlaps "slot\.\*", held by agent:a/,
    );
  });

  it("refuses a pattern that covers one another agent holds", () => {
    lockDef(file, "agent:a", "slot.count");
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.*"),
      /lock conflict: "slot\.\*" overlaps "slot\.count", held by agent:a/,
    );
  });

  it("refuses a pattern that shares a name with another agent's, though neither covers the other", () => {
    lockDef(file, "agent:a", "slot.a*,reducer.*,tile*");
    // Both match `slot.ab`.
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.*b"),
      /lock conflict: "slot\.\*b" overlaps "slot\.a\*", held by agent:a/,
    );
    // `slot.a*` is passed over: only a name with a second dot, like
    // `slot.a.inc`, matches both it and `*.inc`. Both match `reducer.inc`.
    refusedUnchanged(
      () => lockDef(file, "agent:b", "*.inc"),
      /lock conflict: "\*\.inc" overlaps "reducer\.\*", held by agent:a/,
    );
    // Both match `tile.IncBtn`, the dot falling inside both `*`s.
    refusedUnchanged(
      () => lockDef(file, "agent:b", "t*Btn"),
      /lock conflict: "t\*Btn" overlaps "tile\*", held by agent:a/,
    );
  });

  it("grants none of a request when one of its globs overlaps", () => {
    lockDef(file, "agent:a", "tile.*");
    // The lock file is unchanged, so agent:b holds no `slot.count` either.
    refusedUnchanged(
      () => lockDef(file, "agent:b", "slot.count,tile.App"),
      /lock conflict: "tile\.App" overlaps "tile\.\*", held by agent:a/,
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

  // `*` is the only wildcard. The check above and the one every op runs must
  // read a pattern the same way: if `?` made the `t` before it optional for
  // ops, agent:a's `slot.count?` would cover `slot.count`, which agent:b was
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
      /nothing to unlock: agent:x holds no lock on .*c\.kumiki/,
    );
    expect(existsSync(locks)).toBe(false);
  });

  it("refuses an agent that holds no lock, leaving the other agents' locks unwritten", () => {
    lockDef(file, "agent:a", "slot.*");
    refusedUnchanged(() => unlockDef(file, "agent:x"), /nothing to unlock: agent:x holds no lock/);
  });

  it("releases every pattern of the agent and nothing of anyone else's, once", () => {
    lockDef(file, "agent:a", "slot.*");
    lockDef(file, "agent:a", "tile.*");
    lockDef(file, "agent:b", "reducer.*");
    unlockDef(file, "agent:a");
    expect(held()).toEqual({ entries: [{ agent: "agent:b", patterns: ["reducer.*"] }] });
    refusedUnchanged(() => unlockDef(file, "agent:a"), /nothing to unlock: agent:a holds no lock/);
  });
});
