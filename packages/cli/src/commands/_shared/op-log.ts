import { describeSkipped, type OpLogOptions } from "../../mutate.ts";

/**
 * What a verb that reads the op log does with a torn last line the read
 * skipped (§9.2.2): it warns on stderr, naming the log and the line, before
 * anything else the verb prints there.
 *
 * Printed at once, not by `process.emitWarning`, which waits a tick: a verb
 * that then fails exits before such a warning is printed.
 */
export const WARN_SKIPPED: OpLogOptions = {
  onSkipped: (skipped) => console.warn(`warning: ${describeSkipped(skipped)}`),
};
