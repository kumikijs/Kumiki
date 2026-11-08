// A panic in the target's render is the test's result; one in the test's own `given` or
// `expect`, or anything but a panic from the code under test, is a throw in its body. The
// generated tests are run rather than read, because which throw lands where is the question.

import type { TestResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { compileOrFail, importModule, LOADABLE, type ReducerShape } from "./helpers/module.ts";

const SRC = `slot items : List(Int) = []
slot count : Int = 0

reducer pick on=ui.click(Go) do= count := items[0]

tile Go = button(text="go")
tile First = heading("First: " + items[0].show)
tile Label in=Text = text($1)
tile Oops = text("oops")
tile Guarded error-boundary=Oops = heading("First: " + items[0].show)
tile Holder = column(Guarded)
tile App = column(Go)

app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []

test render-panics =
    tile-test First
        given  = {slots: {items: []}}
        expect = heading("First: 1")
test renders =
    tile-test First
        given  = {slots: {items: [1]}}
        expect = heading("First: 1")
test given-slots-panics =
    tile-test First
        given  = {slots: {items: [1], count: [0][1]}}
        expect = heading("First: 1")
test given-in-panics =
    tile-test Label
        given  = {slots: {}, in: [""][1]}
        expect = text("")
test expect-panics =
    tile-test First
        given  = {slots: {items: [1]}}
        expect = heading("First: " + [0][1].show)
test own-boundary =
    tile-test Guarded
        given  = {slots: {items: []}}
        expect = text("oops")
test nested-boundary =
    tile-test Holder
        given  = {slots: {items: []}}
        expect = column(text("oops"))
test pick-panics =
    reducer-test pick
        given  = {slots: {items: []}, event: {type: ui.click, target: Go}}
        expect = {slots: {count: 1}}
test pick-expects-a-panic =
    reducer-test pick
        given  = {slots: {items: []}, event: {type: ui.click, target: Go}}
        expect = {panic: "not a function"}`;

/** The message `[0][1]` and `[""][1]` panic with — distinct from the render's. */
const OWN_PANIC = "Index 1 is out of range for a List of length 1";

type GeneratedTest = { name: string; run: () => TestResult };

type LoadedApp = {
  _tests: GeneratedTest[];
  _tilesById: Record<string, (input: unknown) => unknown>;
  reducers: ReducerShape[];
};

async function loadTestedApp(): Promise<LoadedApp> {
  const mod = await importModule<{ default: LoadedApp }>(
    compileOrFail(SRC, { ...LOADABLE, includeTests: true }),
    "tile-test-panic",
  );
  return mod.default;
}

async function loadTests(
  app: Promise<LoadedApp> = loadTestedApp(),
): Promise<Map<string, GeneratedTest>> {
  return new Map((await app)._tests.map((t) => [t.name, t]));
}

/** Runs the named test of `tests`, which a missing name fails rather than skips. */
async function runIn(
  tests: Promise<Map<string, GeneratedTest>>,
  name: string,
): Promise<TestResult> {
  const t = (await tests).get(name);
  if (!t) throw new Error(`no test ${name}`);
  return t.run();
}

describe("a tile-test's guard", () => {
  const testsP = loadTests();
  const run = (name: string): Promise<TestResult> => runIn(testsP, name);

  it("reports a panic in the target's render as the test's unexpected panic", async () => {
    expect(await run("render-panics")).toEqual({
      name: "render-panics",
      pass: false,
      expected: 'heading("First: 1")',
      actual: 'panic: "Index 0 is out of range for a List of length 0"',
      diffAt: "(unexpected panic)",
    });
  });

  it("reports it in the shape a reducer-test reports a reducer that panics", async () => {
    const shape = (r: TestResult) => ({ pass: r.pass, actual: r.actual, diffAt: r.diffAt });
    expect(shape(await run("render-panics"))).toEqual(shape(await run("pick-panics")));
  });

  it("renders the target's body, so the target's own boundary does not catch its panic", async () => {
    expect(await run("own-boundary")).toEqual({
      name: "own-boundary",
      pass: false,
      expected: 'text("oops")',
      actual: 'panic: "Index 0 is out of range for a List of length 0"',
      diffAt: "(unexpected panic)",
    });
  });

  it("keeps the boundary of a tile the body renders, and compares its fallback", async () => {
    expect(await run("nested-boundary")).toEqual(expect.objectContaining({ pass: true }));
  });

  it("compares a render that does not panic against the snapshot", async () => {
    expect((await run("renders")).pass).toBe(true);
  });

  it.each([
    ["given.slots", "given-slots-panics"],
    ["given.in", "given-in-panics"],
    ["expect", "expect-panics"],
  ])("leaves a panic in the test's own `%s` thrown", async (_section, name) => {
    await expect(run(name)).rejects.toThrow(OWN_PANIC);
  });
});

/** What a fault in the compiler or the runtime might throw: not a panic, and not always an `Error`. */
const FAULTS: [string, unknown][] = [
  ["an error", new TypeError("x.map is not a function")],
  ["a value", { a: 1 }],
  ["a value with a message", { message: "m" }],
];

describe.each(FAULTS)("the guard around the code under test, given %s", (_kind, fault) => {
  // The program has no such fault, so the tile and the reducer are replaced with code that throws one.
  const faultyP = loadTests(
    loadTestedApp().then((app) => {
      app._tilesById.First = () => {
        throw fault;
      };
      for (const r of app.reducers) {
        if (r.name === "pick")
          r.apply = () => {
            throw fault;
          };
      }
      return app;
    }),
  );
  const run = (name: string): Promise<TestResult> => runIn(faultyP, name);

  it("lets it out of the render, as a throw in the test's body", async () => {
    await expect(run("render-panics")).rejects.toBe(fault);
  });

  it("lets it out of a reducer-test's reducer too", async () => {
    await expect(run("pick-panics")).rejects.toBe(fault);
  });

  it("so a test that expects a panic is not passed by a fault", async () => {
    await expect(run("pick-expects-a-panic")).rejects.toBe(fault);
  });
});
