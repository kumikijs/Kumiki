import type { MountedApp } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { mountFeature, tick, waitUntil } from "./helpers/dom.ts";
import { SINK_DOWN, throwingLogger } from "./helpers/episodes.ts";

type Saved = {
  text: string;
  thrown: unknown;
  /** `beats` right after the save, and again once `autosave` would have fired a few more times. */
  beats: [unknown, unknown];
};

/**
 * Mount example 295 under a logger that throws while it records `save`, let `autosave` fire,
 * click Save and wait for both effects' results.
 */
async function saveOnce(): Promise<Saved> {
  const { app, root } = await mountFeature("295-reducer-steps-after-commit", {
    episodeLogger: throwingLogger("recordReducer", (name) => name === "save"),
  });
  await waitUntil(() => (app.live?.beats as number) > 0);
  let thrown: unknown;
  try {
    // Straight to the seam a click reaches, so the throw comes back here.
    (app as MountedApp)._dispatch("save", {});
  } catch (e) {
    thrown = e;
  }
  await waitUntil(() => root.textContent?.includes("stored=1 stamps=1") ?? false);
  const after = app.live?.beats;
  await tick(150);
  return { text: root.textContent ?? "", thrown, beats: [after, app.live?.beats] };
}

describe("a throw while the episode logger records a committed save (example 295)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("still runs both of the save's effects", async () => {
    const { text } = await saveOnce();
    expect(text).toContain("stored=1 stamps=1");
  });

  it("still stops autosave", async () => {
    const { beats } = await saveOnce();
    expect(beats[1]).toBe(beats[0]);
  });

  it("hands the throw on to the click that ran the save", async () => {
    const { thrown } = await saveOnce();
    expect((thrown as Error).message).toBe(SINK_DOWN);
  });
});
