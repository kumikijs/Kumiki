import type { Pos } from "@kumikijs/compiler";

export type PatchAnchor =
  | { kind: "span"; pos: Pos }
  | { kind: "line"; pos: Pos }
  // Composed after every other patch and in no fixed order among themselves, so its `apply`
  // finds where to write in the text it is handed, never at a position read off the plan's source.
  | { kind: "region" };

export type AutoPatch = {
  code: string;
  message: string;
  description: string;
  apply: (text: string) => string;
  anchor: PatchAnchor;
};

export type SkipReason = {
  code: string;
  reason: string;
  message: string;
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
