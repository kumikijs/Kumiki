import { feature } from "@kumikijs/examples";
import { createEpisodeLogger, type EpisodeLogger } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountApp, tick, waitUntil } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("296-effect-launch-throw-reported");

const SINK_DOWN = "episode sink offline";

/**
 * The built-in logger, whose `onEpisode` hook throws once: as it is handed the first episode a
 * click began, which has committed by then.
 */
function onEpisodeThrowingOnce(): EpisodeLogger {
  let thrown = false;
  return createEpisodeLogger({
    onEpisode(ep) {
      if (thrown || ep.trigger.kind !== "ui.click") return;
      thrown = true;
      throw new Error(SINK_DOWN);
    },
  });
}

/**
 * Mount example 296 under that logger, with a `log.write` that answers `.ok`, click Send a and
 * then Send b, and hand back the page text and what reached the console once both writes have
 * settled.
 */
async function sendBoth(): Promise<{ text: string; errors: string[] }> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const { root, handle } = mountApp(await loadApp(EXAMPLE), {
    episodeLogger: onEpisodeThrowingOnce(),
    providers: { "log.write": () => ({ kind: "ok", value: null }) },
  });
  try {
    click(root, "Send a");
    click(root, "Send b");
    await waitUntil(() => root.textContent?.includes("log=ab") ?? false);
    // Long enough for the report of a throw after the last write, had there been one.
    await tick(30);
    return { text: root.textContent ?? "", errors };
  } finally {
    handle.dispose();
    root.remove();
  }
}

describe("a throw as the first of two queued writes' episode commits (example 296)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is told to app.error once, as an error of the app, and the write behind it still runs", async () => {
    const { text } = await sendBoth();
    expect(text).toContain("log=ab");
    expect(text).toContain('app.error x1: effect in effect "record"');
  });

  it("reaches the console once", async () => {
    const { errors } = await sendBoth();
    expect(errors.filter((line) => line.startsWith("[kumiki]"))).toEqual([
      expect.stringContaining(`[kumiki] error in effect "record": ${SINK_DOWN}`),
    ]);
  });
});
