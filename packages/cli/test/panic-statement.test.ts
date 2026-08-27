// `panic("...")` written as a statement, actually run.
//
// The compiler tests prove it parses, typechecks and lowers. None of them run
// it: the example's panic is guarded so the app stays mountable, and the
// scenario asserts only that it does not fire. So `_s.panic` could be renamed,
// or the statement lowered to nothing, with every one of those still green.
//
// A `reducer-test` with `expect = {panic: "..."}` is the seam that runs one.
// It also pins that the message reaches the stop rather than being stringified
// away on the way there.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { testFile } from "../src/smoke.ts";

const dir = mkdtempSync(join(tmpdir(), "kumiki-panic-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source);
  return path;
}

const SOURCE = `slot armed : Bool = false
slot n     : Int  = 0

tile Btn = button(text="go", onClick=stop)
tile App = column(Btn, text(n.show))

reducer stop on=ui.click(Btn) do= if armed then panic("armed and stopped")
                                  else n := n + 1

app A caps=[] routes={"/" -> App, "/404" -> App} init=[]

test stops-when-armed = reducer-test stop
    given  = {slots: {armed: true, n: 0}, event: {type: ui.click, target: Btn}}
    expect = {panic: "armed and stopped"}

test runs-otherwise = reducer-test stop
    given  = {slots: {armed: false, n: 0}, event: {type: ui.click, target: Btn}}
    expect = {slots: {armed: false, n: 1}, effects: []}
`;

describe("panic as a reducer statement", () => {
  it("stops the reducer, carrying its message", { timeout: 30_000 }, async () => {
    const results = await testFile(write("panic.kumiki", SOURCE));
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual([
      "stops-when-armed:true",
      "runs-otherwise:true",
    ]);
  });

  it("reports the message it actually stopped with", { timeout: 30_000 }, async () => {
    const wrong = SOURCE.replace('expect = {panic: "armed and stopped"}', 'expect = {panic: "x"}');
    const results = await testFile(write("panic-wrong.kumiki", wrong));
    const failed = results.find((r) => r.name === "stops-when-armed");
    expect(failed?.pass).toBe(false);
    expect(JSON.stringify(failed)).toContain("armed and stopped");
  });
});
