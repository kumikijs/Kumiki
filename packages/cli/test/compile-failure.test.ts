import { describe, expect, it } from "vitest";
import { loadApp } from "../src/smoke.ts";

const NOT_A_RECORD = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+", onClick=inc)
tile App = column(B, text(count.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test starts-at-41 =
    reducer-test inc
        given  = {slots: 41}
        expect = {slots: {count: 42}}
`;

const IN_TEST =
  'E0713 test-shape-invalid at 8:26: `given.slots` must be a record, `{<slot>: …}` (in test "starts-at-41")';

describe("loadApp on a source that does not compile", () => {
  it("names no file when it was given none, and keeps positions and test names", async () => {
    await expect(loadApp(NOT_A_RECORD, [], { includeTests: true })).rejects.toThrow(
      `compile failed:\n${IN_TEST}`,
    );
  });

  it("finds the last test of the file even with blank and comment lines after it", async () => {
    const trailing = `${NOT_A_RECORD}\n\n# trailing comment\n# another\n\n`;
    await expect(loadApp(trailing, [], { includeTests: true })).rejects.toThrow(
      `compile failed:\n${IN_TEST}`,
    );
  });
});
