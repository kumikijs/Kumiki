import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { defineKumikiElement } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CAP = "telemetry.track";

type AppLive = AppShape & {
  _dispatch?: (name: string, el: Record<string, unknown>) => void;
};

function makeApp(): AppShape {
  const app: AppShape = {
    slots: {
      count: { value: 0, refine: (v) => typeof v === "number" && v >= 0 && v <= 999 },
      name: { value: "" },
    },
    caps: [CAP],
    effects: {
      track: {
        name: "track",
        cap: CAP,
        invoke: async (input, caps) => {
          const p = caps.provider(CAP);
          if (!p) return { kind: "err", value: { message: `Capability ${CAP} has no provider` } };
          return p(input, caps);
        },
      },
    },
    init: [],
    reducers: [
      {
        name: "inc",
        selector: { tile: "IncBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
      {
        name: "fire",
        selector: { tile: "FireBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: {}, emits: [{ effect: "track", args: [{ n: live.count }] }] }),
      },
    ],
    root: () => ({
      kind: "column",
      children: [
        { kind: "heading", text: `Count: ${(app.live as Record<string, unknown>)?.count ?? 0}` },
        { kind: "text", text: `Name: ${(app.live as Record<string, unknown>)?.name ?? ""}` },
      ],
    }),
  };
  return app;
}

function makeTimerApp(): AppShape {
  const app: AppShape = {
    slots: { count: { value: 0 } },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "tick",
        event: { kind: "timer", intervalMs: 100 },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
    ],
    root: () => ({ kind: "column", children: [{ kind: "heading", text: "timer" }] }),
  };
  return app;
}

let tagCounter = 0;
const freshTag = (): string => `kumiki-test-${++tagCounter}`;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const fire = (app: AppShape, name: string): void => (app as AppLive)._dispatch?.(name, {});

describe("defineKumikiElement (outbound web-component seam)", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it("mounts the app into the element on connect and renders (AC1)", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp());
    const el = document.createElement(tag);
    host.appendChild(el);
    expect(el.textContent ?? "").toContain("Count: 0");
  });

  it("disposes the mount on disconnect — timers stop (AC2)", () => {
    vi.useFakeTimers();
    try {
      const tag = freshTag();
      const app = makeTimerApp();
      defineKumikiElement(tag, app);
      const el = document.createElement(tag);
      host.appendChild(el);
      vi.advanceTimersByTime(250); // 2 ticks
      expect((app.live as Record<string, unknown>).count).toBe(2);
      el.remove(); // disconnect → dispose
      const frozen = (app.live as Record<string, unknown>).count;
      vi.advanceTimersByTime(500);
      expect((app.live as Record<string, unknown>).count).toBe(frozen);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards host providers to the embedded mount (AC3)", async () => {
    const tag = freshTag();
    const app = makeApp();
    const seen: unknown[] = [];
    const provider: CapabilityProvider = async (input) => {
      seen.push(input);
      return { kind: "ok", value: null };
    };
    defineKumikiElement(tag, app, { providers: { [CAP]: provider } });
    const el = document.createElement(tag);
    host.appendChild(el);
    fire(app, "fire");
    await tick();
    expect(seen).toEqual([{ n: 0 }]);
  });

  it("surfaces a custom-cap effect as a DOM CustomEvent when listed in events (AC4)", async () => {
    const tag = freshTag();
    const app = makeApp();
    defineKumikiElement(tag, app, { events: [CAP] });
    const el = document.createElement(tag);
    host.appendChild(el);
    const details: unknown[] = [];
    el.addEventListener(CAP, (e) => details.push((e as CustomEvent).detail));
    fire(app, "fire");
    await tick();
    expect(details).toEqual([{ n: 0 }]);
  });

  it("lets a host provider override the events passthrough for the same cap (AC5)", async () => {
    const tag = freshTag();
    const app = makeApp();
    let providerCalls = 0;
    const provider: CapabilityProvider = async () => {
      providerCalls++;
      return { kind: "ok", value: null };
    };
    defineKumikiElement(tag, app, { events: [CAP], providers: { [CAP]: provider } });
    const el = document.createElement(tag);
    host.appendChild(el);
    let eventFired = false;
    el.addEventListener(CAP, () => {
      eventFired = true;
    });
    fire(app, "fire");
    await tick();
    expect(providerCalls).toBe(1);
    expect(eventFired).toBe(false);
  });

  it("setSlot/setSlots update live state and re-render; refine rejects (AC6)", () => {
    const tag = freshTag();
    const app = makeApp();
    defineKumikiElement(tag, app);
    const el = document.createElement(tag) as HTMLElement & {
      setSlot(n: string, v: unknown): void;
      setSlots(o: Record<string, unknown>): void;
      getSlot(n: string): unknown;
      slots: Record<string, unknown>;
    };
    host.appendChild(el);
    el.setSlot("count", 5);
    expect(el.getSlot("count")).toBe(5);
    expect(el.textContent ?? "").toContain("Count: 5");
    el.setSlots({ name: "ada" });
    expect(el.slots.name).toBe("ada");
    expect(el.textContent ?? "").toContain("Name: ada");
    el.setSlot("count", -1); // violates refine (>= 0) → rejected
    expect(el.getSlot("count")).toBe(5);
  });

  it("binds an observed attribute to a slot via attributeSlots (AC7)", () => {
    const tag = freshTag();
    const app = makeApp();
    defineKumikiElement(tag, app, {
      attributeSlots: { "data-count": { slot: "count", parse: (raw) => Number(raw) } },
    });
    const el = document.createElement(tag);
    el.setAttribute("data-count", "7"); // set before connect
    host.appendChild(el);
    expect((app.live as Record<string, unknown>).count).toBe(7);
    expect(el.textContent ?? "").toContain("Count: 7");
    el.setAttribute("data-count", "9"); // change after connect
    expect((app.live as Record<string, unknown>).count).toBe(9);
  });

  it("is idempotent — re-defining the same tag does not throw (AC8)", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp());
    expect(() => defineKumikiElement(tag, makeApp())).not.toThrow();
  });

  it("renders into an open shadow root when shadow is enabled (AC-shadow-1)", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp(), { shadow: true });
    const el = document.createElement(tag);
    host.appendChild(el);
    expect(el.shadowRoot).toBeTruthy();
    // content lives in the shadow root, not the element's light DOM
    expect(el.shadowRoot?.textContent ?? "").toContain("Count: 0");
    expect(el.textContent ?? "").not.toContain("Count: 0");
  });

  it("injects the runtime style nodes into the shadow root, not the document head (AC-shadow-2)", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp(), { shadow: true });
    const el = document.createElement(tag);
    host.appendChild(el);
    // motion styles always inject (they carry the prefers-reduced-motion guard)
    expect(el.shadowRoot?.getElementById("kumiki-motions")).toBeTruthy();
  });

  it("scopes theme background to the shadow container, leaving document.body untouched (AC-shadow-3)", () => {
    const tag = freshTag();
    const app = makeApp();
    app.themes = {
      dark: {
        colors: { bg: "#101010", fg: "#eeeeee", surface: "#222222", border: "#333333" },
      },
    };
    app.themeName = "dark";
    const bodyBefore = document.body.style.background;
    defineKumikiElement(tag, app, { shadow: true });
    const el = document.createElement(tag);
    host.appendChild(el);
    const container = el.shadowRoot?.firstElementChild as HTMLElement;
    // happy-dom preserves the authored hex (jsdom used to normalize it to rgb()).
    expect(container.style.background).toBe("#101010");
    expect(el.shadowRoot?.getElementById("kumiki-theme-base")).toBeTruthy();
    // isolation: the page <body> was not themed
    expect(document.body.style.background).toBe(bodyBefore);
  });

  it("gives each element independent state when passed a createApp factory (multi-instance)", () => {
    const tag = freshTag();
    // `makeApp` itself is a factory (fresh app per call) — like the compiled
    // module's `createApp`. Each element instance gets its own state.
    defineKumikiElement(tag, makeApp);
    type SlotEl = HTMLElement & {
      setSlot(n: string, v: unknown): void;
      getSlot(n: string): unknown;
    };
    const el1 = document.createElement(tag) as SlotEl;
    const el2 = document.createElement(tag) as SlotEl;
    host.appendChild(el1);
    host.appendChild(el2);
    el1.setSlot("count", 7);
    expect(el1.getSlot("count")).toBe(7);
    expect(el2.getSlot("count")).toBe(0); // independent — no shared live
    expect(el1.textContent ?? "").toContain("Count: 7");
    expect(el2.textContent ?? "").toContain("Count: 0");
  });

  it("disposes the shadow mount on disconnect (AC-shadow-4)", () => {
    vi.useFakeTimers();
    try {
      const tag = freshTag();
      const app = makeTimerApp();
      defineKumikiElement(tag, app, { shadow: true });
      const el = document.createElement(tag);
      host.appendChild(el);
      vi.advanceTimersByTime(250);
      expect((app.live as Record<string, unknown>).count).toBe(2);
      el.remove();
      const frozen = (app.live as Record<string, unknown>).count;
      vi.advanceTimersByTime(500);
      expect((app.live as Record<string, unknown>).count).toBe(frozen);
    } finally {
      vi.useRealTimers();
    }
  });
});
