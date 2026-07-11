import { parseEpisodeLogText } from "@kumikijs/compiler/node";
import { describe, expect, it } from "vitest";

describe("parseEpisodeLogText", () => {
  it("returns [] for an empty / whitespace-only file", () => {
    expect(parseEpisodeLogText("")).toEqual([]);
    expect(parseEpisodeLogText("   \n  \r\n  ")).toEqual([]);
  });

  it("parses JSONL (one Episode per line) and skips blank lines", () => {
    const raw = `{"id":"ep_0001","trigger":{"kind":"ui.click","ts":1},"steps":[],"status":"completed"}

{"id":"ep_0002","trigger":{"kind":"ui.click","ts":2},"steps":[],"status":"completed"}
`;
    const parsed = parseEpisodeLogText(raw);
    expect(parsed).toHaveLength(2);
    expect((parsed[0] as { id: string }).id).toBe("ep_0001");
    expect((parsed[1] as { id: string }).id).toBe("ep_0002");
  });

  it("parses a JSON array root", () => {
    const parsed = parseEpisodeLogText(
      '[{"id":"ep_a","trigger":{"kind":"init","ts":0},"steps":[],"status":"completed"}]',
    );
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { id: string }).id).toBe("ep_a");
  });

  it("propagates malformed JSON with the offending line number", () => {
    // Line 1 = the bad token.
    expect(() => parseEpisodeLogText("{not json}")).toThrow(/at line 1/);
    // Line 3 = the bad token after a good line + a blank line.
    const mixed = `{"id":"ok","trigger":{"kind":"init","ts":0},"steps":[],"status":"completed"}

{still bad}`;
    expect(() => parseEpisodeLogText(mixed)).toThrow(/at line 3/);
  });

  it("still parses minimal panic steps (no stack / cause / category)", () => {
    // A log written by an older runtime uses the minimal panic shape
    // {kind, message, location?, ts}. New readers MUST accept it as-is —
    // that's the forward-compat guarantee spec §10.5 promises.
    const raw =
      '{"id":"ep_old","trigger":{"kind":"ui.click","ts":1},"steps":[{"kind":"panic","message":"boom","location":"reducer \\"x\\"","ts":2}],"status":"panic"}';
    const parsed = parseEpisodeLogText(raw);
    expect(parsed).toHaveLength(1);
    const step = (parsed[0] as { steps: Array<{ kind: string; message?: string }> }).steps[0]!;
    expect(step.kind).toBe("panic");
    expect(step.message).toBe("boom");
    // No stack / cause / category fields — reader must not synthesise them.
    expect(step).not.toHaveProperty("stack");
    expect(step).not.toHaveProperty("cause");
    expect(step).not.toHaveProperty("category");
  });
});
