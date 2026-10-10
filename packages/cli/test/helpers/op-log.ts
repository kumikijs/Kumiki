import { readFileSync, writeFileSync } from "node:fs";
import { type OpLogEntry, readOpLog } from "@kumikijs/cli";
import { vi } from "vitest";
import { defined } from "./defined.ts";

export const logPath = (file: string): string => `${file}.kumiki-ops.jsonl`;

export const lastOp = (file: string): OpLogEntry =>
  defined(readOpLog(file).at(-1), "an op in the log");

/** The file and its op log, byte for byte — what "nothing was written" compares. */
export const snapshot = (file: string): { source: string; log: string } => ({
  source: readFileSync(file, "utf8"),
  log: readFileSync(logPath(file), "utf8"),
});

/** Rewrite one op-log entry in place, as an earlier version of the CLI would have logged it. */
export function rewriteLogEntry(
  file: string,
  opId: string,
  edit: (entry: Record<string, unknown>) => void,
): void {
  const lines = readFileSync(logPath(file), "utf8").split("\n");
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (entry["op-id"] !== opId) return line;
    edit(entry);
    return JSON.stringify(entry);
  });
  writeFileSync(logPath(file), out.join("\n"));
}

/** Make the write verbs log `agent` as the author for the rest of the current test. */
export function asAgent(agent: string): void {
  vi.stubEnv("KUMIKI_AUTHOR", agent);
}
