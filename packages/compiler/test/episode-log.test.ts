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

  it("propagates malformed JSON on any line", () => {
    expect(() => parseEpisodeLogText("{not json}")).toThrow();
  });
});
