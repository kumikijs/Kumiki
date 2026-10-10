import type { AppShape, CapabilityProvider, EffectSpec, MountedApp } from "@kumikijs/runtime";
import { defineKumikiElement, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot, freshTag } from "./helpers/dom.ts";

type Counter = AppShape & Partial<Pick<MountedApp, "_dispatch" | "_setSlot">>;

/** A counter whose button is addressable, plus a `label` slot for attributes. */
function makeCounter(): Counter {
  const app: Counter = bareApp({
    slots: { count: { value: 0 }, label: { value: "-" } },
    reducers: [
      {
        name: "inc",
        event: { kind: "ui", ev: "click" },
        selector: { tile: "button" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
    ],
    root: () => ({
      kind: "column",
      children: [
        { kind: "text", text: `${app.live?.label ?? "-"}:${app.live?.count ?? 0}` },
        { kind: "button", text: "+", props: { onClick: () => app._dispatch?.("inc", {}) } },
      ],
    }),
  });
  return app;
}

/** What each mounted host currently shows. */
const readAll = (hosts: HTMLElement[]): string[] =>
  hosts.map((h) => (h.querySelector('[data-kumiki-tile="text"]')?.textContent ?? "").trim());

const clickIn = (host: HTMLElement): void => {
  const btn = host.querySelector("button") as HTMLButtonElement;
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("one AppShape mounted into two hosts", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = freshRoot();
  });
  afterEach(() => {
    host.remove();
  });

  it("keeps both views live and showing the shared state", () => {
    const app = makeCounter();
    const a = freshRoot(host);
    const b = freshRoot(host);
    mount(app, a);
    mount(app, b);

    expect(readAll([a, b])).toEqual(["-:0", "-:0"]);

    clickIn(a);
    expect(app.live?.count).toBe(1);
    expect(readAll([a, b])).toEqual(["-:1", "-:1"]);

    clickIn(b);
    expect(readAll([a, b])).toEqual(["-:2", "-:2"]);
  });

  it("runs the app's initialization exactly once", () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({ kind: "ok", value: null }));
    const boot: EffectSpec = {
      name: "boot",
      cap: "log.write",
      invoke: async (input, caps) => {
        const p = caps.provider("log.write");
        return p ? await p(input, caps) : { kind: "ok", value: null };
      },
    };
    const started = vi.fn();
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: ["log.write"],
      effects: { boot },
      init: [{ effect: "boot", args: [{ message: "hi" }] }],
      reducers: [
        {
          name: "onStart",
          event: { kind: "lifecycle", name: "app.start" },
          apply: () => {
            started();
            return { slots: {}, emits: [] };
          },
        },
      ],
      root: () => ({ kind: "text", text: "x" }),
    };
    mount(app, freshRoot(host), { providers: { "log.write": provider } });
    mount(app, freshRoot(host), { providers: { "log.write": provider } });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("ticks a timer once per interval, not once per view", () => {
    vi.useFakeTimers();
    try {
      const app: AppShape = bareApp({
        slots: { n: { value: 0 } },
        reducers: [
          {
            name: "tick",
            event: { kind: "timer", intervalMs: 100 },
            apply: (live) => ({ slots: { n: (live.n as number) + 1 }, emits: [] }),
          },
        ],
        root: () => ({ kind: "text", text: `n=${app.live?.n ?? 0}` }),
      });
      mount(app, freshRoot(host));
      mount(app, freshRoot(host));
      vi.advanceTimersByTime(100);
      expect(app.live?.n).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the surviving view interactive when the other is disposed", () => {
    const app = makeCounter();
    const a = freshRoot(host);
    const b = freshRoot(host);
    const first = mount(app, a);
    mount(app, b);

    first.dispose();
    expect(a.hasAttribute("data-kumiki-root")).toBe(false);
    expect(a.childElementCount).toBe(0);

    clickIn(b);
    expect(app.live?.count).toBe(1);
    expect(readAll([b])).toEqual(["-:1"]);
  });

  it("tears the shared machinery down when the last view goes", () => {
    vi.useFakeTimers();
    try {
      const app: AppShape = bareApp({
        slots: { n: { value: 0 } },
        reducers: [
          {
            name: "tick",
            event: { kind: "timer", intervalMs: 100 },
            apply: (live) => ({ slots: { n: (live.n as number) + 1 }, emits: [] }),
          },
        ],
        root: () => ({ kind: "text", text: `n=${app.live?.n ?? 0}` }),
      });
      const first = mount(app, freshRoot(host));
      const second = mount(app, freshRoot(host));
      vi.advanceTimersByTime(100);
      expect(app.live?.n).toBe(1);

      first.dispose();
      vi.advanceTimersByTime(100);
      expect(app.live?.n, "one view left, the timer still runs").toBe(2);

      second.dispose();
      vi.advanceTimersByTime(500);
      expect(app.live?.n, "no views left, the timer is gone").toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-mounts cleanly after the last view is disposed", () => {
    const app = makeCounter();
    const a = freshRoot(host);
    const handle = mount(app, a);
    clickIn(a);
    expect(app.live?.count).toBe(1);
    handle.dispose();

    const b = freshRoot(host);
    mount(app, b);
    clickIn(b);
    expect(app.live?.count).toBe(2);
    expect(readAll([b])).toEqual(["-:2"]);
  });

  it("refuses to add a view that wants to hydrate", () => {
    const app = makeCounter();
    mount(app, freshRoot(host));
    expect(() =>
      mount(app, freshRoot(host), {
        hydrate: true,
        bootstrapEpisode: { id: "e", trigger: { kind: "ssr.hydrate" }, steps: [] },
      } as never),
    ).toThrow(/already mounted/);
  });

  it("refuses a view that wants its own style root", () => {
    const app = makeCounter();
    mount(app, freshRoot(host));
    const shadowHost = freshRoot(host);
    const root = shadowHost.attachShadow({ mode: "open" });
    expect(() => mount(app, shadowHost, { styleRoot: root })).toThrow(/styleRoot/);
  });

  it("says which options it ignored rather than dropping them silently", () => {
    const app = makeCounter();
    mount(app, freshRoot(host));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      mount(app, freshRoot(host), {
        providers: { "log.write": async () => ({ kind: "ok", value: null }) },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("providers");
    } finally {
      warn.mockRestore();
    }
  });

  it("does not register a shape whose mount threw", () => {
    const app = makeCounter();
    const failed = freshRoot(host);
    expect(() => mount(app, failed, { hydrate: true })).toThrow(/bootstrapEpisode/);

    const good = freshRoot(host);
    mount(app, good);
    clickIn(good);
    expect(app.live?.count).toBe(1);
    expect(readAll([good])).toEqual(["-:1"]);
    // The host of the failed attempt is not a view of anything.
    expect(failed.childElementCount).toBe(0);
  });

  it("fires tile.mount once per render, however many hosts show it", () => {
    const mounted = vi.fn();
    const app: AppShape = bareApp({
      slots: { n: { value: 0 } },
      reducers: [
        {
          name: "onRowMount",
          event: { kind: "lifecycle", name: 'tile.mount("Row")' },
          apply: () => {
            mounted();
            return { slots: {}, emits: [] };
          },
        },
      ],
      root: () => ({
        kind: "column",
        children: [{ kind: "text", text: "row", props: { _tile: "Row" } }],
      }),
    });
    mount(app, freshRoot(host));
    mount(app, freshRoot(host));
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("does not unmount every tile because a render panicked", () => {
    const unmounted = vi.fn();
    let broken = false;
    const app: AppShape = bareApp({
      slots: { n: { value: 0 } },
      reducers: [
        {
          name: "onRowUnmount",
          event: { kind: "lifecycle", name: 'tile.unmount("Row")' },
          apply: () => {
            unmounted();
            return { slots: {}, emits: [] };
          },
        },
      ],
      root: () => ({
        kind: "column",
        children: [
          { kind: "text", text: "row", props: { _tile: "Row" } },
          {
            kind: "text",
            get text(): string {
              if (broken) throw new Error("boom");
              return "ok";
            },
          } as never,
        ],
      }),
    });
    const app2 = app as Counter;
    mount(app, freshRoot(host));
    expect(unmounted).not.toHaveBeenCalled();

    broken = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      app2._setSlot?.("n", 1);
    } finally {
      err.mockRestore();
    }
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("delivers an imperative slot write to the element it was called on", () => {
    const tag = freshTag("kumiki-shared");
    const app = makeCounter();
    defineKumikiElement(tag, app, { attributeSlots: { label: { slot: "label" } } });
    type SlotEl = HTMLElement & { setSlot(n: string, v: unknown): void };
    host.innerHTML = `<${tag} label="A"></${tag}><${tag} label="B"></${tag}>`;
    const [el1, el2] = Array.from(host.querySelectorAll(tag)) as SlotEl[];
    if (!el1 || !el2) throw new Error("elements did not upgrade");

    expect(app.live?.label).toBe("B");
    expect(readAll([el1, el2])).toEqual(["B:0", "B:0"]);

    el1.setSlot("label", "Z");
    expect(app.live?.label).toBe("Z");
    expect(readAll([el1, el2])).toEqual(["Z:0", "Z:0"]);
  });
});
