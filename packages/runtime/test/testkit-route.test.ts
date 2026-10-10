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
