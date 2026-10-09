import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityProvider } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "64-init-slot-argument.kumiki");

const tick = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mountWithRecordingProvider(): Promise<{
  app: Awaited<ReturnType<typeof loadApp>>;
  seen: { key: unknown }[];
  dispose: () => void;
  root: HTMLElement;
}> {
  const app = await loadApp(EXAMPLE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const seen: { key: unknown }[] = [];
  const provider: CapabilityProvider = async (input) => {
    seen.push(input as { key: unknown });
    return { kind: "ok", value: { _tag: "Some", _0: "stored" } };
  };
  const { dispose } = mount(app, root, { providers: { "storage.read": provider } });
  return { app, seen, dispose, root };
}

describe("app.init arguments", () => {
  it("passes each init entry's argument through to the capability boundary", async () => {
    const { app, seen, dispose, root } = await mountWithRecordingProvider();
    try {
      await tick();

      expect(seen.map((s) => s.key).sort()).toEqual(["kumiki:note", "kumiki:theme"]);
      expect(app.live?.note).toBe("stored");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("resolves the latest-per-key key, which only runs once an effect dispatches", async () => {
    const { app, dispose, root } = await mountWithRecordingProvider();
    try {
      await tick();

      expect(app.live?.scope).toBe("kumiki:note");
      expect(app.live?.themeAt).toBe("kumiki:theme");
      dispose();
    } finally {
      root.remove();
    }
  });
});
