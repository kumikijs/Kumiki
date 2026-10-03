// The write lock between worker threads of one process. They share a pid, so a
// lock naming this pid is not necessarily this thread's: another thread of the
// same process may be inside its own write, and it is waited on like any other
// live writer.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeLockPath } from "../src/write-lock.ts";
import type { ThreadWriter } from "./helpers/write-lock-thread.ts";

const here = dirname(fileURLToPath(import.meta.url));
const WRITER = pathToFileURL(resolve(here, "helpers/write-lock-thread.ts"));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

let dir = "";
let file = "";
let events = "";
let workers: Worker[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-write-lock-threads-"));
  file = join(dir, "c.kumiki");
  events = join(dir, "events");
  writeFileSync(file, "");
  writeFileSync(events, "");
  workers = [];
});
afterEach(async () => {
  await Promise.all(workers.map((w) => w.terminate()));
  rmSync(dir, { recursive: true, force: true });
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

async function until(event: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!recorded().includes(event)) {
    if (Date.now() > deadline) throw new Error(`no "${event}" in ${JSON.stringify(recorded())}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A writer thread that holds the lock until `release` is called. */
async function holdingWriter(role: string) {
  const hold = new Int32Array(new SharedArrayBuffer(8));
  const exited = startWriter(role, 20_000, hold);
  await until(`${role} locking`);
  while (Atomics.load(hold, 0) === 0) await new Promise((r) => setTimeout(r, 10));
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
    expect.stringMatching(
      /^B rejected: .* is being written by kumiki process .*nothing was written/,
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
  await until("B locking");
  // Long enough for B to meet A's lock many times over (it retries every 5–25 ms).
  await new Promise((r) => setTimeout(r, 300));
  await a.release();
  await b;
  const log = recorded().filter((e) => e !== "A locking" && e !== "B locking");
  expect(log).toEqual([`A in ${a.lock}`, "A out", expect.stringMatching(/^B in /), "B out"]);
});
