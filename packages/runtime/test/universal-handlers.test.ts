// The four handlers the runtime lifts onto every tile kind — `onKeyDown`,
// `onMouseEnter`, `onFocus`, `onBlur` — rather than any per-kind renderer.
//
// They dispatch through one shared per-element slot, and the native listeners
// that read that slot used to be registered only when the tile carried a
// handler at create time. A conditional whose later branch introduces one
// therefore had nowhere to land: the element is reused, the slot is refreshed
// with the new handler, and no listener was ever registered to read it. The
// neighbouring case — a conditional that swaps one handler for another — worked,
// which is what made this one hard to see.
//
// The counterpart matters as much: a tile that never carries one of the four
// must still register nothing, so the lazy registration is asserted against
// `addEventListener` itself rather than against behaviour, which cannot tell a
// missing listener from an empty slot.

import type { AppShape, TileNode, TileProps } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";

/** The four, with the event each one listens for and how to fire it. */
const UNIVERSAL = {
  onFocus: { event: "focus", fire: (el: HTMLElement) => el.dispatchEvent(new FocusEvent("focus")) },
  onBlur: { event: "blur", fire: (el: HTMLElement) => el.dispatchEvent(new FocusEvent("blur")) },
  onKeyDown: {
    event: "keydown",
    fire: (el: HTMLElement) =>
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA" })),
  },
  onMouseEnter: {
    event: "mouseenter",
    fire: (el: HTMLElement) => el.dispatchEvent(new MouseEvent("mouseenter")),
  },
} as const;

type Universal = keyof typeof UNIVERSAL;
const NAMES = Object.keys(UNIVERSAL) as Universal[];

/**
 * An app whose single `input` gains `handler` only once `armed` flips.
 *
 * `input` on purpose: it has a patcher registered, so the two renders reuse one
 * element. A kind with no patcher rebuilds the subtree, which re-runs the
 * create path and would register the listener for the wrong reason.
 */
function armableApp(handler: Universal, calls: Record<string, unknown>[]) {
  let armed = false;
  const app: AppShape = {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: (): TileNode => {
      const props: TileProps = armed
        ? { [handler]: (el: Record<string, unknown>) => calls.push(el) }
        : {};
      return { kind: "input", value: "", props };
    },
  };
  return { app, arm: () => (armed = true) };
}

describe("a universally-lifted handler that arrives on a later render", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
  });

  it.each(NAMES)("%s reaches the element it was not created with", (handler) => {
    const calls: Record<string, unknown>[] = [];
    const { app, arm } = armableApp(handler, calls);
    const { dispose } = mount(app, root);

    const el = defined(root.querySelector("input"), "the input the app renders");
    UNIVERSAL[handler].fire(el);
    expect(calls, "nothing is wired before the branch arms").toHaveLength(0);

    arm();
    app._rerender?.();

    // The element has to be the same one, or this is testing the create path.
    expect(root.querySelector("input"), "the patch reused the element").toBe(el);
    UNIVERSAL[handler].fire(el);
    expect(calls).toHaveLength(1);
    dispose();
  });

  it.each(NAMES)("%s stops reaching it when a later render drops it", (handler) => {
    const calls: Record<string, unknown>[] = [];
    const { app, arm } = armableApp(handler, calls);
    arm();
    const { dispose } = mount(app, root);

    const el = defined(root.querySelector("input"), "the input the app renders");
    UNIVERSAL[handler].fire(el);
    expect(calls).toHaveLength(1);

    // `armableApp` only arms; disarming is what the slot refresh has to answer
    // for, and it is the direction registering-on-refresh must not break.
    app.root = () => ({ kind: "input", value: "", props: {} });
    app._rerender?.();
    expect(root.querySelector("input")).toBe(el);
    UNIVERSAL[handler].fire(el);
    expect(calls, "the slot no longer carries it").toHaveLength(1);
    dispose();
  });

  it.each(NAMES)("%s fires once on an element the reconcile has patched", (handler) => {
    // The runtime holds no listener refs, so registering on the render that
    // fills the slot has to be idempotent by bookkeeping. A tile that carries
    // the handler from the start and is then patched would otherwise gain a
    // second set of listeners and run the reducer twice per event.
    const calls: Record<string, unknown>[] = [];
    let renders = 0;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => {
        renders += 1;
        // `value` changes so the two nodes cannot compare equal — this has to
        // be the patch path, not a reuse that never refreshes the slot.
        return {
          kind: "input",
          value: `v${renders}`,
          props: { [handler]: (el: Record<string, unknown>) => calls.push(el) },
        };
      },
    };
    const { dispose } = mount(app, root);

    const el = defined(root.querySelector("input"), "the input the app renders");
    app._rerender?.();
    expect(root.querySelector("input"), "the patch reused the element").toBe(el);

    UNIVERSAL[handler].fire(el);
    expect(calls).toHaveLength(1);
    dispose();
  });

  it("registers no listener at all for a tile that never carries one", () => {
    // Behaviour cannot answer this: a registered listener over an empty slot is
    // a no-op and looks exactly like no listener. Ask `addEventListener`.
    const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    try {
      const app: AppShape = {
        slots: {},
        caps: [],
        effects: {},
        init: [],
        reducers: [],
        root: (): TileNode => ({ kind: "input", value: "", props: {} }),
      };
      const { dispose } = mount(app, root);
      const registered = spy.mock.calls.map((call) => String(call[0]));
      // The input renderer wires its own `input` / `change` unconditionally —
      // those are not these four.
      expect(registered.filter((event) => UNIVERSAL_EVENTS.has(event))).toEqual([]);
      dispose();
    } finally {
      spy.mockRestore();
    }
  });
});

const UNIVERSAL_EVENTS: ReadonlySet<string> = new Set(NAMES.map((name) => UNIVERSAL[name].event));
