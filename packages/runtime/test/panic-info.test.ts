import { KumikiPanic, panicInfo } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

describe("panicInfo", () => {
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

  it("does not add a redundant link when the root is its own cause", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    a.cause = a;
    const rec = panicInfo(a, "reducer");
    expect(rec.message).toBe("a");
    expect(rec.cause).toBeUndefined();
  });

  it("does not loop when a mid-chain link points back to an earlier link", () => {
    // top -> mid -> root -> mid (cycle inside the chain)
    const mid = new Error("mid") as Error & { cause?: unknown };
    const root = new Error("root", { cause: mid });
    mid.cause = root;
    const top = new Error("top", { cause: mid });
    const rec = panicInfo(top, "reducer");
    expect(rec.cause).toBeDefined();
    expect(rec.cause!.map((c) => c.message)).toEqual(["mid", "root"]);
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

  it("stringifies a non-Error link inside the cause chain", () => {
    const top = new Error("top", { cause: "disk full" });
    const rec = panicInfo(top, "reducer");
    expect(rec.cause).toBeDefined();
    expect(rec.cause!.length).toBe(1);
    expect(rec.cause![0]!.message).toBe("disk full");
    // Non-Error links have no stack.
    expect(rec.cause![0]!.stack).toBeUndefined();
  });

  it("never re-throws when the throw's fields have hostile getters", () => {
    class Hostile extends Error {
      override get message(): string {
        throw new Error("hostile message getter");
      }
      override get stack(): string {
        throw new Error("hostile stack getter");
      }
      override get cause(): unknown {
        throw new Error("hostile cause getter");
      }
    }
    const rec = panicInfo(new Hostile(), "reducer");
    // Must not throw; must degrade gracefully.
    expect(rec.category).toBe("reducer");
    expect(typeof rec.message).toBe("string");
    expect(rec.stack).toBeUndefined();
    expect(rec.cause).toBeUndefined();
  });
});
