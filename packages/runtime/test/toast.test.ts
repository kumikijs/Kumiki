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

  const banners = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-kumiki-toast]"));
  const texts = (): string[] => banners().map((b) => b.textContent ?? "");
  const dismissButton = (b: Element | null): HTMLButtonElement =>
    defined(
      b?.querySelector<HTMLButtonElement>("button[data-kumiki-toast-dismiss]"),
      "a dismiss button",
    );
  const pressEscape = (el: EventTarget): void => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  };
  /** A focusable control of the page's own, outside the stack. */
  const pageButton = (): HTMLButtonElement => {
    const b = document.createElement("button");
    document.body.appendChild(b);
    return b;
  };

  // The button's mark is drawn, not written, so the banner's text is still the toast's alone.
  it("gives every toast a dismiss button named for what it does, which adds no text", async () => {
    await fire({ kind: "info", text: "Saved" });
    const button = dismissButton(banner());
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Dismiss");
    expect(banner()?.textContent).toBe("Saved");
  });

  it.each<[string, (b: HTMLElement) => void]>([
    ["its dismiss button is clicked", (b) => dismissButton(b).click()],
    [
      "Escape is pressed on its focused dismiss button",
      (b) => {
        dismissButton(b).focus();
        pressEscape(dismissButton(b));
      },
    ],
  ])("takes an error toast away when %s", async (_, dismiss) => {
    await fire({ kind: "error", text: "Failed" });
    dismiss(defined(banner(), "the error toast"));
    expect(banner()).toBeNull();
  });

  it("takes a toast with time left away at once, and leaves the rest to their own time", async () => {
    await fire({ kind: "info", text: "first" });
    vi.advanceTimersByTime(1_000);
    await fire({ kind: "info", text: "second" });
    dismissButton(banners()[0] ?? null).click();
    expect(texts()).toEqual(["second"]);
    // Past the first one's 3000ms, short of the second's.
    vi.advanceTimersByTime(2_001);
    expect(texts()).toEqual(["second"]);
    vi.advanceTimersByTime(1_000);
    expect(texts()).toEqual([]);
    expect(document.querySelector("[data-kumiki-toast-stack]")).toBeNull();
  });

  // The page's own Escape handlers, and a dialog's, keep the key unless focus is in a toast.
  it.each<[string, () => EventTarget]>([
    ["on the document", () => document],
    ["on a control of the page's own", pageButton],
  ])("leaves an error toast up when Escape is pressed %s", async (_, target) => {
    await fire({ kind: "error", text: "Failed" });
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    pressEscape(target());
    document.removeEventListener("keydown", seen);
    expect(texts()).toEqual(["Failed"]);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // One press, one layer: a confirm dialog listening on the document stays open.
  it("keeps the Escape that dismissed a toast from reaching the document", async () => {
    await fire({ kind: "error", text: "Failed" });
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    pressEscape(dismissButton(banner()));
    document.removeEventListener("keydown", seen);
    expect(banner()).toBeNull();
    expect(seen).not.toHaveBeenCalled();
  });

  it("stacks toasts shown together in one element fixed to the bottom-right, oldest first", async () => {
    await fire({ kind: "error", text: "Failed" });
    await fire({ kind: "success", text: "Saved" });
    expect(texts()).toEqual(["Failed", "Saved"]);
    const stack = defined(banners()[0]?.parentElement, "the stack");
    expect(banners().map((b) => b.parentElement)).toEqual([stack, stack]);
    expect(stack.matches("body > [data-kumiki-toast-stack]")).toBe(true);
    const { position, bottom, right, display, flexDirection } = stack.style;
    expect({ position, bottom, right, display, flexDirection }).toEqual({
      position: "fixed",
      bottom: "24px",
      right: "24px",
      display: "flex",
      flexDirection: "column",
    });
    // Placed by the stack's flow, so a banner that leaves frees its place.
    expect(banners().map((b) => b.style.position)).toEqual(["", ""]);
  });

  it("closes the gap a toast leaves, and takes the stack away with the last one", async () => {
    await fire({ kind: "error", text: "Failed" });
    await fire({ kind: "info", text: "Saved" });
    await fire({ kind: "warn", text: "Offline" });
    vi.advanceTimersByTime(3_001);
    expect(texts()).toEqual(["Failed", "Offline"]);
    expect(banners()[1]?.previousElementSibling).toBe(banners()[0]);
    vi.advanceTimersByTime(2_000);
    dismissButton(banner()).click();
    expect(document.querySelector("[data-kumiki-toast-stack]")).toBeNull();
  });

  it("opens a new stack when the page took the old one away", async () => {
    await fire({ kind: "error", text: "Failed" });
    document.body.replaceChildren();
    await fire({ kind: "error", text: "Failed again" });
    expect(document.querySelectorAll("[data-kumiki-toast-stack]")).toHaveLength(1);
    expect(banner()?.isConnected).toBe(true);
  });

  // Otherwise focus falls to <body>, and a keyboard user starts the page over to reach the rest.
  it("hands focus to the toast that takes the dismissed one's place", async () => {
    for (const text of ["a", "b", "c"]) await fire({ kind: "error", text });
    const button = (i: number): HTMLButtonElement => dismissButton(banners()[i] ?? null);
    button(1).focus();
    pressEscape(button(1));
    expect(texts()).toEqual(["a", "c"]);
    expect(document.activeElement).toBe(button(1));
    // The newest has none after it, so the one before it.
    pressEscape(button(1));
    expect(document.activeElement).toBe(button(0));
  });

  it("hands focus on when a toast whose button holds it runs out of time", async () => {
    await fire({ kind: "error", text: "Failed" });
    await fire({ kind: "info", text: "Saved" });
    dismissButton(banners()[1] ?? null).focus();
    vi.advanceTimersByTime(3_001);
    expect(texts()).toEqual(["Failed"]);
    expect(document.activeElement).toBe(dismissButton(banner()));
  });

  it("leaves focus where it is when the toast that goes did not hold it", async () => {
    const own = pageButton();
    own.focus();
    await fire({ kind: "error", text: "Failed" });
    await fire({ kind: "info", text: "Saved" });
    vi.advanceTimersByTime(3_001);
    dismissButton(banner()).click();
    expect(document.activeElement).toBe(own);
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
