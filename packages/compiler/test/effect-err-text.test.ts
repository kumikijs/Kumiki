// Codegen puts `errText` on an effect's spec only when its capability fails
// with `Text` (stdlib.md §2.5): that is the reading a mock replacing `invoke`
// (the scenario runner) applies to a scripted err. On any other capability
// the err is the provider's `E`, an `HttpError` or a custom record, and must
// reach `.err` as written, so the field must be absent there.

import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { failsWithText } from "../src/capabilities.ts";

const program = (cap: string, mapRequest: string) => `
slot problem : Text = ""
effect run cap=${cap} in=Unit out=Result(Unit, Text) map-request=${mapRequest}
reducer boot   on=app.start      do= emit run()
reducer failed on=run.err($e, _) do= problem := $e
tile App = column(text(problem))
app ErrText
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

/** The generated spec of the effect `run`, from its name to the end of its object. */
function runSpec(cap: string, mapRequest: string): string {
  const result = compile(program(cap, mapRequest), {
    runtimeSpecifier: "./runtime.js",
    capabilities: ["acme.fault"],
  });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const start = result.js.indexOf('name: "run"');
  expect(start).toBeGreaterThan(-1);
  return result.js.slice(start, result.js.indexOf("\n  }", start));
}

describe("an effect's spec carries errText exactly when its capability fails with Text", () => {
  it.each([
    ["storage.read", `{key: "k"}`],
    ["storage.write", `{key: "k", value: "v"}`],
    ["session.read", `{key: "k"}`],
    ["session.write", `{key: "k", value: "v"}`],
    ["indexed.read", `{store: "s", key: "k"}`],
    ["indexed.write", `{store: "s", key: "k", value: "v"}`],
    ["indexed.delete", `{store: "s", key: "k"}`],
  ])("%s: errText is the emitted _errText", (cap, mapRequest) => {
    expect(failsWithText(cap)).toBe(true);
    expect(runSpec(cap, mapRequest)).toContain("errText: _errText,");
  });

  it.each([
    ["http.get", `{url: "/x"}`],
    ["acme.fault", `{}`],
  ])("%s: no errText", (cap, mapRequest) => {
    expect(failsWithText(cap)).toBe(false);
    const spec = runSpec(cap, mapRequest);
    expect(spec).toContain("invoke:");
    expect(spec).not.toContain("errText");
  });
});
