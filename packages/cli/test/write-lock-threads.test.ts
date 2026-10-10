import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeLockPath } from "../src/write-lock.ts";
import { tempDir } from "./helpers/files.ts";
import type { ThreadWriter } from "./helpers/write-lock-thread.ts";

const here = dirname(fileURLToPath(import.meta.url));
const WRITER = pathToFileURL(resolve(here, "helpers/write-lock-thread.ts"));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

let dir = "";
let file = "";
let events = "";
let workers: Worker[] = [];
beforeEach(() => {
  dir = tempDir();
  file = join(dir, "c.kumiki");
  events = join(dir, "events");
  writeFileSync(file, "");
  writeFileSync(events, "");
  workers = [];
});
afterEach(async () => {
  await Promise.all(workers.map((w) => w.terminate()));
});

/** Start a writer thread; resolves once it has exited. */
function startWriter(role: string, waitMs: number, hold?: Int32Array): Promise<void> {
  const data: ThreadWriter = { role, file, events, ...(hold ? { hold } : {}) };
  const worker = new Worker(WRITER, {
    workerData: data,
    execArgv: ["--import", TSX],
    env: { ...process.env, KUMIKI_WRITE_LOCK_WAIT_MS: String(waitMs) },
  });
  workers.push(worker);
  return new Promise((done, fail) => {
    worker.on("error", fail);
    worker.on("exit", () => done());
  });
}

const recorded = (): string[] => readFileSync(events, "utf8").split("\n").filter(Boolean);

/** Wait for `done`, failing with what was recorded if it has not happened in 30 s. */
async function until(done: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`no ${what} in ${JSON.stringify(recorded())}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const event = (e: string) => () => recorded().includes(e);

/** A writer thread that holds the lock until `release` is called. */
async function holdingWriter(role: string) {
  const hold = new Int32Array(new SharedArrayBuffer(8));
  let ended = false;
  const exited = startWriter(role, 20_000, hold).finally(() => {
    ended = true;
  });
  // A writer that is rejected or throws ends without ever holding the lock.
  await until(() => Atomics.load(hold, 0) === 1 || ended, `"${role} in"`);
  if (Atomics.load(hold, 0) === 0) {
    await exited;
    throw new Error(`${role} ended without holding the lock: ${JSON.stringify(recorded())}`);
  }
  const lock = readFileSync(writeLockPath(file), "utf8");
  const release = () => {
    Atomics.store(hold, 1, 1);
    Atomics.notify(hold, 1);
    return exited;
  };
  return { lock, release };
}

it("rejects a writer on one thread while a writer on another thread holds the lock", {
  timeout: 60_000,
}, async () => {
  const a = await holdingWriter("A");
  // B runs to completion while A is still inside its write.
  await startWriter("B", 300);
  const rejected = recorded().filter((e) => e.startsWith("B "));
  expect(rejected).toEqual([
    "B locking",
    "B met the lock",
    expect.stringMatching(
      /^B rejected: .* is being written by kumiki process \d+ \(thread \d+\) on .*if that thread is not writing this file, delete the lock file; nothing was written/,
    ),
  ]);
  // A's lock is still the one on disk: B did not take it over.
  expect(readFileSync(writeLockPath(file), "utf8")).toBe(a.lock);
  await a.release();
  expect(recorded().filter((e) => e.startsWith("A "))).toEqual([
    "A locking",
    `A in ${a.lock}`,
    "A out",
  ]);
});

it("lets a writer on one thread in once the writer on another thread releases", {
  timeout: 60_000,
}, async () => {
  const a = await holdingWriter("A");
  const b = startWriter("B", 20_000);
  await until(event("B met the lock"), '"B met the lock"');
  await a.release();
  await b;
  const log = recorded().filter((e) => e !== "A locking" && e !== "B locking");
  expect(log).toEqual([
    `A in ${a.lock}`,
    "B met the lock",
    "A out",
    expect.stringMatching(/^B in /),
    "B out",
  ]);
});

it("waits on a lock that records no thread, which names the main thread, from a worker thread", {
  timeout: 60_000,
}, async () => {
  const old = JSON.stringify({ pid: process.pid, host: hostname() });
  writeFileSync(writeLockPath(file), old);
  await startWriter("B", 300);
  expect(recorded()).toEqual([
    "B locking",
    "B met the lock",
    expect.stringMatching(
      /^B rejected: .* is being written by kumiki process \d+ on .*nothing was written/,
    ),
  ]);
  expect(readFileSync(writeLockPath(file), "utf8")).toBe(old);
});
