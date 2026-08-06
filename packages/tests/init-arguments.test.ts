// `app.init` arguments and an effect's `latest-per-key` key are the two
// expressions codegen lowers outside a reducer body. Both used to be lowered
// against a fabricated empty `GenCtx`, so a slot reference had no slot table to
// resolve against and came out as a bare identifier: `check` and `build` passed
// and the module threw `ReferenceError` on import, before anything mounted.
//
// The compiler test pins the emitted text. This pins the value that actually
// reaches the capability boundary — the text being right is not the claim, the
// effect receiving the slot's value is.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityProvider } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "64-init-slot-argument.kumiki");

const tick = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("app.init arguments", () => {
  it("passes a slot's value to the effect the init entry names", async () => {
    const app = await loadApp(EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const seen: unknown[] = [];
    const provider: CapabilityProvider = async (input) => {
      seen.push(input);
      return { kind: "ok", value: { _tag: "Some", _0: "stored" } };
    };
    try {
      const { dispose } = mount(app, root, { providers: { "storage.read": provider } });
      await tick();

      // `map-request={key: $1, …}` forwards the init argument as the key, so
      // this is the init argument's value observed from outside the app.
      expect(seen).toHaveLength(1);
      expect((seen[0] as { key: unknown }).key).toBe("kumiki:note");
      expect(app.live?.note).toBe("stored");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("mounts at all — a bare identifier threw before the first render", async () => {
    const app = await loadApp(EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      expect(root.textContent ?? "").toContain("note=");
      dispose();
    } finally {
      root.remove();
    }
  });
});
