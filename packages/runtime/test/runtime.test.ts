import type { AppShape } from "@kumikijs/runtime";
import { _stdlib, builtinEffects, KumikiPanic, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hand-crafted AppShape mirroring the counter example, using the Phase 2 runtime contract.
function makeCounterApp(): AppShape {
  const slots = {
    count: { value: 0, refine: (v: unknown) => typeof v === "number" && v >= 0 && v <= 999 },
  };
  const app: AppShape = {
    slots,
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "inc",
        selector: { tile: "IncBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
      {
        name: "dec",
        selector: { tile: "DecBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) - 1 }, emits: [] }),
      },
      {
        name: "reset",
        selector: { tile: "ResetBtn" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { count: 0 }, emits: [] }),
      },
    ],
    root: () => ({
      kind: "column",
      children: [
        {
          kind: "heading",
          text: `Count: ${(app as unknown as { _live: { count: number } })._live?.count ?? 0}`,
        },
        {
          kind: "row",
          children: [
            {
              kind: "button",
              text: "-",
              props: {
                onClick: () =>
                  (
                    app as unknown as {
                      _dispatch: (n: string, el: Record<string, unknown>) => void;
                    }
                  )._dispatch("dec", {}),
              },
            },
            {
              kind: "button",
              text: "reset",
              props: {
                onClick: () =>
                  (
                    app as unknown as {
                      _dispatch: (n: string, el: Record<string, unknown>) => void;
                    }
                  )._dispatch("reset", {}),
              },
            },
            {
              kind: "button",
              text: "+",
              props: {
                onClick: () =>
                  (
                    app as unknown as {
                      _dispatch: (n: string, el: Record<string, unknown>) => void;
                    }
                  )._dispatch("inc", {}),
              },
            },
          ],
          props: { gap: "sm" },
        },
      ],
    }),
  };

  // Provide `_live` so the root() closure can read count after mounts.
  (app as unknown as { _live: Record<string, unknown> })._live = { count: 0 };
  // Intercept the runtime's slot writes by patching apply functions to also
  // write into our shadow `_live` mirror.
  const originalReducers = app.reducers;
  app.reducers = originalReducers.map((r) => ({
    ...r,
    apply: (live, payload) => {
      const result = r.apply(live, payload);
      const mirror = (app as unknown as { _live: Record<string, unknown> })._live;
      for (const [k, v] of Object.entries(result.slots)) {
        const meta = slots[k as keyof typeof slots];
        if (meta?.refine && !meta.refine(v)) continue;
        mirror[k] = v;
      }
      return result;
    },
  }));

  return app;
}

describe("runtime", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.removeChild(root);
  });

  it("renders initial state and three buttons", () => {
    mount(makeCounterApp(), root);
    expect(root.querySelector("h1")?.textContent).toBe("Count: 0");
    const buttons = Array.from(root.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["-", "reset", "+"]);
  });

  it("increments on + click and re-renders", () => {
    mount(makeCounterApp(), root);
    const plus = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "+");
    plus?.click();
    expect(root.querySelector("h1")?.textContent).toBe("Count: 1");
    plus?.click();
    plus?.click();
    expect(root.querySelector("h1")?.textContent).toBe("Count: 3");
  });

  it("rejects values below refinement floor", () => {
    mount(makeCounterApp(), root);
    const minus = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "-");
    minus?.click();
    expect(root.querySelector("h1")?.textContent).toBe("Count: 0");
  });

  it("resets to 0", () => {
    mount(makeCounterApp(), root);
    const buttons = Array.from(root.querySelectorAll("button"));
    const plus = buttons.find((b) => b.textContent === "+");
    const reset = buttons.find((b) => b.textContent === "reset");
    plus?.click();
    plus?.click();
    plus?.click();
    reset?.click();
    expect(root.querySelector("h1")?.textContent).toBe("Count: 0");
  });

  it("clamps at refinement ceiling 999", () => {
    mount(makeCounterApp(), root);
    const plus = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "+");
    for (let i = 0; i < 1001; i++) plus?.click();
    expect(root.querySelector("h1")?.textContent).toBe("Count: 999");
  });
});

// A named timer (`timer(100ms, name=countdown)`) incrementing `count`, plus a
// `stop` reducer that returns stopTimers: ["countdown"] (what codegen lowers
// `stop-timer(countdown)` to).
function makeTimerApp(): AppShape {
  const app: AppShape = {
    slots: { count: { value: 0 } },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "tick",
        event: { kind: "timer", intervalMs: 100, name: "countdown" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
      {
        name: "stop",
        selector: { tile: "StopBtn" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [], stopTimers: ["countdown"] }),
      },
    ],
    root: () => ({ kind: "column", children: [{ kind: "heading", text: "timer" }] }),
  };
  return app;
}

describe("named timers + stop-timer", () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    vi.useRealTimers();
    root.remove();
  });

  const count = (app: AppShape): unknown => (app.live as Record<string, unknown>).count;

  it("a named timer fires until stop-timer clears it", () => {
    const app = makeTimerApp();
    const { dispose } = mount(app, root);
    vi.advanceTimersByTime(350); // ticks at 100/200/300ms
    expect(count(app)).toBe(3);

    (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
      "stop",
      {},
    );
    const frozen = count(app);
    vi.advanceTimersByTime(500);
    expect(count(app)).toBe(frozen); // no further ticks after stop-timer
    dispose();
  });

  it("dispose clears a running named timer (no leak)", () => {
    const app = makeTimerApp();
    const { dispose } = mount(app, root);
    vi.advanceTimersByTime(150); // one tick
    expect(count(app)).toBe(1);
    dispose();
    vi.advanceTimersByTime(500);
    expect(count(app)).toBe(1); // disposed timer does not fire again
  });
});

// An overlay whose second child (the modal) is gated by the `open` slot —
// mirrors what codegen emits for `overlay(Content, when(open, Modal()))`.
function makeOverlayApp(): AppShape {
  const app: AppShape = {
    slots: { open: { value: false } },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "toggle",
        selector: { tile: "Btn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { open: !(live.open as boolean) }, emits: [] }),
      },
    ],
    root: () => {
      const open = (app.live as Record<string, unknown>).open as boolean;
      return {
        kind: "overlay",
        props: { align: "top" },
        children: [
          {
            kind: "column",
            props: {},
            children: [
              { kind: "heading", text: "Base" },
              {
                kind: "button",
                text: "toggle",
                props: {
                  onClick: () =>
                    (
                      app as unknown as {
                        _dispatch: (n: string, el: Record<string, unknown>) => void;
                      }
                    )._dispatch("toggle", {}),
                },
              },
            ],
          },
          open ? { kind: "card", props: {}, children: [{ kind: "text", text: "Modal" }] } : null,
        ],
      };
    },
  };
  return app;
}

// A root that renders one spinner tile — the status-tile contract (spec
// stdlib §2.3.8: an animated loading indicator, props: size).
function makeSpinnerApp(props: Record<string, unknown> = {}): AppShape {
  const app: AppShape = {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => ({ kind: "spinner", props }),
  };
  return app;
}

describe("spinner builtin", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    document.getElementById("kumiki-animations")?.remove();
  });
  afterEach(() => {
    root.remove();
  });

  // AC1: an accessible animated indicator, not the "…" text placeholder
  it("renders an accessible ring element, not placeholder text", () => {
    mount(makeSpinnerApp(), root);
    const el = root.querySelector('[data-kumiki-tile="spinner"]') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.textContent).toBe("");
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-label")).toBe("Loading");
  });

  // AC2: the spin keyframes + spinner rule are injected into the style root,
  // with a reduced-motion opt-out
  it("injects kumiki-spin keyframes, the spinner rule, and reduced-motion handling", () => {
    mount(makeSpinnerApp(), root);
    const css = document.getElementById("kumiki-animations")?.textContent ?? "";
    expect(css).toContain("@keyframes kumiki-spin");
    expect(css).toContain('[data-kumiki-tile="spinner"]');
    expect(css).toMatch(/prefers-reduced-motion[^}]*\{[^}]*spinner/s);
  });

  // AC3: the size prop scales the ring — sm/md/lg/xl tokens; unknown ignored
  it("maps the size prop tokens", () => {
    mount(makeSpinnerApp({ size: "lg" }), root);
    const lg = root.querySelector('[data-kumiki-tile="spinner"]') as HTMLElement;
    expect(lg.style.fontSize).toBe("1.5rem");

    root.replaceChildren();
    mount(makeSpinnerApp({ size: "sm" }), root);
    const sm = root.querySelector('[data-kumiki-tile="spinner"]') as HTMLElement;
    expect(sm.style.fontSize).toBe("0.75rem");

    root.replaceChildren();
    mount(makeSpinnerApp(), root);
    const def = root.querySelector('[data-kumiki-tile="spinner"]') as HTMLElement;
    expect(def.style.fontSize).toBe("");
  });
});

describe("overlay builtin", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
  });

  const clickToggle = (r: HTMLElement): void => {
    Array.from(r.querySelectorAll("button"))
      .find((b) => b.textContent === "toggle")
      ?.click();
  };

  it("stacks layers: base in flow, overlay absolutely positioned by align; when toggles it", () => {
    const app = makeOverlayApp();
    mount(app, root);

    const overlay = root.querySelector('[data-kumiki-tile="overlay"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.style.position).toBe("relative");
    // closed: base is present, no overlay layer yet
    expect(overlay.textContent).toContain("Base");
    expect(root.querySelector('[data-kumiki-tile="overlay-layer"]')).toBeNull();

    // open: overlay layer mounts, absolutely positioned, aligned to top
    clickToggle(root);
    const layer = root.querySelector('[data-kumiki-tile="overlay-layer"]') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.style.position).toBe("absolute");
    expect(layer.style.alignItems).toBe("flex-start"); // align "top"
    expect(layer.style.justifyContent).toBe("center");
    expect(layer.textContent).toContain("Modal");
    // base layer unaffected
    const overlay2 = root.querySelector('[data-kumiki-tile="overlay"]') as HTMLElement;
    expect(overlay2.textContent).toContain("Base");

    // close: overlay layer unmounts, base remains
    clickToggle(root);
    expect(root.querySelector('[data-kumiki-tile="overlay-layer"]')).toBeNull();
    expect(
      (root.querySelector('[data-kumiki-tile="overlay"]') as HTMLElement).textContent,
    ).toContain("Base");
  });
});

function makeMotionApp(): AppShape {
  const app: AppShape = {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    motions: {
      Spin: {
        keyframes: { from: { rotate: 0 }, to: { rotate: 360 } },
        duration: "slow",
        easing: "linear",
        iteration: "infinite",
      },
      Fade: {
        keyframes: {
          from: { opacity: 0, "translate-y": 16 },
          to: { opacity: 1, "translate-y": 0 },
        },
      },
    },
    root: () => ({
      kind: "column",
      props: {},
      children: [
        { kind: "box", props: { motion: "Spin" }, children: [{ kind: "text", text: "spin" }] },
        { kind: "card", props: { motion: "Fade" }, children: [{ kind: "text", text: "fade" }] },
      ],
    }),
  };
  return app;
}

describe("motion layer", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    document.getElementById("kumiki-motions")?.remove();
  });

  it("injects scoped @keyframes + classes from App.motions and tags the tiles", () => {
    mount(makeMotionApp(), root);
    const css = document.getElementById("kumiki-motions")?.textContent ?? "";

    // Spin: rotate 0 -> 360, slow (600ms), linear, infinite.
    expect(css).toContain("@keyframes kumiki-motion-Spin");
    expect(css).toContain("rotate(360deg)");
    expect(css).toContain("animation-duration: 600ms");
    expect(css).toContain("animation-iteration-count: infinite");
    expect(css).toContain("animation-timing-function: linear");

    // Fade: default duration (300ms), opacity + translateY transform.
    expect(css).toContain("@keyframes kumiki-motion-Fade");
    expect(css).toContain("opacity: 0");
    expect(css).toContain("translateY(16px)");

    // a11y (AC5): prefers-reduced-motion guard present.
    expect(css).toContain("prefers-reduced-motion: reduce");

    // The tiles carry both the marker class and the per-motion class.
    const spin = root.querySelector(".kumiki-motion-Spin");
    expect(spin).toBeTruthy();
    expect(spin?.classList.contains("kumiki-motion")).toBe(true);
    expect(root.querySelector(".kumiki-motion-Fade")).toBeTruthy();
  });
});

describe("in-language test runner helpers", () => {
  it("runReducerTest passes when slots + effects match", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: { count: 0 },
      result: { slots: { count: 1 }, emits: [] },
      panic: null,
      expect: { kind: "state", slots: { count: 1 }, effects: [] },
    });
    expect(r.pass).toBe(true);
  });

  it("runReducerTest reports the diff path on a slot mismatch", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: { count: 0 },
      result: { slots: { count: 1 }, emits: [] },
      panic: null,
      expect: { kind: "state", slots: { count: 2 }, effects: [] },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("slots.count");
  });

  it("runReducerTest compares emitted effect names", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: { slots: {}, emits: [{ effect: "persist", args: [] }] },
      panic: null,
      expect: { kind: "state", slots: {}, effects: [] },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("effects.length");
  });

  it("runReducerTest matches an expected panic by substring", () => {
    expect(
      _stdlib.runReducerTest({
        name: "t",
        givenSlots: {},
        result: null,
        panic: "draft cannot be empty",
        expect: { kind: "panic", message: "cannot be empty" },
      }).pass,
    ).toBe(true);
  });

  it("runTileTest compares structure, ignoring props and handlers", () => {
    const actual = {
      kind: "column",
      children: [{ kind: "button", text: "+1", props: { onClick: () => undefined } }],
    };
    const expected = { kind: "column", children: [{ kind: "button", text: "+1", props: {} }] };
    expect(_stdlib.runTileTest({ name: "t", actual, expected }).pass).toBe(true);

    const mismatch = { kind: "column", children: [{ kind: "button", text: "-1" }] };
    const res = _stdlib.runTileTest({ name: "t", actual: mismatch, expected });
    expect(res.pass).toBe(false);
    expect(res.diffAt).toContain("text");
  });

  it("runReducerTest: a bare effect name matches by name only", () => {
    expect(
      _stdlib.runReducerTest({
        name: "t",
        givenSlots: {},
        result: { slots: {}, emits: [{ effect: "persist", args: [{ x: 1 }] }] },
        panic: null,
        expect: {
          kind: "state",
          slots: {},
          effects: [{ effect: "persist", args: [], argsSpecified: false }],
        },
      }).pass,
    ).toBe(true);
  });

  it("runReducerTest: a parenthesised effect pins its args (so persist() rejects persist(x))", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: { slots: {}, emits: [{ effect: "persist", args: [1] }] },
      panic: null,
      expect: {
        kind: "state",
        slots: {},
        effects: [{ effect: "persist", args: [], argsSpecified: true }],
      },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toContain("args");
  });

  it("runReducerTest: objects with different keys are not equal (undefined-value guard)", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: { slots: { s: { a: undefined } }, emits: [] },
      panic: null,
      expect: { kind: "state", slots: { s: { b: undefined } }, effects: [] },
    });
    expect(r.pass).toBe(false);
  });

  it("runTileTest: a root kind mismatch yields a path without a leading dot", () => {
    const r = _stdlib.runTileTest({
      name: "t",
      actual: { kind: "row" },
      expected: { kind: "column" },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt?.startsWith(".")).toBe(false);
    expect(r.diffAt).toContain("kind");
  });

  it("resetLive clears, seeds defaults, then applies given", () => {
    const live: Record<string, unknown> = { stale: 1 };
    _stdlib.resetLive(live, { count: { value: 0 }, name: { value: "x" } }, { count: 5 });
    expect(live).toEqual({ count: 5, name: "x" });
  });

  // M4b: the runner carries the scalar leaf values at the divergence point, so
  // `kumiki test` can print the §8.7.1 value arrow and `fix --auto-patch` can
  // locate the responsible source literal.
  it("runTileTest exposes the leaf text values on a `.text` mismatch", () => {
    const r = _stdlib.runTileTest({
      name: "t",
      actual: { kind: "heading", text: "Cont: 5" },
      expected: { kind: "heading", text: "Count: 5" },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toContain("text");
    expect(r.leaf).toEqual({ expected: "Count: 5", actual: "Cont: 5" });
  });

  it("runReducerTest exposes the leaf slot values on a slot mismatch", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: { msg: "Helo" },
      result: { slots: { msg: "Helo" }, emits: [] },
      panic: null,
      expect: { kind: "state", slots: { msg: "Hello" }, effects: [] },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("slots.msg");
    expect(r.leaf).toEqual({ expected: "Hello", actual: "Helo" });
  });

  it("runTileTest leaves `leaf` unset for a kind mismatch (not literal-repairable)", () => {
    const r = _stdlib.runTileTest({
      name: "t",
      actual: { kind: "row" },
      expected: { kind: "column" },
    });
    expect(r.pass).toBe(false);
    expect(r.leaf).toBeUndefined();
  });

  // ----- `expect` wildcards (spec/testing.md §8.2.2) -----

  it("wildcard <any-id> matches any value at a slot position", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: { slots: { id: "9ab3-generated-uuid" }, emits: [] },
      panic: null,
      expect: { kind: "state", slots: { id: _stdlib.wild("any-id") }, effects: [] },
    });
    expect(r.pass).toBe(true);
  });

  it("wildcard <slots.X> in an effect arg matches the post-execution slot value", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: {
        slots: { todos: { a: { text: "Hi" } } },
        emits: [{ effect: "persist", args: [{ a: { text: "Hi" } }] }],
      },
      panic: null,
      expect: {
        kind: "state",
        slots: { todos: { a: { text: "Hi" } } },
        effects: [
          { effect: "persist", args: [_stdlib.wild("slot", "todos")], argsSpecified: true },
        ],
      },
    });
    expect(r.pass).toBe(true);
  });

  it("a <slots.X> effect arg fails when it does not equal the slot value", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: {
        slots: { todos: { a: 1 } },
        emits: [{ effect: "persist", args: [{ a: 2 }] }],
      },
      panic: null,
      expect: {
        kind: "state",
        slots: { todos: { a: 1 } },
        effects: [
          { effect: "persist", args: [_stdlib.wild("slot", "todos")], argsSpecified: true },
        ],
      },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toContain("args");
  });

  it("a <any-id> map key matches exactly one generated entry (value shape compared)", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: {
        slots: {
          todos: { "uuid-xyz": { id: "uuid-xyz", text: "Hello", done: false, createdAt: 1717 } },
          draft: "",
        },
        emits: [],
      },
      panic: null,
      expect: {
        kind: "state",
        slots: {
          todos: {
            [_stdlib.WILD_KEY]: {
              id: _stdlib.wild("any-id"),
              text: "Hello",
              done: false,
              createdAt: _stdlib.wild("any-id"),
            },
          },
          draft: "",
        },
        effects: [],
      },
    });
    expect(r.pass).toBe(true);
  });

  it("a <any-id> map key fails when zero entries match (AC1)", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: { slots: { todos: {} }, emits: [] },
      panic: null,
      expect: {
        kind: "state",
        slots: { todos: { [_stdlib.WILD_KEY]: { text: "Hello" } } },
        effects: [],
      },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("slots.todos");
  });

  it("a <any-id> map key fails when more than one entry is present (AC1)", () => {
    const r = _stdlib.runReducerTest({
      name: "t",
      givenSlots: {},
      result: { slots: { todos: { a: { text: "Hello" }, b: { text: "Hello" } } }, emits: [] },
      panic: null,
      expect: {
        kind: "state",
        slots: { todos: { [_stdlib.WILD_KEY]: { text: "Hello" } } },
        effects: [],
      },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("slots.todos");
  });
});

// -----effect-result mocks inside reducer-test (spec/testing.md §8.5) -----

describe("runReducerTestFlow (reducer-test effect mocks)", () => {
  // A two-step flow: `fetchUser` emits `loadUser`; its result drives `userLoaded`
  // (`.ok`) or `userFailed` (`.err`). Built as a minimal AppShape-like object.
  type FlowApp = Parameters<typeof _stdlib.runReducerTestFlow>[0]["app"];
  const makeFlowApp = (): FlowApp =>
    ({
      slots: { users: { value: {} }, error: { value: "" } },
      live: {},
      effects: { loadUser: {}, track: {} },
      reducers: [
        {
          name: "fetchUser",
          event: { kind: "ui", ev: "click" },
          apply: (_live, p) => ({
            slots: {},
            emits: [{ effect: "loadUser", args: [(p as { $el: unknown }).$el] }],
          }),
        },
        {
          name: "userLoaded",
          event: { kind: "effect", effect: "loadUser", outcome: "ok" },
          apply: (live, p) => {
            const u = (p as { $1: { id: string } }).$1;
            return {
              slots: { users: { ...(live.users as object), [u.id]: u } },
              emits: [],
            };
          },
        },
        {
          name: "userFailed",
          event: { kind: "effect", effect: "loadUser", outcome: "err" },
          apply: (_live, p) => ({ slots: { error: (p as { $1: unknown }).$1 }, emits: [] }),
        },
      ],
    }) as unknown as FlowApp;

  const run = (app: FlowApp, given: Record<string, unknown>, rest: Record<string, unknown>) => {
    _stdlib.resetLive(
      (app as unknown as { live: Record<string, unknown> }).live,
      (app as unknown as { slots: Record<string, { value: unknown }> }).slots,
      given,
    );
    return _stdlib.runReducerTestFlow({
      name: "t",
      app,
      target: "fetchUser",
      el: { id: "u1" },
      ...rest,
    } as Parameters<typeof _stdlib.runReducerTestFlow>[0]);
  };

  it("delivers a mocked `ok` result to the .ok reducer", () => {
    const r = run(
      makeFlowApp(),
      { users: {}, error: "" },
      {
        mocks: { loadUser: { outcome: "ok", value: { id: "u1", name: "Alice" } } },
        expect: {
          kind: "state",
          slots: { users: { u1: { id: "u1", name: "Alice" } }, error: "" },
          effects: [],
        },
      },
    );
    expect(r.pass).toBe(true);
  });

  it("delivers a mocked `err` result to the .err reducer", () => {
    const r = run(
      makeFlowApp(),
      { users: {}, error: "" },
      {
        mocks: { loadUser: { outcome: "err", value: "boom" } },
        expect: { kind: "state", slots: { users: {}, error: "boom" }, effects: [] },
      },
    );
    expect(r.pass).toBe(true);
  });

  it("`delay(ms, ok(v))` resolves immediately (virtualized time)", () => {
    const r = run(
      makeFlowApp(),
      { users: {}, error: "" },
      {
        mocks: { loadUser: { outcome: "ok", value: { id: "u1", name: "Z" }, delayMs: 500 } },
        expect: {
          kind: "state",
          slots: { users: { u1: { id: "u1", name: "Z" } }, error: "" },
          effects: [],
        },
      },
    );
    expect(r.pass).toBe(true);
  });

  it("a non-mocked emit is residual and asserted via expect.effects", () => {
    const r = run(
      makeFlowApp(),
      { users: {}, error: "" },
      {
        mocks: {},
        expect: {
          kind: "state",
          slots: { users: {}, error: "" },
          effects: [{ effect: "loadUser", args: [], argsSpecified: false }],
        },
      },
    );
    expect(r.pass).toBe(true);
  });

  it("a mocked `err` with no matching .err reducer fails the test (M2 contract)", () => {
    const app = makeFlowApp();
    // Drop the `.err` handler so the error is unhandled.
    (app as unknown as { reducers: { name: string }[] }).reducers = (
      app as unknown as { reducers: { name: string }[] }
    ).reducers.filter((r) => r.name !== "userFailed");
    const r = run(
      app,
      { users: {}, error: "" },
      {
        mocks: { loadUser: { outcome: "err", value: "boom" } },
        expect: { kind: "state", slots: { users: {}, error: "" }, effects: [] },
      },
    );
    expect(r.pass).toBe(false);
    expect(r.diffAt).toContain("unhandled");
  });
});

// ----- property-test generators + runner (spec/testing.md §8.3) -----

describe("runPropertyTest", () => {
  it("genValue keeps an Int within its [min, max] bounds", () => {
    const rng = (() => {
      let i = 0;
      const seq = [0, 0.25, 0.5, 0.75, 0.999];
      return () => seq[i++ % seq.length] as number;
    })();
    for (let k = 0; k < 20; k++) {
      const v = _stdlib.genValue({ t: "Int", min: 0, max: 100 }, rng) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("genValue Text honors minLen (nonempty)", () => {
    let a = 1;
    const rng = () => {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      return a / 0x7fffffff;
    };
    for (let k = 0; k < 20; k++) {
      const v = _stdlib.genValue({ t: "Text", minLen: 1, maxLen: 5 }, rng) as string;
      expect(v.length).toBeGreaterThanOrEqual(1);
      expect(v.length).toBeLessThanOrEqual(5);
    }
  });

  it("passes (and reports the case count) when the invariant always holds", () => {
    const r = _stdlib.runPropertyTest({
      name: "always",
      vars: { n: { t: "Int", min: 0, max: 10 } },
      trial: (b) => (b.n as number) >= 0,
    });
    expect(r.pass).toBe(true);
    expect(r.cases).toBe(100);
  });

  it("fails with a counterexample when the invariant is violated", () => {
    const r = _stdlib.runPropertyTest({
      name: "too-big",
      vars: { n: { t: "Int", min: 0, max: 100 } },
      trial: (b) => (b.n as number) < 5,
    });
    expect(r.pass).toBe(false);
    expect(r.actual).toContain("counterexample");
    expect(r.cases).toBeGreaterThanOrEqual(1);
  });

  it("a thrown invariant counts as a failure (not a crash)", () => {
    const r = _stdlib.runPropertyTest({
      name: "throws",
      vars: { n: { t: "Int", min: 0, max: 10 } },
      trial: () => {
        throw new Error("boom");
      },
    });
    expect(r.pass).toBe(false);
  });

  it("is deterministic — the same seed yields the same counterexample", () => {
    const mk = () =>
      _stdlib.runPropertyTest({
        name: "same",
        vars: { n: { t: "Int", min: 0, max: 100 } },
        trial: (b) => (b.n as number) < 5,
        seed: 42,
      });
    expect(mk().actual).toBe(mk().actual);
  });

  it("shrinks a failing List toward the minimal length", () => {
    const r = _stdlib.runPropertyTest({
      name: "short-list",
      vars: { xs: { t: "List", elem: { t: "Int", min: 0, max: 9 } } },
      trial: (b) => (b.xs as unknown[]).length < 3,
      seed: 7,
    });
    expect(r.pass).toBe(false);
    // Shrinking drops elements until removing one more would pass: minimal len 3.
    const m = JSON.parse((r.actual ?? "").replace(/^.*?(\{.*\})$/, "$1")) as { xs: unknown[] };
    expect(m.xs.length).toBe(3);
  });
});

describe("stdlib collection methods (issue #5)", () => {
  it("listChunk splits into n-sized chunks; last may be shorter", () => {
    expect(_stdlib.listChunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(_stdlib.listChunk([], 2)).toEqual([]);
  });

  it("listZip pairs elements up to the shorter length", () => {
    expect(_stdlib.listZip([1, 2, 3], ["a", "b"])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });

  it("mapUpdate applies fn to an existing key, no-op when absent", () => {
    expect(_stdlib.mapUpdate({ a: 1 }, "a", (v) => (v as number) + 1)).toEqual({ a: 2 });
    expect(_stdlib.mapUpdate({ a: 1 }, "b", (v) => (v as number) + 1)).toEqual({ a: 1 });
  });

  it("setAdd / setUnion / setIntersect / setDiff", () => {
    expect(_stdlib.setAdd({}, "x")).toEqual({ x: true });
    expect(_stdlib.setUnion({ a: true }, { b: true })).toEqual({ a: true, b: true });
    expect(_stdlib.setIntersect({ a: true, b: true }, { b: true, c: true })).toEqual({ b: true });
    expect(_stdlib.setDiff({ a: true, b: true }, { b: true })).toEqual({ a: true });
  });

  it("or returns the receiver when Some/Ok, else other", () => {
    expect(_stdlib.or(_stdlib.Some(1), _stdlib.Some(2))).toEqual(_stdlib.Some(1));
    expect(_stdlib.or(_stdlib.None, _stdlib.Some(2))).toEqual(_stdlib.Some(2));
    expect(_stdlib.or(_stdlib.Ok(1), _stdlib.Ok(2))).toEqual(_stdlib.Ok(1));
    expect(_stdlib.or(_stdlib.Err("e"), _stdlib.Ok(2))).toEqual(_stdlib.Ok(2));
  });

  it("mapErr maps the Err payload, passes Ok through", () => {
    expect(_stdlib.mapErr(_stdlib.Err("x"), (e) => `${e}!`)).toEqual(_stdlib.Err("x!"));
    expect(_stdlib.mapErr(_stdlib.Ok(1), (e) => `${e}!`)).toEqual(_stdlib.Ok(1));
  });

  it("diff is numeric for Time/Duration and set-difference for Sets", () => {
    expect(_stdlib.diff(10, 3)).toBe(7);
    expect(_stdlib.diff(3, 10)).toBe(7);
    expect(_stdlib.diff({ a: true, b: true }, { b: true })).toEqual({ a: true });
  });
});

describe("stdlib argument-less methods (issue #7)", () => {
  it("listHead / listLast return Option; empty → None", () => {
    expect(_stdlib.listHead([1, 2, 3])).toEqual(_stdlib.Some(1));
    expect(_stdlib.listLast([1, 2, 3])).toEqual(_stdlib.Some(3));
    expect(_stdlib.listHead([])).toEqual(_stdlib.None);
    expect(_stdlib.listLast([])).toEqual(_stdlib.None);
    expect(_stdlib.listHead(null)).toEqual(_stdlib.None);
  });

  it("listTail drops the first element (empty stays empty)", () => {
    expect(_stdlib.listTail([1, 2, 3])).toEqual([2, 3]);
    expect(_stdlib.listTail([1])).toEqual([]);
    expect(_stdlib.listTail([])).toEqual([]);
    expect(_stdlib.listTail(null)).toEqual([]);
  });

  it("toList: Option → [v]/[], Set object → keys, array → fresh copy (no aliasing)", () => {
    expect(_stdlib.toList(_stdlib.Some(7))).toEqual([7]);
    expect(_stdlib.toList(_stdlib.None)).toEqual([]);
    expect(_stdlib.toList({ a: true, b: true })).toEqual(["a", "b"]);
    const src = [1, 2];
    const out = _stdlib.toList(src);
    expect(out).toEqual([1, 2]);
    expect(out).not.toBe(src); // copy, not the same reference
  });

  it("toOption: Ok → Some, Err → None", () => {
    expect(_stdlib.toOption(_stdlib.Ok(5))).toEqual(_stdlib.Some(5));
    expect(_stdlib.toOption(_stdlib.Err("boom"))).toEqual(_stdlib.None);
  });

  it("getErr returns the Err payload and panics (KumikiPanic) on Ok", () => {
    expect(_stdlib.getErr(_stdlib.Err("boom"))).toBe("boom");
    expect(() => _stdlib.getErr(_stdlib.Ok(1))).toThrow(KumikiPanic);
  });

  // M1 (#24): `.get` is the polymorphic unwrap for Option AND Result; spec
  // stdlib.md §2.2 says it panics on the empty case (None / Err). Before M1 it
  // returned the value unchanged (silent), so `.get` and `.get-err` behaved
  // oppositely. Now both panic via KumikiPanic.
  it("unwrap (.get) unwraps Some/Ok and panics on None/Err", () => {
    expect(_stdlib.unwrap(_stdlib.Some(5))).toBe(5);
    expect(_stdlib.unwrap(_stdlib.Ok(7))).toBe(7);
    expect(() => _stdlib.unwrap(_stdlib.None)).toThrow(KumikiPanic);
    expect(() => _stdlib.unwrap(_stdlib.Err("x"))).toThrow(KumikiPanic);
    // A plain (non-variant) value passes through unchanged.
    expect(_stdlib.unwrap(42)).toBe(42);
  });

  it("panic(msg) raises a KumikiPanic carrying the message", () => {
    expect(() => _stdlib.panic("boom")).toThrow(KumikiPanic);
    expect(() => _stdlib.panic("boom")).toThrow("boom");
  });

  it("parseIntOpt / parseFloatOpt return Option, None on non-numeric", () => {
    expect(_stdlib.parseIntOpt("42")).toEqual(_stdlib.Some(42));
    expect(_stdlib.parseIntOpt("3.7")).toEqual(_stdlib.Some(3)); // truncated
    expect(_stdlib.parseIntOpt("x")).toEqual(_stdlib.None);
    expect(_stdlib.parseIntOpt("")).toEqual(_stdlib.None);
    expect(_stdlib.parseFloatOpt("3.5")).toEqual(_stdlib.Some(3.5));
    expect(_stdlib.parseFloatOpt("nope")).toEqual(_stdlib.None);
  });
});

// M1 (#24): a panic on the LIVE path must be handled cleanly — caught, the
// dispatch episode rolled back (no partial writes), surfaced via console.error
// (so smoke/scenario flag it), and the app left interactive (a later dispatch
// still works). Before M1 the panic escaped the DOM event handler uncaught.
//
//  - `boom`     panics inside its reducer body (via _stdlib.panic).
//  - `ok`       is a normal reducer that still works after a panic.
//  - `onError`  is the spec §7.2.3 `app.error` reducer; it records the message
//               of the PanicInfo delivered as `$event`.
function makePanicApp(): AppShape {
  const app: AppShape = {
    slots: { n: { value: 0 }, lastError: { value: "" } },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "boom",
        selector: { tile: "BoomBtn" },
        event: { kind: "ui", ev: "click" },
        apply: () => {
          _stdlib.panic("boom in reducer");
          return { slots: { n: 99 }, emits: [] };
        },
      },
      {
        name: "ok",
        selector: { tile: "OkBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { n: (live.n as number) + 1 }, emits: [] }),
      },
      {
        name: "onError",
        event: { kind: "lifecycle", name: "app.error" },
        apply: (_live, payload) => ({
          slots: { lastError: (payload.$event as { message: string }).message },
          emits: [],
        }),
      },
    ],
    root: () => ({ kind: "column", children: [{ kind: "heading", text: "panic-app" }] }),
  };
  return app;
}

// A root tile that panics during render with NO enclosing error-boundary — the
// top-level render boundary must catch it (render a panic node, not throw).
function makeRenderPanicApp(): AppShape {
  const app: AppShape = {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => {
      _stdlib.panic("render boom");
      return { kind: "column", children: [] };
    },
  };
  return app;
}

describe("live panic handling (#24)", () => {
  let root: HTMLElement;
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    root.remove();
  });

  const dispatch = (app: AppShape, name: string): void =>
    (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
      name,
      {},
    );
  const n = (app: AppShape): unknown => (app.live as Record<string, unknown>).n;

  it("a reducer panic does not escape the dispatch and rolls back the episode", () => {
    const app = makePanicApp();
    mount(app, root);
    // The panicking dispatch must NOT throw out of the handler...
    expect(() => dispatch(app, "boom")).not.toThrow();
    // ...and must leave the slot at its pre-dispatch value (no partial write).
    expect(n(app)).toBe(0);
    // ...and the panic is surfaced (so smoke/scenario flag it).
    expect(errSpy).toHaveBeenCalled();
  });

  it("the app stays interactive after a reducer panic (recoverable, not bricked)", () => {
    const app = makePanicApp();
    mount(app, root);
    dispatch(app, "boom");
    dispatch(app, "ok");
    expect(n(app)).toBe(1); // a normal reducer still runs after a panic
  });

  it("a reducer panic fires the app.error reducer with PanicInfo ($event)", () => {
    const app = makePanicApp();
    mount(app, root);
    dispatch(app, "boom");
    // spec §7.2.3: app.error receives the PanicInfo, whose .message is the panic.
    expect((app.live as Record<string, unknown>).lastError).toBe("boom in reducer");
  });

  it("a render panic with no error-boundary is caught by the top-level boundary", () => {
    const app = makeRenderPanicApp();
    // mount → render must not throw; it renders a panic fallback instead.
    expect(() => mount(app, root)).not.toThrow();
    expect(root.textContent ?? "").toContain("render boom");
    expect(errSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Capability providers (inbound ecosystem seam): a custom capability has no
// built-in implementation, so the host supplies one via mount(..., {providers}).
// The generated effect invoke resolves it at the capability boundary
// (caps.provider(cap)) and errors clearly when none is registered.
// ---------------------------------------------------------------------------

import type { CapabilityProvider, EffectResult } from "@kumikijs/runtime";

const CAP = "telemetry.track";

// Mirrors exactly what codegen emits for a custom-capability effect, so this
// test pins the runtime contract the generated code relies on.
function makeTrackApp(): AppShape {
  const app: AppShape = {
    slots: { sent: { value: 0 }, failed: { value: false } },
    caps: [CAP],
    effects: {
      track: {
        name: "track",
        cap: CAP,
        invoke: async (input, caps) => {
          const p = caps.provider(CAP);
          if (!p) {
            return { kind: "err", value: { message: `Capability "${CAP}" has no provider` } };
          }
          return p(input, caps);
        },
      },
    },
    init: [],
    reducers: [
      {
        name: "fire",
        selector: { tile: "B" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "track", args: [{ name: "click" }] }] }),
      },
      {
        name: "onSent",
        event: { kind: "effect", effect: "track", outcome: "ok" },
        apply: (live) => ({ slots: { sent: (live.sent as number) + 1 }, emits: [] }),
      },
      {
        name: "onFail",
        event: { kind: "effect", effect: "track", outcome: "err" },
        apply: () => ({ slots: { failed: true }, emits: [] }),
      },
    ],
    root: () => ({ kind: "column", children: [] }),
  };
  return app;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("capability providers", () => {
  let root: HTMLElement;
  const fire = (app: AppShape): void =>
    (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
      "fire",
      {},
    );
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("calls a registered provider and flows its ok result into the reducer (AC2)", async () => {
    const app = makeTrackApp();
    const seen: unknown[] = [];
    const provider: CapabilityProvider = async (input) => {
      seen.push(input);
      return { kind: "ok", value: null };
    };
    mount(app, root, { providers: { [CAP]: provider } });
    fire(app);
    await tick();
    expect(seen).toEqual([{ name: "click" }]);
    expect((app.live as Record<string, unknown>).sent).toBe(1);
    expect((app.live as Record<string, unknown>).failed).toBe(false);
  });

  it("errs clearly when the custom capability has no provider (AC3)", async () => {
    const app = makeTrackApp();
    mount(app, root); // no providers
    fire(app);
    await tick();
    expect((app.live as Record<string, unknown>).sent).toBe(0);
    expect((app.live as Record<string, unknown>).failed).toBe(true);
  });

  it("normalizes a synchronously-returned provider value (AC5)", async () => {
    const app = makeTrackApp();
    // A provider may return a plain (non-promise) EffectResult.
    const provider: CapabilityProvider = (): EffectResult => ({ kind: "ok", value: null });
    mount(app, root, { providers: { [CAP]: provider } });
    fire(app);
    await tick();
    expect((app.live as Record<string, unknown>).sent).toBe(1);
  });

  it("normalizes a throwing provider into an err outcome (AC5)", async () => {
    const app = makeTrackApp();
    const provider: CapabilityProvider = () => {
      throw new Error("boom");
    };
    mount(app, root, { providers: { [CAP]: provider } });
    fire(app);
    await tick();
    expect((app.live as Record<string, unknown>).failed).toBe(true);
    expect((app.live as Record<string, unknown>).sent).toBe(0);
  });

  it("does not invoke the provider when the capability is not declared (AC6)", async () => {
    const app = makeTrackApp();
    app.caps = []; // telemetry.track no longer declared
    let called = false;
    const provider: CapabilityProvider = async () => {
      called = true;
      return { kind: "ok", value: null };
    };
    mount(app, root, { providers: { [CAP]: provider } });
    fire(app);
    await tick();
    expect(called).toBe(false);
    expect((app.live as Record<string, unknown>).sent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No-silent-failure contract: an effect `err` result that no
// `.err` reducer consumes must be surfaced (console.error → smoke/runScenario
// flag it), never swallowed. The storage-unavailable case (sandbox / private
// mode) otherwise looks like the app does nothing. An app opts into ignoring an
// error by wiring an `.err` reducer.
// ---------------------------------------------------------------------------

// A custom-cap effect with no provider always returns `err` (mirrors
// makeTrackApp). `withErrReducer` toggles whether the program handles it.
function makeErringApp(withErrReducer: boolean): AppShape {
  const cap = "telemetry.track";
  const reducers: AppShape["reducers"] = [
    {
      name: "fire",
      selector: { tile: "B" },
      event: { kind: "ui", ev: "click" },
      apply: () => ({ slots: {}, emits: [{ effect: "track", args: [{ name: "click" }] }] }),
    },
  ];
  if (withErrReducer) {
    reducers.push({
      name: "onFail",
      event: { kind: "effect", effect: "track", outcome: "err" },
      apply: () => ({ slots: { failed: true }, emits: [] }),
    });
  }
  return {
    slots: { failed: { value: false } },
    caps: [cap],
    effects: {
      track: {
        name: "track",
        cap,
        invoke: async (input, caps) => {
          const p = caps.provider(cap);
          if (!p) return { kind: "err", value: { message: "no provider" } };
          return p(input, caps);
        },
      },
    },
    init: [],
    reducers,
    root: () => ({ kind: "column", children: [] }),
  };
}

describe("unhandled effect-error contract (#37)", () => {
  let root: HTMLElement;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const fire = (app: AppShape): void =>
    (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
      "fire",
      {},
    );
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    document.body.removeChild(root);
  });

  it("surfaces an err result with no .err reducer via console.error (AC1)", async () => {
    const app = makeErringApp(false);
    mount(app, root); // no provider → effect errs
    fire(app);
    await tick();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('effect "track" returned an error');
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("no .err reducer");
  });

  it("stays silent when an .err reducer handles the error (AC3)", async () => {
    const app = makeErringApp(true);
    mount(app, root);
    fire(app);
    await tick();
    expect((app.live as Record<string, unknown>).failed).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("a storage backend that throws yields err — surfaced when unhandled (AC3)", async () => {
    // Simulate an unavailable localStorage (opaque-origin sandbox / private mode).
    const result = await builtinEffects.storageRead({ key: "x" });
    void result; // storage is available in happy-dom; assert the contract shape below.
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true });
    try {
      const r = await builtinEffects.storageRead({ key: "x" });
      expect(r.kind).toBe("err");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: orig, configurable: true });
    }
  });

  it("session backend follows the same unavailable-→-err contract as storage (#84, #37)", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    const orig = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", { value: throwing, configurable: true });
    try {
      const r = await builtinEffects.sessionRead({ key: "x" });
      expect(r.kind).toBe("err");
      const w = await builtinEffects.sessionWrite({ key: "x", value: 1 });
      expect(w.kind).toBe("err");
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", { value: orig, configurable: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Memory router mode: routing must work without the
// ambient location/history — for the playground srcdoc sandbox and any embedded
// host that owns the URL. mount(..., { router: "memory" }) holds the path in
// memory and never calls history.*.
// ---------------------------------------------------------------------------

function makeRoutedApp(): AppShape {
  const app: AppShape = {
    slots: {},
    caps: ["nav.push"],
    effects: {},
    init: [],
    reducers: [],
    routes: [
      { pattern: "/", tile: () => ({ kind: "text", text: "home", props: {} }) },
      {
        pattern: "/items/:id",
        tile: () => ({
          kind: "text",
          text: `item ${(app.live?.route as { params?: Record<string, string> })?.params?.id ?? "?"}`,
          props: {},
        }),
      },
      { pattern: "/404", tile: () => ({ kind: "text", text: "not found", props: {} }) },
    ],
    root: () => ({ kind: "text", text: "", props: {} }),
  };
  return app;
}

describe("memory router mode (#36)", () => {
  let root: HTMLElement;
  const navigate = (app: AppShape, path: string): void =>
    (app as unknown as { _navigate: (p: string, r?: boolean) => void })._navigate(path);
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("initialises at the virtual path, not location.pathname (AC1)", () => {
    const app = makeRoutedApp();
    // A non-root initial path proves the route comes from the virtual location,
    // independent of the test DOM's ambient location (which is "/").
    const { dispose } = mount(app, root, { router: "memory", initialPath: "/items/99" });
    expect(root.textContent).toBe("item 99");
    expect((app.live?.route as { pattern: string }).pattern).toBe("/items/:id");
    dispose();
  });

  it("defaults memory to / and resolves a real route, not /404 (AC1)", () => {
    const app = makeRoutedApp();
    const { dispose } = mount(app, root, { router: "memory" });
    expect(root.textContent).toBe("home");
    dispose();
  });

  it("navigates via internal state, keeping path params, without touching history (AC2)", () => {
    const pushSpy = vi.spyOn(history, "pushState");
    const app = makeRoutedApp();
    const { dispose } = mount(app, root, { router: "memory" });
    navigate(app, "/items/42");
    expect(root.textContent).toBe("item 42");
    expect((app.live?.route as { params: Record<string, string> }).params.id).toBe("42");
    expect(pushSpy).not.toHaveBeenCalled();
    dispose();
    pushSpy.mockRestore();
  });

  it("history mode stays the default and drives the real history API (AC3)", () => {
    const pushSpy = vi.spyOn(history, "pushState");
    const app = makeRoutedApp();
    const { dispose } = mount(app, root); // default → history
    navigate(app, "/items/7");
    expect(root.textContent).toBe("item 7");
    expect(pushSpy).toHaveBeenCalled();
    dispose();
    pushSpy.mockRestore();
    history.replaceState(null, "", "/");
  });
});

// ---------------------------------------------------------------------------
// Standard capabilities (toast/nav/log + http/storage) are also provider-
// overridable: a host can swap the implementation (custom toast UI, router,
// HTTP transport, auth injection) by registering a provider for the cap. Absent
// one, the built-in behavior runs.
// ---------------------------------------------------------------------------

function makeBuiltinApp(): AppShape {
  return {
    slots: { ok: { value: false } },
    caps: ["notification.show", "nav.push"],
    effects: {},
    init: [],
    reducers: [
      {
        name: "doToast",
        selector: { tile: "B" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({
          slots: {},
          emits: [{ effect: "toast", args: [{ kind: "info", text: "hi-toast" }] }],
        }),
      },
      {
        name: "doNav",
        selector: { tile: "B" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({
          slots: {},
          emits: [{ effect: "navigate", args: [{ path: "/elsewhere" }] }],
        }),
      },
    ],
    root: () => ({ kind: "column", children: [] }),
  };
}

describe("standard capability override", () => {
  let root: HTMLElement;
  const fireB = (app: AppShape, name: string): void => (app as AppLive)._dispatch?.(name, {});
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("routes a built-in toast to a host provider when registered (no default banner)", async () => {
    const app = makeBuiltinApp();
    const seen: unknown[] = [];
    mount(app, root, {
      providers: {
        "notification.show": async (input) => {
          seen.push(input);
          return { kind: "ok", value: null };
        },
      },
    });
    fireB(app, "doToast");
    await tick();
    expect(seen).toEqual([{ kind: "info", text: "hi-toast" }]);
    // the built-in fixed banner must NOT have been created
    expect(document.body.textContent ?? "").not.toContain("hi-toast");
  });

  it("falls back to the built-in toast when no provider is registered", async () => {
    const app = makeBuiltinApp();
    mount(app, root); // no providers
    fireB(app, "doToast");
    await tick();
    const banner = Array.from(document.body.querySelectorAll("div")).find((d) =>
      (d.textContent ?? "").includes("hi-toast"),
    );
    expect(banner).toBeTruthy();
    banner?.remove();
  });

  it("routes built-in navigation to a host provider (router integration)", async () => {
    const app = makeBuiltinApp();
    const seen: unknown[] = [];
    const before = location.pathname;
    mount(app, root, {
      providers: {
        "nav.push": async (input) => {
          seen.push(input);
          return { kind: "ok", value: null };
        },
      },
    });
    fireB(app, "doNav");
    await tick();
    expect(seen).toEqual([{ path: "/elsewhere" }]);
    expect(location.pathname).toBe(before); // built-in history navigation was not run
  });
});
