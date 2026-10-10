import { _stdlibCore } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

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
