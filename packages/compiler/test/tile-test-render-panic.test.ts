// A panic while the test evaluates its own `given` or `expect` is a throw in
// the test's body, not the target's panic. The generated tests are run rather
// than read, because what is in question is which throw lands where.

import type { TestResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { compileOrFail, importModule, LOADABLE } from "./helpers/module.ts";

const SRC = `slot items : List(Int) = []
slot count : Int = 0

reducer pick on=ui.click(Go) do= count := items[0]

tile Go = button(text="go")
tile First = heading("First: " + items[0].show)
tile Label in=Text = text($1)
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
test pick-panics =
    reducer-test pick
        given  = {slots: {items: []}, event: {type: ui.click, target: Go}}
        expect = {slots: {count: 1}}`;

/** The message `[0][1]` and `[""][1]` panic with — distinct from the render's. */
const OWN_PANIC = "Index 1 is out of range for a List of length 1";

type GeneratedTest = { name: string; run: () => TestResult };

async function loadTests(): Promise<Map<string, GeneratedTest>> {
  const mod = await importModule<{ default: { _tests: GeneratedTest[] } }>(
    compileOrFail(SRC, { ...LOADABLE, includeTests: true }),
    "tile-test-panic",
  );
  return new Map(mod.default._tests.map((t) => [t.name, t]));
}

describe("a tile-test's guard", () => {
  const testsP = loadTests();
  const run = async (name: string): Promise<TestResult> => {
    const t = (await testsP).get(name);
    if (!t) throw new Error(`no test ${name}`);
    return t.run();
  };

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
