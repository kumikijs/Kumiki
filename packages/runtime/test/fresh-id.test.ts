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

/** A `getRandomValues` that sets byte `i` of what it is handed to `fill(i)`. */
const bytesFrom = (fill: (i: number) => number) =>
  vi.fn(<T extends ArrayBufferView>(a: T): T => {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = fill(i);
    return a;
  });

/** A `getRandomValues` that fills every byte it is handed with `byte`. */
const constantBytes = (byte: number) => bytesFrom(() => byte);

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

  it.each<[string, (i: number) => number, string]>([
    ["distinct random bytes", (i) => 0x11 * (i + 1), "01a12088-d200-71aa-9122-334455667788"],
    // The counter's top bit stays clear, so a millisecond can count up before it rolls over.
    ["random bytes all 0xff", () => 0xff, "01a12088-d200-77ff-bfff-ffffffffffff"],
    ["random bytes all 0x5a", () => 0x5a, "01a12088-d200-725a-9a5a-5a5a5a5a5a5a"],
  ])("lays out %s as RFC 9562 does, and never asks randomUUID", async (_, fill, expected) => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000000");
    const getRandomValues = bytesFrom(fill);
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    const s = await freshStdlib();
    expect(s.freshId()).toBe(expected);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["no crypto at all", undefined],
    ["a crypto with neither member", {}],
    ["a crypto with only randomUUID", { randomUUID: () => "00000000-0000-4000-8000-000000000000" }],
  ])("falls back to Math.random on %s", async (_, crypto) => {
    vi.stubGlobal("crypto", crypto);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const s = await freshStdlib();
    expect(s.freshId()).toBe("01a12088-d200-7080-8080-808080808080");
  });
});

describe("ids one runtime mints sort in the order they were minted", () => {
  it("within one millisecond, past the point the counter rolls over", async () => {
    // Every random bit set seeds the counter at its highest start, 0x7ff, so a millisecond holds
    // the fewest ids it can, 2,049, before a rolled-over counter moves the timestamp on.
    vi.stubGlobal("crypto", { getRandomValues: constantBytes(0xff) });
    const s = await freshStdlib();
    const ids = Array.from({ length: 5000 }, () => s.freshId());
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expectMintOrder(ids);
    expect(ids[0], "the seed").toBe("01a12088-d200-77ff-bfff-ffffffffffff");
    expect(ids[1], "the next count").toBe("01a12088-d200-7800-bfff-ffffffffffff");
    expect(ids[2048], "the last count").toBe("01a12088-d200-7fff-bfff-ffffffffffff");
    expect(ids[2049], "the rollover").toBe("01a12088-d201-77ff-bfff-ffffffffffff");
    expect(stampOf(ids[4999] as string), "the second rollover").toBe(T0 + 2);
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

  it("with an emit's own EffectId, which the same generator mints", async () => {
    const s = await freshStdlib();
    const a = s.freshId();
    const effectId = s.emitId(undefined, { effect: "load", args: [] });
    expect(effectId).toMatch(/^load#/);
    const b = effectId.slice("load#".length);
    expect(b).toMatch(UUID_V7);
    expectMintOrder([a, b, s.freshId()]);
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
