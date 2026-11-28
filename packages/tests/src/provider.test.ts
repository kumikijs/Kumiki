import { feature } from "@kumikijs/examples";
import type { CapabilityProvider, EffectResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { clickContaining, mountApp, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

// `track` (cap=telemetry.track) is emitted on click; its ok result bumps `sent`.
const CUSTOM_CAP_EXAMPLE = feature("27-custom-capability");
// `failed` writes the err's `message` to `problem`; `sentOk` counts `.ok` results.
const CHECKED_RESULT_EXAMPLE = feature("297-provider-result-checked");

describe("custom capability — host provider injection (inbound seam)", () => {
  it("routes an emitted custom-cap effect to the host provider and flows ok back", async () => {
    const app = await loadApp(CUSTOM_CAP_EXAMPLE);
    const seen: unknown[] = [];
    const provider: CapabilityProvider = async (input) => {
      seen.push(input);
      return { kind: "ok", value: null };
    };
    const { root, handle } = mountApp(app, { providers: { "telemetry.track": provider } });
    try {
      clickContaining(root, "Track");
      await tick(25);
      expect(seen).toEqual([{ name: "click" }]);
      expect((app.live as Record<string, unknown>).sent).toBe(1);
      expect(root.textContent ?? "").toContain("sent: 1");
      handle.dispose();
    } finally {
      root.remove();
    }
  });

  it("errs (does not bump sent) when no provider is registered for the custom cap", async () => {
    const app = await loadApp(CUSTOM_CAP_EXAMPLE);
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Track");
      await tick(25);
      expect((app.live as Record<string, unknown>).sent).toBe(0);
      handle.dispose();
    } finally {
      root.remove();
    }
  });
});

describe("a provider answer that is not {kind, value}", () => {
  // The runtime's own tests read each such answer; this one shows the compiled custom-capability
  // invoke hands the answer on and the program renders the err's message.
  it("is the request's err, and the program shows the message naming it", async () => {
    const app = await loadApp(CHECKED_RESULT_EXAMPLE);
    const provider: CapabilityProvider = () => ({ ok: true }) as unknown as EffectResult;
    const { root, handle } = mountApp(app, { providers: { "telemetry.track": provider } });
    try {
      clickContaining(root, "Track");
      await tick(25);
      expect(root.textContent ?? "").toContain("sent: 0");
      expect(root.textContent ?? "").toContain(
        'problem: Error: effect "track" (telemetry.track) resolved to {"ok":true}, not {kind, value}',
      );
      handle.dispose();
    } finally {
      root.remove();
    }
  });
});
