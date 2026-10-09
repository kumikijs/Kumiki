// A tile-test is about its target's render, so a panic there is the test's
// own outcome: an unexpected panic, reported as a reducer-test reports a
// reducer that panics (testing.md §8.4). The guard covers that render and
// nothing else — a panic while the test evaluates its own `given.slots`,
// `given.in` or `expect` is a throw in the test's body, which the runner
// reports on its `error:` line (§8.7.1).
//
// The generated tests are run here rather than read, because what is in
// question is which throw lands where.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { afterAll, describe, expect, it } from "vitest";

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

// Under the package dir so the generated `import "@kumikijs/runtime"` resolves.
const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

type GeneratedTest = { name: string; run: () => TestResult };

/** The program's generated tests, by name, from the module `compile` emits. */
async function loadTests(): Promise<Map<string, GeneratedTest>> {
  const result = compile(SRC, {
    runtimeSpecifier: "@kumikijs/runtime",
    exportApp: true,
    includeTests: true,
  });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const dir = mkdtempSync(join(TMP_ROOT, "tile-test-panic-"));
  made.push(dir);
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as {
    default: { _tests: GeneratedTest[] };
  };
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

  it("leaves a panic in the test's own `given.slots` thrown", async () => {
    await expect(run("given-slots-panics")).rejects.toThrow(OWN_PANIC);
  });

  it("leaves a panic in the test's own `given.in` thrown", async () => {
    await expect(run("given-in-panics")).rejects.toThrow(OWN_PANIC);
  });

  it("leaves a panic in the test's own `expect` thrown", async () => {
    await expect(run("expect-panics")).rejects.toThrow(OWN_PANIC);
  });
});
