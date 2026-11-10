import type { AppShape, TileNode, TileProps } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";

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
const UNIVERSAL_EVENTS: ReadonlySet<string> = new Set(NAMES.map((name) => UNIVERSAL[name].event));

/**
 * An app whose single `input` carries whichever of the four the test last asked for, and re-renders on demand.
 *
 * `input` on purpose: it has a patcher registered, so the two renders reuse one element. A kind with no patcher rebuilds the subtree, which re-runs the create path and would register the listener for the wrong reason.
 */
function handlerApp(calls: Record<string, unknown>[]) {
  let live: readonly Universal[] = [];
  let payload: Record<string, unknown> = { seq: 1 };
  let renders = 0;
  const app: AppShape = bareApp({
    root: (): TileNode => {
      renders += 1;
      const props: TileProps = { el: payload };
      for (const name of live) props[name] = (el: Record<string, unknown>) => calls.push(el);
      return { kind: "input", value: `v${renders}`, props };
    },
  });
  return {
    app,
    /** Set which of the four the next render carries, and optionally its `el` payload. */
    set(next: readonly Universal[], nextPayload?: Record<string, unknown>) {
      live = next;
      if (nextPayload) payload = nextPayload;
    },
    rerender: () => defined(app._rerender, "the rerender seam a mount installs")(),
  };
}

describe("a universally-lifted handler across renders", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
  });

  /** The element the app renders, asserted to be the one an earlier render made. */
  const theInput = (was?: HTMLElement): HTMLElement => {
    const el = defined(root.querySelector("input"), "the input the app renders");
    if (was) expect(el, "the patch reused the element").toBe(was);
    return el;
  };

  it.each(NAMES)("%s reaches the element it was not created with", (handler) => {
    const calls: Record<string, unknown>[] = [];
    const { app, set, rerender } = handlerApp(calls);
    const { dispose } = mount(app, root);

    const el = theInput();
    UNIVERSAL[handler].fire(el);
    expect(calls, "nothing is wired before the branch arms").toHaveLength(0);

    set([handler]);
    rerender();

    UNIVERSAL[handler].fire(theInput(el));
    expect(calls).toHaveLength(1);
    dispose();
  });

  it.each(NAMES)("%s stops reaching it when a render drops it, and comes back after", (handler) => {
    const calls: Record<string, unknown>[] = [];
    const { app, set, rerender } = handlerApp(calls);
    set([handler]);
    const { dispose } = mount(app, root);

    const el = theInput();
    UNIVERSAL[handler].fire(el);
    set([]);
    rerender();
    UNIVERSAL[handler].fire(theInput(el));
    expect(calls, "dropped").toHaveLength(1);

    set([handler]);
    rerender();
    UNIVERSAL[handler].fire(theInput(el));
    expect(calls, "and armed again").toHaveLength(2);
    dispose();
  });

  it("registers the second of the four to arrive, not only the first", () => {
    const calls: Record<string, unknown>[] = [];
    const { app, set, rerender } = handlerApp(calls);
    const { dispose } = mount(app, root);
    const el = theInput();

    set(["onFocus"]);
    rerender();
    UNIVERSAL.onFocus.fire(theInput(el));
    expect(calls).toHaveLength(1);

    set(["onFocus", "onKeyDown"]);
    rerender();
    UNIVERSAL.onKeyDown.fire(theInput(el));
    expect(calls).toHaveLength(2);
    dispose();
  });

  it.each(NAMES)("%s fires once on an element the reconcile has patched", (handler) => {
    const calls: Record<string, unknown>[] = [];
    const { app, set, rerender } = handlerApp(calls);
    set([handler]);
    const { dispose } = mount(app, root);

    const el = theInput();
    rerender();
    UNIVERSAL[handler].fire(theInput(el));
    expect(calls).toHaveLength(1);
    dispose();
  });

  it.each(NAMES)("%s is handed the payload of the render that is live", (handler) => {
    const calls: Record<string, unknown>[] = [];
    const { app, set, rerender } = handlerApp(calls);
    set([handler], { seq: 1 });
    const { dispose } = mount(app, root);

    const el = theInput();
    UNIVERSAL[handler].fire(el);
    expect(calls[0]).toMatchObject({ seq: 1 });

    set([handler], { seq: 2 });
    rerender();
    UNIVERSAL[handler].fire(theInput(el));
    expect(calls[1]).toMatchObject({ seq: 2 });
    dispose();
  });

  it("registers no listener at all for a tile that never carries one", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    try {
      const app: AppShape = bareApp({
        root: (): TileNode => ({ kind: "input", value: "", props: {} }),
      });
      const { dispose } = mount(app, root);
      const registered = spy.mock.calls.map((call) => String(call[0]));
      // The input renderer wires its own — `input`, `change`, and the IME
      // composition pair — unconditionally. None of those are these four.
      expect(registered.filter((event) => UNIVERSAL_EVENTS.has(event))).toEqual([]);
      expect(registered.length, "the renderer's own listeners are still there").toBeGreaterThan(0);
      dispose();
    } finally {
      spy.mockRestore();
    }
  });
});

// The premise of the compiler's lift rows for these kinds: they lift `ui.key`, and W0212 tells a
// `ui.focus` / `ui.blur` on them that the event their <input> fires never reaches the <label>.
describe("a label-wrapped control hears key from its <input>, and never focus or blur", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });

  afterEach(() => {
    root.remove();
  });

  function mountWithSpies(node: TileNode) {
    const spies = { onFocus: vi.fn(), onBlur: vi.fn(), onKeyDown: vi.fn() };
    const { dispose } = mount(bareApp({ root: (): TileNode => ({ ...node, props: spies }) }), root);
    const input = defined(root.querySelector("input"), "the control's <input>");
    input.focus();
    expect(document.activeElement, "the <input> took focus").toBe(input);
    input.blur();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    dispose();
    return spies;
  }

  it.each<TileNode>([
    { kind: "check", checked: false },
    { kind: "switch", checked: false },
    { kind: "radio", group: "g" },
  ])("runs no focus or blur listener, and the key listener once, on a $kind", (node) => {
    const spies = mountWithSpies(node);
    expect(spies.onFocus).not.toHaveBeenCalled();
    expect(spies.onBlur).not.toHaveBeenCalled();
    expect(spies.onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("runs all three on an input, which takes focus itself", () => {
    const spies = mountWithSpies({ kind: "input", value: "" });
    expect(spies.onFocus).toHaveBeenCalledTimes(1);
    expect(spies.onBlur).toHaveBeenCalledTimes(1);
    expect(spies.onKeyDown).toHaveBeenCalledTimes(1);
  });
});
