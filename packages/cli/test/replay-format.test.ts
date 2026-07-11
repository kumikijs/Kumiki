import type { ReplayEvent } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { formatEvent } from "../src/replay.ts";

/**
 * `kumiki replay` panic display (#162). The formatter is exercised via
 * `formatEvent` directly — driving a full CLI panic fixture would test the
 * runtime's replay-executor pipeline, not the CLI's stack / cause rendering,
 * which is what changed here.
 */
describe("formatEvent panic (#162)", () => {
  it("prints category, message, location, indented stack, and cause chain", () => {
    const ev: ReplayEvent = {
      kind: "panic",
      episodeId: "ep_0001",
      stepIndex: 0,
      message: "boom",
      location: `reducer "boom"`,
      stack: "Error: boom\n    at boom (src/x.ts:1:1)\n    at outer (src/y.ts:2:2)",
      cause: [{ message: "root", stack: "Error: root\n    at inner (src/z.ts:3:3)" }],
      category: "reducer",
    };
    const out = formatEvent(ev);
    expect(out).not.toBeNull();
    const lines = out!.split("\n");
    // Header: [panic:<category>] <message>  <location>
    expect(lines[0]).toBe(`  [panic:reducer] boom  reducer "boom"`);
    // Stack lines are indented under the header and lose the message-only prefix.
    expect(lines).toContain("    at boom (src/x.ts:1:1)");
    expect(lines).toContain("    at outer (src/y.ts:2:2)");
    // Cause block.
    expect(lines).toContain("    Caused by: root");
    expect(lines).toContain("      at inner (src/z.ts:3:3)");
  });

  it("falls back to a single line when a pre-#162 log has only `message`", () => {
    const ev: ReplayEvent = {
      kind: "panic",
      episodeId: "ep_0001",
      stepIndex: 0,
      message: "boom",
    };
    const out = formatEvent(ev);
    // No category tag, no location, no stack lines, no "Caused by:" block.
    expect(out).toBe("  [panic] boom");
  });

  it("emits the Caused-by header even when a cause link has no stack", () => {
    const ev: ReplayEvent = {
      kind: "panic",
      episodeId: "ep_0001",
      stepIndex: 0,
      message: "boom",
      cause: [{ message: "bare" }],
      category: "reducer",
    };
    const out = formatEvent(ev);
    const lines = out!.split("\n");
    expect(lines[0]).toBe("  [panic:reducer] boom");
    expect(lines).toContain("    Caused by: bare");
    // No orphan stack lines under a stackless cause.
    expect(lines.filter((l) => l.trim().startsWith("at "))).toEqual([]);
  });
});
