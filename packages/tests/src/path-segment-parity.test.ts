import {
  type BindSegment as CompilerBindSegment,
  indexSegmentJs,
  UNWRAP_SEGMENT,
} from "@kumikijs/compiler";
import { _setPathHelper, type BindSegment as RuntimeBindSegment } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const _compilerToRuntime: RuntimeBindSegment = null as unknown as CompilerBindSegment;
const _runtimeToCompiler: CompilerBindSegment = null as unknown as RuntimeBindSegment;

describe("the segment the compiler emits is the one the runtime decodes", () => {
  it("keeps the two declarations mutually assignable", () => {
    expect(_compilerToRuntime).toBeNull();
    expect(_runtimeToCompiler).toBeNull();
  });

  it("unwraps through the datum the compiler emits", () => {
    expect(_setPathHelper({ _tag: "Some", _0: { t: "a" } }, [UNWRAP_SEGMENT, "t"], "b")).toEqual({
      _tag: "Some",
      _0: { t: "b" },
    });
  });

  it("reads the index step the compiler emits as an index, not as a field", () => {
    const step = new Function("k", `return ${indexSegmentJs("k")};`) as (k: unknown) => never;
    const todos = { t1: { done: false } };
    expect(_setPathHelper(todos, [step("t9"), "done"], true)).toBe(todos);
    expect(_setPathHelper(todos, [step("t1"), "done"], true)).toEqual({ t1: { done: true } });
  });
});
