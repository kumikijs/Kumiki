// One writer on a worker thread, for write-lock-threads.test.ts: it takes the
// write lock on `file` and records what it saw. A writer with `hold` set keeps
// the lock until the test lets go of it, so another thread's writer meets a
// lock that is live.

import { appendFileSync, readFileSync } from "node:fs";
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

record("locking");
try {
  withWriteLock(file, () => {
    record(`in ${readFileSync(writeLockPath(file), "utf8")}`);
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
