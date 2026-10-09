import { compile } from "@kumikijs/compiler";
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

describe("an episode-test's log, read at build time", () => {
  const src = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test replay =
    episode-test
        load   = "log.jsonl"
        mocks  = {}
        expect = {no-panics: true}`;
  const build = (log: string) =>
    compile(src, {
      runtimeSpecifier: "./runtime.js",
      includeTests: true,
      readEpisodeLog: () => log,
    });

  it("inlines the parsed episodes into the generated test", () => {
    const r = build('{"id":"ep_0001","steps":[]}');
    expect(r.kind === "ok" && r.js).toContain('"id":"ep_0001"');
  });

  it("reads the log the way the CLI does, naming the line that is not JSON", () => {
    expect(() => build('{"id":"ep_0001"}\n{nope')).toThrow(/episode log: invalid JSON at line 2/);
  });
});
