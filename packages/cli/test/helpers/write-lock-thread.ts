import fs, { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { workerData } from "node:worker_threads";
import { withWriteLock, writeLockPath } from "../../src/write-lock.ts";

export type ThreadWriter = {
  role: string;
  file: string;
  events: string;
  /** [0] is set to 1 once this writer holds the lock; it then waits for [1] to be set. */
  hold?: Int32Array;
};

const { role, file, events, hold } = workerData as ThreadWriter;
const record = (event: string) => appendFileSync(events, `${role} ${event}\n`);

process.emitWarning = ((warning: string | Error) =>
  record(`warning: ${String(warning)}`)) as typeof process.emitWarning;

const lock = writeLockPath(file);
const open = fs.openSync;
let met = false;
fs.openSync = (...args: Parameters<typeof fs.openSync>): number => {
  try {
    return open(...args);
  } catch (e) {
    const [path, flags] = args;
    if (!met && path === lock && flags === "wx" && (e as NodeJS.ErrnoException).code === "EEXIST") {
      met = true;
      record("met the lock");
    }
    throw e;
  }
};
syncBuiltinESMExports();

record("locking");
try {
  withWriteLock(file, () => {
    record(`in ${readFileSync(lock, "utf8")}`);
    if (hold) {
      Atomics.store(hold, 0, 1);
      Atomics.notify(hold, 0);
      Atomics.wait(hold, 1, 0);
    }
    record("out");
  });
} catch (e) {
  record(`rejected: ${(e as Error).message}`);
}
