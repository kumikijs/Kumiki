import { describeSkipped, type OpLogOptions } from "../../mutate.ts";

// Printed at once, not by `process.emitWarning`, which waits a tick: a verb that then fails exits
// before such a warning is printed.
export const WARN_SKIPPED: OpLogOptions = {
  onSkipped: (skipped) => console.warn(`warning: ${describeSkipped(skipped)}`),
};
