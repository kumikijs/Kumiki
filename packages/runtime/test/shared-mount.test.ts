// One `AppShape` mounted into more than one host. `docs/spec/runtime.md` §10.9
// says passing the default export rather than the `createApp` factory "shares
// one instance across all elements of that tag" — which is only a sentence
// worth writing if every element stays live.
//
// It did not. Each mount overwrote the shape's imperative seams, so the second
// mount captured every event that resolved through the shape and the first
// froze: its buttons re-rendered the other host, and `el.setSlot` on the first
// element landed on the second.

import type { AppShape, CapabilityProvider, EffectSpec } from "@kumikijs/runtime";
import { defineKumikiElement, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Counter = AppShape & {
  _dispatch?: (name: string, el: Record<string, unknown>) => void;
  _setSlot?: (name: string, value: unknown) => void;
};

/** A counter whose button is addressable, plus a `label` slot for attributes. */
function makeCounter(): Counter {
  const app: Counter = {
    slots: { count: { value: 0 }, label: { value: "-" } },
    caps: [],
    effects: {},
    init: [],
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
        // How a compiled app wires a click: the handler calls the shape's
        // dispatch seam by name, which is exactly the seam a second mount used
        // to overwrite.
        { kind: "button", text: "+", props: { onClick: () => app._dispatch?.("inc", {}) } },
      ],
    }),
  };
  return app;
}

/** What each mounted host currently shows. */
const readAll = (hosts: HTMLElement[]): string[] =>
  hosts.map((h) => (h.querySelector('[data-kumiki-tile="text"]')?.textContent ?? "").trim());

const clickIn = (host: HTMLElement): void => {
  const btn = host.querySelector("button") as HTMLButtonElement;
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

let tagCounter = 0;
const freshTag = (): string => `kumiki-shared-${++tagCounter}`;

describe("one AppShape mounted into two hosts", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  const freshRoot = (): HTMLElement => {
    const el = document.createElement("div");
    host.appendChild(el);
    return el;
  };

  it("keeps both views live and showing the shared state", () => {
    const app = makeCounter();
    const a = freshRoot();
    const b = freshRoot();
    mount(app, a);
    mount(app, b);

    expect(readAll([a, b])).toEqual(["-:0", "-:0"]);

    // The first mount is the one that used to freeze: its click re-rendered
    // the *other* host, so `a` stayed at 0 while `b` counted.
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
    mount(app, freshRoot(), { providers: { "log.write": provider } });
    mount(app, freshRoot(), { providers: { "log.write": provider } });

    // Shared state means shared initialization: running `app.init` twice would
    // double every request the app makes on load.
    expect(provider).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("ticks a timer once per interval, not once per view", () => {
    vi.useFakeTimers();
    try {
      const app: AppShape = {
        slots: { n: { value: 0 } },
        caps: [],
        effects: {},
        init: [],
        reducers: [
          {
            name: "tick",
            event: { kind: "timer", intervalMs: 100 },
            apply: (live) => ({ slots: { n: (live.n as number) + 1 }, emits: [] }),
          },
        ],
        root: () => ({ kind: "text", text: `n=${app.live?.n ?? 0}` }),
      };
      mount(app, freshRoot());
      mount(app, freshRoot());
      vi.advanceTimersByTime(100);
      expect(app.live?.n).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the surviving view interactive when the other is disposed", () => {
    const app = makeCounter();
    const a = freshRoot();
    const b = freshRoot();
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
      const app: AppShape = {
        slots: { n: { value: 0 } },
        caps: [],
        effects: {},
        init: [],
        reducers: [
          {
            name: "tick",
            event: { kind: "timer", intervalMs: 100 },
            apply: (live) => ({ slots: { n: (live.n as number) + 1 }, emits: [] }),
          },
        ],
        root: () => ({ kind: "text", text: `n=${app.live?.n ?? 0}` }),
      };
      const first = mount(app, freshRoot());
      const second = mount(app, freshRoot());
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
    const a = freshRoot();
    const handle = mount(app, a);
    clickIn(a);
    expect(app.live?.count).toBe(1);
    handle.dispose();

    const b = freshRoot();
    mount(app, b);
    clickIn(b);
    expect(app.live?.count).toBe(2);
    expect(readAll([b])).toEqual(["-:2"]);
  });

  it("delivers an imperative slot write to the element it was called on", () => {
    // The custom-element form of the same defect: `el.setSlot` goes through the
    // shape's `_setSlot`, which the second mount had overwritten.
    const tag = freshTag();
    const app = makeCounter();
    defineKumikiElement(tag, app, { attributeSlots: { label: { slot: "label" } } });
    type SlotEl = HTMLElement & { setSlot(n: string, v: unknown): void };
    host.innerHTML = `<${tag} label="A"></${tag}><${tag} label="B"></${tag}>`;
    const [el1, el2] = Array.from(host.querySelectorAll(tag)) as SlotEl[];
    if (!el1 || !el2) throw new Error("elements did not upgrade");

    // Both elements show the shared state; the attribute applied last wins the
    // slot, which is what "shares one instance" means.
    expect(app.live?.label).toBe("B");
    expect(readAll([el1, el2])).toEqual(["B:0", "B:0"]);

    el1.setSlot("label", "Z");
    expect(app.live?.label).toBe("Z");
    expect(readAll([el1, el2])).toEqual(["Z:0", "Z:0"]);
  });
});
