import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDef, lockDef, readOpLog, replaceDef } from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCopy } from "./helpers/files.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = app("01-counter");
const MUTATE = pathToFileURL(resolve(here, "../src/mutate.ts")).href;
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const WAIT_ENV = "KUMIKI_WRITE_LOCK_WAIT_MS";

let file = "";
let lock = "";
let holders: ChildProcess[] = [];
beforeEach(() => {
  file = seedCopy(COUNTER, "c.kumiki");
  lock = `${file}.kumiki-write.lock`;
  holders = [];
});
afterEach(() => {
  for (const h of holders) h.kill();
});

/** Run a script under tsx in a child process; resolves with its stdout. */
const runChild = (script: string, args: string[]): Promise<string> =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--import", TSX, script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done(out.trim()) : fail(new Error(err))));
  });

const holdLock = (holdMs: number, seen: string): Promise<number> =>
  new Promise((ready, fail) => {
    const script = [
      'const fs = require("node:fs");',
      'const os = require("node:os");',
      "const [lock, file, holdMs, seen] = process.argv.slice(1);",
      'fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: "wx" });',
      'console.log("ready");',
      "setTimeout(() => {",
      "  fs.copyFileSync(file, seen);",
      "  fs.rmSync(lock);",
      "}, Number(holdMs));",
    ].join("\n");
    const child = spawn(process.execPath, ["-e", script, lock, file, String(holdMs), seen], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    holders.push(child);
    child.on("error", fail);
    child.on("exit", (code) => fail(new Error(`lock holder exited early (${code})`)));
    child.stdout.on("data", (d) => {
      if (String(d).includes("ready") && child.pid !== undefined) ready(child.pid);
    });
  });

/** The pid of a process that has already exited. */
const exitedPid = (): number => {
  const gone = spawnSync(process.execPath, ["-e", "console.log(process.pid)"]);
  expect(gone.status).toBe(0);
  const pid = Number(String(gone.stdout).trim());
  expect(pid).toBeGreaterThan(0);
  return pid;
};

const slotsInFile = (): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^slot (extra\d+)\b/gm)].map((m) => m[1]!).sort();

type Racer = { name: string; pid: number; saw: number[]; opId?: string; error?: string };

const RACER = [
  'import fs from "node:fs";',
  'import { syncBuiltinESMExports } from "node:module";',
  'import { resolve } from "node:path";',
  "const [file, lock, name, atArg] = process.argv.slice(2);",
  "const at = Number(atArg);",
  'if (!Number.isFinite(at)) throw new Error("no start instant: " + atArg);',
  "const saw = [];",
  "const open = fs.openSync;",
  "fs.openSync = (path, flags, ...rest) => {",
  "  try {",
  "    return open(path, flags, ...rest);",
  "  } catch (e) {",
  '    if (e.code === "EEXIST" && resolve(String(path)) === resolve(lock)) {',
  "      try {",
  '        const { pid } = JSON.parse(fs.readFileSync(lock, "utf8"));',
  "        if (!saw.includes(pid)) saw.push(pid);",
  "      } catch {",
  "        // Released, or not filled in yet, before it could be read.",
  "      }",
  "    }",
  "    throw e;",
  "  }",
  "};",
  "syncBuiltinESMExports();",
  `const { addDef } = await import(${JSON.stringify(MUTATE)});`,
  // Sleep until just before the start instant, and spin only the last 50 ms.
  "const nap = new Int32Array(new SharedArrayBuffer(4));",
  "if (at - Date.now() > 50) Atomics.wait(nap, 0, 0, at - Date.now() - 50);",
  "while (Date.now() < at) {}",
  "const pid = process.pid;",
  "try {",
  '  console.log(JSON.stringify({ name, pid, saw, opId: addDef(file, "slot", name, "Int = 0") }));',
  "} catch (e) {",
  "  console.log(JSON.stringify({ name, pid, saw, error: String(e) }));",
  "}",
].join("\n");

/** How many times `race` starts the writers before it gives up on their meeting. */
const RACE_ATTEMPTS = 3;

async function race(setup: () => void = () => {}): Promise<Racer[]> {
  const racer = join(dirname(file), "racer.mts");
  writeFileSync(racer, RACER);
  const names = Array.from({ length: 4 }, (_, i) => `extra${i + 1}`);
  for (let attempt = 1; ; attempt++) {
    copyFileSync(COUNTER, file);
    rmSync(`${file}.kumiki-ops.jsonl`, { force: true });
    rmSync(lock, { force: true });
    setup();
    const at = String(Date.now() + 8_000);
    const results = (await Promise.all(names.map((n) => runChild(racer, [file, lock, n, at])))).map(
      (line) => JSON.parse(line) as Racer,
    );
    expect(results.filter((r) => r.error !== undefined)).toEqual([]);
    const pids = new Set(results.map((r) => r.pid));
    const contended = results.some((r) => r.saw.some((p) => pids.has(p)));
    if (contended) return results;
    expect(
      attempt,
      `in ${RACE_ATTEMPTS} attempts no writer found the lock held by another: either they missed the start instant and ran one after another, or the lock is no longer created exclusively (no EEXIST was ever observed)`,
    ).toBeLessThan(RACE_ATTEMPTS);
  }
}

/** Every op follows the one before it: one linear chain, no forks. */
function expectLinearChain(reported: Array<string | undefined>): void {
  const log = readOpLog(file);
  expect(log.map((e) => e["op-id"]).sort()).toEqual([...reported].sort());
  expect(log[0]?.["parent-ops"]).toEqual([]);
  for (let i = 1; i < log.length; i++) {
    expect(log[i]?.["parent-ops"]).toEqual([log[i - 1]?.["op-id"]]);
  }
}

describe("concurrent write verbs", () => {
  it("land every add from four simultaneous writers as one linear op chain", {
    timeout: 120_000,
  }, async () => {
    const results = await race();
    expect(slotsInFile()).toEqual(results.map((r) => r.name).sort());
    expectLinearChain(results.map((r) => r.opId));
  });

  it("land every add when all the writers find a lock left by a writer that exited", {
    timeout: 120_000,
  }, async () => {
    const gone = exitedPid();
    const results = await race(() =>
      writeFileSync(lock, JSON.stringify({ pid: gone, host: hostname() })),
    );
    expect(slotsInFile()).toEqual(results.map((r) => r.name).sort());
    expectLinearChain(results.map((r) => r.opId));
  });

  it("wait for a live writer's lock and write only after it is released", {
    timeout: 60_000,
  }, async () => {
    vi.stubEnv(WAIT_ENV, "20000");
    const seen = join(dirname(file), "seen.kumiki");
    await holdLock(1500, seen);
    const t0 = Date.now();
    addDef(file, "slot", "extra1", "Int = 0");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    // While the holder still held the lock, the add had not touched the file.
    expect(readFileSync(seen, "utf8")).toBe(readFileSync(COUNTER, "utf8"));
    expect(slotsInFile()).toEqual(["extra1"]);
  });

  it("reject after KUMIKI_WRITE_LOCK_WAIT_MS, naming the holder and the lock, with nothing written or logged", {
    timeout: 20_000,
  }, async () => {
    vi.stubEnv(WAIT_ENV, "300");
    const pid = await holdLock(60_000, join(dirname(file), "seen.kumiki"));
    const before = readFileSync(file, "utf8");
    const t0 = Date.now();
    const error = (() => {
      try {
        addDef(file, "slot", "extra1", "Int = 0");
      } catch (e) {
        return String(e);
      }
      return "no error";
    })();
    expect(error).toContain(`is being written by kumiki process ${pid} on ${hostname()}`);
    expect(error).toContain(lock);
    expect(error).toContain("nothing was written");
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(`${file}.kumiki-ops.jsonl`)).toBe(false);
    // The rejected writer left the holder's lock as it was.
    expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(pid);
  });

  it("take over a lock whose holder has exited", { timeout: 60_000 }, () => {
    vi.stubEnv(WAIT_ENV, "20000");
    writeFileSync(lock, JSON.stringify({ pid: exitedPid(), host: hostname() }));
    const t0 = Date.now();
    addDef(file, "slot", "extra1", "Int = 0");
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(slotsInFile()).toEqual(["extra1"]);
    expect(readOpLog(file)).toHaveLength(1);
  });

  it("take over a lock this process left behind", { timeout: 60_000 }, () => {
    vi.stubEnv(WAIT_ENV, "20000");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname() }));
    addDef(file, "slot", "extra1", "Int = 0");
    expect(slotsInFile()).toEqual(["extra1"]);
  });

  it.each([
    ["empty", ""],
    ["not JSON", "{"],
    ["pid 0", JSON.stringify({ pid: 0, host: hostname() })],
    ["negative pid", JSON.stringify({ pid: -1, host: hostname() })],
    ["fractional pid", JSON.stringify({ pid: 1.5, host: hostname() })],
    ["no host", JSON.stringify({ pid: exitedPid() })],
  ])(
    "take over an unreadable lock (%s) once it is older than a writer takes to fill it in",
    {
      timeout: 60_000,
    },
    (_, content) => {
      vi.stubEnv(WAIT_ENV, "20000");
      writeFileSync(lock, content);
      const old = new Date(Date.now() - 60_000);
      utimesSync(lock, old, old);
      addDef(file, "slot", "extra1", "Int = 0");
      expect(slotsInFile()).toEqual(["extra1"]);
      expect(readOpLog(file)).toHaveLength(1);
    },
  );

  it("leave a fresh empty lock alone, since its writer may still be filling it in", {
    timeout: 20_000,
  }, () => {
    vi.stubEnv(WAIT_ENV, "300");
    writeFileSync(lock, "");
    expect(() => addDef(file, "slot", "extra1", "Int = 0")).toThrow("nothing was written");
    expect(existsSync(lock)).toBe(true);
    expect(slotsInFile()).toEqual([]);
  });

  it("refuse an edit to a definition another agent owns without waiting for the write lock", {
    timeout: 60_000,
  }, async () => {
    lockDef(file, "agent:other", "slot.count");
    vi.stubEnv(WAIT_ENV, "20000");
    await holdLock(60_000, join(dirname(file), "seen.kumiki"));
    const t0 = Date.now();
    expect(() => replaceDef(file, "slot.count", "N = 1")).toThrow("lock violation");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("restore the file when the op cannot be logged", () => {
    mkdirSync(`${file}.kumiki-ops.jsonl`);
    const before = readFileSync(file, "utf8");
    expect(() => addDef(file, "slot", "extra1", "Int = 0")).toThrow(
      /could not be logged \(EISDIR.*\); the file was restored and nothing was written/,
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(lock)).toBe(false);
  });
});
