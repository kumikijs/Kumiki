import type { AppShape, CapabilityProvider, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

const textRoot = (): TileNode => ({ kind: "text", text: "x" });

describe("runtime: app.meta", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
    document.title = "";
    for (const sel of [
      'meta[name="description"]',
      'meta[property="og:image"]',
      'link[rel="icon"]',
    ]) {
      for (const el of Array.from(document.head.querySelectorAll(sel))) el.remove();
    }
  });

  afterEach(() => {
    root.remove();
  });

  it("reflects title / description / og-image / favicon into <head>", () => {
    mount(
      bareApp({
        root: textRoot,
        meta: {
          title: "Hello Kumiki",
          description: "An app",
          ogImage: "/og.png",
          favicon: "/favicon.ico",
        },
      }),
      root,
    );
    expect(document.title).toBe("Hello Kumiki");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "An app",
    );
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      "/og.png",
    );
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      "/favicon.ico",
    );
  });

  it("overwrites a pre-existing meta tag instead of duplicating", () => {
    const stale = document.createElement("meta");
    stale.setAttribute("name", "description");
    stale.setAttribute("content", "stale");
    document.head.appendChild(stale);

    mount(bareApp({ root: textRoot, meta: { description: "fresh" } }), root);

    const found = document.head.querySelectorAll('meta[name="description"]');
    expect(found).toHaveLength(1);
    expect(found[0]?.getAttribute("content")).toBe("fresh");
  });

  it("touches nothing when meta is undefined", () => {
    document.title = "untouched";
    mount(bareApp({ root: textRoot }), root);
    expect(document.title).toBe("untouched");
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });
});

/** An app that sends `event` through `analytics.send` at init. */
function trackingApp(analytics: NonNullable<AppShape["analytics"]>, event: string): AppShape {
  return bareApp({
    caps: ["analytics.send"],
    effects: {
      track: {
        name: "track",
        cap: "analytics.send",
        invoke: async (input, caps) => {
          const p = caps.provider("analytics.send");
          if (p) return p(input, caps);
          return { kind: "err", value: { message: "no provider" } };
        },
      },
    },
    init: [{ effect: "track", args: [{ event }] }],
    analytics,
    root: textRoot,
  });
}

const settleInit = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("runtime: app.analytics", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it("console provider logs events tagged with app-id when no host provider is set", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mount(trackingApp({ provider: "console", appId: "demo" }, "open"), root);
    await settleInit();

    const calls = logSpy.mock.calls.filter((c) => c[0] === "[kumiki:analytics]");
    expect(calls).toEqual([["[kumiki:analytics]", { event: "open", appId: "demo" }]]);
  });

  it("noop provider swallows events without logging", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mount(trackingApp({ provider: "noop" }, "open"), root);
    await settleInit();

    expect(logSpy.mock.calls.filter((c) => c[0] === "[kumiki:analytics]")).toHaveLength(0);
  });

  it("host-supplied analytics.send provider wins over app.analytics default", async () => {
    const hostCalls: unknown[] = [];
    const hostProvider: CapabilityProvider = (input) => {
      hostCalls.push(input);
      return { kind: "ok", value: null };
    };
    mount(trackingApp({ provider: "console", appId: "demo" }, "hosted"), root, {
      providers: { "analytics.send": hostProvider },
    });
    await settleInit();

    expect(hostCalls).toEqual([{ event: "hosted" }]);
  });
});
