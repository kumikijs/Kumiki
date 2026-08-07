// `app.init` arguments and an effect's `latest-per-key` key are the two
// expressions codegen lowers outside a reducer body. Both used to be lowered
// against a fabricated empty `GenCtx`, so a slot reference had no slot table to
// resolve against and came out as a bare identifier.
//
// They fail in different places. An init argument lands in the app object
// literal, so the module throws `ReferenceError` on import and nothing mounts.
// A key expression lands in an arrow body, so the app imports, mounts and
// renders, and throws on the first dispatch of that effect — which is why the
// second case needs an effect to actually fire before it is observable.
//
// The compiler test pins the emitted text. These pin the values that reach the
// capability boundary: the text being right is not the claim.

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

      // `map-request={key: $1, …}` forwards the init argument as the storage
      // key, so these are the init arguments' values observed from outside the
      // app. The scenario tier cannot see them: `runScenario` replaces
      // `eff.invoke` wholesale, so `map-request` never runs there.
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

      // `loadNote` keys by the `noteKey` slot and `loadTheme` by its own `$1`.
      // Both keys reach a reducer as its second bind, so a key expression that
      // failed to resolve is visible in state rather than only in a stack trace
      // — and neither would have thrown before this point.
      expect(app.live?.scope).toBe("kumiki:note");
      expect(app.live?.themeAt).toBe("kumiki:theme");
      dispose();
    } finally {
      root.remove();
    }
  });
});
