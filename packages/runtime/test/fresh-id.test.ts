import { withEnvRecord, withEnvReplay } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `uuid` refinement's shape, narrowed to version 7 and the RFC 9562 variant.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An instant whose 48-bit hex is `01a12088d200`. */
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

/** The Unix-millisecond timestamp a v7 id carries in its first 48 bits. */
const stampOf = (id: string): number => Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);

/**
 * The stdlib of a runtime that has minted nothing yet. The ordering floor is
 * per module, so each test loads its own copy rather than inheriting the ids
 * an earlier test minted.
 */
async function freshStdlib() {
  vi.resetModules();
  return (await import("../src/stdlib.ts"))._stdlibCore;
}

/** A `getRandomValues` that fills every byte it is handed with `byte`. */
const constantBytes = (byte: number) =>
  vi.fn(<T extends ArrayBufferView>(a: T): T => {
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(byte);
    return a;
  });

/** Every id after the first sorts after the one before it. */
function expectMintOrder(ids: string[]): void {
  for (let i = 1; i < ids.length; i++) {
    if (!((ids[i - 1] as string) < (ids[i] as string))) {
      throw new Error(`id ${i} (${ids[i]}) does not sort after id ${i - 1} (${ids[i - 1]})`);
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<T>.fresh() mints a UUIDv7", () => {
  it("carries the clock's millisecond, version 7 and variant 10", async () => {
    const s = await freshStdlib();
    const id = s.freshId();
    expect(id).toMatch(UUID_V7);
    expect(stampOf(id)).toBe(T0);
  });

  it("lays out timestamp, version, counter, variant and random bits as RFC 9562 does", async () => {
    vi.stubGlobal("crypto", { getRandomValues: constantBytes(0xff) });
    const s = await freshStdlib();
    // The counter starts from random bits with its top bit clear, so a run of
    // ids in one millisecond has room to count up before it rolls over.
    expect(s.freshId()).toBe("01a12088-d200-77ff-bfff-ffffffffffff");
  });

  it("takes the random bits from getRandomValues, and never asks randomUUID", async () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000000");
    const getRandomValues = constantBytes(0x5a);
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    const s = await freshStdlib();
    expect(s.freshId()).toBe("01a12088-d200-725a-9a5a-5a5a5a5a5a5a");
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["no crypto at all", undefined],
    ["a crypto with neither member", {}],
    ["a crypto with only randomUUID", { randomUUID: () => "00000000-0000-4000-8000-000000000000" }],
  ])("falls back to Math.random on %s", async (_, crypto) => {
    vi.stubGlobal("crypto", crypto);
    const random = vi.spyOn(Math, "random");
    const s = await freshStdlib();
    const ids = Array.from({ length: 50 }, () => s.freshId());
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(50);
    expectMintOrder(ids);
    expect(random).toHaveBeenCalled();
  });
});

describe("ids one runtime mints sort in the order they were minted", () => {
  it("within one millisecond, past the point the counter rolls over", async () => {
    // Constant random bits seed the counter at its highest start, 0x7ff, so it
    // rolls over after 2049 ids and the order rests on the counter alone.
    vi.stubGlobal("crypto", { getRandomValues: constantBytes(0xff) });
    const s = await freshStdlib();
    const ids = Array.from({ length: 5000 }, () => s.freshId());
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expectMintOrder(ids);
    expect(stampOf(ids[0] as string)).toBe(T0);
    // A rolled-over counter moves the timestamp on rather than wrapping.
    expect(stampOf(ids[2049] as string)).toBe(T0 + 1);
    expect(stampOf(ids[4999] as string)).toBe(T0 + 2);
  });

  it("within one millisecond, with the platform's random bits", async () => {
    const s = await freshStdlib();
    const ids = Array.from({ length: 5000 }, () => s.freshId());
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expectMintOrder(ids);
  });

  it("after the clock steps back, then by the clock once it passes the last id", async () => {
    const s = await freshStdlib();
    const a = s.freshId();
    vi.setSystemTime(T0 - 60_000);
    const b = s.freshId();
    const c = s.freshId();
    vi.setSystemTime(T0 + 5);
    const d = s.freshId();
    expectMintOrder([a, b, c, d]);
    expect([a, b, c, d].map(stampOf)).toEqual([T0, T0, T0, T0 + 5]);
  });
});

describe("a fresh id in an episode", () => {
  it("is journalled whole, so a replay hands back the recorded id and mints nothing", async () => {
    const s = await freshStdlib();
    const recorded = withEnvRecord(() => s.freshId());
    if (!recorded.ok) throw recorded.error;
    expect(recorded.env.reads).toEqual([{ kind: "fresh-id", value: recorded.value }]);

    vi.setSystemTime(T0 + 60_000);
    const getRandomValues = constantBytes(0);
    vi.stubGlobal("crypto", { getRandomValues });
    // Through JSON, as an episode reaches a replay from a log line.
    const reads = JSON.parse(JSON.stringify(recorded.env.reads)) as unknown;
    const replayed = withEnvReplay(reads, () => s.freshId());
    if (!replayed.ok) throw replayed.error;
    expect(replayed.value).toBe(recorded.value);
    expect(replayed.env).toEqual({ reads: [], live: 0, unused: 0, malformed: 0 });
    expect(getRandomValues).not.toHaveBeenCalled();
  });
});
