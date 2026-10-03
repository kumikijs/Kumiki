// `route` is the runtime's slot, not the program's: a `.kumiki` file cannot
// declare it, and `mount` seeds it when the slot table has none. The test
// harness rebuilt its slot table from the declared slots and `given` alone, so
// the slot was absent and any reducer reading `route.path` panicked under
// `kumiki test` — a reducer that works in the app with no way to write a
// passing test for it.
//
// `resetLive` is the one seam all three test kinds go through (reducer-test,
// its multi-step form, tile-test) plus `run-reducer` inside a property test,
// so the parity with `mount` is asserted here.

import { _stdlib } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const DECLARED = { seen: { value: "" } };

function reset(given: Record<string, unknown>): Record<string, unknown> {
  const live: Record<string, unknown> = {};
  _stdlib.resetLive(live, DECLARED, given);
  return live;
}

describe("the harness seeds the route slot the way mount does", () => {
  it("supplies the empty route when the test names none", () => {
    expect(reset({})).toEqual({
      seen: "",
      route: { path: "/", pattern: "/", params: {}, query: {}, hash: { _tag: "None" } },
    });
  });

  it("lets given.slots replace it", () => {
    const route = {
      path: "/posts/7",
      pattern: "/posts/:id",
      params: { id: "7" },
      query: {},
      hash: { _tag: "None" },
    };
    expect(reset({ route })).toMatchObject({ route });
  });

  it("fills the fields a partial route leaves out", () => {
    // Naming every field to change one is the kind of ceremony that gets
    // abbreviated, and an abbreviation that produced `params: undefined` would
    // reintroduce the panic this exists to remove.
    expect(reset({ route: { path: "/posts/7", pattern: "/posts/:id" } })).toMatchObject({
      route: {
        path: "/posts/7",
        pattern: "/posts/:id",
        params: {},
        query: {},
        hash: { _tag: "None" },
      },
    });
  });

  it("leaves a route the program declared itself alone", () => {
    // Not reachable from `.kumiki` — `route` is a reserved slot name — but the
    // shape is host-buildable, and the seed is "when absent", not "always".
    const declared = { route: { value: { path: "/declared" } } };
    const live: Record<string, unknown> = {};
    _stdlib.resetLive(live, declared, {});
    expect(live.route).toEqual({ path: "/declared" });
  });

  it("clears a previous test's leftovers before seeding", () => {
    const live: Record<string, unknown> = { stale: 1, route: { path: "/old" } };
    _stdlib.resetLive(live, DECLARED, {});
    expect(live.stale).toBeUndefined();
    expect(live.route).toMatchObject({ path: "/" });
  });
});

describe("a run-reducer chain", () => {
  const app = {
    live: {} as Record<string, unknown>,
    slots: { seen: { value: "" } },
    reducers: [
      {
        name: "record",
        event: { kind: "ui" as const, ev: "click" as const },
        apply: (live: Record<string, unknown>) => ({
          slots: { seen: (live.route as { path: string }).path },
          emits: [],
        }),
      },
    ],
  };

  it("reads the route in the first step and in every step after it", () => {
    // Step two starts from step one's output, so the seed has to survive the
    // hand-off rather than only being present on the first apply.
    const first = _stdlib.runReducerStep(
      app,
      { slots: { route: { path: "/posts/7", pattern: "/posts/:id" } } },
      "record",
      {},
    );
    expect(first.slots.seen).toBe("/posts/7");
    const second = _stdlib.runReducerStep(app, first, "record", {});
    expect(second.slots.seen).toBe("/posts/7");
  });
});
