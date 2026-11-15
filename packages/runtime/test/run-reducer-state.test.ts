import type { ReducerSpec } from "@kumikijs/runtime";
import { _stdlib, emptyRoute } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

/** `inc` writes `count` only; `label` is the bystander no step seeds or writes. */
function makeApp() {
  const inc: ReducerSpec = {
    name: "inc",
    event: { kind: "ui", ev: "click" },
    apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
  };
  return {
    live: {} as Record<string, unknown>,
    slots: { count: { value: 0 }, label: { value: "x" } },
    reducers: [inc],
  };
}

describe("the state run-reducer answers", () => {
  it.each([
    {
      when: "the test gives a slot the reducer writes",
      given: { slots: { count: 3 } },
      answer: { count: 4, label: "x", route: emptyRoute() },
    },
    {
      when: "the test gives no slots",
      given: undefined,
      answer: { count: 1, label: "x", route: emptyRoute() },
    },
    {
      when: "the test gives a slot the reducer does not write",
      given: { slots: { label: "y" } },
      answer: { count: 1, label: "y", route: emptyRoute() },
    },
    {
      when: "the test gives part of the route",
      given: { slots: { route: { path: "/p" } } },
      answer: { count: 1, label: "x", route: { ...emptyRoute(), path: "/p" } },
    },
  ])("holds every slot, the defaults then the given ones then the writes, when $when", ({
    given,
    answer,
  }) => {
    const after = _stdlib.runReducerStep(makeApp(), given, "inc", {});

    expect(after.slots).toEqual(answer);
  });

  it("hands the whole table to every chained step", () => {
    const app = makeApp();
    const first = _stdlib.runReducerStep(app, { slots: { count: 3 } }, "inc", {});
    const second = _stdlib.runReducerStep(app, first, "inc", {});

    expect(first.slots).toEqual({ count: 4, label: "x", route: emptyRoute() });
    expect(second.slots).toEqual({ count: 5, label: "x", route: emptyRoute() });
  });
});
