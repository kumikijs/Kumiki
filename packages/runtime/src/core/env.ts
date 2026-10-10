import type { EnvRead, EnvReadKind } from "../episode.ts";

type EnvFrame =
  | { mode: "record"; reads: EnvRead[] }
  | { mode: "replay"; remaining: EnvRead[]; live: number; malformed: number };

type EnvJournalHost = { __kumikiEnvJournal__?: EnvFrame[] };

const envStack: EnvFrame[] = ((): EnvFrame[] => {
  const host = globalThis as EnvJournalHost;
  const existing = host.__kumikiEnvJournal__;
  if (existing) return existing;
  const created: EnvFrame[] = [];
  host.__kumikiEnvJournal__ = created;
  return created;
})();

const ENV_VALUE_TYPE: Record<EnvReadKind, "number" | "string" | "boolean"> = {
  now: "number",
  random: "number",
  "fresh-id": "string",
  "prefers-dark": "boolean",
};

export type EnvScopeReport = {
  /** What a record scope journalled, in the order the body asked. Empty for a replay scope. */
  reads: EnvRead[];
  /** Reads a replay scope had no recorded answer for, and took from the live source. */
  live: number;
  /** Recorded answers the replayed body never asked for. */
  unused: number;
  /** Entries rejected as malformed when the scope opened. */
  malformed: number;
};

export type EnvScopeOutcome<T> =
  | { ok: true; value: T; env: EnvScopeReport }
  | { ok: false; error: unknown; env: EnvScopeReport };

/** Open a scope that records every environment read until `endEnvScope`. */
export function beginEnvRecord(): void {
  envStack.push({ mode: "record", reads: [] });
}

export function beginEnvReplay(reads: unknown): void {
  const list = Array.isArray(reads) ? (reads as unknown[]) : [];
  // A non-array that is not simply absent is itself one malformed input.
  let malformed = Array.isArray(reads) || reads == null ? 0 : 1;
  const remaining: EnvRead[] = [];
  for (const entry of list) {
    const read =
      entry && typeof entry === "object"
        ? (entry as { kind?: unknown; value?: unknown })
        : { kind: undefined, value: undefined };
    const want = ENV_VALUE_TYPE[read.kind as EnvReadKind];
    if (want !== undefined && typeof read.value === want) {
      remaining.push({ kind: read.kind as EnvReadKind, value: read.value });
    } else {
      malformed++;
    }
  }
  envStack.push({ mode: "replay", remaining, live: 0, malformed });
}

export function endEnvScope(): EnvScopeReport {
  const frame = envStack.pop();
  if (!frame) return { reads: [], live: 0, unused: 0, malformed: 0 };
  if (frame.mode === "record") return { reads: frame.reads, live: 0, unused: 0, malformed: 0 };
  return {
    reads: [],
    live: frame.live,
    unused: frame.remaining.length,
    malformed: frame.malformed,
  };
}

function withEnvScope<T>(body: () => T): EnvScopeOutcome<T> {
  let value: T;
  try {
    value = body();
  } catch (error) {
    return { ok: false, error, env: endEnvScope() };
  }
  return { ok: true, value, env: endEnvScope() };
}

/** Run `body` inside a recording scope. The scope closes on both exits. */
export function withEnvRecord<T>(body: () => T): EnvScopeOutcome<T> {
  beginEnvRecord();
  return withEnvScope(body);
}

/** Run `body` inside a replay scope seeded with `reads`. Closes on both exits. */
export function withEnvReplay<T>(reads: unknown, body: () => T): EnvScopeOutcome<T> {
  beginEnvReplay(reads);
  return withEnvScope(body);
}

export function readEnv<T>(kind: EnvReadKind, live: () => T): T {
  const frame = envStack[envStack.length - 1];
  if (!frame) return live();
  if (frame.mode === "record") {
    const value = live();
    frame.reads.push({ kind, value });
    return value;
  }
  for (let i = 0; i < frame.remaining.length; i++) {
    if (frame.remaining[i]?.kind !== kind) continue;
    const [read] = frame.remaining.splice(i, 1);
    return (read as EnvRead).value as T;
  }
  frame.live++;
  return live();
}
