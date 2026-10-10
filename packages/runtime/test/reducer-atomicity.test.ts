import type { AppShape, ReducerSpec } from "@kumikijs/runtime";
import { _stdlib, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp, mountApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";

/** `count` is capped at 3; `mirror` and `log` are unconstrained bystanders. */
function makeApp(overrides: Partial<AppShape> = {}): AppShape {
  return bareApp({
    slots: {
      count: {
        value: 0,
        refine: (v) => typeof v === "number" && v >= 0 && v <= 3,
        refineKind: "between",
        refineArgs: [0, 3],
      },
      mirror: { value: 0 },
      log: { value: "" },
      trace: { value: "", volatile: true },
    },
    root: () => ({ kind: "text", text: "app" }),
    ...overrides,
  });
}

let errors: string[];

beforeEach(() => {
  errors = captureConsole("error");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a reducer batch commits all-or-nothing", () => {
  it("does not write the passing slots of a batch whose refined slot is rejected", () => {
    const app = mountApp(
      makeApp({
        reducers: [
          {
            name: "bump",
            event: { kind: "ui", ev: "click" },
            apply: (live) => ({
              slots: { count: (live.count as number) + 1, log: `${live.log}!` },
              emits: [],
            }),
          },
        ],
      }),
    );

    for (let i = 0; i < 3; i++) app._dispatch("bump", {});
    expect(app.live.count).toBe(3);
    expect(app.live.log).toBe("!!!");

    // The fourth bump takes `count` to 4, which `between(0, 3)` rejects. The
    // sibling write must not land either — half a reducer is not a reducer.
    app._dispatch("bump", {});
    expect(app.live.count).toBe(3);
    expect(app.live.log).toBe("!!!");
  });

  it("keeps a rejected value from reaching a slot that reads it later in the body", () => {
    const app = mountApp(
      makeApp({
        reducers: [
          {
            name: "bump",
            event: { kind: "ui", ev: "click" },
            // The emitted body reads `_next` first, so `mirror` sees the value
            // `count` was just assigned — including the one it cannot hold.
            apply: (live) => {
              const next = (live.count as number) + 1;
              return { slots: { count: next, mirror: next }, emits: [] };
            },
          },
        ],
      }),
    );

    for (let i = 0; i < 4; i++) app._dispatch("bump", {});
    expect(app.live.count).toBe(3);
    // 4 never existed in `count`; it must not be permanent in `mirror`.
    expect(app.live.mirror).toBe(3);
  });

  it("drops the batch's emits too", async () => {
    const emitted: string[] = [];
    const app = mountApp(
      makeApp({
        caps: ["http.get"],
        effects: {
          record: {
            name: "record",
            cap: "http.get",
            invoke: (input: unknown) => {
              emitted.push(String(input));
              return Promise.resolve({ kind: "ok", value: null } as const);
            },
          },
        },
        reducers: [
          {
            name: "bump",
            event: { kind: "ui", ev: "click" },
            apply: (live) => ({
              slots: { count: (live.count as number) + 1 },
              emits: [{ effect: "record", args: ["fired"] }],
            }),
          },
        ],
      }),
    );

    app._dispatch("bump", {});
    await Promise.resolve();
    expect(emitted).toEqual(["fired"]);

    for (let i = 0; i < 3; i++) app._dispatch("bump", {});
    await Promise.resolve();
    // Three more dispatches, only two of which could commit: the batch that
    // overflows must not reach the dispatcher at all.
    expect(emitted).toEqual(["fired", "fired", "fired"]);
  });

  it("does not run the batch's stop-timer", () => {
    vi.useFakeTimers();
    try {
      const app = mountApp(
        makeApp({
          reducers: [
            {
              name: "tick",
              event: { kind: "timer", intervalMs: 10, name: "ticker" },
              apply: (live) => ({ slots: { mirror: (live.mirror as number) + 1 }, emits: [] }),
            },
            {
              name: "halt",
              event: { kind: "ui", ev: "click" },
              apply: (live) => ({
                slots: { count: (live.count as number) + 4 },
                emits: [],
                stopTimers: ["ticker"],
              }),
            },
          ],
        }),
      );

      vi.advanceTimersByTime(20);
      expect(app.live.mirror).toBe(2);

      // `count + 4` overflows on the first dispatch, so the whole batch —
      // including the stop-timer — is void and the interval keeps running.
      app._dispatch("halt", {});
      vi.advanceTimersByTime(20);
      expect(app.live.mirror).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not write a volatile slot from a rejected batch", () => {
    const app = mountApp(
      makeApp({
        reducers: [
          {
            name: "bump",
            event: { kind: "ui", ev: "click" },
            apply: (live) => ({
              slots: { count: (live.count as number) + 1, trace: `${live.trace}.` },
              emits: [],
            }),
          },
        ],
      }),
    );

    for (let i = 0; i < 4; i++) app._dispatch("bump", {});
    // `volatile` only excludes a slot from diffs and the episode log; it is
    // still part of the batch and rolls back with it.
    expect(app.live.trace).toBe("...");
  });
});

describe("a rejected batch is reported, never silent", () => {
  it("names the reducer, the slot, the value and the predicate", () => {
    const app = mountApp(
      makeApp({
        reducers: [
          {
            name: "bump",
            event: { kind: "ui", ev: "click" },
            apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
          },
        ],
      }),
    );

    for (let i = 0; i < 3; i++) app._dispatch("bump", {});
    expect(errors).toEqual([]);

    app._dispatch("bump", {});
    expect(errors).toEqual([
      '[kumiki] reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3)). No slot was written and no effect was emitted.',
    ]);
  });

  it("reports every rejected slot in the batch, not just the first", () => {
    const app = mountApp(
      makeApp({
        slots: {
          count: {
            value: 0,
            refine: (v) => typeof v === "number" && v <= 3,
            refineKind: "between",
            refineArgs: [0, 3],
          },
          name: { value: "ok", refine: (v) => v !== "", refineKind: "nonempty", refineArgs: [] },
        },
        reducers: [
          {
            name: "wipe",
            event: { kind: "ui", ev: "click" },
            apply: () => ({ slots: { count: 9, name: "" }, emits: [] }),
          },
        ],
      }),
    );

    app._dispatch("wipe", {});
    expect(errors).toEqual([
      '[kumiki] reducer "wipe" was rejected: slot "count" cannot hold 9 (between(0, 3)), slot "name" cannot hold "" (nonempty). No slot was written and no effect was emitted.',
    ]);
  });

  it("falls back to a bare description when the slot carries no predicate name", () => {
    const app = mountApp(
      makeApp({
        slots: { count: { value: 0, refine: (v) => v === 0 } },
        reducers: [
          {
            name: "bump",
            event: { kind: "ui", ev: "click" },
            apply: () => ({ slots: { count: 1 }, emits: [] }),
          },
        ],
      }),
    );

    app._dispatch("bump", {});
    expect(errors).toEqual([
      '[kumiki] reducer "bump" was rejected: slot "count" cannot hold 1 (its refinement). No slot was written and no effect was emitted.',
    ]);
  });
});

describe("every tier applies the same rule", () => {
  const overflow = (name: string): ReducerSpec => ({
    name,
    event: { kind: "ui", ev: "click" },
    apply: (live) => ({
      slots: { count: (live.count as number) + 4, log: "written" },
      emits: [],
    }),
  });

  it("refuses the batch on the SSR pass, and does not chain its emits", async () => {
    const followUps: string[] = [];
    const app = makeApp({
      caps: ["http.get"],
      effects: {
        boot: {
          name: "boot",
          cap: "http.get",
          invoke: () => Promise.resolve({ kind: "ok", value: null } as const),
        },
        // A distinct effect, so a regression shows up as one extra invoke
        // rather than as a self-feeding boot → booted → boot loop.
        audit: {
          name: "audit",
          cap: "http.get",
          invoke: () => {
            followUps.push("audit");
            return Promise.resolve({ kind: "ok", value: null } as const);
          },
        },
      },
      init: [{ effect: "boot", args: [{}] }],
      reducers: [
        {
          name: "booted",
          event: { kind: "effect", effect: "boot", outcome: "ok" },
          apply: () => ({
            slots: { count: 9, log: "written" },
            emits: [{ effect: "audit", args: [{}] }],
          }),
        },
      ],
    });

    const { snapshot } = await renderToString(app, { route: "/" });

    expect(snapshot.slots.count).toBe(0);
    expect(snapshot.slots.log).toBe("");
    expect(followUps).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('reducer "booted" was rejected');
    expect(errors[0]).not.toContain("no .err reducer");
  });

  it("refuses the batch during episode replay", () => {
    const app = {
      live: { count: 0, log: "" } as Record<string, unknown>,
      slots: makeApp().slots,
      reducers: [overflow("bump")],
      effects: {},
    };
    const result = _stdlib.runEpisodeTest({
      name: "replay",
      app,
      episodes: [
        {
          id: "e1",
          trigger: { kind: "ui", target: "Btn" },
          steps: [{ kind: "reducer", name: "bump" }],
          status: "completed",
        },
      ],
      mocks: {},
      expect: { slotsEqual: { count: 0, log: "" } },
    });

    expect(result.pass).toBe(true);
    expect(errors.some((e) => e.includes('reducer "bump" was rejected'))).toBe(true);
  });

  it("refuses the batch in a mocked reducer-test, and drops its emits", () => {
    const app = {
      live: { count: 0, log: "" } as Record<string, unknown>,
      slots: makeApp().slots,
      reducers: [
        {
          name: "bump",
          event: { kind: "ui", ev: "click" },
          apply: (live: Record<string, unknown>) => ({
            slots: { count: (live.count as number) + 4 },
            emits: [{ effect: "persist", args: [] }],
          }),
        } as ReducerSpec,
      ],
      effects: {},
    };
    const result = _stdlib.runReducerTestFlow({
      name: "t",
      app,
      target: "bump",
      el: {},
      mocks: {},
      // `effects: []` is the assertion: the emit must not survive as residual.
      expect: { kind: "state", slots: { count: 0 }, effects: [] },
    });

    expect(result.pass).toBe(true);
    expect(errors.some((e) => e.includes('reducer "bump" was rejected'))).toBe(true);
  });

  it("refuses the batch in a property-test's run-reducer step, failing the trial", () => {
    const app = {
      live: { count: 0, log: "" } as Record<string, unknown>,
      slots: makeApp().slots,
      reducers: [overflow("bump")],
      effects: {},
    };
    expect(() => _stdlib.runReducerStep(app, { slots: { count: 0, log: "" } }, "bump", {})).toThrow(
      'reducer "bump" was rejected: slot "count" cannot hold 4 (between(0, 3))',
    );
    expect(errors.some((e) => e.includes("was rejected"))).toBe(false);
  });
});

describe("the paths a batch rejection must not change", () => {
  it("leaves two-way bind rejecting per field, quietly", () => {
    const app = mountApp(makeApp());

    app._setSlot("count", 2);
    expect(app.live.count).toBe(2);

    app._setSlot("count", 9);
    expect(app.live.count).toBe(2);
    expect(errors).toEqual([]);
  });

  it("still commits a batch whose values all pass", () => {
    const app = mountApp(
      makeApp({
        reducers: [
          {
            name: "set",
            event: { kind: "ui", ev: "click" },
            apply: () => ({ slots: { count: 3, mirror: 3, log: "done" }, emits: [] }),
          },
        ],
      }),
    );

    app._dispatch("set", {});
    expect(app.live.count).toBe(3);
    expect(app.live.mirror).toBe(3);
    expect(app.live.log).toBe("done");
    expect(errors).toEqual([]);
  });
});
