import type { AppShape, CapabilityProvider, MountedApp } from "@kumikijs/runtime";
import { defineKumikiElement } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot, freshTag } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

const CAP = "telemetry.track";

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
  return bareApp({
    slots: { count: { value: 0 } },
    reducers: [
      {
        name: "tick",
        event: { kind: "timer", intervalMs: 100 },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
    ],
    root: () => ({ kind: "column", children: [{ kind: "heading", text: "timer" }] }),
  });
}

const fire = (app: AppShape, name: string): void => (app as MountedApp)._dispatch(name, {});

describe("defineKumikiElement (outbound web-component seam)", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = freshRoot();
  });
  afterEach(() => {
    host.remove();
  });

  it("mounts the app into the element on connect and renders", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp());
    const el = document.createElement(tag);
    host.appendChild(el);
    expect(el.textContent ?? "").toContain("Count: 0");
  });

  it("disposes the mount on disconnect — timers stop", () => {
    vi.useFakeTimers();
    try {
      const tag = freshTag();
      const app = makeTimerApp();
      defineKumikiElement(tag, app);
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

  it("forwards host providers to the embedded mount", async () => {
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
    await tick(0);
    expect(seen).toEqual([{ n: 0 }]);
  });

  it("surfaces a custom-cap effect as a DOM CustomEvent when listed in events", async () => {
    const tag = freshTag();
    const app = makeApp();
    defineKumikiElement(tag, app, { events: [CAP] });
    const el = document.createElement(tag);
    host.appendChild(el);
    const details: unknown[] = [];
    el.addEventListener(CAP, (e) => details.push((e as CustomEvent).detail));
    fire(app, "fire");
    await tick(0);
    expect(details).toEqual([{ n: 0 }]);
  });

  it("lets a host provider override the events passthrough for the same cap", async () => {
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
    await tick(0);
    expect(providerCalls).toBe(1);
    expect(eventFired).toBe(false);
  });

  it("setSlot/setSlots update live state and re-render; refine rejects", () => {
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
    el.setSlot("count", -1);
    expect(el.getSlot("count")).toBe(5);
  });

  it("binds an observed attribute to a slot via attributeSlots", () => {
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

  it("is idempotent — re-defining the same tag does not throw", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp());
    expect(() => defineKumikiElement(tag, makeApp())).not.toThrow();
  });

  it("renders into an open shadow root when shadow is enabled", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp(), { shadow: true });
    const el = document.createElement(tag);
    host.appendChild(el);
    expect(el.shadowRoot).toBeTruthy();
    expect(el.shadowRoot?.textContent ?? "").toContain("Count: 0");
    expect(el.textContent ?? "").not.toContain("Count: 0");
  });

  it("injects the runtime style nodes into the shadow root, not the document head", () => {
    const tag = freshTag();
    defineKumikiElement(tag, makeApp(), { shadow: true });
    const el = document.createElement(tag);
    host.appendChild(el);
    // Motion styles always inject: they carry the prefers-reduced-motion guard.
    expect(el.shadowRoot?.getElementById("kumiki-motions")).toBeTruthy();
  });

  it("scopes theme background to the shadow container, leaving document.body untouched", () => {
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
    expect(container.style.background).toBe("#101010");
    expect(el.shadowRoot?.getElementById("kumiki-theme-base")).toBeTruthy();
    expect(document.body.style.background).toBe(bodyBefore);
  });

  it("gives each element independent state when passed a createApp factory (multi-instance)", () => {
    const tag = freshTag();
    // `makeApp` returns a fresh app per call, like the compiled module's `createApp`.
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
    expect(el2.getSlot("count")).toBe(0);
    expect(el1.textContent ?? "").toContain("Count: 7");
    expect(el2.textContent ?? "").toContain("Count: 0");
  });

  it("disposes the shadow mount on disconnect", () => {
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
