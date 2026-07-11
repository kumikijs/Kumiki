import { KumikiPanic, panicInfo } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

describe("panicInfo (#162)", () => {
  it("extracts message + stack from a plain Error and defaults location to undefined", () => {
    const e = new Error("boom");
    const rec = panicInfo(e, "reducer");
    expect(rec.message).toBe("boom");
    expect(rec.location).toBeUndefined();
    expect(rec.stack).toMatch(/boom/);
    expect(rec.cause).toBeUndefined();
    expect(rec.category).toBe("reducer");
  });

  it("preserves KumikiPanic.location", () => {
    const e = new KumikiPanic("boom", "at X");
    const rec = panicInfo(e, "reducer");
    expect(rec.location).toBe("at X");
    expect(rec.message).toBe("boom");
    expect(rec.stack).toMatch(/boom/);
  });

  it("flattens a 3-link Error.cause chain in order", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    const rec = panicInfo(top, "reducer");
    expect(rec.cause).toBeDefined();
    expect(rec.cause!.map((c) => c.message)).toEqual(["mid", "root"]);
    expect(rec.cause![0]!.stack).toMatch(/mid/);
    expect(rec.cause![1]!.stack).toMatch(/root/);
  });

  it("stops at the depth cap and does not loop on a self-cyclic cause", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    a.cause = a;
    const rec = panicInfo(a, "reducer");
    // First visit lands in `chain`, the immediate self-repeat is skipped by the
    // `seen` guard — so we end up with exactly one link, not a hang.
    expect(rec.cause).toBeDefined();
    expect(rec.cause!.length).toBe(1);
    expect(rec.cause![0]!.message).toBe("a");
  });

  it("caps the chain at PANIC_CAUSE_MAX_DEPTH = 8", () => {
    // Build a 20-deep chain — the collector must trim it, not walk the lot.
    let prev: Error | undefined;
    for (let i = 0; i < 20; i++) {
      prev = new Error(`link-${i}`, prev !== undefined ? { cause: prev } : undefined);
    }
    const rec = panicInfo(prev!, "reducer");
    expect(rec.cause).toBeDefined();
    expect(rec.cause!.length).toBe(8);
  });

  it("handles a non-Error throw (string) with undefined stack + cause", () => {
    const rec = panicInfo("string throw", "unknown");
    expect(rec.message).toBe("string throw");
    expect(rec.stack).toBeUndefined();
    expect(rec.cause).toBeUndefined();
    expect(rec.category).toBe("unknown");
  });

  it("defaults category to 'unknown' when omitted", () => {
    const rec = panicInfo(new Error("x"));
    expect(rec.category).toBe("unknown");
  });

  it("KumikiPanic forwards options.cause to native Error.cause", () => {
    const root = new Error("root");
    const e = new KumikiPanic("boom", "at X", { cause: root });
    expect((e as Error & { cause?: unknown }).cause).toBe(root);
    const rec = panicInfo(e, "reducer");
    expect(rec.cause).toBeDefined();
    expect(rec.cause![0]!.message).toBe("root");
  });
});
