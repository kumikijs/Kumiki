import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function baseApp(overrides: Partial<AppShape>): AppShape {
  return {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => ({ kind: "text", text: "x" }),
    ...overrides,
  };
}

describe("runtime: app.meta (#80)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
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
    document.body.removeChild(root);
  });

  it("reflects title / description / og-image / favicon into <head>", () => {
    mount(
      baseApp({
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

    mount(baseApp({ meta: { description: "fresh" } }), root);

    const found = document.head.querySelectorAll('meta[name="description"]');
    expect(found).toHaveLength(1);
    expect(found[0]?.getAttribute("content")).toBe("fresh");
  });

  it("touches nothing when meta is undefined", () => {
    document.title = "untouched";
    mount(baseApp({}), root);
    expect(document.title).toBe("untouched");
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });
});

describe("runtime: app.analytics (#80)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.removeChild(root);
    vi.restoreAllMocks();
  });

  it("console provider logs events tagged with app-id when no host provider is set", async () => {
    const logged: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args);
    });

    const app: AppShape = {
      slots: {},
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
      init: [{ effect: "track", args: [{ event: "open" }] }],
      reducers: [],
      analytics: { provider: "console", appId: "demo" },
      root: () => ({ kind: "text", text: "x" }),
    };

    mount(app, root);
    await Promise.resolve();
    await Promise.resolve();

    const hit = logged.find(
      (entry) =>
        Array.isArray(entry) &&
        entry[0] === "[kumiki:analytics]" &&
        entry[1] &&
        typeof entry[1] === "object" &&
        (entry[1] as Record<string, unknown>).event === "open",
    );
    expect(hit).toBeDefined();
    expect((hit as unknown[])[1]).toEqual({ event: "open", appId: "demo" });
  });

  it("noop provider swallows events without logging", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app: AppShape = {
      slots: {},
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
      init: [{ effect: "track", args: [{ event: "open" }] }],
      reducers: [],
      analytics: { provider: "noop" },
      root: () => ({ kind: "text", text: "x" }),
    };

    mount(app, root);
    await Promise.resolve();
    await Promise.resolve();

    const calls = logSpy.mock.calls.filter((c) => c[0] === "[kumiki:analytics]");
    expect(calls).toHaveLength(0);
  });

  it("host-supplied analytics.send provider wins over app.analytics default", async () => {
    const hostCalls: unknown[] = [];
    const hostProvider: CapabilityProvider = (input) => {
      hostCalls.push(input);
      return { kind: "ok", value: null };
    };

    const app: AppShape = {
      slots: {},
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
      init: [{ effect: "track", args: [{ event: "hosted" }] }],
      reducers: [],
      analytics: { provider: "console", appId: "demo" },
      root: () => ({ kind: "text", text: "x" }),
    };

    mount(app, root, { providers: { "analytics.send": hostProvider } });
    await Promise.resolve();
    await Promise.resolve();

    expect(hostCalls).toEqual([{ event: "hosted" }]);
  });
});
