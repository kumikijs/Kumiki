import { messageOf } from "../../text.ts";

export function exitWithUsage(usage: string): never {
  console.error(usage);
  process.exit(2);
}

/** An option parser that rejects a missing value, which commander would fill with the next flag. */
export function requireValue(usage: string): (raw: string) => string {
  return (raw) => {
    if (raw.startsWith("--")) exitWithUsage(usage);
    return raw;
  };
}

/** Prints what `run` reports, or its error with exit code 1. */
export function printOrExit(run: () => string): void {
  let line: string;
  try {
    line = run();
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
  console.log(line);
}

export function parseJsonOrExit(raw: string, where: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    console.error(`invalid JSON in ${where}: ${messageOf(e)}`);
    process.exit(2);
  }
}
