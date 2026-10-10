import type { CapabilityRegistry, TileCtx, TileNode } from "@kumikijs/runtime";
import { installToast, renderToString, statusTiles } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";

const ctx: TileCtx = {
  render: () => {
    throw new Error("this tile has no children to render");
  },
};

describe("the toast effect", () => {
  const fire = async (input: unknown): Promise<void> => {
    // A host that registered no provider still has to answer.
    const caps: CapabilityRegistry = { has: () => false, provider: () => undefined };
    const app = bareApp();
    installToast(app, { navigate: () => {}, back: () => {} });
    await defined(app.effects.toast, "the installed toast effect").invoke(input, caps);
  };
  const banner = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("[data-kumiki-toast]");

  beforeEach(() => {
    document.body.replaceChildren();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the kind on the element rather than choosing an appearance", async () => {
    await fire({ kind: "success", text: "Saved" });
    expect(banner()?.dataset.level).toBe("success");
    expect(banner()?.textContent).toBe("Saved");
  });

  it("is a polite live region", async () => {
    await fire({ kind: "error", text: "Failed" });
    expect(banner()?.getAttribute("role")).toBe("status");
    expect(banner()?.getAttribute("aria-live")).toBe("polite");
  });

  const some = (ms: number) => ({ _tag: "Some", _0: ms });

  it.each<[string, Record<string, unknown>, [advanceMs: number, shown: boolean][]]>([
    [
      "uses the per-kind default when the emitter says nothing",
      { kind: "warn" },
      [
        [3_001, true],
        [2_000, false],
      ],
    ],
    ["leaves an error toast up until it is dismissed", { kind: "error" }, [[600_000, true]]],
    [
      "takes a zero duration as asking for no timer",
      { kind: "info", duration: some(0) },
      [[600_000, true]],
    ],
    [
      "treats a negative duration as no duration at all",
      { kind: "info", duration: some(-1) },
      [[3_001, false]],
    ],
    [
      "stays for the duration the emitter asked for",
      { kind: "info", duration: some(10_000) },
      [
        [3_000, true],
        [7_001, false],
      ],
    ],
    [
      "falls back to the kind's default when the emitter says None",
      {
        kind: "info",
        duration: { _tag: "None" },
      },
      [
        [2_999, true],
        [2, false],
      ],
    ],
  ])("%s", async (_, input, timeline) => {
    await fire({ text: "note", ...input });
    for (const [advanceMs, shown] of timeline) {
      vi.advanceTimersByTime(advanceMs);
      expect(banner() !== null, `after ${advanceMs}ms more`).toBe(shown);
    }
  });
});

describe("the tiles that announce themselves", () => {
  const toastNode: Extract<TileNode, { kind: "toast" }> = { kind: "toast", text: "hi" };
  const errorNode: Extract<TileNode, { kind: "error" }> = { kind: "error", field: "email" };

  it("announces the toast tile politely", () => {
    const el = defined(statusTiles.toast, "the toast renderer")(toastNode, ctx);
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });

  it("announces the error tile assertively — it is why the user stopped", () => {
    const el = defined(statusTiles.error, "the error renderer")(errorNode, ctx);
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.getAttribute("aria-live")).toBe("assertive");
  });

  it("serves the same attributes rather than adding them on hydration", async () => {
    const app = bareApp({
      routes: [{ pattern: "/", tile: () => ({ kind: "page", children: [toastNode] }) }],
    });
    const { html } = await renderToString(app, { route: "/" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
