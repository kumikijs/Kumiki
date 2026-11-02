import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

// A Map key spelled "__proto__" is an ordinary key (stdlib.md §2.2.2), so the snapshot a scenario's
// `state` reads holds it as an entry like any other.
const program = withApp(`type Note = {x: Int}
slot counts : Map(Text, Int) = {"__proto__": 1, "a": 2}
slot notes : Map(Text, Note) = {"__proto__": {x: 1}}
tile App = column(text("x"))`);

describe('a scenario\'s state snapshot of a Map with a "__proto__" key', () => {
  it("holds the entry", async () => {
    const shape = await loadSource(program);
    // JSON.parse makes "__proto__" an own key, as a scenario file read from disk has it.
    const state = JSON.parse('{"counts": {"__proto__": 1, "a": 2}}');
    const report = await runScenario(shape, freshRoot(), { steps: [{ expect: { state } }] });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("does not read the entry's fields as keys of the Map", async () => {
    const shape = await loadSource(program);
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ expect: { state: { notes: { x: 1 } } } }],
    });
    expect(failureDetail(report)).toContain('state notes: expected {"x":1}');
  });
});
