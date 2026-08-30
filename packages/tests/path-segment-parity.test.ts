// A write path is built by the compiler and decoded by the runtime, and each
// declares the segment type it works with: the compiler's browser-safe core
// does not import from the runtime, so the two declarations are separate by
// design. Separate declarations of one wire format drift — which is the class
// of bug the `.get` segment exists to fix — so they are compared here, in the
// one package that depends on both.
//
// The assertions are the assignments themselves: a drift fails `pnpm
// typecheck` rather than this test body.

import { type BindSegment as CompilerBindSegment, UNWRAP_SEGMENT } from "@kumikijs/compiler";
import { _setPathHelper, type BindSegment as RuntimeBindSegment } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const _compilerToRuntime: RuntimeBindSegment = null as unknown as CompilerBindSegment;
const _runtimeToCompiler: CompilerBindSegment = null as unknown as RuntimeBindSegment;

describe("the segment the compiler emits is the one the runtime decodes", () => {
  it("keeps the two declarations mutually assignable", () => {
    // The type check above is the guard; this keeps the bindings used, and
    // fails loudly if either import disappears.
    expect(_compilerToRuntime).toBeNull();
    expect(_runtimeToCompiler).toBeNull();
  });

  it("unwraps through the datum the compiler emits", () => {
    // Not a restatement of the types: `UNWRAP_SEGMENT` is what codegen
    // serialises, and this is the setter reading that exact value.
    expect(_setPathHelper({ _tag: "Some", _0: { t: "a" } }, [UNWRAP_SEGMENT, "t"], "b")).toEqual({
      _tag: "Some",
      _0: { t: "b" },
    });
  });
});
