import { feature } from "@kumikijs/examples";
import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { mountApp, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("64-init-slot-argument");

/** Mount the example with a `storage.read` provider that records each request, and let init settle. */
async function bootRecording(): Promise<{ app: AppShape; seen: { key: unknown }[] }> {
  const app = await loadApp(EXAMPLE);
  const seen: { key: unknown }[] = [];
  const provider: CapabilityProvider = async (input) => {
    seen.push(input as { key: unknown });
    return { kind: "ok", value: { _tag: "Some", _0: "stored" } };
  };
  const { root, handle } = mountApp(app, { providers: { "storage.read": provider } });
  try {
    await tick(25);
    handle.dispose();
  } finally {
    root.remove();
  }
  return { app, seen };
}

describe("app.init arguments", () => {
  it("passes each init entry's argument through to the capability boundary", async () => {
    const { app, seen } = await bootRecording();
    expect(seen.map((s) => s.key).sort()).toEqual(["kumiki:note", "kumiki:theme"]);
    expect(app.live?.note).toBe("stored");
  });

  it("resolves the latest-per-key key, which only runs once an effect dispatches", async () => {
    const { app } = await bootRecording();
    expect(app.live?.scope).toBe("kumiki:note");
    expect(app.live?.themeAt).toBe("kumiki:theme");
  });
});
