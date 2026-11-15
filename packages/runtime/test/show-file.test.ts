// @vitest-environment node
// happy-dom's `File` has fields of its own, where a browser's, like Node's, has none.
import { expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";

it("writes a File as its three fields and the handle on the picked file", () => {
  const file = { name: "a.txt", size: 3, type: "text/plain", _file: new File(["abc"], "a.txt") };
  expect(_stdlibCore.show(file)).toBe('{name: "a.txt", size: 3, type: "text/plain", _file: {}}');
});
