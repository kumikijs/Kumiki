// Regression (#444 follow-up): `uuid` now gates the paths a refinement sits on,
// so every `<T>.fresh()` the runtime hands a reducer has to pass that check.
// `crypto.randomUUID` exists only in a secure context; a page served over plain
// http (or loaded with `page.setContent`) falls back, and the old fallback
// (`Math.random().toString(36) + Date.now().toString(36)`) was not a uuid, so a
// keyed `todos` / `expenses` write was rejected in the browser tier.

import { _stdlibCore } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

// The same shape `uuid` checks (compiler/src/refinements.ts), plus the v4
// version and variant nibbles the fallback promises.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("freshId outside a secure context", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a v4 uuid from getRandomValues when randomUUID is missing", () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView>(a: T): T => {
      new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(0xff);
      return a;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const id = _stdlibCore.freshId();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("still yields a uuid when there is no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = new Set(Array.from({ length: 50 }, () => _stdlibCore.freshId()));
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(ids.size).toBe(50);
  });

  it("prefers randomUUID when the platform has it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
    expect(_stdlibCore.freshId()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
