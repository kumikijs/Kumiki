import { _stdlib } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

type ReducerTestInput = Parameters<typeof _stdlib.runReducerTest>[0];
type Emit = { effect: string; args: unknown[] };

const reducerTest = (over: Partial<ReducerTestInput>) =>
  _stdlib.runReducerTest({
    name: "t",
    target: "r",
    slotMetas: {},
    givenSlots: {},
    result: { slots: {}, emits: [] },
    panic: null,
    expect: { kind: "state", slots: {}, effects: [] },
    ...over,
  });

const produced = (slots: Record<string, unknown>, emits: Emit[] = []) => ({ slots, emits });

const expected = (
  slots: Record<string, unknown>,
  effects: { effect: string; args: unknown[]; argsSpecified: boolean }[] = [],
): ReducerTestInput["expect"] => ({ kind: "state", slots, effects });

const persistOf = (arg: unknown) => ({ effect: "persist", args: [arg], argsSpecified: true });

describe("runReducerTest", () => {
  it.each<[string, Partial<ReducerTestInput>]>([
    [
      "slots and effects match",
      { givenSlots: { count: 0 }, result: produced({ count: 1 }), expect: expected({ count: 1 }) },
    ],
    [
      "an expected panic matches by substring",
      {
        result: null,
        panic: "draft cannot be empty",
        expect: { kind: "panic", message: "cannot be empty" },
      },
    ],
    [
      "a bare effect name matches by name only",
      {
        result: produced({}, [{ effect: "persist", args: [{ x: 1 }] }]),
        expect: expected({}, [{ effect: "persist", args: [], argsSpecified: false }]),
      },
    ],
    [
      "<any-id> matches any value at a slot position",
      {
        result: produced({ id: "9ab3-generated-uuid" }),
        expect: expected({ id: _stdlib.wild("any-id") }),
      },
    ],
    [
      "<slots.X> in an effect arg matches the post-execution slot value",
      {
        result: produced({ todos: { a: { text: "Hi" } } }, [
          { effect: "persist", args: [{ a: { text: "Hi" } }] },
        ]),
        expect: expected({ todos: { a: { text: "Hi" } } }, [
          persistOf(_stdlib.wild("slot", "todos")),
        ]),
      },
    ],
    [
      "an <any-id> map key matches exactly one generated entry, comparing its value shape",
      {
        result: produced({
          todos: { "uuid-xyz": { id: "uuid-xyz", text: "Hello", done: false, createdAt: 1717 } },
          draft: "",
        }),
        expect: expected({
          todos: {
            [_stdlib.WILD_KEY]: {
              id: _stdlib.wild("any-id"),
              text: "Hello",
              done: false,
              createdAt: _stdlib.wild("any-id"),
            },
          },
          draft: "",
        }),
      },
    ],
  ])("passes when %s", (_, input) => {
    expect(reducerTest(input).pass).toBe(true);
  });

  it.each<[string, Partial<ReducerTestInput>, string | RegExp]>([
    [
      "it emits an effect the test does not expect",
      { result: produced({}, [{ effect: "persist", args: [] }]) },
      /^effects\.length$/,
    ],
    [
      "a parenthesised effect pins its args, so persist() rejects persist(x)",
      {
        result: produced({}, [{ effect: "persist", args: [1] }]),
        expect: expected({}, [{ effect: "persist", args: [], argsSpecified: true }]),
      },
      "args",
    ],
    [
      "objects differ in keys whose values are undefined",
      { result: produced({ s: { a: undefined } }), expect: expected({ s: { b: undefined } }) },
      /^slots\.s/,
    ],
    [
      "a <slots.X> effect arg does not equal the slot value",
      {
        result: produced({ todos: { a: 1 } }, [{ effect: "persist", args: [{ a: 2 }] }]),
        expect: expected({ todos: { a: 1 } }, [persistOf(_stdlib.wild("slot", "todos"))]),
      },
      "args",
    ],
    [
      "an <any-id> map key matches no entry",
      {
        result: produced({ todos: {} }),
        expect: expected({ todos: { [_stdlib.WILD_KEY]: { text: "Hello" } } }),
      },
      /^slots\.todos$/,
    ],
    [
      "an <any-id> map key matches more than one entry",
      {
        result: produced({ todos: { a: { text: "Hello" }, b: { text: "Hello" } } }),
        expect: expected({ todos: { [_stdlib.WILD_KEY]: { text: "Hello" } } }),
      },
      /^slots\.todos$/,
    ],
  ])("fails when %s", (_, input, diffAt) => {
    const r = reducerTest(input);
    expect(r.pass).toBe(false);
    expect(r.diffAt).toMatch(diffAt);
  });

  it("reports the diff path and both leaf values on a slot mismatch", () => {
    const r = reducerTest({
      givenSlots: { msg: "Helo" },
      result: produced({ msg: "Helo" }),
      expect: expected({ msg: "Hello" }),
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("slots.msg");
    expect(r.leaf).toEqual({ expected: "Hello", actual: "Helo" });
  });
});

describe("runTileTest", () => {
  it("compares structure, ignoring handlers", () => {
    const actual = {
      kind: "column",
      children: [{ kind: "button", text: "+1", props: { onClick: () => undefined } }],
    };
    const expectedTree = {
      kind: "column",
      children: [{ kind: "button", text: "+1", props: {} }],
    };
    expect(_stdlib.runTileTest({ name: "t", actual, expected: expectedTree }).pass).toBe(true);
  });

  it("exposes the leaf text values on a `.text` mismatch", () => {
    const r = _stdlib.runTileTest({
      name: "t",
      actual: { kind: "heading", text: "Cont: 5" },
      expected: { kind: "heading", text: "Count: 5" },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toContain("text");
    expect(r.leaf).toEqual({ expected: "Count: 5", actual: "Cont: 5" });
  });

  it("names a root kind mismatch without a leading dot, and leaves `leaf` unset", () => {
    const r = _stdlib.runTileTest({
      name: "t",
      actual: { kind: "row" },
      expected: { kind: "column" },
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt?.startsWith(".")).toBe(false);
    expect(r.diffAt).toContain("kind");
    expect(r.leaf).toBeUndefined();
  });
});

describe("resetLive", () => {
  it("clears, seeds defaults, then applies given", () => {
    const live: Record<string, unknown> = { stale: 1 };
    _stdlib.resetLive(live, { count: { value: 0 }, name: { value: "x" } }, { count: 5 });
    expect(live).toEqual({ count: 5, name: "x", route: expect.anything() });
    expect(live.route).toMatchObject({ path: "/", pattern: "/" });
  });
});

describe("runReducerTestFlow (reducer-test effect mocks)", () => {
  type FlowInput = Parameters<typeof _stdlib.runReducerTestFlow>[0];
  type FlowApp = FlowInput["app"];
  // `fetchUser` emits `loadUser`; its result drives `userLoaded` (.ok) or `userFailed` (.err).
  const makeFlowApp = (): FlowApp => ({
    slots: { users: { value: {} }, error: { value: "" } },
    live: {},
    effects: {},
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
          return { slots: { users: { ...(live.users as object), [u.id]: u } }, emits: [] };
        },
      },
      {
        name: "userFailed",
        event: { kind: "effect", effect: "loadUser", outcome: "err" },
        apply: (_live, p) => ({ slots: { error: (p as { $1: unknown }).$1 }, emits: [] }),
      },
    ],
  });

  const run = (app: FlowApp, rest: Pick<FlowInput, "mocks" | "expect">) => {
    _stdlib.resetLive(app.live, app.slots, { users: {}, error: "" });
    return _stdlib.runReducerTestFlow({
      name: "t",
      app,
      target: "fetchUser",
      el: { id: "u1" },
      ...rest,
    });
  };

  it.each<[string, Pick<FlowInput, "mocks" | "expect">]>([
    [
      "delivers a mocked `ok` result to the .ok reducer",
      {
        mocks: { loadUser: { outcome: "ok", value: { id: "u1", name: "Alice" } } },
        expect: expected({ users: { u1: { id: "u1", name: "Alice" } }, error: "" }),
      },
    ],
    [
      "delivers a mocked `err` result to the .err reducer",
      {
        mocks: { loadUser: { outcome: "err", value: "boom" } },
        expect: expected({ users: {}, error: "boom" }),
      },
    ],
    [
      "resolves `delay(ms, ok(v))` immediately, in virtual time",
      {
        mocks: { loadUser: { outcome: "ok", value: { id: "u1", name: "Z" }, delayMs: 500 } },
        expect: expected({ users: { u1: { id: "u1", name: "Z" } }, error: "" }),
      },
    ],
    [
      "leaves a non-mocked emit residual, asserted via expect.effects",
      {
        mocks: {},
        expect: expected({ users: {}, error: "" }, [
          { effect: "loadUser", args: [], argsSpecified: false },
        ]),
      },
    ],
  ])("%s", (_, rest) => {
    expect(run(makeFlowApp(), rest).pass).toBe(true);
  });

  it("fails a mocked `err` that no .err reducer handles", () => {
    const app = makeFlowApp();
    app.reducers = app.reducers.filter((r) => r.name !== "userFailed");
    const r = run(app, {
      mocks: { loadUser: { outcome: "err", value: "boom" } },
      expect: expected({ users: {}, error: "" }),
    });
    expect(r.pass).toBe(false);
    expect(r.diffAt).toContain("unhandled");
  });
});

describe("runPropertyTest", () => {
  it("genValue keeps an Int within its [min, max] bounds", () => {
    const seq = [0, 0.25, 0.5, 0.75, 0.999];
    let i = 0;
    const rng = () => seq[i++ % seq.length] as number;
    for (let k = 0; k < 20; k++) {
      const v = _stdlib.genValue({ t: "Int", min: 0, max: 100 }, rng) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("genValue Text honors minLen and maxLen", () => {
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

  it("passes, reporting the case count, when the invariant always holds", () => {
    const r = _stdlib.runPropertyTest({
      name: "always",
      vars: { n: { t: "Int", min: 0, max: 10 } },
      trial: (b) => (b.n as number) >= 0,
    });
    expect(r.pass).toBe(true);
    expect(r.cases).toBe(100);
  });

  it.each([1, 10_000])("runs exactly the %i cases a whole-number count asks for", (count) => {
    let calls = 0;
    const r = _stdlib.runPropertyTest({
      name: "counted",
      vars: { n: { t: "Int", min: 0, max: 10 } },
      trial: () => {
        calls += 1;
        return true;
      },
      count,
    });
    expect([r.pass, r.cases, calls]).toEqual([true, count, count]);
  });

  // The invariant fails on every input, so a count that ran a case would report a
  // counterexample and one that ran none would report a pass.
  it.each([
    { count: 0, shown: "0" },
    { count: 0.5, shown: "0.5" },
    { count: -3, shown: "-3" },
    { count: -0, shown: "-0" },
    { count: Number.NaN, shown: "NaN" },
    { count: Number.POSITIVE_INFINITY, shown: "Infinity" },
    { count: "5", shown: '"5"' },
    { count: null, shown: "null" },
  ])("fails a count of $shown without running a case, naming the count", ({ count, shown }) => {
    let calls = 0;
    const r = _stdlib.runPropertyTest({
      name: "bad-count",
      vars: { n: { t: "Int", min: 0, max: 10 } },
      trial: () => {
        calls += 1;
        return false;
      },
      count: count as number,
    });
    expect(r).toEqual({
      name: "bad-count",
      pass: false,
      expected: "count is a whole number, 1 or more",
      actual: `count = ${shown}`,
      diffAt: "(count)",
      cases: 0,
    });
    expect(calls).toBe(0);
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

  it("counts a thrown invariant as a failure, not a crash", () => {
    const r = _stdlib.runPropertyTest({
      name: "throws",
      vars: { n: { t: "Int", min: 0, max: 10 } },
      trial: () => {
        throw new Error("boom");
      },
    });
    expect(r.pass).toBe(false);
  });

  it("yields the same counterexample for the same seed", () => {
    const mk = () =>
      _stdlib.runPropertyTest({
        name: "same",
        vars: { n: { t: "Int", min: 0, max: 100 } },
        trial: (b) => (b.n as number) < 5,
        seed: 42,
      });
    expect(mk().actual).toBe(mk().actual);
  });

  it("shrinks a failing List to the shortest length that still fails", () => {
    const r = _stdlib.runPropertyTest({
      name: "short-list",
      vars: { xs: { t: "List", elem: { t: "Int", min: 0, max: 9 } } },
      trial: (b) => (b.xs as unknown[]).length < 3,
      seed: 7,
    });
    expect(r.pass).toBe(false);
    const m = JSON.parse((r.actual ?? "").replace(/^.*?(\{.*\})$/, "$1")) as { xs: unknown[] };
    expect(m.xs.length).toBe(3);
  });
});
