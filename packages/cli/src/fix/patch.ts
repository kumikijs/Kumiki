import type { KumikiError, Pos } from "@kumikijs/compiler";

export type PatchAnchor =
  | { kind: "span"; pos: Pos }
  | { kind: "line"; pos: Pos }
  // Composed after every other tier, in the plan's order, which no patch may rely on: its `apply`
  // finds where to write in the text it is handed. A test-repair splice keeps its plan-time
  // offsets because it is applied alone, to the source it was planned on.
  | { kind: "region" };

export type AutoPatch = {
  code: string;
  message: string;
  description: string;
  apply: (text: string) => string;
  anchor: PatchAnchor;
};

/** A patch for a compile diagnostic, with the diagnostic, so a report can print it whole. */
export type CompilePatch = AutoPatch & { diagnostic: KumikiError };

export type SkipReason = {
  code: string;
  reason: string;
  message: string;
  /** The diagnostic there is no patch for, so a report can print it whole. */
  diagnostic: KumikiError;
  /** The tied names of a `close-names-tied` skip, sorted. */
  candidates?: string[];
};

export type PatchOrReason = { patch: AutoPatch } | { patch: null; reason: string };

function debugFixEnabled(): boolean {
  const v = process.env.KUMIKI_DEBUG;
  if (!v) return false;
  return v
    .split(",")
    .map((s) => s.trim())
    .includes("fix");
}

/** Under `KUMIKI_DEBUG=fix`, says on stderr why a planner produced no patch. */
export function debugSkip(where: string, reason: string, detail?: string): void {
  if (!debugFixEnabled()) return;
  console.warn(`[kumiki fix] skip ${where}: ${reason}${detail ? ` — ${detail}` : ""}`);
}
