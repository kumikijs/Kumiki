import { describe, expect, it } from "vitest";
import { bindPathStartsWith, type PathSegment } from "../src/core/path.ts";

const GET: PathSegment = { get: true };

describe("a bound path read against an error tile's path", () => {
  it.each<[string, PathSegment[], PathSegment[], boolean]>([
    ["the whole slot covers any path", ["email"], [], true],
    ["the whole slot covers the slot itself", [], [], true],
    ["an equal field", ["email"], ["email"], true],
    ["a field below the prefix", ["contact", "email"], ["contact"], true],
    ["a different field", ["email"], ["age"], false],
    ["an unwrap against an unwrap", [GET, "title"], [GET], true],
    ["a field spelled get against an unwrap", ["get"], [GET], false],
    ["an unwrap against a field spelled get", [GET], ["get"], false],
    ["an index against the same key", [{ at: 0 }, "email"], [{ at: 0 }], true],
    ["an index against another key", [{ at: 0 }, "email"], [{ at: 1 }], false],
    ["an index against a field", ["email"], [{ at: 0 }], false],
    ["a Map key against the same key", [{ at: "b" }, "age"], [{ at: "b" }, "age"], true],
    [
      "a record key against an equal record, its fields in another order",
      [{ at: { x: 0, y: 1 } }, "qty"],
      [{ at: { y: 1, x: 0 } }],
      true,
    ],
    ["a tag key against the same tag", [{ at: { _tag: "Red" } }], [{ at: { _tag: "Red" } }], true],
    ["a tag key against another tag", [{ at: { _tag: "Red" } }], [{ at: { _tag: "Blue" } }], false],
    ["a prefix longer than the path", ["contact"], ["contact", "email"], false],
  ])("%s: %j through %j is %s", (_label, path, prefix, expected) => {
    expect(bindPathStartsWith(path, prefix)).toBe(expected);
  });
});
