import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityProvider } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
// `track` (cap=telemetry.track) is emitted on click; its ok result bumps `sent`.
const CUSTOM_CAP_EXAMPLE = join(here, "..", "examples", "features", "27-custom-capability.kumiki");

const tick = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

function clickTrack(root: HTMLElement): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Track"),
  );
  if (!btn) throw new Error("Track button not found");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("custom capability — host provider injection (inbound seam)", () => {
  it("routes an emitted custom-cap effect to the host provider and flows ok back", async () => {
    const app = await loadApp(CUSTOM_CAP_EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const seen: unknown[] = [];
    const provider: CapabilityProvider = async (input) => {
      seen.push(input);
      return { kind: "ok", value: null };
    };
    try {
      const { dispose } = mount(app, root, { providers: { "telemetry.track": provider } });
      clickTrack(root);
      await tick();
      expect(seen).toEqual([{ name: "click" }]);
      expect((app.live as Record<string, unknown>).sent).toBe(1);
      expect(root.textContent ?? "").toContain("sent: 1");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("errs (does not bump sent) when no provider is registered for the custom cap", async () => {
    const app = await loadApp(CUSTOM_CAP_EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root); // no providers
      clickTrack(root);
      await tick();
      // track.ok never fires because the boundary returned an err.
      expect((app.live as Record<string, unknown>).sent).toBe(0);
      dispose();
    } finally {
      root.remove();
    }
  });
});
