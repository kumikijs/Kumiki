import type { Episode } from "@kumikijs/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { click, mountFeature, tick, waitUntil } from "./helpers/dom.ts";
import { SINK_DOWN, throwingLogger } from "./helpers/episodes.ts";

/**
 * Mount example 261 under a logger that throws while the render after `loaded` is recorded,
 * click Load, and hand back the page text, the logger's episodes and what reached the console.
 */
async function loadOnce(): Promise<{ text: string; episodes: Episode[]; errors: string[] }> {
  const logger = throwingLogger("recordSignalUpdate", (dirty) => dirty.includes("oks"));
  const { root, errors } = await mountFeature("261-effect-result-delivered-once", {
    episodeLogger: logger,
  });
  click(root, "Load");
  await waitUntil(() => root.textContent?.includes("oks=1") ?? false);
  // Long enough for a second result, had the request delivered one.
  await tick(30);
  return { text: root.textContent ?? "", episodes: logger.list(), errors };
}

describe("a throw while a storage read's .ok is delivered (example 261)", () => {
  beforeEach(() => {
    localStorage.setItem("note", JSON.stringify("hello"));
  });

  it("leaves the request with its one .ok: failed does not run, so no record reaches problem", async () => {
    const { text } = await loadOnce();
    expect(text).toContain("note: hello");
    expect(text).toContain("oks=1 errs=0");
    expect(text).not.toContain("[object Object]");
  });

  it("reports the throw to app.error and the console as an error of the app", async () => {
    const { text, errors } = await loadOnce();
    expect(text).toContain('app.error: effect in effect "loadNote"');
    expect(errors.filter((line) => line.includes('effect "loadNote"'))).toEqual([
      expect.stringContaining(`[kumiki] error in effect "loadNote": ${SINK_DOWN}`),
    ]);
  });

  it("records one effect-end for the request, and the throw as a panic step on its episode", async () => {
    const { episodes } = await loadOnce();
    const ends = episodes.flatMap((ep) =>
      ep.steps.filter((s) => s.kind === "effect-end" && s.name === "loadNote").map(() => ep),
    );
    expect(ends).toHaveLength(1);
    expect(ends[0]?.steps.find((s) => s.kind === "panic")).toMatchObject({
      message: SINK_DOWN,
      location: 'effect "loadNote"',
      category: "effect",
    });
  });
});
